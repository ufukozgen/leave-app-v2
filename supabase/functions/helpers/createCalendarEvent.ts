// helpers/createCalendarEvent.ts
import { getGraphToken } from "./graphAuth.ts";

/** Utility: Get initials from e-mail like "x.y.z@domain" => "XYZ" */
function getInitialsFromEmail(email: string): string {
  if (!email) return "";
  const [username] = email.split('@');
  return username
    .split('.')
    .map(part => part.charAt(0).toUpperCase())
    .join('');
}

/** Adds one day to a yyyy-mm-dd string */
function addOneDay(dateStr: string): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0,10);
}

/**
 * Creates an event in a shared Outlook calendar and invites the employee as attendee.
 */
export async function createCalendarEvent({
  sharedCalendarEmail,
  employeeEmail,
  employeeName,
  leave
}: {
  sharedCalendarEmail: string,
  employeeEmail: string,
  employeeName: string,
  leave: {
    start_date: string,
    end_date: string,
    duration_type?: "full" | "half-am" | "half-pm",
    note?: string
  }
}) {
  const accessToken = await getGraphToken();
  const url = `https://graph.microsoft.com/v1.0/users/${sharedCalendarEmail}/events`;

  // --- TIME LOGIC BLOCK ---
  let eventTimes;
  if (leave.duration_type === "full") {
    // "All-day" as timed event for compatibility (00:00 to next day 00:00)
    eventTimes = {
      start: { dateTime: leave.start_date + "T00:00:00", timeZone: "Europe/Istanbul" },
      end:   { dateTime: addOneDay(leave.end_date) + "T00:00:00", timeZone: "Europe/Istanbul" }
    };
  } else if (leave.duration_type === "half-am") {
    eventTimes = {
      start: { dateTime: leave.start_date + "T08:30:00", timeZone: "Europe/Istanbul" },
      end:   { dateTime: leave.start_date + "T12:00:00", timeZone: "Europe/Istanbul" }
    };
  } else if (leave.duration_type === "half-pm") {
    eventTimes = {
      start: { dateTime: leave.start_date + "T13:00:00", timeZone: "Europe/Istanbul" },
      end:   { dateTime: leave.start_date + "T17:30:00", timeZone: "Europe/Istanbul" }
    };
  } else {
    // Fallback: treat as "all-day"
    eventTimes = {
      start: { dateTime: leave.start_date + "T00:00:00", timeZone: "Europe/Istanbul" },
      end:   { dateTime: addOneDay(leave.end_date) + "T00:00:00", timeZone: "Europe/Istanbul" }
    };
  }
  // --- END TIME LOGIC BLOCK ---

  // Get initials for subject
  const initials = getInitialsFromEmail(employeeEmail);

  const eventBody = {
    subject: `${initials} İzin`,
    body: {
      contentType: "HTML",
      content: `
        ${employeeName} adlı çalışan için izin kaydı.<br>
        Tarihler: ${leave.start_date} - ${leave.end_date}<br>
      `.trim()
    },
    ...eventTimes,
    location: { displayName: "Out of Office" },
    attendees: [
      {
        emailAddress: { address: employeeEmail, name: employeeName },
        type: "required"
      }
    ]
  };
  console.log("Event body:", JSON.stringify(eventBody, null, 2));

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(eventBody)
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error("Calendar event creation failed: " + JSON.stringify(json));
  return json; // Includes .id field
}
