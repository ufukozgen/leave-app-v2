// supabase/functions/update-leave-balance/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";

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

function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

async function assertUserIsActive(
  supabase: any,
  userId: string,
  corsHeaders: Record<string, string>,
  message = "User is archived",
) {
  const { data, error } = await supabase
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

    const user_id: string = body.user_id;
    const remaining: number = Number(body.remaining);
    const note: string = body.note ?? "";
    // Optional (future-proof). If you don’t send it, we’ll use your default annual type id.
    const leave_type_id: string | null = body.leave_type_id ?? null;

    if (!user_id) return jsonResponse({ error: "user_id is required" }, 400, corsHeaders);
    if (!Number.isFinite(remaining)) return jsonResponse({ error: "remaining must be a number" }, 400, corsHeaders);

    // JWT for actor auth
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return jsonResponse({ error: "Missing Authorization token" }, 401, corsHeaders);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    // Auth: get the actor
    const { data: { user: actor }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !actor) {
      return jsonResponse({ error: "Kullanıcı doğrulanamadı" }, 401, corsHeaders);
    }

    console.log(`[update-leave-balance ${reqId}] caller:`, actor.email, "target user_id:", user_id);

    // ✅ Actor active guard
    {
      const blocked = await assertUserIsActive(supabase, actor.id, corsHeaders);
      if (blocked) return blocked;
    }

    // Actor role check
    const { data: actorRow, error: actorRowErr } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", actor.id)
      .maybeSingle();

    if (actorRowErr) console.log(`[update-leave-balance ${reqId}] actorRow error:`, actorRowErr);

    if (!actorRow || actorRow.role !== "admin") {
      return jsonResponse({ error: "Sadece adminler izin bakiyesi güncelleyebilir." }, 403, corsHeaders);
    }

    // Fetch employee (target)
    const { data: targetUser, error: targetErr } = await supabase
      .from("users")
      .select("id, email, name, manager_email, is_active")
      .eq("id", user_id)
      .maybeSingle();

    if (targetErr) console.log(`[update-leave-balance ${reqId}] target user lookup error:`, targetErr);

    if (!targetUser) {
      return jsonResponse({ error: "Çalışan bulunamadı." }, 404, corsHeaders);
    }

    // ✅ Target active guard (recommended)
    if (targetUser.is_active === false) {
      return jsonResponse({ error: "Target user is archived" }, 409, corsHeaders);
    }

    const employeeEmail = normalizeEmail(targetUser.email);
    const managerEmail = normalizeEmail(targetUser.manager_email);

    // Determine leave_type_id (your current default)
    const DEFAULT_ANNUAL_LEAVE_TYPE_ID = "9664d16e-0a1c-441c-842a-b7371252f943";
    const effectiveLeaveTypeId = leave_type_id ?? DEFAULT_ANNUAL_LEAVE_TYPE_ID;

    // Fetch previous balance (by user + leave_type)
    const { data: oldBalance, error: balErr } = await supabase
      .from("leave_balances")
      .select("id, user_id, leave_type_id, remaining")
      .eq("user_id", user_id)
      .eq("leave_type_id", effectiveLeaveTypeId)
      .maybeSingle();

    if (balErr) console.log(`[update-leave-balance ${reqId}] old balance lookup error:`, balErr);

    const oldRemaining = Number(oldBalance?.remaining ?? 0);
    const action = remaining > oldRemaining ? "accrual" : "correction";

    // Upsert balance row
    const balanceFields = {
      user_id,
      leave_type_id: effectiveLeaveTypeId,
      remaining,
      last_updated: new Date().toISOString(),
    };

    if (oldBalance?.id) {
      const { error } = await supabase
        .from("leave_balances")
        .update(balanceFields)
        .eq("id", oldBalance.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("leave_balances")
        .insert([balanceFields]);
      if (error) throw error;
    }

    // Log the change in balance_logs (best-effort)
    try {
      await supabase.from("balance_logs").insert([{
        user_id,
        admin_id: actor.id,
        admin_email: actorRow.email, // ✅ from DB, not client
        action,
        remaining_before: oldRemaining,
        remaining_after: remaining,
        note: note ?? "",
        created_at: new Date().toISOString(),
        // optional correlation
        details: { req_id: reqId, leave_type_id: effectiveLeaveTypeId },
      }]);
    } catch (e) {
      console.error(`[update-leave-balance ${reqId}] balance_logs insert failed:`, e);
    }

    const delta = Math.abs(remaining - oldRemaining);
    const actionDesc = action === "accrual"
      ? `Yıllık izin bakiyeniz <b>${delta}</b> gün artırıldı.`
      : `Yıllık izin bakiyeniz <b>${delta}</b> gün azaltıldı/düzeltildi.`;

    const subject = "Yıllık İzin Bakiyesi Güncellendi";

    // Employee email (robust)
    if (employeeEmail) {
      const htmlEmployee = `
        <p>Sayın ${targetUser.name || employeeEmail},</p>
        <p>Yetkili <b>${actorRow.name || actorRow.email}</b> tarafından yıllık izin bakiyeniz güncellendi.</p>
        <p>${actionDesc}</p>
        <ul>
          <li><b>Önceki bakiye:</b> ${oldRemaining} gün</li>
          <li><b>Yeni bakiye:</b> ${remaining} gün</li>
        </ul>
        ${note ? `<p><b>Açıklama:</b> ${note}</p>` : ""}
        <p>Detaylı bilgi için uygulamayı kontrol edebilirsiniz.</p>
        <br/>
        <a href="https://leave-app-v2.vercel.app"
           style="
             display:inline-block;
             padding:10px 20px;
             background:#F39200;
             color:#fff;
             border-radius:8px;
             text-decoration:none;
             font-weight:bold;
             font-family:Calibri, Arial, sans-serif;
             font-size:16px;
             margin-top:10px;
           ">
           İzin Uygulamasına Git
        </a>
      `;

      console.log(`[update-leave-balance ${reqId}] emailing employee:`, employeeEmail);
      try {
        await sendGraphEmail({ to: employeeEmail, subject, html: htmlEmployee });
        console.log(`[update-leave-balance ${reqId}] employee email SENT`);
      } catch (e) {
        console.error(`[update-leave-balance ${reqId}] employee email FAILED:`, e);
      }
    } else {
      console.log(`[update-leave-balance ${reqId}] missing employee email; skipping`);
    }

    // Manager email (robust: never gate on users lookup)
    if (managerEmail) {
      // Optional manager name lookup (nice-to-have)
      let managerName = "";
      try {
        const { data: mgrRow } = await supabase
          .from("users")
          .select("name")
          .eq("email", managerEmail)
          .maybeSingle();
        managerName = mgrRow?.name || "";
      } catch (_e) {}

      const htmlManager = `
        <p>Sayın ${managerName || managerEmail},</p>
        <p>Sorumluluğunuzdaki <b>${targetUser.name || employeeEmail || "-"}</b> çalışanının yıllık izin bakiyesi güncellendi.</p>
        <p>${actionDesc}</p>
        <ul>
          <li><b>Önceki bakiye:</b> ${oldRemaining} gün</li>
          <li><b>Yeni bakiye:</b> ${remaining} gün</li>
        </ul>
        ${note ? `<p><b>Açıklama:</b> ${note}</p>` : ""}
        <p>Detaylı bilgi için uygulamayı kontrol edebilirsiniz.</p>
        <br/>
        <a href="https://leave-app-v2.vercel.app"
           style="
             display:inline-block;
             padding:10px 20px;
             background:#F39200;
             color:#fff;
             border-radius:8px;
             text-decoration:none;
             font-weight:bold;
             font-family:Calibri, Arial, sans-serif;
             font-size:16px;
             margin-top:10px;
           ">
           İzin Uygulamasına Git
        </a>
      `;

      console.log(`[update-leave-balance ${reqId}] emailing manager:`, managerEmail);
      try {
        await sendGraphEmail({ to: managerEmail, subject, html: htmlManager });
        console.log(`[update-leave-balance ${reqId}] manager email SENT`);
      } catch (e) {
        console.error(`[update-leave-balance ${reqId}] manager email FAILED:`, e);
      }
    } else {
      console.log(`[update-leave-balance ${reqId}] missing manager_email on user; skipping manager email`);
    }

    return jsonResponse({ success: true, req_id: reqId }, 200, corsHeaders);
  } catch (err: any) {
    console.error(err);
    return jsonResponse({ error: err?.message || String(err) }, 500, corsHeaders);
  }
});
