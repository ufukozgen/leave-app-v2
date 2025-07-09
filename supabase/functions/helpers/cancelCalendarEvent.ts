// helpers/cancelCalendarEvent.ts
import { getGraphToken } from "./graphAuth.ts";

/**
 * Cancels (deletes) an event from the shared Outlook calendar.
 * @param sharedCalendarEmail - Shared calendar mailbox address
 * @param eventId - The .id property from the created event
 * @returns true if successful
 */
export async function cancelCalendarEvent({
  sharedCalendarEmail,
  eventId
}: {
  sharedCalendarEmail: string,
  eventId: string
}) {
  const accessToken = await getGraphToken();
  const url = `https://graph.microsoft.com/v1.0/users/${sharedCalendarEmail}/events/${eventId}`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${accessToken}`
    }
  });
  // 204 is success for DELETE
  if (!resp.ok && resp.status !== 204) {
    const err = await resp.text();
    throw new Error("Calendar event cancellation failed: " + err);
  }
  return true;
}
