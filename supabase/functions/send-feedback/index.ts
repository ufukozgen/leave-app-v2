import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";

// Uses ENV variables set in Supabase dashboard
const FEEDBACK_TO = Deno.env.get("FEEDBACK_TO"); // e.g. izinapp-feedback@terralab.com.tr
// FEEDBACK_FROM not needed; AZURE_MAILBOX_USER used by helper

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Sadece POST istekleri destekleniyor." }),
      { status: 405 }
    );
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Geçersiz istek formatı." }),
      { status: 400 }
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
      { status: 400 }
    );
  }

  // Extract email prefix
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
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "E-posta gönderilemedi. " + (err.message || "") }),
      { status: 500 }
    );
  }
});
