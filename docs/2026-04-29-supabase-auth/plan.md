# Supabase auth — 2026-04-29

The **auth** chunk of step 1 in `../2026-04-29-port-stack-analysis/notes.md` ("Stand up new app shell + auth + Postgres..."). Follows `../2026-04-29-nextjs-scaffold/` and precedes the db-schema-tables chunk. Wires Supabase Auth into the existing Next.js scaffold: magic-link login/logout, session reads in server components, and middleware-protected routes. Auth-only — no app tables yet (`auth.users` is Supabase's built-in schema). Done when an unauthenticated visit to `/` redirects to `/login`, a magic link logs the user in and lands them back on `/` with `<Ping />` rendering, and a logout button returns them to `/login`.

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Supabase project config + middleware + session helper | In Progress | - |
| 2: Login flow (magic link + callback) | Pending | - |
| 3: Logout + session-aware UI + route gating | Pending | - |
| 4: Verification (lint, typecheck, build, manual flow) | Pending | - |

**Overall Progress:** 0% (0/4 phases complete)

**Note:**
- Each phase includes both implementation and verification.
- "Integration tests" doesn't apply yet — no app schema and no service layer to test against. Phase 4 is static checks + a manual end-to-end walkthrough, matching the scaffold chunk's pattern.

### Phase Checklist

#### Phase 1: Supabase project config + middleware + session helper
- [ ] In Supabase dashboard: enable Email provider, **disable** "Allow new users to sign up" (in-house only — users will be created manually or via service-role script in a later chunk)
- [ ] In Supabase dashboard: set Site URL = `http://localhost:3000` for dev; add prod URL once known
- [ ] In Supabase dashboard: add `http://localhost:3000/auth/callback` to Redirect URLs
- [ ] Add the user's own email as the first user via the Supabase dashboard (Auth → Users → Add user → Send invite)
- [x] `src/middleware.ts` — refresh session cookie on every request via `@supabase/ssr`; redirect unauthenticated users away from gated routes to `/login`
- [x] `src/lib/supabase/session.ts` — `getUser()` server helper returning the current `User` or `null` (thin wrapper around `supabase.auth.getUser()` for use in server components / actions)

#### Phase 2: Login flow (magic link + callback)
- [ ] `src/features/auth/actions.ts` — `'use server'` `signInWithMagicLink(formData)` action; calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: <origin>/auth/callback } })`
- [ ] `src/app/login/page.tsx` — server component with email form posting to the action; shows "check your inbox" state after submit
- [ ] `src/app/auth/callback/route.ts` — GET handler that calls `supabase.auth.exchangeCodeForSession(code)` and redirects to `/` (or to the `next` param if present)
- [ ] `src/app/auth/auth-error/page.tsx` — minimal error page for failed callbacks
- [ ] Whitelist `/login`, `/auth/callback`, `/auth/auth-error` in middleware so they remain public

#### Phase 3: Logout + session-aware UI + route gating
- [ ] `signOut()` server action in `src/features/auth/actions.ts`; calls `supabase.auth.signOut()` and redirects to `/login`
- [ ] `src/components/auth/session-banner.tsx` — server component showing the logged-in email + a logout form button
- [ ] Wire `<SessionBanner />` into `src/app/layout.tsx` (or `src/app/page.tsx`) above the existing `<Ping />` example
- [ ] Confirm middleware gates everything except the public-list above; visiting `/` while logged out redirects to `/login?next=/`
- [ ] `getUser()` in `src/app/page.tsx` and pass the email through to the banner — proves server-component session reads work

#### Phase 4: Verification
- [ ] `pnpm lint` passes
- [ ] `pnpm exec tsc --noEmit` passes
- [ ] `pnpm build` passes with stub env vars (or with real Supabase env if needed for build-time validation)
- [ ] Manual: log out, hit `/`, get redirected to `/login`
- [ ] Manual: submit email, receive magic link, click it, land on `/` logged in, see `<Ping />` still works
- [ ] Manual: click logout, redirected to `/login`, `/` is no longer reachable without re-auth

## Picks

| Concern | Pick | Why |
|---|---|---|
| Auth method | Magic link (email OTP) | No password storage, no reset flow, sidesteps importing legacy plaintext passwords. Few users, low rate-limit pressure. |
| Signup | Disabled — admin invite only | In-house tool; the legacy `Users!A:E` sheet was admin-curated, keep that property. |
| Auth email delivery | Supabase default SMTP for now | Free tier is rate-limited (~4/hr) but adequate for in-house. Resend integration is its own chunk later. |
| Session storage | HTTP-only cookies via `@supabase/ssr` | Already wired by the scaffold (`src/lib/supabase/{server,client}.ts`); just need middleware to refresh them. |
| Route protection | Next.js middleware | Single source of truth for "who's gated"; cheaper than per-page checks; standard `@supabase/ssr` pattern. |
| Roles / RBAC | Deferred | Legacy app had a client-side role check; real RBAC lands with the user-table chunk via Supabase Auth `app_metadata` or a `users` table. |

## What this chunk deliberately does NOT include

- No app `users` table — Supabase's built-in `auth.users` is enough until we need profile fields (display name, role, coach link). That arrives with the db-schema-tables chunk.
- No password auth, no OAuth providers — magic-link only.
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
│   │       └── actions.ts           # NEW — signInWithMagicLink, signOut
│   └── lib/
│       └── supabase/
│           ├── client.ts            # unchanged
│           ├── server.ts            # unchanged
│           └── session.ts           # NEW — getUser() helper
```
