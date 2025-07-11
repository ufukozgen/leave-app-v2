import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";
import { cancelCalendarEvent } from "../helpers/cancelCalendarEvent.ts";

// Shared calendar e-mail should be set as environment variable "SHARED_CALENDAR_EMAIL"
const sharedCalendarEmail = Deno.env.get("SHARED_CALENDAR_EMAIL");

// CORS headers for browser support
const allowedOrigins = [
  "https://leave-app-v2.vercel.app",
  "http://localhost:5173",
];
function getCORSHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}


serve(async (req) => {
      const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { request_id } = await req.json();
    console.log("CANCEL request_id:", request_id);
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get user from JWT
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "User authentication failed" }), {
        status: 401, headers: corsHeaders
      });
    }

    // Get the leave request, including calendar_event_id
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, status, manager_email, start_date, end_date, days, location, note, calendar_event_id")
      .eq("id", request_id)
      .maybeSingle();

      console.log("DEBUG leave:", leave);
      console.log("DEBUG leaveError:", leaveError);

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Leave request not found" }), {
        status: 404, headers: corsHeaders
      });
    }

    // Get info about the actor (user trying to cancel)
    const { data: actor } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (!actor) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 401, headers: corsHeaders
      });
    }

    // Only the request owner, their manager, or an admin can cancel
    const isOwner = user.id === leave.user_id;
    const isManager = actor.email === leave.manager_email;
    const isAdmin = actor.role === "admin";
    if (!isOwner && !isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403, headers: corsHeaders
      });
    }

    // Only allow cancel if Pending or Approved
    if (!["Pending", "Approved"].includes(leave.status)) {
      return new Response(JSON.stringify({ error: "This leave request cannot be cancelled." }), {
        status: 400, headers: corsHeaders
      });
    }

    // Cancel the leave
    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({ status: "Cancelled" })
      .eq("id", request_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Cancel update failed" }), {
        status: 500, headers: corsHeaders
      });
    }

    // Logging the cancellation action for audit
    try {
      await supabase.from("logs").insert([{
        user_id: user.id,
        actor_email: user.email,
        action: "cancel_request",
        target_table: "leave_requests",
        target_id: leave.id,
        status_before: leave.status,
        status_after: "Cancelled",
        details: {
          start_date: leave.start_date,
          end_date: leave.end_date,
          days: leave.days,
          location: leave.location,
          note: leave.note,
        }
      }]);
    } catch (logError) {
      console.error("Logging failed in cancel-leave:", logError);
      // Do not block cancellation on log error
    }

    // Cancel the event in the shared calendar if exists
    if (leave.calendar_event_id) {
      try {
        await cancelCalendarEvent({
          sharedCalendarEmail,
          eventId: leave.calendar_event_id
        });
      } catch (calendarError) {
        console.error("Calendar event cancellation failed:", calendarError);
        // Continue even if calendar event cannot be cancelled
      }
    }

    // Fetch the employee (leave owner) for email
    const { data: employee } = await supabase
      .from("users")
      .select("email, name")
      .eq("id", leave.user_id)
      .maybeSingle();

    // Fetch the manager (for notification if leave was approved)
    const { data: manager } = await supabase
      .from("users")
      .select("email, name")
      .eq("email", leave.manager_email)
      .maybeSingle();

    // Notify employee
    if (employee) {
      // Send email notification
      await sendGraphEmail({
        to: employee.email,
        subject: "İzin Talebiniz İptal Edildi",
        html: `
          <p>Sayın ${employee.name},</p>
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
           margin-top:10px;
         ">
         İzin Uygulamasına Git
      </a>
        `
      });
    }
    // **New**: Email to manager if leave was Approved and is now cancelled
if (leave.status === "Approved" && manager) {
  await sendGraphEmail({
    to: manager.email,
    subject: "Onayladığınız İzin Talebi İptal Edildi",
    html: `
      <p>Sayın ${manager.name},</p>
      <p>Onayladığınız aşağıdaki izin talebi çalışan tarafından iptal edilmiştir:</p>
      <ul>
        <li>Çalışan: ${employee?.name || employee?.email}</li>
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
           margin-top:10px;
         ">
         İzin Uygulamasına Git
      </a>
    `
  });
}

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (e) {
    console.error("Error in cancel-leave:", e);
    return new Response(JSON.stringify({ error: "Unexpected error: " + (e?.message || e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
