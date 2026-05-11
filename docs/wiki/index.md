# Wiki index

Catalog of `docs/wiki/` pages. This is the entry point — start here, then follow links to the page you need.

`docs/wiki/` is a persistent, LLM-maintained reference describing the **current state** of the system. It is not a journal. When something changes (schema, architecture, conventions), the affected wiki page gets edited; the change is noted in `log.md`. Per-chunk working notes (plans, decisions, research) live in `docs/designs/YYYY-MM-DD-slug/` instead.

Inspired by [Karpathy's LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — three-layer pattern: raw sources / wiki / schema. For this project: raw sources are the code, `docs/designs/`, and external references (Supabase, Postgres docs); the wiki is what you're reading; the schema is `CLAUDE.md`.

## Reference pages

- [architecture.md](architecture.md) — system overview, stack picks and rationale, folder layout, migration roadmap, what's deliberately out of scope.
- [data-model.md](data-model.md) — Postgres schema overview, ERD, table-by-table notes, mixin reference, open schema questions.
- [auth.md](auth.md) — Supabase Auth setup, Google OAuth + magic link, signup-disabled invariant, route gating, staff vs portal-contact login routing, per-action `requireRole` matrix.
- [conventions.md](conventions.md) — cross-cutting rules: Server Actions for mutations, mixin pattern, migration workflow, git/commit rules.
- [security.md](security.md) — five-layer defence-in-depth map: edge / layout / action / RLS / forensic audit log. Threat models for staff app vs future portal. What to grep when investigating.

## Concept pages

Cross-cutting topics that span multiple tables/features.

- [lifecycle.md](lifecycle.md) — record lifecycle and dependency: archive the relationship, not the entity. Selection vs display vs workflow-target query semantics.
- [commercial-spine.md](commercial-spine.md) — how a deal flows: Client → MSA → Quote → Event/Campaign → Invoice → Payment. Why the accepted Quote *is* the contract (no `orders` table). MSA-per-Client, 12-month term. Bundled MSA + first-Quote e-sig envelope.

(Candidate future pages: `calendar-algorithm.md` once the legacy ribbon-packing ports; `quote-lifecycle.md` once quote → contract → invoice → payment ships.)

## Entity / feature pages

One per substantial feature. None yet.

## How this wiki is maintained

See `CLAUDE.md` for the full schema. Short version:

- **Ingest** — when new state arrives (a schema change ships, a feature merges, a new convention is decided), update or create the relevant wiki page in the same turn. Note the change in `log.md`.
- **Query** — when answering a question that the wiki could plausibly cover, *read the wiki first* and cite it. If the answer is good and not yet captured, file it back as a wiki page (or amend an existing one) before moving on.
- **Lint** — periodic pass to check for stale claims, contradictions, orphan pages (linked from nowhere), and missing cross-references.
