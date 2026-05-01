import 'server-only';
import { Resend } from 'resend';

export type SendInput = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

export type SendResult = { ok: true; id: string } | { error: string };

let cached: Resend | null = null;

function client(): Resend | { error: string } {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return { error: 'RESEND_API_KEY is not set.' };
  cached = new Resend(key);
  return cached;
}

function isProduction(): boolean {
  return (process.env.APP_ENV ?? process.env.NODE_ENV) === 'production';
}

export async function sendEmail(input: SendInput): Promise<SendResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) return { error: 'RESEND_FROM_EMAIL is not set.' };

  const resend = client();
  if ('error' in resend) return resend;

  let { to, subject } = input;
  const devTo = process.env.EMAIL_DEV_TO;
  if (!isProduction() && devTo) {
    subject = `[DEV→${to}] ${subject}`;
    to = devTo;
  }

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    text: input.text,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });

  if (error) return { error: error.message ?? 'Email send failed.' };
  if (!data?.id) return { error: 'Email send returned no id.' };
  return { ok: true, id: data.id };
}
