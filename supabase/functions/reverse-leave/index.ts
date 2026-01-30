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
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}
function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

async function assertUserIsActive(
  supabase: any,
  userId: string,
  corsHeaders: Record<string, string>,
  message = "User is archived",
) {
  const { data, error } = await supabase
    .from("users")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) return jsonResponse({ error: "User lookup failed" }, 500, corsHeaders);

  if (!data || data.is_active === false) {
    return jsonResponse({ error: message }, 403, corsHeaders);
  }

  return null;
}

// --------------------------- Balance restore helper (best-effort) ---------------------------
async function restoreDaysToBalance(
  supabase: ReturnType<typeof createClient>,
  params: { user_id: string; leave_type_id: string | null; days: number | null },
) {
  const { user_id, leave_type_id, days } = params;
  if (!leave_type_id || !days || days <= 0) {
    return { restored: false, mode: "none" };
  }

  // Try A) leave_balances row schema
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

      if (newUsed < 0) {
        return { restored: false, mode: "leave_balances", note: "used would go negative; skipped" };
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
    // fall through
  }

  // Try B) user_leave_balances jsonb schema
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

  const reqId = crypto.randomUUID();

  try {
    const { request_id } = await req.json();
    if (!request_id) return jsonResponse({ error: "request_id is required" }, 400, corsHeaders);

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return jsonResponse({ error: "Missing Authorization token" }, 401, corsHeaders);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    // Auth (actor)
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return jsonResponse({ error: "Kullanıcı doğrulanamadı" }, 401, corsHeaders);
    }

    console.log(`[reverse-leave ${reqId}] caller:`, user.email, "request_id:", request_id);

    // ✅ Actor guard
    {
      const blocked = await assertUserIsActive(supabase, user.id, corsHeaders);
      if (blocked) return blocked;
    }

    // Load leave (includes email ✅)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, email, leave_type_id, days, deducted_days, status, manager_email, start_date, end_date, enable_ooo, calendar_event_id, approval_date, deduction_date")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return jsonResponse({ error: "Talep bulunamadı" }, 404, corsHeaders);
    }

    // ✅ Target guard
    {
      const blockedTarget = await assertUserIsActive(
        supabase,
        leave.user_id,
        corsHeaders,
        "Target user is archived",
      );
      if (blockedTarget) return jsonResponse({ error: "Target user is archived" }, 409, corsHeaders);
    }

    // Actor record (role/email)
    const { data: actor, error: actorErr } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (actorErr) console.log(`[reverse-leave ${reqId}] actor lookup error:`, actorErr);

    if (!actor) {
      return jsonResponse({ error: "Kullanıcı bulunamadı" }, 401, corsHeaders);
    }

    // Only manager or admin can reverse
    const isManager = normalizeEmail(actor.email) === normalizeEmail(leave.manager_email);
    const isAdmin = actor.role === "admin";
    if (!isManager && !isAdmin) {
      return jsonResponse({ error: "Yetkiniz yok." }, 403, corsHeaders);
    }

    // Only these statuses can be reversed
    if (!["Approved", "Deducted"].includes(leave.status)) {
      return jsonResponse({ error: "Sadece düşülen veya onaylanan izinler geri alınabilir." }, 400, corsHeaders);
    }

    const statusBefore = leave.status;
    let newStatus: "Pending" | "Approved";
    let doBalanceRestore = false;
    let shouldRemoveCalendar = false;

    if (leave.status === "Approved") {
      newStatus = "Pending";          // reverse approval
      doBalanceRestore = false;
      shouldRemoveCalendar = true;
    } else {
      newStatus = "Approved";         // reverse deduction
      doBalanceRestore = true;
      shouldRemoveCalendar = false;
    }

    // Restore ACTUAL deducted amount; fallback for older records
    const daysToRestore =
      typeof leave.deducted_days === "number"
        ? leave.deducted_days
        : Number(leave.deducted_days ?? leave.days ?? 0);

    let balanceRestoreInfo: any = { restored: false, mode: "skipped" };
    if (doBalanceRestore) {
      balanceRestoreInfo = await restoreDaysToBalance(supabase, {
        user_id: leave.user_id,
        leave_type_id: leave.leave_type_id ?? null,
        days: daysToRestore,
      });
      console.log(`[reverse-leave ${reqId}] balance restore:`, balanceRestoreInfo);
    }

    // Remove calendar event if undoing an Approval
    if (shouldRemoveCalendar && leave.calendar_event_id) {
      try {
        await cancelCalendarEvent({ eventId: leave.calendar_event_id });
        console.log(`[reverse-leave ${reqId}] calendar cancelled:`, leave.calendar_event_id);
      } catch (e) {
        console.error(`[reverse-leave ${reqId}] calendar cancel failed:`, e);
      }
    }

    // Update leave status
    const updatePayload: Record<string, any> = { status: newStatus };

    if (newStatus === "Pending") {
      updatePayload.approval_date = null;
    }
    if (newStatus === "Approved") {
      updatePayload.deduction_date = null;
      updatePayload.deducted_days = null; // recommended
    }

    // Optional race protection: only update if current status matches what we started with
    const { data: updatedRows, error: updateErr } = await supabase
      .from("leave_requests")
      .update(updatePayload)
      .eq("id", leave.id)
      .eq("status", statusBefore)
      .select("id")
      .limit(1);

    if (updateErr) {
      return jsonResponse({ error: "Geri alma işlemi başarısız" }, 500, corsHeaders);
    }
    if (!updatedRows || updatedRows.length === 0) {
      return jsonResponse({ error: "Talep zaten işlenmiş olabilir (durumu değişmiş)." }, 409, corsHeaders);
    }

    // Reconcile OOO
    try {
      const ownerEmail = normalizeEmail(leave.email);
      if (ownerEmail) {
        await reconcileUserOOO(supabase, { user_id: leave.user_id, email: ownerEmail });
      }
    } catch (e) {
      console.error(`[reverse-leave ${reqId}] reconcileUserOOO failed:`, e);
    }

    // Log (best-effort)
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
          req_id: reqId,
        },
      }]);
    } catch (logErr) {
      console.error(`[reverse-leave ${reqId}] DB logging failed (RLS likely):`, logErr);
    }

    // Notify owner by email (ROBUST: use leave.email)
    const ownerEmail = normalizeEmail(leave.email);
    let ownerName = "";

    // Optional name lookup (never gates sending)
    try {
      const { data: ownerRow, error: ownerErr } = await supabase
        .from("users")
        .select("name")
        .eq("id", leave.user_id)
        .maybeSingle();
      if (ownerErr) console.log(`[reverse-leave ${reqId}] owner name lookup error:`, ownerErr);
      ownerName = ownerRow?.name || "";
    } catch (_e) {
      // ignore
    }

    if (!ownerEmail) {
      console.log(`[reverse-leave ${reqId}] missing leave.email; skipping owner email`);
    } else {
      let statusMsg = "";
      const subject = "İzin Talebinizde Güncelleme";

      if (newStatus === "Approved") {
        statusMsg = `İzin talebiniz tekrar <b>ONAYLANDI</b> ve varsa kesinti (<b>${daysToRestore}</b> gün) geri alındı.`;
      } else {
        statusMsg = "İzin talebiniz <b>BEKLEME</b> durumuna geri alındı (onay geri çekildi).";
      }

      console.log(`[reverse-leave ${reqId}] About to email owner:`, ownerEmail);
      try {
        await sendGraphEmail({
          to: ownerEmail,
          subject,
          html: `
            <p>Sayın ${ownerName || ownerEmail},</p>
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
        console.log(`[reverse-leave ${reqId}] owner email SENT`);
      } catch (e) {
        console.error(`[reverse-leave ${reqId}] owner email FAILED:`, e);
      }
    }

    return jsonResponse({
      success: true,
      reversed_request_id: leave.id,
      status_before: statusBefore,
      status_after: newStatus,
      restored_days: doBalanceRestore ? daysToRestore : 0,
      balance_restore: balanceRestoreInfo,
      req_id: reqId,
    }, 200, corsHeaders);
  } catch (e: any) {
    return jsonResponse({ error: "Beklenmeyen hata: " + (e?.message || String(e)) }, 500, corsHeaders);
  }
});
