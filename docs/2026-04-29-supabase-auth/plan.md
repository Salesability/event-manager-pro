# Supabase auth — 2026-04-29

The **auth** chunk of step 1 in `../2026-04-29-port-stack-analysis/notes.md` ("Stand up new app shell + auth + Postgres..."). Follows `../2026-04-29-nextjs-scaffold/` and precedes the db-schema-tables chunk. Wires Supabase Auth into the existing Next.js scaffold: magic-link login/logout, session reads in server components, and middleware-protected routes. Auth-only — no app tables yet (`auth.users` is Supabase's built-in schema). Done when an unauthenticated visit to `/` redirects to `/login`, a magic link logs the user in and lands them back on `/` with `<Ping />` rendering, and a logout button returns them to `/login`.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Supabase project config + middleware + session helper | Done | - |
| 2: Login flow (Google OAuth + magic link + callback) | Done | - |
| 3: Logout + session-aware UI + route gating | Done | - |
| 4: Verification (lint, typecheck, build, test, manual flow) | Done | - |

**Overall Progress:** 100% (4/4 phases complete)

**Note:**
- Each phase includes both implementation and verification.
- "Integration tests" doesn't apply yet — no app schema and no service layer to test against. Phase 4 is static checks + a manual end-to-end walkthrough, matching the scaffold chunk's pattern.

### Phase Checklist

#### Phase 1: Supabase project config + middleware + session helper
- [x] In Supabase dashboard: enable Email provider
- [x] In Supabase dashboard: **disable** "Allow new users to sign up" (Auth → Settings) — single project-level toggle that locks down both magic link and Google OAuth; new emails on either path get rejected with "Signups not allowed"
- [x] In Google Cloud Console: create OAuth 2.0 Client ID (Web application), add `https://<project-ref>.supabase.co/auth/v1/callback` as authorized redirect URI (Supabase intermediates the OAuth handshake)
- [x] In Supabase dashboard: enable Google provider, paste the Client ID + Client Secret from Google Cloud Console
- [x] In Supabase dashboard: set Site URL = `http://localhost:3000` for dev; add prod URL once known
- [x] In Supabase dashboard: add `http://localhost:3000/auth/callback` to Redirect URLs
- [ ] Add the user's own email as the first user via the Supabase dashboard (Auth → Users → Add user → "Create new user" with email pre-confirmed, **not** "Send invitation" — pre-confirmed lets the user sign in via Google immediately without an extra email round-trip)
- [x] `src/middleware.ts` — refresh session cookie on every request via `@supabase/ssr`; redirect unauthenticated users away from gated routes to `/login`
- [x] `src/lib/supabase/session.ts` — `getUser()` server helper returning the current `User` or `null` (thin wrapper around `supabase.auth.getUser()` for use in server components / actions)

#### Phase 2: Login flow (magic link + Google OAuth + callback)
- [x] `src/features/auth/actions.ts` — `signInWithMagicLink(formData)` (`signInWithOtp`), `signInWithGoogle(formData)` (`signInWithOAuth`), `signOut()`. Both sign-in actions set `redirectTo: <origin>/auth/callback?next=…`; magic-link sets `shouldCreateUser: false`.
- [x] `src/app/login/page.tsx` — server component. Redirects already-authed users to `next` (or `/`). Primary CTA: "Continue with Google" with the official multicolor G mark. Below a thin "or" divider: email field + "Send magic link" button as fallback. Shows "check your inbox" state after magic-link submit.
- [x] `src/app/auth/callback/route.ts` — GET handler that calls `supabase.auth.exchangeCodeForSession(code)` and redirects to the safe `next` (or `/`); same handler for both providers.
- [x] `src/app/auth/auth-error/page.tsx` — minimal error page for failed callbacks.
- [x] Whitelist `/login`, `/auth/callback`, `/auth/auth-error` in middleware so they remain public _(done in Phase 1)_

#### Phase 3: Logout + session-aware UI + route gating
- [x] `signOut()` server action in `src/features/auth/actions.ts`; calls `supabase.auth.signOut()` and redirects to `/login` _(done in Phase 2)_
- [x] `src/components/auth/session-banner.tsx` — server component showing the logged-in email + a logout form button
- [x] Wire `<SessionBanner />` into `src/app/layout.tsx` so it appears on every gated page
- [x] Confirm middleware gates everything except the public-list above; visiting `/` while logged out redirects to `/login?next=/` _(code in `src/lib/supabase/middleware.ts`; manual run pending in Phase 4)_
- [x] `getUser()` in `src/app/page.tsx` to render the signed-in email — proves server-component session reads work. (Banner reads its own session because it lives in the layout, not a child of the page.)

#### Phase 4: Verification
- [x] `pnpm lint` passes
- [x] `pnpm exec tsc --noEmit` passes
- [x] `pnpm build` passes (Next 16 `middleware → proxy` rename done in this chunk — `src/middleware.ts` → `src/proxy.ts`, no warning)
- [x] `pnpm test` passes (Vitest scaffolded in this chunk; covers `safeNextPath` open-redirect surface)
- [x] Manual: log out, hit `/`, get redirected to `/login`
- [x] Manual: submit email, receive magic link, click it, land on `/` logged in, see `<Ping />` still works
- [x] Manual: click "Continue with Google", complete OAuth, land on `/` logged in, banner shows email
- [x] Manual: click "Sign out" in the banner, redirected to `/login`, `/` is no longer reachable without re-auth

## Picks

| Concern | Pick | Why |
|---|---|---|
| Auth method | **Google OAuth** (primary) + magic link (fallback) | Core users (Shannon, Scott, Adam — Workspace + Gmail) all have Google accounts, so "Continue with Google" is the main CTA: one click, no inbox round-trip. Magic link is kept as the fallback for non-Google users (Outlook user Brian today; future dealership clients on arbitrary domains like `@centuryhonda.ca`, `@myers.ca`). Both providers fan into the same `/auth/callback`, same session, same `auth.users` row (Supabase keys on email — pre-invite via magic-link and later Google sign-in with the same email collapse into one user). Workspace-domain restriction was considered and ruled out because today's users span multiple email providers. |
| Deployment | Cloud Run with "allow unauthenticated invocations" | Container is publicly reachable; all access control is app-side via the middleware. Per-coach public share links (legacy `?coach=<id>`) stay un-gated. No Google LB / IAP — keeps things portable. |
| Signup | Disabled — admin invite only, gates **both** providers | Project-level "Allow new users to sign up" is the single toggle that gates magic link **and** Google OAuth. With it off, an unrecognized email hitting either entry point gets rejected with "Signups not allowed" — no silent auto-provisioning when someone clicks "Continue with Google" with a brand-new address. Admin pre-creates users via the dashboard (Auth → Users → Add user, email pre-confirmed); after that, the user can sign in via either Google or magic link with that email. Mirrors the curated `Users!A:E` sheet from the legacy app. |
| Auth email delivery | Supabase default SMTP for now | Free tier is rate-limited (~4/hr) but adequate for in-house. Resend integration is its own chunk later. |
| Session storage | HTTP-only cookies via `@supabase/ssr` | Already wired by the scaffold (`src/lib/supabase/{server,client}.ts`); just need middleware to refresh them. |
| Route protection | Next.js middleware | Single source of truth for "who's gated"; cheaper than per-page checks; standard `@supabase/ssr` pattern. |
| Roles / RBAC | Deferred | Legacy app had a client-side role check; real RBAC lands with the user-table chunk via Supabase Auth `app_metadata` or a `users` table. |

## What this chunk deliberately does NOT include

- No app `users` table — Supabase's built-in `auth.users` is enough until we need profile fields (display name, role, coach link). That arrives with the db-schema-tables chunk.
- No in-app admin UI for inviting users — admin curates `auth.users` directly via the Supabase dashboard for now. If the user list grows past hand-management, a `/admin/users` route lands with the RBAC chunk.
- No auto-provisioning on Google OAuth — a fresh Google sign-in with an unrecognized email is rejected, not silently signed up. This is intentional; "controlled signups" is the property we're protecting.
- No password auth, and no OAuth providers beyond Google — Google + magic link covers every current and near-term user.
- No password reset / change-email flows — magic link makes both moot for now.
- No Resend SMTP for auth emails — Supabase default sender. Swap in the Resend chunk.
- No legacy user import — when the import chunk runs, it'll create rows in a future `users` table keyed to `auth.users.id`. Inviting today's handful of coaches manually via the dashboard is cheaper than writing import glue twice.
- No RBAC, no per-route role gates — middleware gates "logged in vs not" only.

## Seams left for later chunks

- `src/lib/supabase/session.ts` — `getUser()` is the single read path; later add `getProfile()` once a `users` table exists.
- `src/features/auth/` — folder ready for `signUp`, `resetPassword`, OAuth callbacks if/when needed.
- Middleware whitelist is a single array — easy to extend when more public routes appear (marketing pages, share-by-link views).
- Auth email templates stay default; the Resend chunk will switch SMTP at the Supabase project level (no app-code change required).

## File layout target

```
event-manager-pro/
├── src/
│   ├── middleware.ts                # NEW — session refresh + route gate
│   ├── app/
│   │   ├── layout.tsx               # touched — render <SessionBanner />
│   │   ├── page.tsx                 # touched — read getUser(), pass to banner
│   │   ├── login/
│   │   │   └── page.tsx             # NEW — magic-link form
│   │   └── auth/
│   │       ├── callback/route.ts    # NEW — exchange code for session
│   │       └── auth-error/page.tsx  # NEW — failure page
│   ├── components/
│   │   └── auth/
│   │       └── session-banner.tsx   # NEW
│   ├── features/
│   │   └── auth/
│   │       └── actions.ts           # NEW — signInWithMagicLink, signInWithGoogle, signOut
│   └── lib/
│       └── supabase/
│           ├── client.ts            # unchanged
│           ├── server.ts            # unchanged
│           └── session.ts           # NEW — getUser() helper
```
