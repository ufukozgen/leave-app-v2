// helpers/createCalendarEvent.ts
import { getGraphToken } from "./graphAuth.ts";

/**
 * Creates an event in a shared Outlook calendar and invites the employee as attendee.
 * @param sharedCalendarEmail - The mailbox address of the shared calendar (e.g. izinler@terralab.com.tr)
 * @param employeeEmail - The employee's e-mail address
 * @param employeeName - The employee's full name
 * @param leave - Object with at least start_date, end_date, note
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
    note?: string
  }
}) {
  const accessToken = await getGraphToken();
  const url = `https://graph.microsoft.com/v1.0/users/${sharedCalendarEmail}/events`;

  const eventBody = {
    subject: `Leave: ${leave.start_date} - ${leave.end_date}`,
    body: {
      contentType: "HTML",
      content: `
        Leave approved for ${employeeName}<br>
        Dates: ${leave.start_date} to ${leave.end_date}<br>
      `
    },
    start: { dateTime: leave.start_date + "T09:00:00", timeZone: "Europe/Istanbul" },
    end: { dateTime: leave.end_date + "T18:00:00", timeZone: "Europe/Istanbul" },
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
