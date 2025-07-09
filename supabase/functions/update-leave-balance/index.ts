// supabase/functions/update-leave-balance/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts"; // works just like your deduct-leave!

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
      accrued,
      used,
      remaining,
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

    // Prepare balance fields (adapt leave_type_id if needed)
    let balanceFields = {
      user_id,
      leave_type_id: oldBalance?.leave_type_id ?? 1,
      accrued,
      used,
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

    // Log the change
    await supabase.from("logs").insert([{
      user_id: user_id,
      actor_email: admin_email,
      action: balId ? "admin_update_balance" : "admin_create_balance",
      target_table: "leave_balances",
      target_id: balId,
      status_before: oldBalance ? JSON.stringify({
        accrued: oldBalance.accrued,
        used: oldBalance.used,
        remaining: oldBalance.remaining,
      }) : null,
      status_after: JSON.stringify({ accrued, used, remaining }),
      details: {
        user_email: user.email,
        leave_type: "Annual",
        note: note ?? "",
      }
    }]);

    // Prepare email
    const subject = "Yıllık İzin Bakiyesi Güncellendi";
    const htmlEmployee = `
      <p>Sayın ${user.name || user.email},</p>
      <p>Yıllık izin bakiyeniz ${admin_name ? `yönetici/İK personeli <b>${admin_name}</b>` : "yetkili"} tarafından güncellenmiştir.</p>
      <ul>
        <li>Kazandırılan: <b>${accrued}</b> gün</li>
        <li>Kullanılan: <b>${used}</b> gün</li>
        <li>Kalan: <b>${remaining}</b> gün</li>
      </ul>
      ${note ? `<p><b>Açıklama:</b> ${note}</p>` : ""}
      <p>Detaylı bilgi için uygulamayı kontrol edebilirsiniz.</p>
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
        <ul>
          <li>Kazandırılan: <b>${accrued}</b> gün</li>
          <li>Kullanılan: <b>${used}</b> gün</li>
          <li>Kalan: <b>${remaining}</b> gün</li>
        </ul>
        ${note ? `<p><b>Açıklama:</b> ${note}</p>` : ""}
        <p>Detaylı bilgi için uygulamayı kontrol edebilirsiniz.</p>
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
