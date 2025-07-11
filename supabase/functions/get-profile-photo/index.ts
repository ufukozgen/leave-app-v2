import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGraphToken } from "../helpers/graphAuth.ts";

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

  if (req.method === "OPTIONS") {
    // Handle CORS preflight
    return new Response("ok", { headers: corsHeaders });
  }
console.log("Function called:", req.method);
  try {
    const { user_email } = await req.json();

    console.log("user_email", user_email);
    console.log("trying getGraphToken...");

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
  return new Response(JSON.stringify({ error: e?.message || e, stack: e?.stack }), {
    status: 500,
    headers: corsHeaders,
  });
}
});

