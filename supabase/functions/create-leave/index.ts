// /supabase/functions/create-leave/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";

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

// Guard: block archived users at the server level
async function assertUserIsActive(
  supabase: any,
  userId: string,
  corsHeaders: Record<string, string>,
) {
  const { data, error } = await supabase
    .from("users")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) return jsonResponse({ error: "User lookup failed" }, 500, corsHeaders);

  if (!data || data.is_active === false) {
    return jsonResponse({ error: "User is archived" }, 403, corsHeaders);
  }

  return null; // OK
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
    const jwt = authHeader.replace("Bearer ", "").trim();

    if (!jwt) {
      return jsonResponse({ error: "Missing Authorization token" }, 401, corsHeaders);
    }

    // Service role client (your current pattern)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      // Optional but helpful: attach auth header globally
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    // Get current user from JWT
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return jsonResponse({ error: "Kullanıcı doğrulanamadı" }, 401, corsHeaders);
    }

    // ✅ Actor guard
    const blocked = await assertUserIsActive(supabase, user.id, corsHeaders);
    if (blocked) return blocked;

    // Fetch manager (for e-mail)
    const { data: manager } = await supabase
      .from("users")
      .select("email, name")
      .eq("email", body.manager_email)
      .maybeSingle();

    // Normalize enable_ooo to strict boolean
    const enableOOO: boolean = !!body.enable_ooo;

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
      enable_ooo: enableOOO,
      ooo_custom_message: body.ooo_custom_message || null,
    };

    // Insert into leave_requests
    const { error: insertError, data: inserted } = await supabase
      .from("leave_requests")
      .insert([leaveData])
      .select()
      .maybeSingle();

    if (insertError) {
      return jsonResponse({ error: "İzin talebi oluşturulamadı" }, 500, corsHeaders);
    }

    // Audit trail (include enable_ooo in details)
    if (inserted) {
      await supabase.from("logs").insert([{
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
          enable_ooo: enableOOO,
        },
      }]);
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
            <li>OOO (otomatik yanıt): ${enableOOO ? "Etkinleştirilecek" : "Etkin değil"}</li>
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
        `,
      });
    }

    return jsonResponse({ success: true, data: inserted }, 200, corsHeaders);
  } catch (e: any) {
    return jsonResponse(
      { error: "Beklenmeyen hata: " + (e?.message || e) },
      500,
      corsHeaders,
    );
  }
});
