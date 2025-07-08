import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "./sendGraphEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Change '*' to your production URL in production!
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    // Handle CORS preflight
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { request_id } = await req.json();

    // Get JWT from Authorization header
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    // Connect to Supabase with service role
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get user info from JWT
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Fetch leave request (get user_id, manager_email, status, and more details for the email)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, manager_email, status, start_date, end_date, days, location, note")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Get user's role and email (of the acting manager)
    const { data: userRow } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (!userRow) {
      return new Response(JSON.stringify({ error: "Kullanıcı bulunamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Authorization: only manager or admin
    const isManager = userRow.email === leave.manager_email;
    const isAdmin = userRow.role === "admin";
    if (!isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403,
        headers: corsHeaders,
      });
    }
    
    // Update status to Approved
    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({ status: "Approved" })
      .eq("id", request_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Onaylama başarısız" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // -- Fetch the employee/user for email notification --
    const { data: employee } = await supabase
      .from("users")
      .select("email, name")
      .eq("id", leave.user_id)
      .maybeSingle();

    if (!employee) {
      return new Response(JSON.stringify({ error: "Çalışan bulunamadı (mail gönderilemedi)" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // -- Send email notification to employee --
    await sendGraphEmail({
      to: employee.email,
      subject: "İzin Talebiniz Onaylandı",
      html: `
        <p>Sayın ${employee.name},</p>
        <p>Yöneticiniz ${userRow.name || ""} aşağıdaki izin talebinizi <b>onayladı</b>:</p>
        <ul>
          <li>Başlangıç: ${leave.start_date}</li>
          <li>Bitiş: ${leave.end_date}</li>
          <li>Gün: ${leave.days}</li>
        </ul>
        <p>İyi tatiller dileriz!</p>
      `
      // from is not needed if set in env
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
