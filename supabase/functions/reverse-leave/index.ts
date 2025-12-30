import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";
import { cancelCalendarEvent } from "../helpers/cancelCalendarEvent.ts";
import { reconcileUserOOO } from "../helpers/reconcileUserOOO.ts";

// --------------------------- CORS ---------------------------
const allowedOrigins = [
  "https://leave-app-v2.vercel.app",
  "http://localhost:5173",
];
function getCORSHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

// --------------------------- Balance restore helper (best-effort) ---------------------------
// Supports two common schemas without breaking the main flow:
//  A) leave_balances(user_id, leave_type_id, used, remaining)
//  B) user_leave_balances(user_id PK, balances jsonb: { "<leave_type_id>": number })
async function restoreDaysToBalance(
  supabase: ReturnType<typeof createClient>,
  params: { user_id: string; leave_type_id: string | null; days: number | null }
) {
  const { user_id, leave_type_id, days } = params;
  if (!leave_type_id || !days || days <= 0) {
    return { restored: false, mode: "none" };
  }

  // Try A) row/columns schema: leave_balances
  try {
    const { data: lb } = await supabase
      .from("leave_balances")
      .select("id, used, remaining")
      .eq("user_id", user_id)
      .eq("leave_type_id", leave_type_id)
      .maybeSingle();

    if (lb) {
      const newUsed = Number(lb.used || 0) - Number(days);
      const newRem = Number(lb.remaining || 0) + Number(days);

      // NOTE: you previously prevented used < 0.
      // Keep this behavior to avoid weirdness, but if you want to allow it, remove this check.
      if (newUsed < 0) {
        return {
          restored: false,
          mode: "leave_balances",
          note: "used would go negative; skipped",
        };
      }

      const { error: updErr } = await supabase
        .from("leave_balances")
        .update({
          used: newUsed,
          remaining: newRem,
          last_updated: new Date().toISOString(),
        })
        .eq("id", lb.id);

      if (!updErr) return { restored: true, mode: "leave_balances" };
    }
  } catch (_e) {
    // fall through to JSON schema
  }

  // Try B) JSON schema: user_leave_balances(balances jsonb)
  try {
    const { data: row } = await supabase
      .from("user_leave_balances")
      .select("balances")
      .eq("user_id", user_id)
      .maybeSingle();

    const balances = (row?.balances ?? {}) as Record<string, number>;
    const current = Number(balances[leave_type_id] ?? 0);
    balances[leave_type_id] = current + Number(days);

    const { error: upsertErr } = await supabase
      .from("user_leave_balances")
      .upsert({ user_id, balances }, { onConflict: "user_id" });

    if (!upsertErr) return { restored: true, mode: "user_leave_balances.jsonb" };
    return { restored: false, mode: "user_leave_balances.jsonb", note: upsertErr?.message };
  } catch (e: any) {
    return { restored: false, mode: "user_leave_balances.jsonb", note: e?.message || String(e) };
  }
}

