// /supabase/functions/cancel-leave/index.ts
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

// --------------------------- Microsoft Graph (disable OOO) ---------------------------
const TENANT_ID =
  Deno.env.get("MICROSOFT_TENANT_ID") ||
  Deno.env.get("AZURE_TENANT_ID") || "";
const CLIENT_ID =
  Deno.env.get("MICROSOFT_CLIENT_ID") ||
  Deno.env.get("AZURE_CLIENT_ID") || "";
const CLIENT_SECRET =
  Deno.env.get("MICROSOFT_CLIENT_SECRET") ||
  Deno.env.get("AZURE_CLIENT_SECRET") || "";

const GRAPH_TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function getGraphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials",
  });
  const res = await fetch(GRAPH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Graph token error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}
// Returns true if we should disable OOO after cancelling this leave.
// We skip disabling if the user has another overlapping Pending/Approved leave with enable_ooo=true.
async function shouldDisableOOOAfterCancel(
  supabase: ReturnType<typeof createClient>,
  params: { user_id: string; cancelled_id: string; start_date: string; end_date: string }
): Promise<boolean> {
  const { user_id, cancelled_id, start_date, end_date } = params;

  // Find other leaves for this user that overlap [start_date, end_date]
  // Overlap condition: other.start_date <= end_date AND other.end_date >= start_date
  const { data: overlapping, error } = await supabase
    .from("leave_requests")
    .select("id")
    .eq("user_id", user_id)
    .neq("id", cancelled_id)
    .eq("enable_ooo", true)
    .in("status", ["Pending", "Approved"])
    .lte("start_date", end_date) // start <= cancelled.end
    .gte("end_date", start_date); // end >= cancelled.start

  if (error) {
    // On any read error, act conservatively: DO NOT disable OOO
    console.error("OOO overlap check failed, skipping disable:", error);
    return false;
  }

  // If there is any overlapping OOO-enabled leave, keep OOO on
  if (overlapping && overlapping.length > 0) {
    return false;
  }

  // Otherwise it's safe to disable OOO
  return true;
}

async function disableOutOfOffice(userEmail: string) {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing Graph secrets (TENANT_ID / CLIENT_ID / CLIENT_SECRET).");
  }
  const token = await getGraphToken();
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(userEmail)}/mailboxSettings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ automaticRepliesSetting: { status: "disabled" } }),
  });
  if (!res.ok) throw new Error(`disable OOO failed ${res.status}: ${await res.text()}`);
}

// --------------------------- Optional balance restore ---------------------------
// Best-effort for two common schemas; safe to skip if your schema differs.
async function restoreApprovedDays(
  supabase: ReturnType<typeof createClient>,
  user_id: string,
  leave_type_id: string | null,
  days: number | null
) {
  if (!leave_type_id || !days || days <= 0) return { restored: false, mode: "none" };

  // Try A) row-per-type schema
  try {
    const { data: row } = await supabase
      .from("user_leave_balances")
      .select("remaining_days")
      .eq("user_id", user_id)
      .eq("leave_type_id", leave_type_id)
      .maybeSingle();

    if (row && typeof row.remaining_days !== "undefined") {
      const newVal = Number(row.remaining_days || 0) + Number(days);
      const { error: updErr } = await supabase
        .from("user_leave_balances")
        .update({ remaining_days: newVal })
        .eq("user_id", user_id)
        .eq("leave_type_id", leave_type_id);
      if (!updErr) return { restored: true, mode: "row-per-type" };
    }
  } catch (_e) {
    // fall through
  }

  // Try B) JSON aggregate schema
  try {
    const { data: jsonRow } = await supabase
      .from("user_leave_balances")
      .select("balances")
      .eq("user_id", user_id)
      .maybeSingle();

    const balances = (jsonRow?.balances ?? {}) as Record<string, number>;
    const current = Number(balances[leave_type_id] ?? 0);
    balances[leave_type_id] = current + Number(days);

    const { error: upsertErr } = await supabase
      .from("user_leave_balances")
      .upsert({ user_id, balances }, { onConflict: "user_id" });

    if (!upsertErr) return { restored: true, mode: "jsonb" };
    return { restored: false, mode: "jsonb:upsert-error", note: upsertErr?.message };
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

  try {
    const { request_id } = await req.json();
    if (!request_id) {
      return new Response(JSON.stringify({ error: "request_id is required" }), { status: 400, headers: corsHeaders });
    }

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Who is calling?
    const { data: userResp, error: userError } = await supabase.auth.getUser(jwt);
    const user = userResp?.user ?? null;
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), { status: 401, headers: corsHeaders });
    }
