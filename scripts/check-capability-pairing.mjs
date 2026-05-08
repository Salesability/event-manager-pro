#!/usr/bin/env node
// Capability pairing CI check (0034). Catches asymmetric authz gates:
//
//   (a) UI shows `<Can capability="X">` but no server-side `assertCan('X')`
//       — privileged button has no backend gate. High-impact security leak.
//
//   (b) Server `assertCan('X')` exists but no `<Can capability="X">` /
//       `useCan('X')` in any client component — UX leak (unreachable
//       affordance) and a possible orphaned capability.
//
// Run: `pnpm check:capability-pairing`
// Exits non-zero on any unmatched capability. Per-line opt-out via
// `// expected: server-only` (capability legitimately has no UI affordance,
// e.g. CSV-export endpoints) or `// expected: ui-only` (rare — UI gating
// for a capability the server enforces by other means, e.g. role-list).
//
// Pairs with 0031 (gate presence) and 0032 (admit-set). Together cover the
// three failure modes: gate-missing, gate-wrong, gate-asymmetric.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

const UI_PATTERNS = [
  /<Can\s+capability=["']([^"']+)["']/g,
  /\buseCan\(\s*["']([^"']+)["']/g,
];
const SERVER_PATTERNS = [
  /\bassertCan\(\s*["']([^"']+)["']/g,
  // `can(profile, 'X', resource?)` — pure PDP. Capability is the second arg.
  /\bcan\([^,)]+,\s*["']([^"']+)["']/g,
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
]);
const SKIP_FILE_PATTERNS = [
  /\.test\.(t|j)sx?$/,
  /\.d\.ts$/,
  // The capability source-of-truth file lists every capability as a
  // string-literal union; counting those would short-circuit the check.
  /[/\\]src[/\\]lib[/\\]auth[/\\]capabilities\.ts$/,
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else {
      yield path.join(dir, entry.name);
    }
  }
}

function shouldScan(file) {
  if (!/\.(ts|tsx|jsx|mjs|cjs|js)$/.test(file)) return false;
  if (SKIP_FILE_PATTERNS.some((re) => re.test(file))) return false;
  return true;
}

// Per-occurrence record: { capability, file, line, optOut }
function extract(file, src, patterns) {
  const results = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const cap = m[1];
      const upToMatch = src.slice(0, m.index);
      const line = upToMatch.split('\n').length;
      const lineEnd = src.indexOf('\n', m.index);
      const lineText = src.slice(
        upToMatch.lastIndexOf('\n') + 1,
        lineEnd < 0 ? src.length : lineEnd,
      );
      const optOut = parseOptOut(lineText);
      results.push({ capability: cap, file, line, optOut });
    }
  }
  return results;
}

// Recognises trailing comments of the form:
//   // expected: server-only
//   // expected: ui-only
function parseOptOut(lineText) {
  const m = lineText.match(/\/\/\s*expected:\s*(server-only|ui-only|both)/);
  return m ? m[1] : null;
}

function classify(occurrences) {
  // Per capability: gather sides (after honoring opt-outs).
  const byCap = new Map();
  function ensure(cap) {
    if (!byCap.has(cap)) {
      byCap.set(cap, { ui: [], server: [], optOut: new Set() });
    }
    return byCap.get(cap);
  }
  for (const o of occurrences.uiHits) {
    const entry = ensure(o.capability);
    entry.ui.push(o);
    if (o.optOut) entry.optOut.add(o.optOut);
  }
  for (const o of occurrences.serverHits) {
    const entry = ensure(o.capability);
    entry.server.push(o);
    if (o.optOut) entry.optOut.add(o.optOut);
  }
  return byCap;
}

function reportFailures(byCap) {
  const failures = [];
  for (const [cap, entry] of byCap.entries()) {
    const allowServerOnly = entry.optOut.has('server-only');
    const allowUiOnly = entry.optOut.has('ui-only');
    const hasUi = entry.ui.length > 0;
    const hasServer = entry.server.length > 0;
    if (hasUi && !hasServer && !allowUiOnly) {
      failures.push({
        capability: cap,
        kind: 'ui-only',
        sites: entry.ui.map(siteString),
        hint: 'UI gates this capability but no server gate enforces it. Add `assertCan(\'' +
          cap +
          '\')` in the action this UI triggers, or add `// expected: ui-only` to the UI line if the server enforces by other means.',
      });
    }
    if (hasServer && !hasUi && !allowServerOnly) {
      failures.push({
        capability: cap,
        kind: 'server-only',
        sites: entry.server.map(siteString),
        hint: 'Server gates this capability but no UI affordance points at it. Add `<Can capability="' +
          cap +
          '">` to the relevant button (or `useCan(\'' +
          cap +
          '\')` in conditional logic), or add `// expected: server-only` to the action line if no UI affordance is intended (CSV export, programmatic-only routes).',
      });
    }
  }
  return failures;
}

function siteString(o) {
  const rel = path.relative(REPO_ROOT, o.file);
  return `${rel}:${o.line}`;
}

function main() {
  const srcDir = path.join(REPO_ROOT, 'src');
  if (!fs.existsSync(srcDir)) {
    console.error('No src/ directory found under', REPO_ROOT);
    process.exit(2);
  }
  const uiHits = [];
  const serverHits = [];
  for (const file of walk(srcDir)) {
    if (!shouldScan(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    uiHits.push(...extract(file, src, UI_PATTERNS));
    serverHits.push(...extract(file, src, SERVER_PATTERNS));
  }

  const byCap = classify({ uiHits, serverHits });
  const failures = reportFailures(byCap);

  // Summary regardless of failure: useful for visual confirmation.
  const total = byCap.size;
  const paired = [...byCap.values()].filter(
    (e) =>
      (e.ui.length > 0 && e.server.length > 0) ||
      e.optOut.has('server-only') ||
      e.optOut.has('ui-only') ||
      e.optOut.has('both'),
  ).length;
  console.log(
    `Capability pairing scan: ${paired}/${total} capabilities paired or opted out.`,
  );

  if (failures.length === 0) {
    console.log('OK — no asymmetric gates.');
    process.exit(0);
  }

  console.error(`\nFAIL — ${failures.length} asymmetric gate(s):\n`);
  for (const f of failures) {
    console.error(
      `  '${f.capability}' (${f.kind} — present on the wrong side)`,
    );
    for (const site of f.sites) {
      console.error(`     at ${site}`);
    }
    console.error(`     ${f.hint}\n`);
  }
  process.exit(1);
}

main();
