import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";

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
      duration_type: body.duration_type,
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
    // Insert log entry for audit trail
    
if (inserted) {
  await supabase.from("logs").insert([
    {
      user_id: user.id,
      actor_email: user.email,
      action: "submit_request",
      target_table: "leave_requests",
      target_id: inserted.id,
      status_before: null,
      status_after: "Pending",
      details: {
        days: body.days,
        start_date: body.start_date,
        end_date: body.end_date,
        location: body.location,
        note: body.note,
        leave_type_id: body.leave_type_id,
      }
    }
  ]);
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
