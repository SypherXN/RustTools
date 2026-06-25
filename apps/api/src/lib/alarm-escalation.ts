import { env } from "../config.js";

export function twilioConfigured(): boolean {
  return Boolean(env.twilio.accountSid && env.twilio.authToken && env.twilio.fromNumber);
}

export async function sendTwilioSms(to: string, body: string): Promise<void> {
  if (!twilioConfigured()) return;

  const auth = Buffer.from(`${env.twilio.accountSid}:${env.twilio.authToken}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.twilio.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: env.twilio.fromNumber,
        Body: body.slice(0, 1500),
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Twilio SMS failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

export async function sendEscalationEmail(to: string, subject: string, body: string): Promise<void> {
  if (!env.sendgrid.apiKey) return;

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.sendgrid.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: env.sendgrid.fromEmail, name: "RustTools" },
      subject,
      content: [{ type: "text/plain", value: body }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`SendGrid email failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

export async function dispatchAlarmEscalation(
  smsNumbers: string[],
  emailAddresses: string[],
  title: string,
  body: string,
): Promise<void> {
  const text = `${title}: ${body}`.slice(0, 1500);
  for (const to of smsNumbers) {
    if (!to.trim()) continue;
    try {
      await sendTwilioSms(to.trim(), text);
    } catch (err) {
      console.error("[AlarmEscalation] SMS failed:", err);
    }
  }
  for (const to of emailAddresses) {
    if (!to.trim()) continue;
    try {
      await sendEscalationEmail(to.trim(), title, body);
    } catch (err) {
      console.error("[AlarmEscalation] Email failed:", err);
    }
  }
}
