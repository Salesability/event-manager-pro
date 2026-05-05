# Authentication

Identity and session for both staff (the internal app) and customer-side contacts (a future client portal).

> Part of `docs/wiki/`. See [data-model.md](data-model.md) for the `auth.users` ↔ `contacts` ↔ `team_member_roles` / `dealer_contacts` relationships, [architecture.md](architecture.md) for where the auth code lives.

## Identity

**Supabase Auth** is the source of truth for who someone is. Two sign-in methods:

- **Google OAuth** (primary CTA on the login page). One click, no inbox round-trip. Core users (Shannon, Scott, Adam) are on Workspace + Gmail.
- **Magic link** (fallback, "Send magic link"). For non-Google emails — today's Outlook user (Brian) and any future client whose dealership is on a non-Google domain (`@centuryhonda.ca`, `@myers.ca`).

Both providers fan into the same `/auth/callback` route, the same session, and the same `auth.users` row — Supabase keys on email, so a magic-link invite + later Google sign-in with the same email collapse into one user.

**No password auth.** No other OAuth providers. Magic link covers the Outlook tail; Google covers everyone else. Adding more providers needs explicit justification.

## Signups are disabled

The Supabase project-level **"Allow new users to sign up"** toggle is **off**. This single switch gates both Google OAuth and magic link — an unrecognized email hitting either entry point gets rejected with `Signups not allowed`. No silent auto-provisioning when someone clicks "Continue with Google" with a brand-new address.

**To add a user:** admins use the in-app `/admin/users` page (gated by `requireAdmin()`). The "Add user" dialog calls `auth.admin.createUser({ email, email_confirm: true })` via the service-role client and links the new user to a `contacts` row in the same Server Action — either by creating a fresh contact (firstName/lastName) or by picking an existing unlinked one. `email_confirm: true` lets them sign in via Google immediately without an extra email round-trip. After that, they can sign in via either Google or magic link with that email.

The Supabase dashboard (Auth → Users → Add user) still works as a fallback when the in-app UI is unreachable — but it skips the contact linkage. If you provision that way, follow up with "Link contact" on the row in `/admin/users`.

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

## Route gating (RBAC)

Two layers of gating, defence-in-depth:

1. **`src/proxy.ts` + `src/lib/supabase/middleware.ts`** — single edge gate.
   - Sends unauthenticated requests to `/login?next=<original-path>` (whitelist: `/login`, `/auth/callback`, `/auth/auth-error`, plus public `/share/coach/[id]` per-coach share links).
   - Sends signed-in non-admins hitting `/admin/*` (matched against the `ADMIN_PATHS` constant) back to `/` — gate is `user.app_metadata?.role === 'admin'`.
2. **Per-page / per-Server-Action `requireAdmin()`** (`src/lib/auth/require-admin.ts`) — defensive: every admin Server Component calls it at the top, every admin Server Action calls it before the first DB read. Survives a missed middleware match.

**Two surfaces, kept consistent at write time:**

- **`auth.users.app_metadata.role`** — single string, lives on the JWT. Cheap to read in middleware via `getUser()` with no DB hit. Powers the gate.
- **`team_member_roles` table** — N rows per contact (admin / staff / coach / viewer enum). Powers per-feature semantics (calendar coach auto-filter, etc.). Multiple roles per person allowed (admin + coach is a valid combo).

When an admin promotes a user via `/admin/users`, both surfaces are written in the same Server Action: `team_member_roles` first inside a DB transaction, then `app_metadata.role = 'admin'` (or `null`) via the service-role client. If the auth-side update fails after the DB commit, the action returns a "Re-submit to retry" error — the gate cache is stale but no privilege escalation occurred.

**v1 wired roles:** only `admin` and `coach` are selectable in the UI. `staff` and `viewer` are reserved enum values for future use; "signed-in non-admin" *is* the v1 staff experience (no `team_member_roles` row required).

## Login routing: staff vs portal contacts

The decision tree runs in **two places** so it's durable, not just a one-shot greeting:

1. `src/app/auth/callback/route.ts` — *first* request after `exchangeCodeForSession`. Picks the landing URL.
2. `src/app/(app)/layout.tsx` — every subsequent request to a gated `(app)/*` route. Re-runs the same gate so a contact-only auth user can't bypass the callback redirect by typing `/calendar` directly.

Both consult `loadCurrentMembership()` (wrapped in React's `cache()` so the per-request DB read is shared with `/calendar`'s `viewerCoachId` fetch). The branches:

- **`team_member_roles` rows exist** (any role) → staff app at `next` (default `/`). Admins also pass on `app_metadata.role === 'admin'` alone, so a fresh admin can operate before any role row is written (bootstrap path).
- **No `team_member_roles`, ≥1 active `dealer_contacts` row** → `/auth/auth-error?reason=Portal+not+yet+available`. The portal isn't built yet (0018 routes the *decision* but not the *destination*); when the portal ships, swap this redirect to `/portal`.
- **No contacts row, OR contacts but neither table** → `/auth/auth-error?reason=Account+not+provisioned`. Defensive — shouldn't happen with signups disabled.

A contact can have rows in both tables (per [data-model.md](data-model.md)). Routing precedence: any us-side role wins → staff app. The portal wouldn't show their own dealer to them anyway.

**Auto-link trigger** (`drizzle/0002_contact_user_backfill_trigger.sql`): an `AFTER INSERT ON auth.users` trigger matches `NEW.email` against `contact_identifiers(kind='email', value=…)`; if a match exists and that contact's `user_id` is null, the trigger sets `contacts.user_id = NEW.id`. Idempotent. Today (signups-disabled) it's mostly insurance — the in-app provisioning flow already links explicitly. It earns its keep the day a self-signup portal opens.

## Email sender

Supabase **default SMTP** for now. Free-tier rate limit is ~4 emails/hour — adequate for in-house use. Switching to Resend is its own future chunk; happens at the Supabase project level (no app-code change required).

## Open

- **Email-confirmation guarantee for Google.** The auto-link trigger's safety depends on Supabase requiring confirmed email. Magic link confirms by definition. For Google OAuth, Supabase trusts Google's `email_verified` claim — fine for Workspace/Gmail, but worth re-confirming if any non-Google IdPs get added.
- **Client portal route.** The post-callback router *decides* the staff/portal/error split, but the portal destination is a placeholder (`/auth/auth-error?reason=Portal+not+yet+available`) until that chunk ships. Day-it-opens change is a one-line redirect swap.
