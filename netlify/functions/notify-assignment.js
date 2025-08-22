// netlify/functions/notify-assignment.js
// Sends an email via Resend when a task is assigned to BRYCE/JUSTIN/COLE.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { assignee, title, date } = JSON.parse(event.body || '{}');
    if (!assignee || !title || !date) {
      return { statusCode: 400, body: 'Missing assignee/title/date' };
    }

    // Map assignee -> recipient email via env vars
    const map = {
      BRYCE: process.env.MAIL_BRYCE,
      JUSTIN: process.env.MAIL_JUSTIN,
      COLE: process.env.MAIL_COLE,
    };
    const to = map[assignee];
    if (!to) {
      // If UNASSIGNED or unknown, silently succeed
      return { statusCode: 200, body: 'No recipient for this assignee' };
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const MAIL_FROM = process.env.MAIL_FROM; // e.g. "Trelevate <no-reply@yourdomain.com>"
    if (!RESEND_API_KEY || !MAIL_FROM) {
      return { statusCode: 500, body: 'Missing email config' };
    }

    const subject = `New task assigned: ${title}`;
    const text = `Task: ${title}\nAssigned date: ${date}\n`;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [to],
        subject,
        text,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { statusCode: 502, body: `Email send failed: ${resp.status} ${errText}` };
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
};
