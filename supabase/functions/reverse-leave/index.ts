import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "./SendGraphEmail.ts"; // Adjust this path if needed

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Set to your production domain in prod!
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
      .select("id, user_id, leave_type_id, days, status, manager_email")
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

    if (leave.status !== "Deducted" && leave.status !== "Approved") {
      return new Response(JSON.stringify({ error: "Sadece düşülen veya onaylanan izinler geri alınabilir." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // What will the new status be?
    let newStatus = "";
    let doBalanceUpdate = false;
    if (leave.status === "Deducted") {
      newStatus = "Approved";
      doBalanceUpdate = true;
    } else if (leave.status === "Approved") {
      newStatus = "Pending";
      doBalanceUpdate = false;
    }

    // If reverting a deduction, also restore balance!
    if (doBalanceUpdate) {
      // Get leave balance
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

      const daysToRevert = Number(leave.days);
      const newUsed = Number(balance.used) - daysToRevert;
      const newRemaining = Number(balance.remaining) + daysToRevert;
      if (newUsed < 0) {
        return new Response(JSON.stringify({ error: "İzin bakiyesi geri alınamıyor (kullanılan gün negatif olur)" }), {
          status: 400, headers: corsHeaders
        });
      }

      const { error: updateError } = await supabase
        .from("leave_balances")
        .update({ used: newUsed, remaining: newRemaining, last_updated: new Date().toISOString() })
        .eq("id", balance.id);

      if (updateError) {
        return new Response(JSON.stringify({ error: "Bakiyeler geri alınamadı" }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // Update leave status
    const { error: updateLeaveError } = await supabase
      .from("leave_requests")
      .update({ status: newStatus, deduction_date: newStatus === "Approved" ? null : undefined })
      .eq("id", leave.id);

    if (updateLeaveError) {
      return new Response(JSON.stringify({ error: "Geri alma işlemi başarısız" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Get the email address of the leave owner (employee)
    const { data: ownerUser } = await supabase
      .from("users")
      .select("email")
      .eq("id", leave.user_id)
      .maybeSingle();

    // Compose e-mail
    if (ownerUser?.email) {
      let statusMessage = "";
      if (newStatus === "Approved") {
        statusMessage = "İzin bakiyeniz güncellendi. İzniniz tekrar ONAYLANDI ve kesinti geri alındı.";
      } else if (newStatus === "Pending") {
        statusMessage = "İzniniz tekrar BEKLEMEDE. Onay geri alındı ve henüz onaylanmadı.";
      } else {
        statusMessage = "İzin durumunuzda değişiklik yapıldı.";
      }

      const emailSubject = "İzin Talebinizde Güncelleme";
      const emailBody = [
  "Sayın çalışan,",
  "",
  `${leave.days} gün olarak talep ettiğiniz izninizde bir güncelleme yapıldı.`,
  "",
  statusMessage,
  "",
  "Daha fazla bilgi için lütfen yöneticinizle iletişime geçiniz.",
  "",
  "İyi çalışmalar."
].join("\n");



      // Send the email (do not block on await, but safe to do so in Deno)
      await sendGraphEmail({
        to: ownerUser.email,
        subject: emailSubject,
        html: emailBody,
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
