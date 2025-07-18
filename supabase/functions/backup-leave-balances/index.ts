import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const devMode = false;

  // Optional admin secret check (skip if devMode)
  if (!devMode) {
    const auth = req.headers.get("authorization");
    const expected = `Bearer ${Deno.env.get("ADMIN_SECRET")}`;
    if (!auth || auth !== expected) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // Fetch leave balances with user info
  const { data: balances, error: fetchError } = await supabase
    .from("leave_balances")
     .select(`
    user_id,
    remaining,
    leave_type_id,
    users (
      name,
      email
    )
  `);

  if (fetchError) {
    // ❌ Log error
    await supabase.from("leave_backup_logs").insert({
      row_count: 0,
      status: "error",
      error_message: fetchError.message,
    });

    return new Response(JSON.stringify({ fetchError }), { status: 500 });
  }

  // Group balances by user
const grouped = balances.reduce((acc: Record<string, any>, entry) => {
  if (!acc[entry.user_id]) {
    acc[entry.user_id] = {
      name: entry.users?.name ?? null,
      email: entry.users?.email ?? null,
      balance: {},
    };
  }
  acc[entry.user_id].balance[entry.leave_type_id] = entry.remaining;
  return acc;
}, {});

const backups = Object.entries(grouped).map(([user_id, { name, email, balance }]) => ({
  user_id,
  name,
  email,
  balance,
}));


  // Insert into backup table
  const { error: insertError } = await supabase
    .from("leave_balance_backups")
    .insert(backups);

  if (insertError) {
    // ❌ Log insert error
    await supabase.from("leave_backup_logs").insert({
      row_count: 0,
      status: "error",
      error_message: insertError.message,
    });

    return new Response(JSON.stringify({ insertError }), { status: 500 });
  }

  // ✅ Log successful backup
  await supabase.from("leave_backup_logs").insert({
    row_count: backups.length,
    status: "success",
  });

  return new Response(
    JSON.stringify({ status: "success", count: backups.length }),
    { status: 200 }
  );
});
