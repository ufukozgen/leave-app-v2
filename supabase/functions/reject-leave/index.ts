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

  try {
    const { request_id, rejection_reason } = await req.json();
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Authenticate actor (the person doing the reject)
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      console.log("Kullanıcı doğrulanamadı:", userError, user);
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401, headers: corsHeaders
      });
    }
// ✅ Actor guard: caller must be active
{
  const blocked = await assertUserIsActive(supabase, user.id, corsHeaders);
  if (blocked) return blocked;
}

    // Load the leave request
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, status, manager_email, start_date, end_date, days, location, note")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      console.log("Talep bulunamadı:", leaveError, leave);
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
        status: 404, headers: corsHeaders
      });
    }
// ✅ Target guard: request owner must be active (recommended)
{
  const blockedTarget = await assertUserIsActive(
    supabase,
    leave.user_id,
    corsHeaders,
    "Target user is archived",
  );
  if (blockedTarget) {
    return jsonResponse({ error: "Target user is archived" }, 409, corsHeaders);
  }
}

    // Get actor record (role/email/name)
    const { data: actor } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (!actor) {
      console.log("Kullanıcı bulunamadı:", actor);
      return new Response(JSON.stringify({ error: "Kullanıcı bulunamadı" }), {
        status: 401, headers: corsHeaders
      });
    }

    // Only manager or admin can reject
    const isManager = actor.email === leave.manager_email;
    const isAdmin = actor.role === "admin";
    if (!isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403, headers: corsHeaders
      });
    }

    // Only Pending can be rejected
    if (leave.status !== "Pending") {
      return new Response(JSON.stringify({ error: "Yalnızca bekleyen talepler reddedilebilir." }), {
        status: 400, headers: corsHeaders
      });
    }

    // Reject the leave
    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({
        status: "Rejected",
        approval_date: new Date().toISOString(), // keeping your pattern of stamping this field
        rejection_reason: rejection_reason || null
      })
      .eq("id", request_id);

    if (updateError) {
      console.log("Reddetme başarısız:", updateError);
      return new Response(JSON.stringify({ error: "Reddetme başarısız" }), {
        status: 500, headers: corsHeaders
      });
    }

    // Fetch employee (the owner of the leave)
    const { data: employee } = await supabase
      .from("users")
      .select("id, email, name")
      .eq("id", leave.user_id)
      .maybeSingle();

    // Log the action
    try {
      await supabase.from("logs").insert([{
        user_id: user.id,                  // actor (rejector)
        actor_email: actor.email,          // use actor.email for consistency
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
        }
      }]);
    } catch (logError) {
      console.error("Failed to log action:", logError);
      // don't block main flow
    }

    // Reconcile OOO (harmless if your policy only considers Approved leaves)
    try {
      if (employee?.email) {
        await reconcileUserOOO(supabase, { user_id: leave.user_id, email: employee.email });
      }
    } catch (e) {
      console.error("reconcileUserOOO (after reject) failed:", e);
    }

    // Notify the employee by email
    if (employee?.email) {
      await sendGraphEmail({
        to: employee.email,
        subject: "İzin Talebiniz Reddedildi",
        html: `
          <p>Sayın ${employee.name || employee.email},</p>
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
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: corsHeaders
    });

  } catch (e: any) {
    console.log("reject-leave error:", e);
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || e) }), {
      status: 500, headers: corsHeaders
    });
  }
});
