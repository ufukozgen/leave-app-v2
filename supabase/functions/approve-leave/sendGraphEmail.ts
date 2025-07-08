// sendGraphEmail.ts for Supabase Edge Functions (Deno)
// Usage: await sendGraphEmail({ to, subject, html, from });

export async function sendGraphEmail({ to, subject, html, from }) {
  // Get env vars
  const tenantId = Deno.env.get("AZURE_TENANT_ID");
  const clientId = Deno.env.get("AZURE_CLIENT_ID");
  const clientSecret = Deno.env.get("AZURE_CLIENT_SECRET");
  const fromAddress = from || Deno.env.get("AZURE_MAILBOX_USER");
  if (!tenantId || !clientId || !clientSecret || !fromAddress) {
    throw new Error("Missing Azure environment variables.");
  }

  // 1. Get access token from Microsoft identity platform
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error("Azure token error: " + err);
  }
  const { access_token } = await tokenRes.json();

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
