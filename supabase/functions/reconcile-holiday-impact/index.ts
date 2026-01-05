// supabase/functions/reconcile-holiday-impact/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { calcLeaveDays } from "../helpers/calcLeaveDays.ts";

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

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { holiday_date, dry_run } = await req.json(); // holiday_date: "YYYY-MM-DD"
    if (!holiday_date) {
      return new Response(JSON.stringify({ error: "holiday_date is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth check (admin-only)
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("role, email")
      .eq("id", user.id)
      .maybeSingle();

    if (!userRow || userRow.role !== "admin") {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Find deducted leaves overlapping that date
    const { data: leaves, error: leavesError } = await supabase
      .from("leave_requests")
      .select("id, user_id, leave_type_id, start_date, end_date, deducted_days, days, status")
      .eq("status", "Deducted")
      .lte("start_date", holiday_date)
      .gte("end_date", holiday_date);

    if (leavesError) {
      return new Response(JSON.stringify({ error: "Leave listesi alınamadı" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const list = leaves || [];
    if (list.length === 0) {
      return new Response(JSON.stringify({ success: true, impacted: 0, changes: [] }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Fetch holidays for overall min/max range once (more efficient)
    const minStart = list.reduce((m, x) => (x.start_date < m ? x.start_date : m), list[0].start_date);
    const maxEnd = list.reduce((m, x) => (x.end_date > m ? x.end_date : m), list[0].end_date);

    const { data: holidayRows, error: holidayError } = await supabase
      .from("holidays")
      .select("date, is_half_day, half")
      .gte("date", minStart)
      .lte("date", maxEnd);

    if (holidayError) {
      return new Response(JSON.stringify({ error: "Resmi tatiller alınamadı" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const holidays = (holidayRows || []).map((h) => ({
      date: h.date,
      is_half_day: h.is_half_day,
      half: h.half,
    }));

    const changes: any[] = [];

    for (const leave of list) {
      const oldDeducted = Number(leave.deducted_days ?? leave.days ?? 0);

      const newDeducted = calcLeaveDays({
        startDate: leave.start_date,
        endDate: leave.end_date,
        holidays: holidays.filter((h) => h.date >= leave.start_date && h.date <= leave.end_date),
      });

      const delta = Math.round((newDeducted - oldDeducted) * 2) / 2;
      if (delta === 0) continue;

      changes.push({
        leave_id: leave.id,
        user_id: leave.user_id,
        leave_type_id: leave.leave_type_id,
        start_date: leave.start_date,
        end_date: leave.end_date,
        old_deducted_days: oldDeducted,
        new_deducted_days: newDeducted,
        delta,
      });

      if (dry_run) continue;

      // Update leave request deducted_days
      const { error: updLeaveErr } = await supabase
        .from("leave_requests")
        .update({ deducted_days: newDeducted })
        .eq("id", leave.id);

      if (updLeaveErr) {
        // skip balance update if leave update failed
        continue;
      }

      // Update leave balance (used += delta, remaining -= delta)
      const { data: balance, error: balErr } = await supabase
        .from("leave_balances")
        .select("id, used, remaining")
        .eq("user_id", leave.user_id)
        .eq("leave_type_id", leave.leave_type_id)
        .maybeSingle();

      if (balErr || !balance) continue;

      const newUsed = Number(balance.used) + delta;
      const newRemaining = Number(balance.remaining) - delta;

      const { error: updBalErr } = await supabase
        .from("leave_balances")
        .update({ used: newUsed, remaining: newRemaining, last_updated: new Date().toISOString() })
        .eq("id", balance.id);

      if (updBalErr) continue;

      // Log
      await supabase.from("logs").insert([{
        user_id: user.id,
        actor_email: user.email,
        action: "reconcile_holiday_impact",
        target_table: "leave_requests",
        target_id: leave.id,
        status_before: "Deducted",
        status_after: "Deducted",
        details: {
          holiday_date,
          old_deducted_days: oldDeducted,
          new_deducted_days: newDeducted,
          delta,
        },
      }]);
    }

    return new Response(
      JSON.stringify({
        success: true,
        impacted: list.length,
        changed: changes.length,
        dry_run: !!dry_run,
        changes,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || e) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
