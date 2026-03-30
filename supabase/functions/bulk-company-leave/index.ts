// supabase/functions/bulk-company-leave/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
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

function addDaysUTC(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function hasOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return !(endA < startB || startA > endB);
}

async function assertUserIsActive(
  adminClient: any,
  userId: string,
  corsHeaders: Record<string, string>,
  message = "User is archived",
) {
  const { data, error } = await adminClient
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
    const body = await req.json();

    const {
      mode,
      user_ids,
      leave_type_id,
      start_date,
      end_date,
      duration_type,
      location,
      note,
      insufficient_balance_action,
    } = body ?? {};

    if (!mode || !["preview", "apply"].includes(mode)) {
      return jsonResponse({ error: "mode must be preview or apply" }, 400, corsHeaders);
    }

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return jsonResponse({ error: "user_ids is required" }, 400, corsHeaders);
    }

    if (!leave_type_id) {
      return jsonResponse({ error: "leave_type_id is required" }, 400, corsHeaders);
    }

    if (!start_date || !end_date) {
      return jsonResponse({ error: "start_date and end_date are required" }, 400, corsHeaders);
    }

    if (!duration_type || !["full", "half-am", "half-pm"].includes(duration_type)) {
      return jsonResponse({ error: "Invalid duration_type" }, 400, corsHeaders);
    }

    if (start_date > end_date) {
      return jsonResponse({ error: "start_date cannot be after end_date" }, 400, corsHeaders);
    }

    if ((duration_type === "half-am" || duration_type === "half-pm") && start_date !== end_date) {
      return jsonResponse(
        { error: "Half-day bulk processing requires start_date and end_date to be the same" },
        400,
        corsHeaders,
      );
    }

    if (
      mode === "apply" &&
      !["deduct_anyway", "skip"].includes(String(insufficient_balance_action || ""))
    ) {
      return jsonResponse(
        { error: "insufficient_balance_action must be deduct_anyway or skip" },
        400,
        corsHeaders,
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) {
      return jsonResponse({ error: "Missing Authorization token" }, 401, corsHeaders);
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await authClient.auth.getUser(jwt);
    if (userError || !user) {
      return jsonResponse({ error: "Kullanıcı doğrulanamadı" }, 401, corsHeaders);
    }

    console.log(`[bulk-company-leave ${reqId}] caller:`, user.email, "mode:", mode);

    {
      const blocked = await assertUserIsActive(adminClient, user.id, corsHeaders);
      if (blocked) return blocked;
    }

    const { data: adminUserRow, error: adminUserErr } = await adminClient
      .from("users")
      .select("id, role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (adminUserErr || !adminUserRow || adminUserRow.role !== "admin") {
      return jsonResponse({ error: "Only admins can use this function." }, 403, corsHeaders);
    }

    const { data: leaveType, error: leaveTypeError } = await adminClient
      .from("leave_types")
      .select("id, name, deducts_from_balance")
      .eq("id", leave_type_id)
      .maybeSingle();

    if (leaveTypeError || !leaveType) {
      return jsonResponse({ error: "Leave type not found" }, 404, corsHeaders);
    }

    const { data: usersData, error: usersError } = await adminClient
      .from("users")
      .select("id, name, email, manager_email, role, is_active")
      .in("id", user_ids);

    if (usersError) {
      console.error(`[bulk-company-leave ${reqId}] users fetch error:`, usersError);
      return jsonResponse({ error: "Selected users could not be loaded" }, 500, corsHeaders);
    }

    const userMap = new Map((usersData || []).map((u) => [u.id, u]));

    const { data: holidayRows, error: holidayError } = await adminClient
      .from("holidays")
      .select("date, is_half_day, half")
      .gte("date", start_date)
      .lte("date", end_date);

    if (holidayError) {
      console.error(`[bulk-company-leave ${reqId}] holiday fetch error:`, holidayError);
      return jsonResponse({ error: "Resmi tatiller alınamadı" }, 500, corsHeaders);
    }

    const { data: overlappingLeaves, error: overlapError } = await adminClient
      .from("leave_requests")
      .select("id, user_id, start_date, end_date, status")
      .in("user_id", user_ids)
      .in("status", ["Pending", "Approved", "Deducted"])
      .lte("start_date", end_date)
      .gte("end_date", start_date);

    if (overlapError) {
      console.error(`[bulk-company-leave ${reqId}] overlap fetch error:`, overlapError);
      return jsonResponse({ error: "Existing leave requests could not be checked" }, 500, corsHeaders);
    }

    const overlapsByUser = new Map<string, any[]>();
    for (const row of overlappingLeaves || []) {
      const arr = overlapsByUser.get(row.user_id) || [];
      arr.push(row);
      overlapsByUser.set(row.user_id, arr);
    }

    const { data: balanceRows, error: balanceError } = await adminClient
      .from("leave_balances")
      .select("id, user_id, leave_type_id, accrued, used, remaining")
      .eq("leave_type_id", leave_type_id)
      .in("user_id", user_ids);

    if (balanceError) {
      console.error(`[bulk-company-leave ${reqId}] balance fetch error:`, balanceError);
      return jsonResponse({ error: "Leave balances could not be loaded" }, 500, corsHeaders);
    }

    const balanceMap = new Map((balanceRows || []).map((b) => [b.user_id, b]));

    const previewResults = [];

    for (const targetUserId of user_ids) {
      const targetUser = userMap.get(targetUserId);

      if (!targetUser) {
        previewResults.push({
          user_id: targetUserId,
          name: null,
          email: "",
          status: "error",
          reason: "User not found",
        });
        continue;
      }

      if (targetUser.is_active === false) {
        previewResults.push({
          user_id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          status: "inactive",
          reason: "Target user is archived",
        });
        continue;
      }

      const computedDays = Number(
        calcLeaveDays({
          startDate: start_date,
          endDate: end_date,
          holidays: (holidayRows || []).map((h) => ({
            date: h.date,
            is_half_day: h.is_half_day,
            half: h.half,
          })),
          durationType: duration_type,
        }),
      );

      const overlaps = overlapsByUser.get(targetUser.id) || [];
      const hasAnyOverlap = overlaps.some((r) =>
        hasOverlap(start_date, end_date, r.start_date, r.end_date)
      );

      if (hasAnyOverlap) {
        previewResults.push({
          user_id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          status: "overlap",
          needed: computedDays,
          reason: "Overlapping leave request exists",
        });
        continue;
      }

      if (!leaveType.deducts_from_balance) {
        previewResults.push({
          user_id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          status: "ready",
          remaining: null,
          needed: computedDays,
        });
        continue;
      }

      const balance = balanceMap.get(targetUser.id);
      if (!balance) {
        previewResults.push({
          user_id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          status: "missing_balance",
          needed: computedDays,
          reason: "No leave balance row found",
        });
        continue;
      }

      const remaining = Number(balance.remaining ?? 0);

      if (remaining < computedDays) {
        previewResults.push({
          user_id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          status: "insufficient_balance",
          remaining,
          needed: computedDays,
          reason: `Remaining balance (${remaining}) is lower than required days (${computedDays})`,
        });
        continue;
      }

      previewResults.push({
        user_id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        status: "ready",
        remaining,
        needed: computedDays,
      });
    }

    const previewSummary = {
      ready: previewResults.filter((r) => r.status === "ready").length,
      insufficient_balance: previewResults.filter((r) => r.status === "insufficient_balance").length,
      overlap: previewResults.filter((r) => r.status === "overlap").length,
      inactive: previewResults.filter((r) => r.status === "inactive").length,
      missing_balance: previewResults.filter((r) => r.status === "missing_balance").length,
      error: previewResults.filter((r) => r.status === "error").length,
    };

    if (mode === "preview") {
      return jsonResponse(
        {
          success: true,
          mode: "preview",
          summary: previewSummary,
          results: previewResults,
          req_id: reqId,
        },
        200,
        corsHeaders,
      );
    }

    const applyResults = [];

    for (const row of previewResults) {
      const targetUser = userMap.get(row.user_id);
      if (!targetUser) continue;

      const computedDays = Number(row.needed ?? 0);

      try {
        if (row.status === "inactive") {
          applyResults.push({
            user_id: row.user_id,
            name: row.name,
            email: row.email,
            status: "skipped",
            needed: computedDays,
            reason: "Target user is archived",
          });
          continue;
        }

        if (row.status === "overlap") {
          applyResults.push({
            user_id: row.user_id,
            name: row.name,
            email: row.email,
            status: "skipped",
            needed: computedDays,
            reason: "Overlapping leave request exists",
          });
          continue;
        }

        if (row.status === "missing_balance") {
          applyResults.push({
            user_id: row.user_id,
            name: row.name,
            email: row.email,
            status: "skipped",
            needed: computedDays,
            reason: "No leave balance row found",
          });
          continue;
        }

        if (row.status === "insufficient_balance" && insufficient_balance_action === "skip") {
          applyResults.push({
            user_id: row.user_id,
            name: row.name,
            email: row.email,
            status: "skipped",
            needed: computedDays,
            remaining_before: row.remaining ?? null,
            remaining_after: row.remaining ?? null,
            reason: "Skipped due to insufficient balance by admin choice",
          });
          continue;
        }

        let balance = null;
        let remainingBefore: number | null = null;
        let remainingAfter: number | null = null;
        let insertedLeaveId: string | null = null;

        // 1) INSERT LEAVE REQUEST FIRST
        const { data: insertedLeave, error: insertLeaveError } = await adminClient
          .from("leave_requests")
          .insert([{
            user_id: targetUser.id,
            leave_type_id,
            start_date,
            end_date,
            return_date: addDaysUTC(end_date, 1),
            location: location || "Company-wide leave",
            note: note || "Bulk company leave processing",
            days: computedDays,
            deducted_days: computedDays,
            manager_email: targetUser.manager_email || adminUserRow.email,
            approval_date: new Date().toISOString(),
            status: "Deducted",
            email: targetUser.email,
            duration_type,
            deduction_date: new Date().toISOString(),
            enable_ooo: false,
            ooo_custom_message: null,
            calendar_event_id: null,
            rejection_reason: null,
          }])
          .select("id")
          .maybeSingle();

        if (insertLeaveError || !insertedLeave) {
          throw insertLeaveError || new Error("Leave request insert failed");
        }

        insertedLeaveId = insertedLeave.id;

        // 2) UPDATE BALANCE AFTER SUCCESSFUL LEAVE INSERT
        if (leaveType.deducts_from_balance) {
          balance = balanceMap.get(targetUser.id);

          if (!balance) {
            // rollback inserted leave
            await adminClient.from("leave_requests").delete().eq("id", insertedLeaveId);
            throw new Error("Balance row missing during apply");
          }

          remainingBefore = Number(balance.remaining ?? 0);
          remainingAfter = remainingBefore - computedDays;
          const newUsed = Number(balance.used ?? 0) + computedDays;

          const { error: updateBalanceError } = await adminClient
            .from("leave_balances")
            .update({
              used: newUsed,
              remaining: remainingAfter,
              last_updated: new Date().toISOString(),
            })
            .eq("id", balance.id);

          if (updateBalanceError) {
            // rollback inserted leave
            await adminClient.from("leave_requests").delete().eq("id", insertedLeaveId);
            throw updateBalanceError;
          }

          balanceMap.set(targetUser.id, {
            ...balance,
            used: newUsed,
            remaining: remainingAfter,
          });

          // 3) BALANCE LOG
          try {
            await adminClient.from("balance_logs").insert([{
              user_id: targetUser.id,
              admin_id: adminUserRow.id,
              admin_email: adminUserRow.email,
              action:
                row.status === "insufficient_balance" && insufficient_balance_action === "deduct_anyway"
                  ? "BULK_LEAVE_FORCED_DEDUCT"
                  : "BULK_LEAVE_DEDUCT",
              remaining_before: remainingBefore,
              remaining_after: remainingAfter,
              note: note || "Bulk company leave processing",
            }]);
          } catch (e) {
            console.error(`[bulk-company-leave ${reqId}] balance_logs insert failed:`, e);
          }
        }

        // 4) ACTION LOG
        try {
          await adminClient.from("logs").insert([{
            user_id: adminUserRow.id,
            actor_email: adminUserRow.email,
            action:
              row.status === "insufficient_balance" && insufficient_balance_action === "deduct_anyway"
                ? "bulk_leave_forced_deduct_insufficient_balance"
                : "bulk_leave_deducted",
            target_table: "leave_requests",
            target_id: insertedLeaveId,
            status_before: null,
            status_after: "Deducted",
            details: {
              req_id: reqId,
              source: "bulk-company-leave",
              target_user_id: targetUser.id,
              target_user_email: targetUser.email,
              start_date,
              end_date,
              duration_type,
              leave_type_id,
              leave_type_name: leaveType.name,
              days: computedDays,
              remaining_before: remainingBefore,
              remaining_after: remainingAfter,
              insufficient_balance_action,
            },
          }]);
        } catch (e) {
          console.error(`[bulk-company-leave ${reqId}] logs insert failed:`, e);
        }

        applyResults.push({
          user_id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          status: "processed",
          needed: computedDays,
          remaining_before: remainingBefore,
          remaining_after: remainingAfter,
          leave_request_id: insertedLeaveId,
          reason:
            row.status === "insufficient_balance" && insufficient_balance_action === "deduct_anyway"
              ? "Processed with forced deduction despite insufficient balance"
              : "Processed successfully",
        });
      } catch (e: any) {
        console.error(`[bulk-company-leave ${reqId}] apply error for user ${row.user_id}:`, e);

        applyResults.push({
          user_id: row.user_id,
          name: row.name,
          email: row.email,
          status: "error",
          needed: computedDays,
          reason: e?.message || "Unexpected error",
        });

        try {
          await adminClient.from("logs").insert([{
            user_id: adminUserRow.id,
            actor_email: adminUserRow.email,
            action: "bulk_leave_error",
            target_table: "users",
            target_id: row.user_id,
            details: {
              req_id: reqId,
              source: "bulk-company-leave",
              start_date,
              end_date,
              duration_type,
              leave_type_id,
              error: e?.message || String(e),
            },
          }]);
        } catch (_e) {}
      }
    }

    const applySummary = {
      ...previewSummary,
      processed: applyResults.filter((r) => r.status === "processed").length,
      skipped: applyResults.filter((r) => r.status === "skipped").length,
      error_apply: applyResults.filter((r) => r.status === "error").length,
    };

    return jsonResponse(
      {
        success: true,
        mode: "apply",
        summary: applySummary,
        results: applyResults,
        req_id: reqId,
      },
      200,
      corsHeaders,
    );
  } catch (e: any) {
    console.error("bulk-company-leave error:", e);
    return jsonResponse({ error: "Beklenmeyen hata: " + (e?.message || String(e)) }, 500, corsHeaders);
  }
});