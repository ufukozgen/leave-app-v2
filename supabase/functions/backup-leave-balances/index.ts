// supabase/functions/backup-leave-balances/index.ts
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type BalanceRow = {
  user_id: string;
  remaining: number | null;
  leave_type_id: string;
  users: { name: string | null; email: string | null } | null;
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

  // Optional: allow ?date=YYYY-MM-DD to backfill a specific snapshot_date
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date"); // "2025-09-01"
  const nowUtc = new Date();
  const snapshotDateISO = dateParam ?? nowUtc.toISOString().slice(0, 10); // YYYY-MM-DD
  const snapshotTsISO = nowUtc.toISOString(); // full timestamp

  // 1) fetch balances + user info
  const { data: balances, error: fetchError } = await supabase
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

  if (fetchError) {
    await supabase.from("leave_backup_logs").insert({
      run_at: new Date().toISOString(),
      row_count: 0,
      status: "error",
      error_message: fetchError.message,
    });
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
    });
  }

  const safeNum = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

  // 2) group per user -> { leaveTypeId: remaining }
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
    grouped[uid].balance[row.leave_type_id] = safeNum(row.remaining);
  });

  // 3) build insert payload (supports both schemas: with or without snapshot_ts)
  const backups = Object.entries(grouped).map(([user_id, { name, email, balance }]) => ({
    user_id,
    name,
    email,
    balance,                  // jsonb column (or text -> jsonb cast on view)
    snapshot_date: snapshotDateISO, // DATE
    // If you added `snapshot_ts timestamptz` (see migration below) it will be used too:
    snapshot_ts: snapshotTsISO,     // timestamptz (ignored if column doesn't exist)
  }));

  // 4) insert in one go (small teams) or chunk if needed
  const { error: insertError } = await supabase
    .from("leave_balance_backups")
    .insert(backups, { defaultToNull: false });

  if (insertError) {
    await supabase.from("leave_backup_logs").insert({
      run_at: new Date().toISOString(),
      row_count: 0,
      status: "error",
      error_message: insertError.message,
    });
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
    });
  }

  // 5) log success
  await supabase.from("leave_backup_logs").insert({
    run_at: new Date().toISOString(),
    row_count: backups.length,
    status: "success",
    error_message: null,
  });

  return new Response(
    JSON.stringify({ status: "success", count: backups.length }),
    { status: 200 }
  );
});
