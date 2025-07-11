// helpers/createCalendarEvent.ts
import { getGraphToken } from "./graphAuth.ts";

/**
 * Adds one day to a yyyy-mm-dd string (for all-day event 'end' field)
 */
function addOneDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0,10);
}

/**
 * Creates an event in a shared Outlook calendar and invites the employee as attendee.
 * @param sharedCalendarEmail - The mailbox address of the shared calendar (e.g. izinler@terralab.com.tr)
 * @param employeeEmail - The employee's e-mail address
 * @param employeeName - The employee's full name
 * @param leave - Object with at least start_date, end_date, duration_type, note
 * @returns The created event object (includes .id field for future reference)
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
    // All-day event, end date is exclusive for Outlook
    eventTimes = {
      start: { date: leave.start_date },
      end: { date: addOneDay(leave.end_date) }
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
    // Fallback: treat as all-day
    eventTimes = {
      start: { date: leave.start_date },
      end: { date: addOneDay(leave.end_date) }
    };
  }
  // --- END TIME LOGIC BLOCK ---

  const eventBody = {
    subject: `Leave: ${leave.start_date} - ${leave.end_date}`,
    body: {
      contentType: "HTML",
      content: `
        Leave approved for ${employeeName}<br>
        Dates: ${leave.start_date} to ${leave.end_date}<br>
        ${leave.note ? `Note: ${leave.note}` : ""}
      `
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
  return json; // Will include .id field (store in DB if you need to cancel later!)
}
