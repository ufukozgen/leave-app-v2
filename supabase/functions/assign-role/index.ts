// supabase/functions/assign-role/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://leave-app-v2.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user_id, role } = await req.json();

    // Auth
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user: actor }, error: userError } = await supabase.auth.getUser(jwt);

    if (userError || !actor)
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });

    // Only admin can assign roles
    const { data: actorRow } = await supabase.from("users").select("role, email").eq("id", actor.id).maybeSingle();
    if (!actorRow || actorRow.role !== "admin")
      return new Response(JSON.stringify({ error: "Only admin allowed." }), { status: 403, headers: corsHeaders });

    // Get old role (for logging)
    const { data: userRow } = await supabase.from("users").select("role").eq("id", user_id).maybeSingle();
    const oldRole = userRow?.role;

    // Update role
    const { error } = await supabase.from("users").update({ role }).eq("id", user_id);
    if (error) throw error;

    // Log the action in users_logs table
    await supabase.from("users_logs").insert([{
      target_user_id: user_id,
      action: "assign_role",
      old_role: oldRole,
      new_role: role,
      performed_by: actor.id,
      performed_by_email: actorRow.email,
      note: "",
      created_at: new Date().toISOString(),
    }]);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || err }), { status: 500, headers: corsHeaders });
  }
});
