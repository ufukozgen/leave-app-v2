// supabase/functions/update-leave-balance/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://leave-app-v2.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      user_id,
      remaining,      // only this is needed
      admin_email,
      admin_name,
      note,
    } = await req.json();

    // JWT for actor auth
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth: get the actor
    const { data: { user: actor }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !actor) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Get actor's role for permissions
    const { data: actorRow } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", actor.id)
      .maybeSingle();

    if (!actorRow || actorRow.role !== "admin") {
      return new Response(JSON.stringify({ error: "Sadece adminler izin bakiyesi güncelleyebilir." }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Fetch employee and manager
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", user_id)
      .maybeSingle();

    if (!user) {
      return new Response(JSON.stringify({ error: "Çalışan bulunamadı." }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Fetch manager (optional)
    const { data: manager } = await supabase
      .from("users")
      .select("*")
      .eq("email", user.manager_email)
      .maybeSingle();

    // Fetch previous balance
    const { data: oldBalance } = await supabase
      .from("leave_balances")
      .select("*")
      .eq("user_id", user_id)
      .maybeSingle();

    const oldRemaining = oldBalance?.remaining ?? 0;
    const action = remaining > oldRemaining ? "accrual" : "correction";

    // Prepare balance fields
    let balanceFields = {
      user_id,
      leave_type_id: oldBalance?.leave_type_id ?? "9664d16e-0a1c-441c-842a-b7371252f943",
      remaining,
      last_updated: new Date().toISOString(),
    };

    let balId = oldBalance?.id;
    if (balId) {
      const { error } = await supabase
        .from("leave_balances")
        .update(balanceFields)
        .eq("id", balId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from("leave_balances")
        .insert([balanceFields])
        .select();
      if (error) throw error;
      balId = data?.[0]?.id;
    }

    // Log the change in balance_logs
    await supabase.from("balance_logs").insert([{
      user_id: user_id,
      admin_id: actor.id,
      admin_email: admin_email,
      action,
      remaining_before: oldRemaining,
      remaining_after: remaining,
      note: note ?? "",
      created_at: new Date().toISOString(),
    }]);

    // Prepare e-mail notification content
    const actionDesc = action === "accrual"
      ? `Yıllık izin bakiyeniz <b>${remaining - oldRemaining}</b> gün artırıldı.`
      : `Yıllık izin bakiyeniz <b>${oldRemaining - remaining}</b> gün azaltıldı/düzeltildi.`;

    const subject = "Yıllık İzin Bakiyesi Güncellendi";
    const htmlEmployee = `
      <p>Sayın ${user.name || user.email},</p>
      <p>${admin_name ? `Yönetici/İK personeli <b>${admin_name}</b>` : "Yetkili"} tarafından yıllık izin bakiyeniz güncellendi.</p>
      <p>${actionDesc}</p>
      <ul>
        <li><b>Önceki bakiye:</b> ${oldRemaining} gün</li>
        <li><b>Yeni bakiye:</b> ${remaining} gün</li>
      </ul>
      ${note ? `<p><b>Açıklama:</b> ${note}</p>` : ""}
      <p>Detaylı bilgi için uygulamayı kontrol edebilirsiniz.</p>

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
    `;

    // Send to employee
    await sendGraphEmail({
      to: user.email,
      subject,
      html: htmlEmployee,
      from: "izin-uygulamasi@terralab.com.tr"
    });

    // Send to manager (if found)
    if (manager) {
      const htmlManager = `
        <p>Sayın ${manager.name || manager.email},</p>
        <p>Sorumluluğunuzdaki <b>${user.name || user.email}</b> çalışanının yıllık izin bakiyesi güncellendi.</p>
        <p>${actionDesc}</p>
        <ul>
          <li><b>Önceki bakiye:</b> ${oldRemaining} gün</li>
          <li><b>Yeni bakiye:</b> ${remaining} gün</li>
        </ul>
        ${note ? `<p><b>Açıklama:</b> ${note}</p>` : ""}
        <p>Detaylı bilgi için uygulamayı kontrol edebilirsiniz.</p>

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
      `;
      await sendGraphEmail({
        to: manager.email,
        subject,
        html: htmlManager,
        from: "izin-uygulamasi@terralab.com.tr"
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message || err }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
