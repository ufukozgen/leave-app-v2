import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGraphToken } from "../helpers/graphAuth.ts";

// CORS headers for browser support
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://leave-app-v2.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    // Handle CORS preflight
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_email } = await req.json();
    if (!user_email) {
      return new Response(JSON.stringify({ error: "user_email required" }), { status: 400, headers: corsHeaders });
    }

    const token = await getGraphToken();
    const url = `https://graph.microsoft.com/v1.0/users/${user_email}/photo/$value`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: "Photo not found", details: errText }), { status: 404, headers: corsHeaders });
    }

    const buffer = await resp.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    return new Response(JSON.stringify({
      image: `data:image/jpeg;base64,${base64}`
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || e }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
