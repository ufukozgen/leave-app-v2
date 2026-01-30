import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --------------------------- CORS ---------------------------
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // --------------------------- ENV ---------------------------
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";
    const GITHUB_OWNER = Deno.env.get("GITHUB_OWNER") || "";
    const GITHUB_REPO = Deno.env.get("GITHUB_REPO") || "";
    const GITHUB_WORKFLOW_FILE = Deno.env.get("GITHUB_WORKFLOW_FILE") || "";
    const GITHUB_REF = Deno.env.get("GITHUB_REF") || "main";

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase env vars" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO || !GITHUB_WORKFLOW_FILE) {
      return new Response(
        JSON.stringify({ error: "Missing GitHub secrets (token/owner/repo/workflow file)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --------------------------- AUTH (JWT) ---------------------------
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing Authorization Bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client 1: anon + JWT (to identify caller)
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid session token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = userData.user.id;
    const callerEmail = userData.user.email || null;

    // Client 2: service role (to check admin in DB safely)
    const supabaseSrv = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // --------------------------- ADMIN CHECK ---------------------------
    // Supports:
    //  - users.role = 'admin'
    //  - user_roles.role = 'admin'
    let isAdmin = false;

    // A) users.role
    {
      const { data, error } = await supabaseSrv
        .from("users")
        .select("role")
        .eq("id", callerId)
        .maybeSingle();

      if (!error && data?.role === "admin") isAdmin = true;
    }

    // B) user_roles table (fallback)
    if (!isAdmin) {
      const { data, error } = await supabaseSrv
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId)
        .maybeSingle();

      if (!error && data?.role === "admin") isAdmin = true;
    }

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin only", callerEmail }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --------------------------- DISPATCH WORKFLOW ---------------------------
    const dispatchUrl =
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}` +
      `/actions/workflows/${GITHUB_WORKFLOW_FILE}/dispatches`;

    const ghRes = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "leave-app-v2",
      },
      body: JSON.stringify({
        ref: GITHUB_REF,
        inputs: {
          // optional inputs if you add them in workflow_dispatch:
          // triggered_by: callerEmail ?? "unknown",
          // trigger_type: "manual_ui",
        },
      }),
    });

    // workflow_dispatch success is normally 204 No Content
    if (!ghRes.ok) {
      const details = await ghRes.text();
      return new Response(
        JSON.stringify({
          error: "GitHub dispatch failed",
          status: ghRes.status,
          details,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dispatched: true,
        workflow: GITHUB_WORKFLOW_FILE,
        ref: GITHUB_REF,
        callerEmail,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "dispatch-backup-workflow error", details: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
