import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "./sendGraphEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Replace '*' with your URL in prod
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
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

    // Get user from JWT
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      console.log("User not authenticated", userError, user);
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401, headers: corsHeaders
      });
    }

    // Get the leave request and request owner
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, status, manager_email, start_date, end_date, days, location, note")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      console.log("Leave not found", leaveError, leave);
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
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
      console.log("Actor not found", actor);
      return new Response(JSON.stringify({ error: "Kullanıcı bulunamadı" }), {
        status: 401, headers: corsHeaders
      });
    }

    // Only the request owner, their manager, or an admin can cancel
    const isOwner = user.id === leave.user_id;
    const isManager = actor.email === leave.manager_email;
    const isAdmin = actor.role === "admin";
    if (!isOwner && !isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403, headers: corsHeaders
      });
    }

    // Only allow cancel if Pending or Approved
    if (!["Pending", "Approved"].includes(leave.status)) {
      return new Response(JSON.stringify({ error: "Bu izin talebi iptal edilemez." }), {
        status: 400, headers: corsHeaders
      });
    }

    // Cancel the leave
    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({ status: "Cancelled" })
      .eq("id", request_id);

    if (updateError) {
      console.log("Cancel update failed", updateError);
      return new Response(JSON.stringify({ error: "İptal başarısız" }), {
        status: 500, headers: corsHeaders
      });
    }

    // Fetch the employee (for e-mail)
    const { data: employee } = await supabase
      .from("users")
      .select("email, name")
      .eq("id", leave.user_id)
      .maybeSingle();

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
        `
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (e) {
    console.log("Error in cancel-leave:", e);
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
