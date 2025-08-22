// netlify/functions/notify-assignment.js
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { assignee, title, date } = JSON.parse(event.body || '{}');
    if (!assignee || !title || !date) {
      return { statusCode: 400, body: 'Missing assignee/title/date' };
    }

    // Use the vars you already created in Netlify
    const map = {
      BRYCE:  process.env.VITE_MAIL_TO_BRYCE,
      JUSTIN: process.env.VITE_MAIL_TO_JUSTIN,
      COLE:   process.env.VITE_MAIL_TO_COLE,
    };
    const to = map[assignee];
    if (!to) return { statusCode: 200, body: 'No recipient for this assignee' };

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const MAIL_FROM      = process.env.MAIL_FROM; // e.g. "Trelevate <onboarding@resend.dev>"
    if (!RESEND_API_KEY || !MAIL_FROM) {
      return { statusCode: 500, body: 'Missing email config' };
    }

    const payload = {
      from: MAIL_FROM,
      to: [to],
      subject: `New task assigned: ${title}`,
      html: `<p><strong>${assignee}</strong> was assigned <em>${title}</em> for <b>${date}</b>.</p>`,
      text: `Assignee: ${assignee}\nTitle: ${title}\nDate: ${date}\n`,
    };

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      return { statusCode: 502, body: `Email send failed: ${resp.status} ${err}` };
    }
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
};
