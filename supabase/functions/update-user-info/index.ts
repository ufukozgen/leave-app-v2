import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

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

// ✅ TR-safe normalization (removes dots etc.)
function normalizeInitialsTR(input: unknown) {
  const raw = String(input ?? "");
  const lettersOnly = raw.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "").slice(0, 3);
  return lettersOnly.toLocaleUpperCase("tr-TR");
}

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, name, initials, is_admin } = await req.json();

    // Auth
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user: actor }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !actor) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });
    }

    // Only admin can update users
    const { data: actorRow } = await supabase.from("users").select("role, email").eq("id", actor.id).maybeSingle();
    if (!actorRow || actorRow.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only admin allowed." }), { status: 403, headers: corsHeaders });
    }

    // Get old values
    const { data: userRow } = await supabase.from("users").select("name, initials").eq("id", user_id).maybeSingle();
    if (!userRow) {
      return new Response(JSON.stringify({ error: "User not found." }), { status: 404, headers: corsHeaders });
    }

    // ✅ Normalize initials BEFORE validation / uniqueness
    const normalizedInitials = typeof initials === "string" ? normalizeInitialsTR(initials) : "";

    // Validate initials (after normalization)
    if (typeof initials === "string") {
      if (!/^[A-ZÇĞİÖŞÜ]{2}[A-ZÇĞİÖŞÜ]?$/.test(normalizedInitials)) {
        return new Response(
          JSON.stringify({
            error:
              "Baş harfler 2 veya 3 karakter olmalı ve büyük harf olmalı (maks. 3 karakter, Türkçe desteklenir).",
          }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Uniqueness check
      const { data: sameInitials } = await supabase
        .from("users")
        .select("id")
        .eq("initials", normalizedInitials)
        .neq("id", user_id)
        .maybeSingle();

      if (sameInitials) {
        return new Response(
          JSON.stringify({ error: "Baş harfler başka bir kullanıcıya atanmış." }),
          { status: 409, headers: corsHeaders }
        );
      }
    }

    // Prepare update object
    const updateObj: { name?: string; initials?: string } = {};
    const logActions: any[] = [];

    if (name && name !== userRow.name) {
      updateObj.name = name;
      logActions.push({
        target_user_id: user_id,
        action: "update_name",
        performed_by: actor.id,
        performed_by_email: actorRow.email,
        note: `Adı '${userRow.name || ""}' iken '${name}' olarak güncellendi`,
        created_at: new Date().toISOString(),
      });
    }

    if (typeof initials === "string" && normalizedInitials && normalizedInitials !== userRow.initials) {
      updateObj.initials = normalizedInitials;
      logActions.push({
        target_user_id: user_id,
        action: "update_initials",
        performed_by: actor.id,
        performed_by_email: actorRow.email,
        note: `Baş harfler '${userRow.initials || ""}' iken '${normalizedInitials}' olarak güncellendi`,
        created_at: new Date().toISOString(),
      });
    }

    if (Object.keys(updateObj).length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No changes" }), { status: 200, headers: corsHeaders });
    }

    // Update user
    const { error: updateError } = await supabase.from("users").update(updateObj).eq("id", user_id);
    if (updateError) throw updateError;

    // Update is_admin via app_metadata
    if (typeof is_admin === "boolean") {
      const { error: metaError } = await supabase.auth.admin.updateUserById(user_id, {
        app_metadata: { is_admin },
      });
      if (metaError) {
        return new Response(JSON.stringify({ error: "Failed to update app_metadata" }), { status: 500, headers: corsHeaders });
      }

      logActions.push({
        target_user_id: user_id,
        action: "update_is_admin",
        performed_by: actor.id,
        performed_by_email: actorRow.email,
        note: `Yönetici yetkisi '${is_admin}' olarak ayarlandı`,
        created_at: new Date().toISOString(),
      });
    }

    // Insert logs (NOTE: your code uses "user_logs" but schema shows "users_logs" – keep yours if it exists)
    if (logActions.length) {
      await supabase.from("user_logs").insert(logActions);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || err }), { status: 500, headers: corsHeaders });
  }
});
