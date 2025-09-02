// /supabase/functions/helpers/reconcileUserOOO.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

const TENANT_ID = Deno.env.get("MICROSOFT_TENANT_ID") || Deno.env.get("AZURE_TENANT_ID") || "";
const CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") || Deno.env.get("AZURE_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET") || Deno.env.get("AZURE_CLIENT_SECRET") || "";
const GRAPH_TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// IMPORTANT: Microsoft Graph expects **Windows** time zone IDs.
// For Türkiye: "Turkey Standard Time"
const WINDOWS_TZ = "Turkey Standard Time";

// get app token
async function getGraphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials",
  });
  const res = await fetch(GRAPH_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`Graph token error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

// set OOO to "disabled"
async function graphDisableOOO(email: string) {
  const token = await getGraphToken();
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(email)}/mailboxSettings`;
  const body = { automaticRepliesSetting: { status: "disabled" } };
  const res = await fetch(url, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`disable OOO failed ${res.status}: ${await res.text()}`);
}

// set OOO to a **single scheduled window** covering all leaves
async function graphScheduleOOO(email: string, startISO: string, endISO: string, internalHtml?: string, externalHtml?: string) {
  const token = await getGraphToken();
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(email)}/mailboxSettings`;

  const payload = {
    automaticRepliesSetting: {
      status: "scheduled",
      scheduledStartDateTime: { dateTime: startISO, timeZone: WINDOWS_TZ },
      scheduledEndDateTime:   { dateTime: endISO,   timeZone: WINDOWS_TZ },
      internalReplyMessage: internalHtml ?? "",
      externalReplyMessage: externalHtml ?? "",
      externalAudience: "contactsOnly", // adjust if you want "all"
    },
  };

  const res = await fetch(url, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`schedule OOO failed ${res.status}: ${await res.text()}`);
}

// Utility: build all‑day window [start 00:00, end 23:59:59] in Istanbul
function fullDayBoundsISO(localDateYYYYMMDD: string, endOfDay = false) {
  // localDateYYYYMMDD like "2025-09-03"
  const [y, m, d] = localDateYYYYMMDD.split("-").map(Number);
  // Europe/Istanbul is UTC+03 year‑round now; use fixed offset for simplicity
  const pad = (n: number) => String(n).padStart(2, "0");
  const t = endOfDay ? "23:59:59" : "00:00:00";
  // We pass **local** dateTime string; Graph uses `timeZone` field above.
  return `${pad(y)}-${pad(m)}-${pad(d)}T${t}`;
}

type Supa = ReturnType<typeof createClient>;

/**
 * Recompute user's OOO after any leave status change.
 * Policy:
 *   - Consider leaves with status IN ('Approved')  // adjust if Pending should count too
 *   - AND enable_ooo = true
 *   - AND end_date >= today (still relevant)
 * Result:
 *   - If none: disable OOO
 *   - Else: schedule a single window from MIN(start_date) 00:00 to MAX(end_date) 23:59:59
 */
export async function reconcileUserOOO(supabase: Supa, params: { user_id: string; email: string }) {
  const today = new Date(); // now in UTC
  const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD (UTC date; OK for filter)

  const { data: leaves, error } = await supabase
    .from("leave_requests")
    .select("start_date, end_date")
    .eq("user_id", params.user_id)
    .eq("enable_ooo", true)
    .eq("status", "Approved")   // <- if you want Pending to also trigger OOO, change to .in("status", ["Pending","Approved"])
    .gte("end_date", todayStr); // only current/future relevant windows

  if (error) {
    console.error("reconcileUserOOO: query error; DO NOT change OOO:", error);
    return; // be conservative; leave existing OOO as is
  }

  if (!leaves || leaves.length === 0) {
    // No active OOO-worthy leaves → disable
    try {
      await graphDisableOOO(params.email);
      console.log(`OOO disabled for ${params.email} (no active OOO windows).`);
    } catch (e) {
      console.error("graphDisableOOO failed:", e);
    }
    return;
  }

  // Merge by taking the overall min start and max end (single window; Graph supports only one scheduled window)
  let minStart = leaves[0].start_date;
  let maxEnd = leaves[0].end_date;
  for (const r of leaves) {
    if (r.start_date < minStart) minStart = r.start_date;
    if (r.end_date > maxEnd)     maxEnd   = r.end_date;
  }

  const startISO = fullDayBoundsISO(minStart, false); // 00:00
  const endISO   = fullDayBoundsISO(maxEnd, true);    // 23:59:59

  try {
    await graphScheduleOOO(params.email, startISO, endISO);
    console.log(`OOO scheduled for ${params.email}: ${startISO} → ${endISO} (${WINDOWS_TZ}).`);
  } catch (e) {
    console.error("graphScheduleOOO failed:", e);
  }
}
