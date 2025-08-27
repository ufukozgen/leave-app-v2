// /supabase/functions/reverse-leave/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";
import { cancelCalendarEvent } from "../helpers/cancelCalendarEvent.ts";

const sharedCalendarEmail = Deno.env.get("SHARED_CALENDAR_EMAIL");

// --------------------------- CORS ---------------------------
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

// --------------------------- Microsoft Graph (disable OOO) ---------------------------
// Try both naming schemes so you can reuse existing secrets without renaming
const TENANT_ID =
  Deno.env.get("MICROSOFT_TENANT_ID") ||
  Deno.env.get("AZURE_TENANT_ID") ||
  "";
const CLIENT_ID =
  Deno.env.get("MICROSOFT_CLIENT_ID") ||
  Deno.env.get("AZURE_CLIENT_ID") ||
  "";
const CLIENT_SECRET =
  Deno.env.get("MICROSOFT_CLIENT_SECRET") ||
  Deno.env.get("AZURE_CLIENT_SECRET") ||
  "";

const GRAPH_TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function getGraphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials",
  });
  const res = await fetch(GRAPH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Graph token error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

async function disableOutOfOffice(userEmail: string) {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing Graph secrets (TENANT_ID / CLIENT_ID / CLIENT_SECRET).");
  }
  const token = await getGraphToken();
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(userEmail)}/mailboxSettings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ automaticRepliesSetting: { status: "disabled" } }),
  });
  if (!res.ok) throw new Error(`disable OOO failed ${res.status}: ${await res.text()}`);
}

// --------------------------- Handler ---------------------------
serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { request_id } = await req.json();
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Who is calling?
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // Select all needed fields (added: email, enable_ooo)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, email, leave_type_id, days, status, manager_email, start_date, end_date, enable_ooo, calendar_event_id, approval_date")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("role, email")
      .eq("id", user.id)
      .maybeSingle();

    if (!userRow) {
      return new Response(JSON.stringify({ error: "Kullanıcı bulunamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const isManager = userRow.email === leave.manager_email;
    const isAdmin = userRow.role === "admin";
    if (!isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    if (leave.status !== "Deducted" && leave.status !== "Approved") {
      return new Response(JSON.stringify({ error: "Sadece düşülen veya onaylanan izinler geri alınabilir." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // New status and balance logic
    let newStatus = "";
    let doBalanceUpdate = false;
    let shouldDisableOOO = false;

    if (leave.status === "Deducted") {
      newStatus = "Approved";   // revert deduction back to approved
      doBalanceUpdate = true;   // restore balance
      shouldDisableOOO = false; // OOO unaffected in this leg
    } else if (leave.status === "Approved") {
      newStatus = "Pending";    // move approved back to pending
      doBalanceUpdate = false;
      shouldDisableOOO = true;  // recommended: disable OOO when approval is reversed
    }

    // If reverting a deduction, also restore balance!
    if (doBalanceUpdate) {
      const { data: balance, error: balanceError } = await supabase
        .from("leave_balances")
        .select("id, used, remaining")
        .eq("user_id", leave.user_id)
        .eq("leave_type_id", leave.leave_type_id)
        .maybeSingle();

      if (balanceError || !balance) {
        return new Response(JSON.stringify({ error: "İzin bakiyesi bulunamadı" }), {
          status: 404, headers: corsHeaders
        });
      }

      const daysToRevert = Number(leave.days);
      const newUsed = Number(balance.used) - daysToRevert;
      const newRemaining = Number(balance.remaining) + daysToRevert;
      if (newUsed < 0) {
        return new Response(JSON.stringify({ error: "İzin bakiyesi geri alınamıyor (kullanılan gün negatif olur)" }), {
          status: 400, headers: corsHeaders
        });
      }

      const { error: updateError } = await supabase
        .from("leave_balances")
        .update({ used: newUsed, remaining: newRemaining, last_updated: new Date().toISOString() })
        .eq("id", balance.id);

      if (updateError) {
        return new Response(JSON.stringify({ error: "Bakiyeler geri alınamadı" }), {
          status: 500, headers: corsHeaders
        });
      }
    }

    // If reverting Approved → Pending, remove calendar event if exists
    if (leave.status === "Approved" && leave.calendar_event_id) {
      try {
        await cancelCalendarEvent({
          sharedCalendarEmail,
          eventId: leave.calendar_event_id
        });
      } catch (calendarError) {
        console.error("Calendar event cancellation failed (reverse-leave):", calendarError);
      }
    }

    // Update leave status (and clear approval_date if going back to Pending)
    const updatePayload: Record<string, any> = { status: newStatus };
    if (newStatus === "Pending") {
      updatePayload.approval_date = null;
    }
    if (newStatus === "Approved") {
      // If you also store deduction_date, clear it here when reverting from Deducted
      updatePayload.deduction_date = null;
    }

    const { error: updateLeaveError } = await supabase
      .from("leave_requests")
      .update(updatePayload)
      .eq("id", leave.id);

    if (updateLeaveError) {
      return new Response(JSON.stringify({ error: "Geri alma işlemi başarısız" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Disable OOO if appropriate and opted-in
    try {
      if (shouldDisableOOO && leave.enable_ooo === true && leave.email) {
        await disableOutOfOffice(leave.email);
        console.log(`OOO disabled for ${leave.email} due to reverse`);
      }
    } catch (e) {
      console.error("Failed to disable OOO on reverse:", e);
    }

    // Log the action
    try {
      await supabase.from("logs").insert([{
        user_id: user.id,
        actor_email: user.email,
        action: leave.status === "Deducted" ? "revert_deducted_request" : "revert_approved_request",
        target_table: "leave_requests",
        target_id: leave.id,
        status_before: leave.status,
        status_after: newStatus,
        details: {
          start_date: leave.start_date,
          end_date: leave.end_date,
          days: leave.days,
          enable_ooo: leave.enable_ooo,
        },
      }]);
    } catch (logError) {
      console.error("Logging failed in reverse-leave:", logError);
    }

    // Notify leave owner by email
    const { data: ownerUser } = await supabase
      .from("users")
      .select("email")
      .eq("id", leave.user_id)
      .maybeSingle();

    if (ownerUser?.email) {
      let statusMessage = "";
      if (newStatus === "Approved") {
        statusMessage = "İzin bakiyeniz güncellendi. İzniniz tekrar <b>ONAYLANDI</b> ve kesinti geri alındı.";
      } else if (newStatus === "Pending") {
        statusMessage = "İzniniz tekrar <b>BEKLEMEDE</b>. Onay geri alındı ve henüz onaylanmadı.";
      } else {
        statusMessage = "İzin durumunuzda değişiklik yapıldı.";
      }

      const emailSubject = "İzin Talebinizde Güncelleme";
      const emailBody = `
        <p>Sayın çalışan,</p>
        <p>${leave.days} gün olarak talep ettiğiniz izninizde bir güncelleme yapıldı.</p>
        <p>${statusMessage}</p>
        <p>Daha fazla bilgi için lütfen yöneticinizle iletişime geçiniz.</p>

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

      await sendGraphEmail({
        to: ownerUser.email,
        subject: emailSubject,
        html: emailBody,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || String(e)) }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
