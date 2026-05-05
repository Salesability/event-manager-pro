# Record lifecycle and dependency

How this codebase manages "this thing has ended" without losing the historical references that point at it.

## TL;DR

> **Archive the relationship, not the entity.** Master records (people, dealers, campaigns) are the historical anchor for everything else and should rarely be archived. Relationships (memberships, role bindings, identifiers, links) describe a lifecycle that *can* end and are the archive candidates.

If you're about to set `archivedAt` on a master record, stop and ask: is the *person* gone, or is one of their *relationships*? Almost always it's the relationship.

## The three independent levers

For a team member, "deactivated" is three independent meanings, served by three different mechanisms:

| Lever | Source of truth | What it controls |
|---|---|---|
| Can this user sign in? | `auth.users.banned_until` (Supabase) | Authentication |
| Is this person a coach / admin / staff? | `team_member_roles(role).archivedAt` | Capability / pickability |
| Does this person exist as a record? | `contacts.archivedAt` | Master record presence |

`deactivateUser` (`src/features/auth/actions.ts`) pulls the first two and **leaves the third alone**. Existing campaigns assigned to that coach still resolve their name and email; share links still load; coach-confirmation emails still send. The person just isn't pickable for new assignments.

## How the schema already encodes this

Look at the master/relationship split:

| Master | Relationship rows attached to it |
|---|---|
| `contacts` | `team_member_roles`, `dealer_contacts`, `contact_identifiers` |
| `dealers` | `dealer_contacts` |
| `campaigns` | (no relationship table; campaigns hold FKs to masters directly) |

Every relationship table is `archivable` (has `archivedAt`). Most master tables are too — but archiving the master is a much larger statement ("this entity never existed for our purposes" rather than "this binding ended"). In practice we archive masters only when:

- The record was created by mistake (a duplicate dealer from a botched import).
- A "delete" UI gesture explicitly says "remove this dealership" and the operator confirms.

We do **not** archive masters as a side-effect of a relationship change. `deactivateUser` is the canonical example.

## Query semantics: three buckets

Same row, three intents, three filter rules.

### Selection (forms, pickers, autocompletes)

> Filter to **active relationships only.**

The picker is asking "who can I assign right now?" An archived `team_member_roles(role='coach')` row means the person is no longer one of our coaches; they shouldn't appear.

Examples: `loadCoaches()` for the booking form, `loadDealers()` for the dealer dropdown, the coach combobox in `availability-admin.tsx`.

### Display (history, audit, retrospective views)

> **No archive filter.** Show the historical name even if the relationship has ended.

The view is asking "what happened?" The answer doesn't change just because someone left the team last month.

Examples: `loadCampaigns()` left-joins `contacts` for `coachName` without filtering `contacts.archivedAt` — that's intentional. The `Last sign-in` column in `/admin/people` shows banned users with their full history.

### Workflow target (acting on a stored FK)

> **Resolve the master record regardless of relationship state.**

A campaign has `coachId = 42`. The "Email assigned coach" button on that campaign should still work even if contact 42 is no longer an active coach. The archive flag is about *future selectability*, not *historical resolvability*. If we want to *prevent* the action, prevent it explicitly with a per-action check ("this coach is deactivated; send anyway?"), not by hiding the data and producing a "No email on file" misnomer.

Examples: `loadCoach(id)` used by `sendCoachShareLinkEmail`, the `/share/coach/[id]` route. **Both of these still filter `archivedAt IS NULL` today and would benefit from being relaxed** — see "Open follow-ups" below.

## Frontend analog

The same three buckets, mapped to UI:

- **Pick lists / autocompletes:** active only. Same as the selection-query rule.
- **Display rows:** show the name; if the underlying relationship is archived, mark with a muted "(deactivated)" affordance — `people-admin.tsx` uses `opacity-60` on the row for banned/inactive people; that's the pattern.
- **Action buttons on stored FKs:** still functional. The button doesn't lie about availability; the action's underlying server function decides whether to proceed and surfaces a clear message if it shouldn't.

## Re-activating

The principle makes re-activation cheap: insert (or restore via `archivedAt = NULL`) the `team_member_roles` rows, lift the `auth.users` ban, and the contact — which was never touched — is unchanged. No data has to be reconstructed. This is the "restore archived row" branch in `syncTeamMemberRoles` (`src/features/people/actions.ts`), and the `updatePerson` on→off→on appAccess transition handles the auth-side ban lift symmetrically.

## Open follow-ups (not yet aligned with this principle)

These are reads that filter `contacts.archivedAt IS NULL` *or* `team_member_roles.archivedAt IS NULL` in workflow-target contexts where they shouldn't:

- `loadCoach(id)` in `src/features/schedule/queries.ts` — used by `sendCoachShareLinkEmail` (`src/features/email/actions.ts`). Should resolve by FK regardless of role-archive state.
- `/share/coach/[id]/page.tsx` — currently 404s if the coach's `team_member_roles(role='coach')` was archived. Should render the page and label it as a deactivated coach instead.
- A campaign assigned to a now-archived coach in `loadCampaigns()` already resolves their name correctly; this is the part that was already correct.

Until these are reconciled, `deactivateUser` produces a soft semantic break: existing share links 404 and "Email assigned coach" buttons surface "No email on file." That's a tolerable interim because the master `contacts` row is now preserved (the previous behavior would have lost the name from `loadCampaigns()` too).

## Related

- [`data-model.md`](data-model.md) — the master/relationship split is described in the table layout and FK conventions.
- [`auth.md`](auth.md) — `auth.users.banned_until` is the auth-side lever; described under the deactivation flow.
- `src/features/auth/actions.ts:deactivateUser` — canonical implementation of the principle.
- `0018-user-system/eval-2026-05-05-0945.md` — the eval that surfaced the gap and the design discussion that produced this page.
