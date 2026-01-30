// /supabase/functions/deduct-leave/index.ts
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

function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

async function assertUserIsActive(
  supabase: any,
  userId: string,
  corsHeaders: Record<string, string>,
  message = "User is archived",
) {
  const { data, error } = await supabase
    .from("users")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) return jsonResponse({ error: "User lookup failed" }, 500, corsHeaders);

  if (!data || data.is_active === false) {
    return jsonResponse({ error: message }, 403, corsHeaders);
  }

  return null;
}

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const reqId = crypto.randomUUID();

  try {
    const { request_id } = await req.json();
    if (!request_id) {
      return jsonResponse({ error: "request_id is required" }, 400, corsHeaders);
    }

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) {
      return jsonResponse({ error: "Missing Authorization token" }, 401, corsHeaders);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return jsonResponse({ error: "Kullanıcı doğrulanamadı" }, 401, corsHeaders);
    }

    console.log(`[deduct-leave ${reqId}] caller:`, user.email, "request_id:", request_id);

    // ✅ Actor guard
    {
      const blocked = await assertUserIsActive(supabase, user.id, corsHeaders);
      if (blocked) return blocked;
    }

    // Fetch leave request (include email so we can always notify)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, email, leave_type_id, days, deducted_days, status, manager_email, start_date, end_date, location, note")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return jsonResponse({ error: "Talep bulunamadı" }, 404, corsHeaders);
    }

    // ✅ Target guard
    {
      const blockedTarget = await assertUserIsActive(
        supabase,
        leave.user_id,
        corsHeaders,
        "Target user is archived",
      );
      if (blockedTarget) return jsonResponse({ error: "Target user is archived" }, 409, corsHeaders);
    }

    // Actor role check
    const { data: userRow, error: userRowErr } = await supabase
      .from("users")
      .select("role, email")
      .eq("id", user.id)
      .maybeSingle();

    if (userRowErr) console.log(`[deduct-leave ${reqId}] actor lookup error:`, userRowErr);

    if (!userRow) {
      return jsonResponse({ error: "Kullanıcı bulunamadı" }, 401, corsHeaders);
    }

    const isManager = normalizeEmail(userRow.email) === normalizeEmail(leave.manager_email);
    const isAdmin = userRow.role === "admin";

    if (!isManager && !isAdmin) {
      return jsonResponse({ error: "Yetkiniz yok." }, 403, corsHeaders);
    }

    // Only allow deduction from Approved
    if (leave.status !== "Approved") {
      return jsonResponse({ error: "Sadece onaylanan izinler düşülebilir." }, 400, corsHeaders);
    }

    // Fetch holidays within leave range (inclusive)
    const { data: holidayRows, error: holidayError } = await supabase
      .from("holidays")
      .select("date, is_half_day, half")
      .gte("date", leave.start_date)
      .lte("date", leave.end_date);

    if (holidayError) {
      console.error(`[deduct-leave ${reqId}] holiday fetch error:`, holidayError);
      return jsonResponse({ error: "Resmi tatiller alınamadı" }, 500, corsHeaders);
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

    const daysToDeduct = Number(computedDaysToDeduct);

    // ✅ Prevent double-deduct race:
    // Update only if status is still Approved at the time of update
    const { data: updatedRows, error: updateLeaveError } = await supabase
      .from("leave_requests")
      .update({
        status: "Deducted",
        deduction_date: new Date().toISOString(),
        deducted_days: daysToDeduct,
      })
      .eq("id", leave.id)
      .eq("status", "Approved")
      .select("id")
      .limit(1);

    if (updateLeaveError) {
      console.error(`[deduct-leave ${reqId}] update leave failed:`, updateLeaveError);
      return jsonResponse({ error: "Düşme işlemi başarısız" }, 500, corsHeaders);
    }
    if (!updatedRows || updatedRows.length === 0) {
      // Someone else already deducted it (or status changed)
      return jsonResponse({ error: "Talep zaten düşülmüş ya da durumu değişmiş." }, 409, corsHeaders);
    }

    // Update user's leave balance
    const { data: balance, error: balanceError } = await supabase
      .from("leave_balances")
      .select("id, used, remaining")
      .eq("user_id", leave.user_id)
      .eq("leave_type_id", leave.leave_type_id)
      .maybeSingle();

    if (balanceError || !balance) {
      console.error(`[deduct-leave ${reqId}] balance fetch error:`, balanceError);
      return jsonResponse({ error: "İzin bakiyesi bulunamadı" }, 404, corsHeaders);
    }

    const newUsed = Number(balance.used) + daysToDeduct;
    const newRemaining = Number(balance.remaining) - daysToDeduct; // allow negative balances

    const { error: updateBalanceError } = await supabase
      .from("leave_balances")
      .update({
        used: newUsed,
        remaining: newRemaining,
        last_updated: new Date().toISOString(),
      })
      .eq("id", balance.id);

    if (updateBalanceError) {
      console.error(`[deduct-leave ${reqId}] balance update failed:`, updateBalanceError);
      return jsonResponse({ error: "Bakiyeler güncellenemedi" }, 500, corsHeaders);
    }

    // Log (best-effort) - will likely fail until you fix logs RLS
    try {
      await supabase.from("logs").insert([{
        user_id: user.id,
        actor_email: user.email,
        action: "deduct_request",
        target_table: "leave_requests",
        target_id: leave.id,
        status_before: "Approved",
        status_after: "Deducted",
        details: {
          start_date: leave.start_date,
          end_date: leave.end_date,
          requested_days: leave.days,
          deducted_days: daysToDeduct,
          location: leave.location,
          note: leave.note,
          holidays_in_range: (holidayRows || []).length,
          req_id: reqId,
        },
      }]);
    } catch (logError) {
      console.error(`[deduct-leave ${reqId}] DB logging failed (RLS likely):`, logError);
    }

    // ✅ Email notification (robust):
    // Always send to the email stored on the leave request
    const employeeEmail = normalizeEmail(leave.email);
    let employeeName = "";

    // Optional name lookup (nice to have)
    try {
      const { data: empRow, error: empErr } = await supabase
        .from("users")
        .select("name")
        .eq("id", leave.user_id)
        .maybeSingle();
      if (empErr) console.log(`[deduct-leave ${reqId}] employee name lookup error:`, empErr);
      employeeName = empRow?.name || "";
    } catch (_e) {
      // ignore
    }

    if (!employeeEmail) {
      console.log(`[deduct-leave ${reqId}] no leave.email; skipping employee email`);
    } else {
      console.log(`[deduct-leave ${reqId}] About to email employee:`, employeeEmail);
      try {
        await sendGraphEmail({
          to: employeeEmail,
          subject: "İzin Günlerinizden Düşüş Yapıldı",
          html: `
            <p>Sayın ${employeeName || employeeEmail},</p>
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
        console.log(`[deduct-leave ${reqId}] Employee email SENT`);
      } catch (e) {
        console.error(`[deduct-leave ${reqId}] Employee email FAILED:`, e);
      }
    }

    return jsonResponse({
      success: true,
      warning: newRemaining < 0 ? "Bu işlem sonucu çalışan bakiyesi negatife düştü!" : undefined,
      deducted_days: daysToDeduct,
      req_id: reqId,
    }, 200, corsHeaders);
  } catch (e: any) {
    console.error("deduct-leave error:", e);
    return jsonResponse({ error: "Beklenmeyen hata: " + (e?.message || String(e)) }, 500, corsHeaders);
  }
});
