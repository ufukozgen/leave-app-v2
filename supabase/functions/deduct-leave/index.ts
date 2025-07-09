// supabase/functions/deduct-leave/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts"; // Adjust the path if needed

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://leave-app-v2.vercel.app",
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

    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, leave_type_id, days, status, manager_email, start_date, end_date")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("role, email")
      .eq("id", user.id)
      .maybeSingle();

    if (!userRow) {
      return new Response(JSON.stringify({ error: "Kullanıcı bulunamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const isManager = userRow.email === leave.manager_email;
    const isAdmin = userRow.role === "admin";
    if (!isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Only allow deduction from Approved
    if (leave.status !== "Approved") {
      return new Response(JSON.stringify({ error: "Sadece onaylanan izinler düşülebilir." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Update leave request to Deducted
    const { error: updateLeaveError } = await supabase
      .from("leave_requests")
      .update({ status: "Deducted", deduction_date: new Date().toISOString() })
      .eq("id", leave.id);

    if (updateLeaveError) {
      return new Response(JSON.stringify({ error: "Düşme işlemi başarısız" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Update user's leave balance
    const { data: balance, error: balanceError } = await supabase
      .from("leave_balances")
      .select("id, used, remaining")
      .eq("user_id", leave.user_id)
      .eq("leave_type_id", leave.leave_type_id)
      .maybeSingle();

    if (balanceError || !balance) {
      return new Response(JSON.stringify({ error: "İzin bakiyesi bulunamadı" }), {
        status: 404, headers: corsHeaders
      });
    }

    const daysToDeduct = Number(leave.days);
    const newUsed = Number(balance.used) + daysToDeduct;
    const newRemaining = Number(balance.remaining) - daysToDeduct;
    if (newRemaining < 0) {
      return new Response(JSON.stringify({ error: "Yeterli izin bakiyesi yok." }), {
        status: 400, headers: corsHeaders
      });
    }

    const { error: updateBalanceError } = await supabase
      .from("leave_balances")
      .update({ used: newUsed, remaining: newRemaining, last_updated: new Date().toISOString() })
      .eq("id", balance.id);

    if (updateBalanceError) {
      return new Response(JSON.stringify({ error: "Bakiyeler güncellenemedi" }), {
        status: 500, headers: corsHeaders
      });
    }

    try {
  await supabase.from("logs").insert([
    {
      user_id: user.id,              // the actor's user ID from JWT
      actor_email: user.email,       // actor's email
      action: "deduct_request",         // e.g. "approve_request"
      target_table: "leave_requests",
      target_id: leave.id,
      status_before: leave.status,
      status_after: "Deducted",      // new leave status string
      details: {
        start_date: leave.start_date,
        end_date: leave.end_date,
        days: leave.days,
        location: leave.location,
        note: leave.note,
        
        // add any other useful info
      }
    }
  ]);

  } catch (logError) {
  console.error("Failed to log action:", logError);
  // Optional: handle logging failure gracefully without blocking main flow
}

    // Fetch employee (for e-mail)
    const { data: employee } = await supabase
      .from("users")
      .select("email, name")
      .eq("id", leave.user_id)
      .maybeSingle();

    // Send e-mail notification
    if (employee) {
      await sendGraphEmail({
        to: employee.email,
        subject: "İzin Günlerinizden Düşüş Yapıldı",
        html: `
          <p>Sayın ${employee.name},</p>
          <p>Aşağıdaki izin talebiniz için <b>${leave.days}</b> gün düşülmüştür.</p>
          <ul>
            <li>Başlangıç: ${leave.start_date}</li>
            <li>Bitiş: ${leave.end_date}</li>
            <li>Düşülen Gün: <b>${leave.days}</b></li>
            <li>Kalan Yıllık İzin: <b>${newRemaining}</b> gün</li>
          </ul>
          <p>Bakiye bilgilerinizi uygulamada detaylı görebilirsiniz.</p>
        `
        // from: "izin-uygulamasi@terralab.com.tr" // only if not set in sendGraphEmail
      });
    }

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
