import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";
import { reconcileUserOOO } from "../helpers/reconcileUserOOO.ts";

// CORS headers for browser support
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

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const reqId = crypto.randomUUID();

  try {
    const { request_id, rejection_reason } = await req.json();
    if (!request_id) {
      return jsonResponse({ error: "request_id is required" }, 400, corsHeaders);
    }

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) {
      return jsonResponse({ error: "Missing Authorization token" }, 401, corsHeaders);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    // Authenticate actor (the person doing the reject)
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      console.log(`[reject-leave ${reqId}] auth failed:`, userError);
      return jsonResponse({ error: "Kullanıcı doğrulanamadı" }, 401, corsHeaders);
    }

    console.log(`[reject-leave ${reqId}] caller:`, user.email, "request_id:", request_id);

    // ✅ Actor guard
    {
      const blocked = await assertUserIsActive(supabase, user.id, corsHeaders);
      if (blocked) return blocked;
    }

    // Load the leave request (IMPORTANT: include leave.email)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, email, status, manager_email, start_date, end_date, days, location, note")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      console.log(`[reject-leave ${reqId}] leave not found:`, leaveError);
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

    // Get actor record (role/email/name)
    const { data: actor, error: actorErr } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (actorErr) console.log(`[reject-leave ${reqId}] actor lookup error:`, actorErr);

    if (!actor) {
      return jsonResponse({ error: "Kullanıcı bulunamadı" }, 401, corsHeaders);
    }

    // Only manager or admin can reject
    const isManager = normalizeEmail(actor.email) === normalizeEmail(leave.manager_email);
    const isAdmin = actor.role === "admin";
    if (!isManager && !isAdmin) {
      return jsonResponse({ error: "Yetkiniz yok." }, 403, corsHeaders);
    }

    // Only Pending can be rejected
    if (leave.status !== "Pending") {
      return jsonResponse({ error: "Yalnızca bekleyen talepler reddedilebilir." }, 409, corsHeaders);
    }

    // Reject the leave (conditional, prevents race)
    const { data: updatedRows, error: updateError } = await supabase
      .from("leave_requests")
      .update({
        status: "Rejected",
        approval_date: new Date().toISOString(),
        rejection_reason: rejection_reason || null,
      })
      .eq("id", request_id)
      .eq("status", "Pending")
      .select("id")
      .limit(1);

    if (updateError) {
      console.log(`[reject-leave ${reqId}] reject update failed:`, updateError);
      return jsonResponse({ error: "Reddetme başarısız" }, 500, corsHeaders);
    }
    if (!updatedRows || updatedRows.length === 0) {
      return jsonResponse({ error: "Talep zaten işlenmiş olabilir (durumu değişmiş)." }, 409, corsHeaders);
    }

    console.log(`[reject-leave ${reqId}] rejected leave id:`, leave.id);

    // Optional: employee name lookup (nice-to-have)
    const employeeEmail = normalizeEmail(leave.email);
    let employeeName = "";

    try {
      const { data: empRow, error: empErr } = await supabase
        .from("users")
        .select("name")
        .eq("id", leave.user_id)
        .maybeSingle();
      if (empErr) console.log(`[reject-leave ${reqId}] employee name lookup error:`, empErr);
      employeeName = empRow?.name || "";
    } catch (_e) {
      // ignore
    }

    // Log the action (best-effort; may fail due to logs RLS)
    try {
      await supabase.from("logs").insert([{
        user_id: user.id,
        actor_email: actor.email,
        action: "reject_request",
        target_table: "leave_requests",
        target_id: leave.id,
        status_before: "Pending",
        status_after: "Rejected",
        details: {
          start_date: leave.start_date,
          end_date: leave.end_date,
          days: leave.days,
          location: leave.location,
          note: leave.note,
          rejection_reason: rejection_reason || null,
          req_id: reqId,
        },
      }]);
    } catch (logError) {
      console.error(`[reject-leave ${reqId}] DB logging failed (RLS likely):`, logError);
    }

    // Reconcile OOO (non-blocking)
    try {
      if (employeeEmail) {
        await reconcileUserOOO(supabase, { user_id: leave.user_id, email: employeeEmail });
      }
    } catch (e) {
      console.error(`[reject-leave ${reqId}] reconcileUserOOO failed:`, e);
    }

    // Notify the employee by email (robust: uses leave.email)
    if (!employeeEmail) {
      console.log(`[reject-leave ${reqId}] missing leave.email; skipping employee email`);
    } else {
      console.log(`[reject-leave ${reqId}] About to email employee:`, employeeEmail);
      try {
        await sendGraphEmail({
          to: employeeEmail,
          subject: "İzin Talebiniz Reddedildi",
          html: `
            <p>Sayın ${employeeName || employeeEmail},</p>
            <p>Yöneticiniz aşağıdaki izin talebinizi <b>reddetti</b>:</p>
            <ul>
              <li>Başlangıç: ${leave.start_date}</li>
              <li>Bitiş: ${leave.end_date}</li>
              <li>Gün: ${leave.days}</li>
            </ul>
            ${rejection_reason ? `<p><b>Red Nedeni:</b> ${rejection_reason}</p>` : ""}
            <p>Detaylar için yöneticinizle görüşebilirsiniz.</p>
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
        console.log(`[reject-leave ${reqId}] employee email SENT`);
      } catch (e) {
        console.error(`[reject-leave ${reqId}] employee email FAILED:`, e);
      }
    }

    return jsonResponse({ success: true, req_id: reqId }, 200, corsHeaders);
  } catch (e: any) {
    console.log("reject-leave error:", e);
    return jsonResponse({ error: "Beklenmeyen hata: " + (e?.message || String(e)) }, 500, corsHeaders);
  }
});
