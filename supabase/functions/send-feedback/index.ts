import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";

const FEEDBACK_TO = Deno.env.get("FEEDBACK_TO");

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://leave-app-v2.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    // CORS preflight
    return new Response("ok", { headers: corsHeaders });
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Geçersiz istek formatı." }),
      { status: 400, headers: corsHeaders }
    );
  }

  const { message, name, email } = data || {};
  if (
    typeof message !== "string" || !message.trim() ||
    typeof name !== "string" || !name.trim() ||
    typeof email !== "string" || !email.trim()
  ) {
    return new Response(
      JSON.stringify({ error: "Zorunlu alanlar eksik. Lütfen tekrar deneyin." }),
      { status: 400, headers: corsHeaders }
    );
  }

  const emailPrefix = email.split("@")[0];

  const html = `
    <h2>İzinApp Geri Bildirim</h2>
    <p><b>Gönderen:</b> ${name} (${email})</p>
    <p><b>Mesaj:</b></p>
    <pre style="font-family: inherit; background: #f6f6f6; padding: 12px; border-radius: 6px">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
    <hr/>
    <div style="color: #888; font-size: 13px;">Bu e-posta İzinApp uygulamasından otomatik olarak gönderildi.</div>
  `;

  try {
    await sendGraphEmail({
      to: FEEDBACK_TO,
      subject: `İzinApp Kullanıcı Geri Bildirimi (${emailPrefix})`,
      html,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "E-posta gönderilemedi. " + (err.message || "") }),
      { status: 500, headers: corsHeaders }
    );
  }
});
