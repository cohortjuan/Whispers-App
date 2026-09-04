import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

// fail-open, same philosophy as isPasswordBreached in lib/password.js: a
// notification email should never block or fail whatever triggered it. No
// SMTP_HOST configured (true for local dev by default -- see .env.example)
// just logs and returns instead of throwing, so this is safe to call from
// anywhere without every caller needing its own try/catch.
export async function sendMail({ to, subject, text }) {
  const client = getTransporter();
  if (!client) {
    console.log(`[mailer] SMTP not configured, skipping email to ${to}: ${subject}`);
    return;
  }
  try {
    await client.sendMail({
      from: process.env.SMTP_FROM || 'Whispers App <noreply@whispers.app>',
      to,
      subject,
      text,
    });
  } catch (err) {
    console.warn('failed to send email (continuing anyway):', err.message);
  }
}
