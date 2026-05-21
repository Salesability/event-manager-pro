import 'server-only';
import { Resend } from 'resend';

export type SendAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SendInput = {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML body (Resend renders both `text` and `html` side-by-side
   *  in the client's preference order). Added for 0026 Phase 4 — the quote
   *  email is the first React Email template in the codebase. */
  html?: string;
  replyTo?: string;
  attachments?: SendAttachment[];
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

// Inverted (Phase 7 of 0019): real-send requires explicit APP_ENV=production.
// Any other environment redirects to EMAIL_DEV_TO if set, or refuses the send
// if not — so a misconfigured deploy that forgets APP_ENV can never silently
// real-send to a customer. The previous design (real-send default with
// opt-in redirect) had the inverse failure mode: a production deploy that
// accidentally left EMAIL_FORCE_DEV_REDIRECT=true would silently route
// customer email to a dev inbox. See plan Decision matrix in
// `docs/chunks/0019-security-architecture/plan.md` Phase 7.
type RedirectDecision =
  | { redirect: true; to: string }
  | { redirect: false; reason: 'production' | 'no-dev-target' };

function decideRedirect(): RedirectDecision {
  // Normalise APP_ENV so `Production`, ` production`, etc. don't accidentally
  // fall through as non-production and silently redirect to a dev inbox.
  const appEnv = process.env.APP_ENV?.trim().toLowerCase();
  if (appEnv === 'production') {
    return { redirect: false, reason: 'production' };
  }
  const devTo = process.env.EMAIL_DEV_TO?.trim();
  if (!devTo) {
    return { redirect: false, reason: 'no-dev-target' };
  }
  return { redirect: true, to: devTo };
}

export async function sendEmail(input: SendInput): Promise<SendResult> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) return { error: 'RESEND_FROM_EMAIL is not set.' };

  const resend = client();
  if ('error' in resend) return resend;

  const decision = decideRedirect();
  if (!decision.redirect && decision.reason === 'no-dev-target') {
    return {
      error:
        'Email send refused: APP_ENV is not "production" and EMAIL_DEV_TO is not set. Set EMAIL_DEV_TO to redirect, or APP_ENV=production to real-send.',
    };
  }

  let { to, subject } = input;
  if (decision.redirect) {
    subject = `[DEV→${to}] ${subject}`;
    to = decision.to;
  }

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.attachments?.length
      ? {
          attachments: input.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            ...(a.contentType ? { contentType: a.contentType } : {}),
          })),
        }
      : {}),
  });

  if (error) return { error: error.message ?? 'Email send failed.' };
  if (!data?.id) return { error: 'Email send returned no id.' };
  return { ok: true, id: data.id };
}
