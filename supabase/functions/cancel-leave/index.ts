// supabase/functions/cancel-leave/index.ts
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

// --------------------------- Guards ---------------------------
async function assertUserIsActive(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  corsHeaders: Record<string, string>,
  message = "User is archived",
) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("assertUserIsActive lookup failed:", error);
    return jsonResponse({ error: "User lookup failed" }, 500, corsHeaders);
  }

  if (!data || data.is_active === false) {
    return jsonResponse({ error: message }, 403, corsHeaders);
  }

  return null;
}

// --------------------------- Optional balance restore ---------------------------
async function restoreApprovedDays(
  supabaseAdmin: ReturnType<typeof createClient>,
  user_id: string,
  leave_type_id: string | null,
  days: number | null,
) {
  if (!leave_type_id || !days || days <= 0) return { restored: false, mode: "none" };

  // Try A) row-per-type schema
  try {
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("user_leave_balances")
      .select("remaining_days")
      .eq("user_id", user_id)
      .eq("leave_type_id", leave_type_id)
      .maybeSingle();

    if (rowErr) {
      // don't fail function; just log + continue fallback
      console.log("restoreApprovedDays row-per-type lookup error:", rowErr);
    } else if (row && typeof row.remaining_days !== "undefined") {
      const newVal = Number(row.remaining_days || 0) + Number(days);

      const { error: updErr } = await supabaseAdmin
        .from("user_leave_balances")
        .update({ remaining_days: newVal })
        .eq("user_id", user_id)
        .eq("leave_type_id", leave_type_id);

      if (!updErr) return { restored: true, mode: "row-per-type" };
      console.log("restoreApprovedDays row-per-type update error:", updErr);
    }
  } catch (e) {
    console.log("restoreApprovedDays row-per-type exception:", e);
  }

  // Try B) JSON aggregate schema
  try {
    const { data: jsonRow, error: jsonErr } = await supabaseAdmin
      .from("user_leave_balances")
      .select("balances")
      .eq("user_id", user_id)
      .maybeSingle();

    if (jsonErr) {
      return { restored: false, mode: "jsonb:lookup-error", note: jsonErr.message };
    }

    const balances = (jsonRow?.balances ?? {}) as Record<string, number>;
    const current = Number(balances[leave_type_id] ?? 0);
    balances[leave_type_id] = current + Number(days);

    const { error: upsertErr } = await supabaseAdmin
      .from("user_leave_balances")
      .upsert({ user_id, balances }, { onConflict: "user_id" });

    if (!upsertErr) return { restored: true, mode: "jsonb" };
    return { restored: false, mode: "jsonb:upsert-error", note: upsertErr.message };
  } catch (e: any) {
    return { restored: false, mode: "jsonb:exception", note: e?.message || String(e) };
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
    // Parse body safely
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
    }

    const request_id = body?.request_id;
    if (!request_id) {
      return jsonResponse({ error: "request_id is required" }, 400, corsHeaders);
    }

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) {
      return jsonResponse({ error: "Missing Authorization token" }, 401, corsHeaders);
    }

    // ---- Build clients (IMPORTANT) ----
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Admin client: bypasses RLS (no Authorization header!)
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

    // User client: ONLY for auth.getUser()
    const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    // Who is calling?
    const { data: userResp, error: userError } = await supabaseUser.auth.getUser(jwt);
    const user = userResp?.user ?? null;

    if (userError || !user) {
      return jsonResponse({ error: "Kullanıcı doğrulanamadı" }, 401, corsHeaders);
    }

    console.log(`[cancel-leave ${reqId}] caller:`, user.email, "request_id:", request_id);

    // ✅ Actor guard: caller must be active (admin client)
    {
      const blocked = await assertUserIsActive(supabaseAdmin, user.id, corsHeaders);
      if (blocked) return blocked;
    }

    // Load leave (admin client)
    const { data: leave, error: leaveError } = await supabaseAdmin
      .from("leave_requests")
      .select(
        "id, user_id, email, manager_email, status, start_date, end_date, days, location, note, enable_ooo, calendar_event_id, leave_type_id",
      )
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      console.error(`[cancel-leave ${reqId}] leave lookup error:`, leaveError);
      return jsonResponse({ error: "Talep bulunamadı" }, 404, corsHeaders);
    }

    // ✅ Target guard: request owner must be active (admin client)
    {
      const blockedTarget = await assertUserIsActive(
        supabaseAdmin,
        leave.user_id,
        corsHeaders,
        "Target user is archived",
      );
      if (blockedTarget) {
        return jsonResponse({ error: "Target user is archived" }, 409, corsHeaders);
      }
    }

    // Actor info (admin client)
    const { data: actor, error: actorErr } = await supabaseAdmin
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (actorErr) console.log(`[cancel-leave ${reqId}] actor lookup error:`, actorErr);
    if (!actor) return jsonResponse({ error: "User not found" }, 401, corsHeaders);

    // Permissions
    const isOwner = user.id === leave.user_id;
    const isManager = normalizeEmail(actor.email) === normalizeEmail(leave.manager_email);
    const isAdmin = actor.role === "admin";

    console.log(`[cancel-leave ${reqId}] perms:`, {
      isOwner,
      isManager,
      isAdmin,
      status: leave.status,
    });

    if (!isOwner && !isManager && !isAdmin) {
      return jsonResponse({ error: "Yetkiniz yok." }, 403, corsHeaders);
    }

    // Prevent invalid/double cancel
    if (leave.status === "Cancelled") {
      return jsonResponse({ error: "Talep zaten iptal edilmiş." }, 409, corsHeaders);
    }
    if (!["Pending", "Approved"].includes(leave.status)) {
      return jsonResponse({ error: `Bu durumda iptal edilemez: ${leave.status}` }, 409, corsHeaders);
    }

    const statusBefore = leave.status;

    // Cancel the leave (admin client)
    const { error: updateError } = await supabaseAdmin
      .from("leave_requests")
      .update({ status: "Cancelled" })
      .eq("id", request_id);

    if (updateError) {
      console.error(`[cancel-leave ${reqId}] cancel update failed:`, updateError);
      return jsonResponse(
        {
          error: "İptal güncellemesi başarısız",
          debug: {
            code: (updateError as any).code,
            message: (updateError as any).message,
            details: (updateError as any).details,
            hint: (updateError as any).hint,
            req_id: reqId,
          },
        },
        500,
        corsHeaders,
      );
    }

    console.log(
      `[cancel-leave ${reqId}] cancelled leave id:`,
      leave.id,
      "statusBefore:",
      statusBefore,
    );

    // Log the action (best-effort)
    try {
      await supabaseAdmin.from("logs").insert([
        {
          user_id: user.id,
          actor_email: actor.email,
          action: "cancel_request",
          target_table: "leave_requests",
          target_id: leave.id,
          status_before: statusBefore,
          status_after: "Cancelled",
          details: {
            start_date: leave.start_date,
            end_date: leave.end_date,
            days: leave.days,
            location: leave.location,
            note: leave.note,
            enable_ooo: leave.enable_ooo,
            req_id: reqId,
          },
        },
      ]);
    } catch (logError) {
      console.error(`[cancel-leave ${reqId}] DB logging failed (ignored):`, logError);
    }

    // If was Approved, try to restore balance (best-effort)
    let balanceRestoreInfo: any = { restored: false, mode: "skipped" };
    if (statusBefore === "Approved") {
      balanceRestoreInfo = await restoreApprovedDays(
        supabaseAdmin,
        leave.user_id,
        leave.leave_type_id ?? null,
        typeof leave.days === "number" ? leave.days : Number(leave.days ?? 0),
      );
      console.log(`[cancel-leave ${reqId}] balance restore:`, balanceRestoreInfo);
    }

    // Cancel shared calendar event if we have an id (best-effort)
    try {
      if (leave.calendar_event_id) {
        await cancelCalendarEvent({ eventId: leave.calendar_event_id });
        console.log(`[cancel-leave ${reqId}] calendar event cancelled:`, leave.calendar_event_id);
      }
    } catch (calendarError) {
      console.error(`[cancel-leave ${reqId}] Calendar event cancellation failed (ignored):`, calendarError);
    }

    // Recompute OOO considering ALL remaining leaves (best-effort)
    try {
      if (leave.email) {
        await reconcileUserOOO(supabaseAdmin, { user_id: leave.user_id, email: leave.email });
        console.log(`[cancel-leave ${reqId}] reconcileUserOOO done for:`, leave.email);
      }
    } catch (e) {
      console.error(`[cancel-leave ${reqId}] reconcileUserOOO failed (ignored):`, e);
    }

    // ------------------- Email notifications (robust) -------------------
    const employeeEmail = normalizeEmail(leave.email);
    const managerEmail = normalizeEmail(leave.manager_email);

    // Optional name lookups (nice-to-have)
    let employeeName = "";
    let managerName = "";

    try {
      const [{ data: empRow, error: empErr }, { data: mgrRow, error: mgrErr }] =
        await Promise.all([
          supabaseAdmin.from("users").select("name").eq("id", leave.user_id).maybeSingle(),
          managerEmail
            ? supabaseAdmin.from("users").select("name").ilike("email", managerEmail).maybeSingle()
            : Promise.resolve({ data: null, error: null } as any),
        ]);

      if (empErr) console.log(`[cancel-leave ${reqId}] employee name lookup error:`, empErr);
      if (mgrErr) console.log(`[cancel-leave ${reqId}] manager name lookup error:`, mgrErr);

      employeeName = empRow?.name || "";
      managerName = mgrRow?.name || "";
    } catch (e) {
      console.log(`[cancel-leave ${reqId}] name lookups exception:`, e);
    }

    // 1) Notify employee (always, if email exists)
    if (!employeeEmail) {
      console.log(`[cancel-leave ${reqId}] no employeeEmail on leave; skipping employee email`);
    } else {
      console.log(`[cancel-leave ${reqId}] emailing employee:`, employeeEmail);
      try {
        await sendGraphEmail({
          to: employeeEmail,
          subject: "İzin Talebiniz İptal Edildi",
          html: `
            <p>Sayın ${employeeName || employeeEmail},</p>
            <p>Aşağıdaki izin talebiniz <b>iptal edildi</b>:</p>
            <ul>
              <li>Başlangıç: ${leave.start_date}</li>
              <li>Bitiş: ${leave.end_date}</li>
              <li>Gün: ${leave.days}</li>
            </ul>
            <p>Bilginize.</p>
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
        console.log(`[cancel-leave ${reqId}] employee email SENT`);
      } catch (e) {
        console.error(`[cancel-leave ${reqId}] employee email FAILED (ignored):`, e);
      }
    }

    // 2) Notify manager only if it had been Approved (your rule)
    if (statusBefore === "Approved") {
      if (!managerEmail) {
        console.log(`[cancel-leave ${reqId}] no managerEmail on leave; skipping manager email`);
      } else {
        console.log(`[cancel-leave ${reqId}] emailing manager:`, managerEmail);
        try {
          await sendGraphEmail({
            to: managerEmail,
            subject: "Onayladığınız İzin Talebi İptal Edildi",
            html: `
              <p>Sayın ${managerName || managerEmail},</p>
              <p>Onayladığınız aşağıdaki izin talebi iptal edilmiştir:</p>
              <ul>
                <li>Çalışan: ${employeeName || employeeEmail || "-"}</li>
                <li>Başlangıç: ${leave.start_date}</li>
                <li>Bitiş: ${leave.end_date}</li>
                <li>Gün: ${leave.days}</li>
              </ul>
              <p>Bilginize.</p>
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
          console.log(`[cancel-leave ${reqId}] manager email SENT`);
        } catch (e) {
          console.error(`[cancel-leave ${reqId}] manager email FAILED (ignored):`, e);
        }
      }
    } else {
      console.log(`[cancel-leave ${reqId}] statusBefore != Approved, manager email not sent (by design).`);
    }

    return jsonResponse(
      {
        success: true,
        cancelled_request_id: leave.id,
        status_before: statusBefore,
        status_after: "Cancelled",
        balance_restore: balanceRestoreInfo,
        req_id: reqId,
      },
      200,
      corsHeaders,
    );
  } catch (e: any) {
    console.error("cancel-leave error:", e);
    return jsonResponse(
      { error: "Beklenmeyen hata: " + (e?.message || String(e)) },
      500,
      getCORSHeaders(req.headers.get("origin") || ""),
    );
  }
});
