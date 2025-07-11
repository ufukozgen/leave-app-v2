// supabase/functions/assign-manager/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

// CORS headers for browser support
const allowedOrigins = [
  "https://leave-app-v2.vercel.app",
  "http://localhost:5173",
];
function getCORSHeaders(origin) {
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
    const { user_id, manager_email } = await req.json();

    // Auth
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user: actor }, error: userError } = await supabase.auth.getUser(jwt);

    if (userError || !actor) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });
    // Only admin can assign managers
    const { data: actorRow } = await supabase.from("users").select("role").eq("id", actor.id).maybeSingle();
    if (!actorRow || actorRow.role !== "admin") return new Response(JSON.stringify({ error: "Only admin allowed." }), { status: 403, headers: corsHeaders });

    // Assign manager
    const { error } = await supabase.from("users").update({ manager_email }).eq("id", user_id);
    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || err }), { status: 500, headers: corsHeaders });
  }
});
