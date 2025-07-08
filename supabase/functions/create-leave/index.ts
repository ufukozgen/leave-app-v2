import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "./sendGraphEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Get JWT from header
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Fetch manager (for e-mail)
    const { data: manager } = await supabase
      .from("users")
      .select("email, name")
      .eq("email", body.manager_email)
      .maybeSingle();

    // Set up leave data
    const leaveData = {
      user_id: user.id,
      email: user.email,
      start_date: body.start_date,
      end_date: body.end_date,
      return_date: body.return_date,
      location: body.location,
      note: body.note,
      days: body.days,
      manager_email: body.manager_email,
      leave_type_id: body.leave_type_id,
      status: "Pending",
      request_date: new Date().toISOString(),
    };

    // Insert into leave_requests
    const { error: insertError, data: inserted } = await supabase
      .from("leave_requests")
      .insert([leaveData])
      .select()
      .maybeSingle();

    if (insertError) {
      return new Response(JSON.stringify({ error: "İzin talebi oluşturulamadı" }), {
        status: 500, headers: corsHeaders
      });
    }

    // E-mail to manager if they exist
    if (manager && manager.email) {
      await sendGraphEmail({
        to: manager.email,
        subject: "Yeni İzin Talebi Onayınıza Sunuldu",
        html: `
          <p>Sayın ${manager.name},</p>
          <p>Çalışanınız <b>${user.email}</b> tarafından aşağıdaki izin talebi iletildi:</p>
          <ul>
            <li>Başlangıç: ${body.start_date}</li>
            <li>Bitiş: ${body.end_date}</li>
            <li>Gün: ${body.days}</li>
            <li>Açıklama: ${body.note || "-"}</li>
          </ul>
          <p>Lütfen uygulama üzerinden talebi inceleyin ve onaylayın.</p>
        `
      });
    }

    return new Response(JSON.stringify({ success: true, data: inserted }), {
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
