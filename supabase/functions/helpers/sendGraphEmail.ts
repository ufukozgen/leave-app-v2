// helpers/sendGraphEmail.ts
import { getGraphToken } from "./graphAuth.ts";

export async function sendGraphEmail({ to, subject, html, from }) {
  const fromAddress = from || Deno.env.get("AZURE_MAILBOX_USER");
  if (!fromAddress) {
    throw new Error("Missing Azure sender mailbox environment variable.");
  }

  const access_token = await getGraphToken();

  // 2. Send email via Graph API
  const mailRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${fromAddress}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false
      })
    }
  );

  if (!mailRes.ok) {
    const err = await mailRes.text();
    throw new Error("Graph sendMail error: " + err);
  }

  return true;
}
