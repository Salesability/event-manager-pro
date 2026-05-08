import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import actionGatePlugin from "./eslint-plugins/action-gate.mjs";

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
]);

export default eslintConfig;
