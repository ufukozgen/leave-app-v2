// supabase/functions/backup-leave-balances/index.ts
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type BalanceRow = {
  user_id: string;
  remaining: number | null;
  leave_type_id: string;
  users: { name: string | null; email: string | null } | null;
};

type ApprovalAggRow = {
  user_id: string;
  leave_type_id: string | null;
  approved_days: number | null;
};

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // --- simple auth gate (GitHub Action or admin caller) ---
  const devMode = false;
  if (!devMode) {
    const auth = req.headers.get("authorization");
    const expected = `Bearer ${Deno.env.get("ADMIN_SECRET")}`;
    if (!auth || auth !== expected) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // Optional backfill: ?date=YYYY-MM-DD  (stored in snapshot_date)
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date"); // e.g. "2025-09-01"
  const nowUtc = new Date();
  const snapshotDateISO = dateParam ?? nowUtc.toISOString().slice(0, 10); // YYYY-MM-DD
  const snapshotTsISO = nowUtc.toISOString(); // full timestamptz

  // 1) current balances + user info
  const { data: balances, error: fetchBalancesErr } = await supabase
    .from("leave_balances")
    .select(
      `
      user_id,
      remaining,
      leave_type_id,
      users (
        name,
        email
      )
    `
    );

  if (fetchBalancesErr) {
    await supabase.from("leave_backup_logs").insert({
      created_at_ts: new Date().toISOString(),
      status: "error",
      row_count: 0,
      details: `fetch balances failed: ${fetchBalancesErr.message}`
    });
    return new Response(JSON.stringify({ error: fetchBalancesErr.message }), {
      status: 500,
    });
  }

  // 2) approvals snapshot (status = 'Approved' → treat as "approved but not deducted")
  //    Sums the 'days' field per user & leave_type_id.
  const { data: approvalsAgg, error: fetchApprovalsErr } = await supabase
    .from("leave_requests")
    .select("user_id, leave_type_id, days")
    .eq("status", "Approved");

  if (fetchApprovalsErr) {
    await supabase.from("leave_backup_logs").insert({
      created_at_ts: new Date().toISOString(),
      status: "error",
      row_count: 0,
      details: `fetch approvals failed: ${fetchApprovalsErr.message}`
    });
    return new Response(JSON.stringify({ error: fetchApprovalsErr.message }), {
      status: 500,
    });
  }

  // Reduce approvals to a map: user_id -> { leave_type_id: sumDays }
  const approvalsGrouped: Record<string, Record<string, number>> = {};
  (approvalsAgg as { user_id: string; leave_type_id: string | null; days: number | null }[]).forEach((r) => {
    if (!r.user_id || !r.leave_type_id) return;
    if (!approvalsGrouped[r.user_id]) approvalsGrouped[r.user_id] = {};
    const prev = approvalsGrouped[r.user_id][r.leave_type_id] ?? 0;
    approvalsGrouped[r.user_id][r.leave_type_id] = prev + (typeof r.days === "number" ? r.days : 0);
  });

  const safeNum = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

  // 3) group balances per user: user_id -> { name, email, balance:{leave_type_id: remaining} }
  const grouped: Record<
    string,
    { name: string | null; email: string | null; balance: Record<string, number> }
  > = {};
  (balances as BalanceRow[]).forEach((row) => {
    const uid = row.user_id;
    if (!grouped[uid]) {
      grouped[uid] = {
        name: row.users?.name ?? null,
        email: row.users?.email ?? null,
        balance: {},
      };
    }
    if (row.leave_type_id) {
      grouped[uid].balance[row.leave_type_id] = safeNum(row.remaining);
    }
  });

  // 4) build insert payload, including approvals (jsonb)
  const backups = Object.entries(grouped).map(([user_id, { name, email, balance }]) => ({
    user_id,
    name,
    email,
    balances: balance,             // jsonb
    approvals: approvalsGrouped[user_id] ?? {}, // jsonb
    snapshot_date: snapshotDateISO, // DATE
    snapshot_ts: snapshotTsISO,     // timestamptz
    run_ts: snapshotTsISO,
  }));

  // 5) insert
  const { error: insertErr } = await supabase
    .from("leave_balance_backups")
    .insert(backups, { defaultToNull: false });

  if (insertErr) {
    await supabase.from("leave_backup_logs").insert({
      created_at_ts: new Date().toISOString(),
      status: "error",
      row_count: 0,
      details: `insert backups failed: ${insertErr.message}`
    });
    return new Response(JSON.stringify({ error: insertErr.message }), {
      status: 500,
    });
  }

  // 6) log success
  await supabase.from("leave_backup_logs").insert({
    created_at_ts: new Date().toISOString(),
    status: "success",
    row_count: backups.length,
    details: { snapshot_date: snapshotDateISO }
  });

  return new Response(
    JSON.stringify({ status: "success", count: backups.length }),
    { status: 200 }
  );
});
