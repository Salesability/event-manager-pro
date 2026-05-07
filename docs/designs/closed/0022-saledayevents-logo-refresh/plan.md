# SaleDay Events logo refresh + filename rename

**Started:** 2026-05-05

## Progress Tracker

| Phase | Status | Commit |
|-------|--------|--------|
| 1: Drop new asset under `/public` with renamed filename | Done | - |
| 2: Update logo references (3 call sites) | Done | - |
| 3: Verification + cleanup | Done | - |

The current logo at `public/saleday-logo.jpg` (246×155) is replaced with the new `TILL SDE logo colour RGB-100.jpg` (also 246×155 — same dims, so no `next/image` `width`/`height` changes are needed). The user also wants the public-facing filename renamed off `saleday-logo.jpg` to something that matches the brand wordmark on the new mark (`saledayevents`). "Done" means: the new image renders on the three surfaces that load the logo today (app header, login screen, coach share page), the old `saleday-logo.jpg` file is removed, and no stale references remain in the repo.

**Open decision (resolve in Phase 1):** target filename. Default proposal: `saledayevents-logo.jpg` (matches the wordmark on the new mark — "saledayevents" is one word in the brand). Alternative: keep `saleday-logo.jpg` and just swap the bytes (skips the rename, ignores the user's "change the name" ask). Going with `saledayevents-logo.jpg` unless redirected.

**Out of scope:**
- `src/app/favicon.ico` — last regenerated 2026-05-03 ("RGBA-fixed" per CURRENT.md history). Not requested in this chunk; leaving unless the user opts in.
- `<title>` / page metadata strings ("SaleDay Events", "Sales event scheduling for SaleDay") — wordmark on the new logo is `saledayevents` (one word) but the product name of record is still "SaleDay" / "SaleDay Events" per `project_entry_point.md` memory. Don't touch metadata under this chunk.
- Email templates / PDF letterhead / OG images — none of those load `saleday-logo.jpg` today (verified via grep). If any get added later, they'd reference the new filename directly.

## Code Anchors

| New code | Anchor (`path:line`) | Why this anchor |
|----------|---------------------|-----------------|
| `public/saledayevents-logo.jpg` (new asset) | `public/saleday-logo.jpg` | Same role: single shared logo asset under `/public`, referenced by absolute path from `next/image`. New file replaces it byte-for-byte at the new path. |
| `src/components/app/app-header.tsx:18` (src + alt update) | self (lines 17–24) — same `<Image>` block | One-line `src` swap; `alt` already says "SaleDay Events — Automotive Marketing" which matches the new wordmark + tagline, so leave alt untouched. |
| `src/app/login/page.tsx:25` (src + alt update) | self — same `<Image>` block | Same shape as app-header; one-line `src` swap, alt unchanged. |
| `src/app/share/coach/[id]/page.tsx:44` (src + alt update) | self — same `<Image>` block | Same shape as the other two; public-facing share surface, so verify in browser smoke. |

**Conventions referenced:**
- None — `/public` static assets are loaded by absolute path from `next/image`. No project convention beyond "asset goes in `/public`, reference with leading slash".

**Overall Progress:** 100% (3/3 phases complete)

### Phase Checklist

#### Phase 1: Drop new asset under `/public` with renamed filename
- [x] `cp "/Users/davidwhogan/Downloads/TILL SDE logo colour RGB-100.jpg" public/saledayevents-logo.jpg`
- [x] `git rm public/saleday-logo.jpg` (after Phase 2 references all migrated; sequencing is "add new, swap refs, then remove old" so dev server doesn't 404 mid-edit)
- [x] Confirm new asset is 246×155 (matches existing dims so no `width`/`height` prop changes downstream)

#### Phase 2: Update logo references (3 call sites)
- [x] `src/components/app/app-header.tsx:18` — `src="/saleday-logo.jpg"` → `src="/saledayevents-logo.jpg"`
- [x] `src/app/login/page.tsx:25` — same swap
- [x] `src/app/share/coach/[id]/page.tsx:44` — same swap
- [x] `grep -r "saleday-logo" src/ public/ docs/wiki/` returns zero hits before commit (drift check)
- [x] `pnpm tsc --noEmit` clean
- [x] `pnpm lint` clean

#### Phase 3: Verification + cleanup
- [x] Smoke (web-test): `goto /login`; expect heading "Sign in" + visible logo `<img alt="SaleDay Events — Automotive Marketing">` rendering from `/saledayevents-logo.jpg`
- [x] Smoke (web-test): `goto /calendar` (auth-injected); expect app header with logo + alt text "SaleDay Events — Automotive Marketing"
- [x] Smoke (web-test): `goto /share/coach/<known-id>` (`/share/coach/1` → Shannon Tilley); expect logo render
- [x] Visual check: pull up the rendered page and confirm the new mark (blue+grey "SD" monogram + "saledayevents AUTOMOTIVE MARKETING" wordmark) is what's showing, not the old asset cached — screenshots at `/tmp/web-test-{login,share,calendar}.png`
- [x] Confirm `public/saleday-logo.jpg` is deleted and not referenced anywhere in the working tree (in *runtime code*; design docs still mention the old name as historical context — see eval false-positives note)
- [x] Eval gate (`/eval`) before commit → `eval-2026-05-05-1908.md` PASS
