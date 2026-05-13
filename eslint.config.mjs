import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import actionGatePlugin from "./eslint-plugins/action-gate.mjs";
import noInlineRowActionLabelPlugin from "./eslint-plugins/no-inline-row-action-label.mjs";
import safeParseRequiredPlugin from "./eslint-plugins/safeparse-required.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The browse tool ships its own TypeScript build under .claude/tools/browse;
    // it has its own conventions and isn't part of the Next.js app surface.
    ".claude/tools/**",
  ]),
  // Action-gate enforcement: every Server Action in `src/features/**/actions.ts`
  // must call an allow-listed auth gate, or opt out per-function with
  // `// authz: public`. See `eslint-plugins/action-gate.mjs` and
  // `docs/designs/0031-action-gate-lint/plan.md`.
  {
    files: ["src/features/**/actions.ts"],
    plugins: { "action-gate": actionGatePlugin },
    rules: {
      "action-gate/no-ungated-action": "error",
    },
  },
  // Same enforcement for Route Handlers under `(app)/**`. The auth flow
  // callback at `src/app/auth/callback/route.ts` is intentionally public —
  // it runs the OAuth-code exchange before any session exists — and is
  // opted out via `// authz: public` in the file itself.
  {
    files: ["src/app/**/route.ts"],
    plugins: { "action-gate": actionGatePlugin },
    rules: {
      "action-gate/no-ungated-action": ["error", { routeHandler: true }],
    },
  },
  // 0045 Phase 8 — schema-as-contract: every Server Action in
  // `src/features/**/actions.ts` must run `safeParse` against a shared zod
  // schema, either directly or via a same-file wrapper that does. Per-export
  // opt-out via `// validation: skip` on the line before the `export`. See
  // `eslint-plugins/safeparse-required.mjs` and
  // `docs/designs/0045-form-schema-as-contract/plan.md` → Phase 8.
  {
    files: ["src/features/**/actions.ts"],
    plugins: { "safeparse-required": safeParseRequiredPlugin },
    rules: {
      "safeparse-required/safeparse-required": [
        "error",
        {
          // Cross-file wrapper helpers that internally `safeParse` a shared
          // schema. Listing them here lets the rule accept calls to them as
          // valid delegation — keeps `// validation: skip` honest (only used
          // when validation really is being skipped, not just delegated).
          wrapperNames: ["parseCampaignInput"],
        },
      ],
    },
  },
  // 0043 Phase 6 — canonical row-action vocabulary. Row-action files (per-row
  // table action buttons) must reference `ROW_ACTION_LABELS` from
  // `src/lib/ui/labels.ts`, not inline string literals matching the canonical
  // vocabulary (`View` / `Edit` / `Archive` / `Activate` / `Open` / `Details` /
  // `Manage` / `Show`). Per-line opt-out via `// row-label: ok`.
  {
    files: [
      "src/app/**/row-actions.tsx",
      "src/features/**/*-columns.tsx",
    ],
    plugins: { "no-inline-row-action-label": noInlineRowActionLabelPlugin },
    rules: {
      "no-inline-row-action-label/no-inline-row-action-label": "error",
    },
  },
]);

export default eslintConfig;
