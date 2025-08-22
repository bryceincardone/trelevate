// netlify/functions/notify-assignment.js
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { to, subject, html } = JSON.parse(event.body || '{}');
    if (!to || !subject || !html) {
      return { statusCode: 400, body: "Missing 'to', 'subject', or 'html'." };
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
    if (!apiKey) return { statusCode: 500, body: 'RESEND_API_KEY not set' };

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to, subject, html })
    });

    const text = await resp.text(); // Resend returns JSON; we passthrough as text
    if (!resp.ok) {
      // Bubble up the exact Resend error text so you can read it in the console/logs
      return { statusCode: resp.status, body: text };
    }
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    return { statusCode: 500, body: `Server error: ${String(err)}` };
  }
}