// ✅ Actor guard: caller must be active
{
  const blocked = await assertUserIsActive(supabase, user.id, corsHeaders);
  if (blocked) return blocked;
}

    // Load leave (also need email for OOO + manager for perms + type/days for restore)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, email, manager_email, status, start_date, end_date, days, location, note, enable_ooo, calendar_event_id, leave_type_id")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), { status: 404, headers: corsHeaders });
    }
// ✅ Target guard: request owner must be active (recommended business rule)
{
  const blockedTarget = await assertUserIsActive(
    supabase,
    leave.user_id,
    corsHeaders,
    "Target user is archived",
  );
  if (blockedTarget) {
    // 409 is nice here: request exists but operation is not allowed due to current state
    return jsonResponse({ error: "Target user is archived" }, 409, corsHeaders);
  }
}

    // Actor info
    const { data: actor } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (!actor) {
      return new Response(JSON.stringify({ error: "User not found" }), { status: 401, headers: corsHeaders });
    }

    // Permissions
    const isOwner = user.id === leave.user_id;
    const isManager = actor.email === leave.manager_email;
    const isAdmin = actor.role === "admin";
    if (!isOwner && !isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), { status: 403, headers: corsHeaders });
    }

    // Prevent invalid/double cancel
    if (leave.status === "Cancelled") {
      return new Response(JSON.stringify({ error: "Talep zaten iptal edilmiş." }), { status: 409, headers: corsHeaders });
    }
    if (!["Pending", "Approved"].includes(leave.status)) {
      return new Response(JSON.stringify({ error: `Bu durumda iptal edilemez: ${leave.status}` }), { status: 409, headers: corsHeaders });
    }

    const statusBefore = leave.status;

    // Cancel the leave (no cancel_date write)
    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({ status: "Cancelled" })
      .eq("id", request_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "İptal güncellemesi başarısız" }), { status: 500, headers: corsHeaders });
    }

    // Log the action
    try {
      await supabase.from("logs").insert([{
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
          enable_ooo: leave.enable_ooo
        },
      }]);
    } catch (logError) {
      console.error("Logging failed in cancel-leave:", logError);
    }

    // If was Approved, try to restore balance (best-effort)
    let balanceRestoreInfo: any = { restored: false, mode: "skipped" };
    if (statusBefore === "Approved") {
      balanceRestoreInfo = await restoreApprovedDays(
        supabase,
        leave.user_id,
        leave.leave_type_id ?? null,
        typeof leave.days === "number" ? leave.days : Number(leave.days ?? 0)
      );
    }

    // Cancel shared calendar event if we have an id
    try {
      if (leave.calendar_event_id) {
        await cancelCalendarEvent({ eventId: leave.calendar_event_id });
      }
    } catch (calendarError) {
      console.error("Calendar event cancellation failed:", calendarError);
    }

    // Recompute OOO considering ALL remaining leaves
try {
  if (leave.email) {
    await reconcileUserOOO(supabase, { user_id: leave.user_id, email: leave.email });
  }
} catch (e) {
  console.error("reconcileUserOOO (after cancel) failed:", e);
}



    // Fetch employee + manager for email notifications
    const [{ data: employee }, { data: manager }] = await Promise.all([
      supabase.from("users").select("email, name").eq("id", leave.user_id).maybeSingle(),
      supabase.from("users").select("email, name").eq("email", leave.manager_email).maybeSingle(),
    ]);

    // Email notifications (Turkish)
    // 1) Notify employee
    if (employee?.email) {
      await sendGraphEmail({
        to: employee.email,
        subject: "İzin Talebiniz İptal Edildi",
        html: `
          <p>Sayın ${employee.name || employee.email},</p>
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
    }

    // 2) Notify manager only if it had been Approved
    if (statusBefore === "Approved" && manager?.email) {
      await sendGraphEmail({
        to: manager.email,
        subject: "Onayladığınız İzin Talebi İptal Edildi",
        html: `
          <p>Sayın ${manager.name || manager.email},</p>
          <p>Onayladığınız aşağıdaki izin talebi iptal edilmiştir:</p>
          <ul>
            <li>Çalışan: ${employee?.name || employee?.email || "-"}</li>
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
    }

    return new Response(JSON.stringify({
      success: true,
      cancelled_request_id: leave.id,
      status_before: statusBefore,
      status_after: "Cancelled",
      balance_restore: balanceRestoreInfo,
    }), { status: 200, headers: corsHeaders });

  } catch (e: any) {
    console.error("cancel-leave error:", e);
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || String(e)) }), {
      status: 500, headers: getCORSHeaders(req.headers.get("origin") || ""),
    });
  }
});
