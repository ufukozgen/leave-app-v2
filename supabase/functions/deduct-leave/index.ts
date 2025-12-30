import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";
import { calcLeaveDays } from "../helpers/calcLeaveDays.ts";

// CORS headers for browser support
const allowedOrigins = [
  "https://leave-app-v2.vercel.app",
  "http://localhost:5173",
];

function getCORSHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
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
    const { request_id } = await req.json();

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(jwt);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Fetch leave request (include location/note because you log them)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select(
        "id, user_id, leave_type_id, days, deducted_days, status, manager_email, start_date, end_date, location, note"
      )
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Actor role check
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
      return new Response(
        JSON.stringify({ error: "Sadece onaylanan izinler düşülebilir." }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Fetch holidays within leave range (inclusive)
    const { data: holidayRows, error: holidayError } = await supabase
      .from("holidays")
      .select("date, is_half_day, half")
      .gte("date", leave.start_date)
      .lte("date", leave.end_date);

    if (holidayError) {
      return new Response(JSON.stringify({ error: "Resmi tatiller alınamadı" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Recalculate deduction days at deduction-time
    const computedDaysToDeduct = calcLeaveDays({
      startDate: leave.start_date,
      endDate: leave.end_date,
      holidays: (holidayRows || []).map((h) => ({
        date: h.date,
        is_half_day: h.is_half_day,
        half: h.half,
      })),
    });

    // Update leave request to Deducted + store deducted_days
    const { error: updateLeaveError } = await supabase
      .from("leave_requests")
      .update({
        status: "Deducted",
        deduction_date: new Date().toISOString(),
        deducted_days: computedDaysToDeduct,
      })
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
        status: 404,
        headers: corsHeaders,
      });
    }

    const daysToDeduct = Number(computedDaysToDeduct);
    const newUsed = Number(balance.used) + daysToDeduct;
    const newRemaining = Number(balance.remaining) - daysToDeduct;
    // ---- Allow negative balances (advance leave) ----

    const { error: updateBalanceError } = await supabase
      .from("leave_balances")
      .update({
        used: newUsed,
        remaining: newRemaining,
        last_updated: new Date().toISOString(),
      })
      .eq("id", balance.id);

    if (updateBalanceError) {
      return new Response(JSON.stringify({ error: "Bakiyeler güncellenemedi" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Log (best-effort)
    try {
      await supabase.from("logs").insert([
        {
          user_id: user.id,
          actor_email: user.email,
          action: "deduct_request",
          target_table: "leave_requests",
          target_id: leave.id,
          status_before: leave.status,
          status_after: "Deducted",
          details: {
            start_date: leave.start_date,
            end_date: leave.end_date,
            // Store both values: what was on the request, and what was actually deducted now
            requested_days: leave.days,
            deducted_days: daysToDeduct,
            location: leave.location,
            note: leave.note,
            holidays_in_range: (holidayRows || []).length,
          },
        },
      ]);
    } catch (logError) {
      console.error("Failed to log action:", logError);
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
          <p>Aşağıdaki izin talebiniz için <b>${daysToDeduct}</b> gün düşülmüştür.</p>
          <ul>
            <li>Başlangıç: ${leave.start_date}</li>
            <li>Bitiş: ${leave.end_date}</li>
            <li>Düşülen Gün: <b>${daysToDeduct}</b></li>
            <li>Kalan Yıllık İzin: <b>${newRemaining}</b> gün</li>
          </ul>
          <p>Bakiye bilgilerinizi uygulamada detaylı görebilirsiniz.</p>

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

    return new Response(
      JSON.stringify({
        success: true,
        warning:
          newRemaining < 0
            ? "Bu işlem sonucu çalışan bakiyesi negatife düştü!"
            : undefined,
        deducted_days: daysToDeduct,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || e) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