// --------------------------- Handler ---------------------------
serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { request_id } = await req.json();
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth (actor)
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401, headers: corsHeaders
      });
    }

    // Load leave
    // ✅ ADD deducted_days here (critical)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select(
        "id, user_id, email, leave_type_id, days, deducted_days, status, manager_email, start_date, end_date, enable_ooo, calendar_event_id, approval_date, deduction_date"
      )
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
        status: 404, headers: corsHeaders
      });
    }

    // Actor record (role/email)
    const { data: actor } = await supabase
      .from("users")
      .select("role, email")
      .eq("id", user.id)
      .maybeSingle();

    if (!actor) {
      return new Response(JSON.stringify({ error: "Kullanıcı bulunamadı" }), {
        status: 401, headers: corsHeaders
      });
    }

    // Only manager or admin can reverse
    const isManager = actor.email === leave.manager_email;
    const isAdmin = actor.role === "admin";
    if (!isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403, headers: corsHeaders
      });
    }

    // Only these statuses can be reversed
    if (!["Approved", "Deducted"].includes(leave.status)) {
      return new Response(JSON.stringify({ error: "Sadece düşülen veya onaylanan izinler geri alınabilir." }), {
        status: 400, headers: corsHeaders
      });
    }

    // Decide new status & side-effects
    const statusBefore = leave.status;
    let newStatus: "Pending" | "Approved";
    let doBalanceRestore = false;
    let shouldRemoveCalendar = false;

    if (leave.status === "Approved") {
      // Reverse approval → back to Pending
      newStatus = "Pending";
      doBalanceRestore = false;
      shouldRemoveCalendar = true;
    } else {
      // Deducted → back to Approved and restore what was actually deducted
      newStatus = "Approved";
      doBalanceRestore = true;
      shouldRemoveCalendar = false;
    }

    // ✅ Restore the ACTUAL deducted amount (deducted_days), fallback to days for older records
    const daysToRestore =
      typeof leave.deducted_days === "number"
        ? leave.deducted_days
        : Number(leave.deducted_days ?? leave.days ?? 0);

    // Balance restore if we are reverting from Deducted → Approved
    let balanceRestoreInfo: any = { restored: false, mode: "skipped" };
    if (doBalanceRestore) {
      balanceRestoreInfo = await restoreDaysToBalance(supabase, {
        user_id: leave.user_id,
        leave_type_id: leave.leave_type_id ?? null,
        days: daysToRestore,
      });
    }

    // Remove calendar event if we’re undoing an Approval
    if (shouldRemoveCalendar && leave.calendar_event_id) {
      try {
        await cancelCalendarEvent({ eventId: leave.calendar_event_id });
      } catch (e) {
        console.error("Calendar event cancellation failed (reverse-leave):", e);
      }
    }

    // Update leave status (and clear timers appropriately)
    const updatePayload: Record<string, any> = { status: newStatus };

    if (newStatus === "Pending") {
      updatePayload.approval_date = null;
    }
    if (newStatus === "Approved") {
      updatePayload.deduction_date = null;

      // Optional but recommended: clear deducted_days when you undo deduction,
      // so UI/records don't look "still deducted".
      updatePayload.deducted_days = null;
    }

    const { error: updateErr } = await supabase
      .from("leave_requests")
      .update(updatePayload)
      .eq("id", leave.id);

    if (updateErr) {
      return new Response(JSON.stringify({ error: "Geri alma işlemi başarısız" }), {
        status: 500, headers: corsHeaders
      });
    }

    // Reconcile OOO
    try {
      if (leave.email) {
        await reconcileUserOOO(supabase, { user_id: leave.user_id, email: leave.email });
      }
    } catch (e) {
      console.error("reconcileUserOOO (after reverse) failed:", e);
    }

    // Log
    try {
      await supabase.from("logs").insert([{
        user_id: user.id,
        actor_email: actor.email,
        action: statusBefore === "Deducted" ? "revert_deducted_request" : "revert_approved_request",
        target_table: "leave_requests",
        target_id: leave.id,
        status_before: statusBefore,
        status_after: newStatus,
        details: {
          start_date: leave.start_date,
          end_date: leave.end_date,
          requested_days: leave.days,
          deducted_days: leave.deducted_days,
          restored_days: doBalanceRestore ? daysToRestore : 0,
          enable_ooo: leave.enable_ooo,
          balance_restore: balanceRestoreInfo,
        },
      }]);
    } catch (logErr) {
      console.error("Logging failed in reverse-leave:", logErr);
    }

    // Notify owner by email
    const { data: owner } = await supabase
      .from("users")
      .select("email, name")
      .eq("id", leave.user_id)
      .maybeSingle();

    if (owner?.email) {
      let statusMsg: string;
      let subject = "İzin Talebinizde Güncelleme";

      if (newStatus === "Approved") {
        statusMsg = `İzin talebiniz tekrar <b>ONAYLANDI</b> ve varsa kesinti (<b>${daysToRestore}</b> gün) geri alındı.`;
      } else {
        statusMsg = "İzin talebiniz <b>BEKLEME</b> durumuna geri alındı (onay geri çekildi).";
      }

      await sendGraphEmail({
        to: owner.email,
        subject,
        html: `
          <p>Sayın ${owner.name || owner.email},</p>
          <p>${leave.start_date} – ${leave.end_date} tarihli izin talebinizde değişiklik yapıldı.</p>
          <ul>
            <li>Talep Edilen Gün: <b>${leave.days}</b></li>
            ${statusBefore === "Deducted"
              ? `<li>Kesilen Gün: <b>${daysToRestore}</b></li>`
              : ""
            }
          </ul>
          <p>${statusMsg}</p>
          <br/>
          <a href="https://leave-app-v2.vercel.app"
             style="
               display:inline-block;
               padding:10px 20px;
               background:#F39200;
               color:#fff;
               border-radius:8px;
               text-decoration:none;
               font-weight:bold;
               font-family:Calibri, Arial, sans-serif;
               font-size:16px;
               margin-top:10px;">
            İzin Uygulamasına Git
          </a>
        `,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      reversed_request_id: leave.id,
      status_before: statusBefore,
      status_after: newStatus,
      restored_days: doBalanceRestore ? daysToRestore : 0,
      balance_restore: balanceRestoreInfo,
    }), { status: 200, headers: corsHeaders });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || e) }), {
      status: 500, headers: corsHeaders
    });
  }
});
