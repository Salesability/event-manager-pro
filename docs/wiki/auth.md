# Authentication

Identity and session for both staff (the internal app) and customer-side contacts (a future client portal).

> Part of `docs/wiki/`. See [data-model.md](data-model.md) for the `auth.users` ↔ `profiles` ↔ `contacts` relationship, [architecture.md](architecture.md) for where the auth code lives.

## Identity

**Supabase Auth** is the source of truth for who someone is. Two sign-in methods:

- **Google OAuth** (primary CTA on the login page). One click, no inbox round-trip. Core users (Shannon, Scott, Adam) are on Workspace + Gmail.
- **Magic link** (fallback, "Send magic link"). For non-Google emails — today's Outlook user (Brian) and any future client whose dealership is on a non-Google domain (`@centuryhonda.ca`, `@myers.ca`).

Both providers fan into the same `/auth/callback` route, the same session, and the same `auth.users` row — Supabase keys on email, so a magic-link invite + later Google sign-in with the same email collapse into one user.

**No password auth.** No other OAuth providers. Magic link covers the Outlook tail; Google covers everyone else. Adding more providers needs explicit justification.

## Signups are disabled

The Supabase project-level **"Allow new users to sign up"** toggle is **off**. This single switch gates both Google OAuth and magic link — an unrecognized email hitting either entry point gets rejected with `Signups not allowed`. No silent auto-provisioning when someone clicks "Continue with Google" with a brand-new address.

**To add a user:** admin pre-creates them via the Supabase dashboard (Auth → Users → Add user → "Create new user" with email **pre-confirmed**, *not* "Send invitation"). Pre-confirmed lets them sign in via Google immediately without an extra email round-trip. After that, they can sign in via either Google or magic link with that email.

This mirrors the curated `Users!A:E` sheet from the legacy app — controlled signups, not open registration.

## Session

- HTTP-only cookies via `@supabase/ssr`.
- `src/proxy.ts` (Next 16's renamed `middleware.ts`) refreshes the session cookie on every request and gates routes (see below).
- `src/lib/supabase/session.ts` exposes `getUser()` — server helper returning the current `User` or `null`. Single read path. Use it in server components and Server Actions.
- `src/lib/supabase/client.ts` and `server.ts` expose the browser and server-cookie-aware Supabase clients.

## Login flow

```
GET  /login                 → src/app/login/page.tsx (server component)
                              already-authed users redirect to ?next= or /
POST <Server Action>        → signInWithGoogle()  → supabase.auth.signInWithOAuth({
                                                     redirectTo: <origin>/auth/callback?next=…
                                                   })
                            → signInWithMagicLink() → supabase.auth.signInWithOtp({
                                                       redirectTo: …,
                                                       shouldCreateUser: false
                                                     })
GET  /auth/callback?code=…  → src/app/auth/callback/route.ts
                              supabase.auth.exchangeCodeForSession(code)
                              redirect to safe `next` (or /)
GET  /auth/auth-error       → minimal error page for failed callbacks
```

`shouldCreateUser: false` on magic link is belt-and-suspenders — the project-level signups-disabled toggle already blocks creation, but this prevents Supabase from even attempting it.

The `next` param is passed through `safeNextPath()` (in `src/lib/auth/`) to prevent open-redirect attacks. Tests live in `tests/` (Vitest).

## Logout & session UI

- `signOut()` Server Action (`src/features/auth/actions.ts`) → `supabase.auth.signOut()` → redirect to `/login`.
- `<SessionBanner />` (`src/components/auth/session-banner.tsx`) is a server component rendering the logged-in email and a logout form button. Wired into `src/app/layout.tsx` so it appears on every gated page.

## Route gating

`src/proxy.ts` is the single gate. By default it sends unauthenticated requests to `/login?next=<original-path>`. The whitelist of public routes:

- `/login`
- `/auth/callback`
- `/auth/auth-error`

Future per-coach share links (legacy `?coach=<id>`) will extend the whitelist when that view ports. RBAC beyond "logged in vs not" doesn't exist yet — see *Roles* below.

## Login routing: staff vs portal contacts

Two extension tables hang off `auth.users`:

- `profiles` — staff users only (admin / staff / coach / viewer roles)
- `contacts` — customer-side people, with an optional `user_id` FK for those who log in to the client portal

After auth resolves, the app decides where to send the user based on which extension row exists:

- **Profile row exists** → internal app (`/`).
- **No profile, but a `contacts` row links to this `auth.users.id`** → client portal (TBD path).
- **Neither** → shouldn't happen with signups-disabled, but defensively → `/auth/auth-error`.

The contact-side branch isn't wired yet — there's no portal route, and the `contacts.user_id` back-fill trigger hasn't shipped (see *Open* below).

See [data-model.md](data-model.md) for why profiles is staff-only and contacts is customer-side.

## Email sender

Supabase **default SMTP** for now. Free-tier rate limit is ~4 emails/hour — adequate for in-house use. Switching to Resend is its own future chunk; happens at the Supabase project level (no app-code change required).

## Open

- **Signup-trigger to back-fill `contacts.user_id`.** When a contact signs up via either provider, a `BEFORE INSERT` trigger on `auth.users` should match `NEW.email` against `contacts.email` and populate `contacts.user_id`. SQL-only (Drizzle doesn't model triggers); goes in a hand-written migration. Not yet drafted.
- **Email-confirmation guarantee for Google.** The trigger's safety depends on Supabase requiring confirmed email. Magic link confirms by definition. For Google OAuth, Supabase trusts Google's `email_verified` claim — fine for Workspace/Gmail, but worth re-confirming if any non-Google IdPs get added.
- **Client portal route.** Once a portal exists, the post-callback router needs to actually send `contacts`-only users there. Today they'd land on `/` and hit the staff app, which assumes a profile row.
- **RBAC.** Currently middleware gates "logged in vs not" only. Per-route role checks land with the user-table chunk via Supabase Auth `app_metadata` or by reading `profiles.role` server-side.
