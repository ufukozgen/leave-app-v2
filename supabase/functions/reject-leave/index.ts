import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "./sendGraphEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Change '*' to your domain in prod
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { request_id, rejection_reason } = await req.json();
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Authenticate
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      console.log("Kullanıcı doğrulanamadı:", userError, user);
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401, headers: corsHeaders
      });
    }

    // Get leave request
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, status, manager_email, start_date, end_date, days, location, note")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      console.log("Talep bulunamadı:", leaveError, leave);
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
        status: 404, headers: corsHeaders
      });
    }

    // Get actor (the person doing the reject)
    const { data: actor } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (!actor) {
      console.log("Kullanıcı bulunamadı:", actor);
      return new Response(JSON.stringify({ error: "Kullanıcı bulunamadı" }), {
        status: 401, headers: corsHeaders
      });
    }

    // Only manager or admin can reject
    const isManager = actor.email === leave.manager_email;
    const isAdmin = actor.role === "admin";
    if (!isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403, headers: corsHeaders
      });
    }

    // Only Pending can be rejected
    if (leave.status !== "Pending") {
      return new Response(JSON.stringify({ error: "Yalnızca bekleyen talepler reddedilebilir." }), {
        status: 400, headers: corsHeaders
      });
    }

    // Reject the leave
    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({
        status: "Rejected",
        approval_date: new Date().toISOString(),
        rejection_reason: rejection_reason || null
      })
      .eq("id", request_id);

    if (updateError) {
      console.log("Reddetme başarısız:", updateError);
      return new Response(JSON.stringify({ error: "Reddetme başarısız" }), {
        status: 500, headers: corsHeaders
      });
    }

    // Notify the employee
    const { data: employee } = await supabase
      .from("users")
      .select("email, name")
      .eq("id", leave.user_id)
      .maybeSingle();

    if (employee) {
      await sendGraphEmail({
        to: employee.email,
        subject: "İzin Talebiniz Reddedildi",
        html: `
          <p>Sayın ${employee.name},</p>
          <p>Yöneticiniz aşağıdaki izin talebinizi <b>reddetti</b>:</p>
          <ul>
            <li>Başlangıç: ${leave.start_date}</li>
            <li>Bitiş: ${leave.end_date}</li>
            <li>Gün: ${leave.days}</li>
          </ul>
          ${rejection_reason ? `<p><b>Red Nedeni:</b> ${rejection_reason}</p>` : ""}
          <p>Detaylar için yöneticinizle görüşebilirsiniz.</p>
        `
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: corsHeaders
    });

  } catch (e) {
    console.log("reject-leave error:", e);
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
