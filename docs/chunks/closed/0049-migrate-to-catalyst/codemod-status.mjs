#!/usr/bin/env node
/**
 * Post-0049 cleanup: sweep `--color-status-*` Tailwind classes to
 * Tailwind defaults + brand. After this codemod the `--color-status-*`
 * block in globals.css is orphan and gets dropped manually.
 *
 *   text-status-red   → text-red-600       (#dc2626 — close to legacy #c0392b)
 *   text-status-green → text-green-700     (#15803d — close to legacy #1e7e4a)
 *   text-status-blue  → text-brand-700     (brand-700 IS the logo blue at L=0.35 C=0.103)
 *   bg-status-*       → bg-{red|green|brand}-600 (solid fills)
 *   tints /N          → bg-{family}-50|100|200 by opacity bucket
 *   border-status-*   → border-{family}-{300|500}
 *
 * Catalyst's <Badge color="green"> / <Button color="green"> use the same
 * Tailwind palette, so this codemod yields visual consistency with the
 * other primitives.
 *
 * Run: node docs/chunks/closed/0049-migrate-to-catalyst/codemod-status.mjs
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPLACEMENTS = [
  // Border-left for sonner toaster shape (compound class — keep first)
  ['border-l-status-green', 'border-l-green-600'],
  ['border-l-status-red', 'border-l-red-600'],
  ['border-l-status-blue', 'border-l-brand-600'],

  // Opacity tints — most specific first
  ['bg-status-red/5', 'bg-red-50'],
  ['bg-status-red/10', 'bg-red-50'],
  ['bg-status-red/15', 'bg-red-100'],
  ['bg-status-red/20', 'bg-red-100'],
  ['bg-status-red/40', 'bg-red-200'],
  ['bg-status-green/5', 'bg-green-50'],
  ['bg-status-green/10', 'bg-green-50'],
  ['bg-status-green/15', 'bg-green-100'],
  ['bg-status-green/20', 'bg-green-100'],
  ['bg-status-blue/5', 'bg-brand-50'],
  ['bg-status-blue/10', 'bg-brand-50'],
  ['bg-status-blue/15', 'bg-brand-100'],

  ['border-status-red/30', 'border-red-300'],
  ['border-status-red/40', 'border-red-300'],
  ['border-status-green/30', 'border-green-300'],
  ['border-status-green/40', 'border-green-300'],
  ['border-status-blue/30', 'border-brand-300'],

  ['hover:border-status-red', 'hover:border-red-500'],
  ['hover:bg-status-red/5', 'hover:bg-red-50'],
  ['hover:bg-status-red/10', 'hover:bg-red-50'],
  ['hover:bg-status-red', 'hover:bg-red-700'],
  ['hover:bg-status-green', 'hover:bg-green-700'],
  ['hover:bg-status-blue', 'hover:bg-brand-700'],
  ['hover:text-status-red', 'hover:text-red-700'],
  ['hover:text-status-green', 'hover:text-green-700'],
  ['hover:text-status-blue', 'hover:text-brand-700'],

  ['focus:border-status-red', 'focus:border-red-500'],

  // Plain solids
  ['bg-status-red', 'bg-red-600'],
  ['bg-status-green', 'bg-green-600'],
  ['bg-status-blue', 'bg-brand-600'],

  // Plain borders
  ['border-status-red', 'border-red-500'],
  ['border-status-green', 'border-green-500'],
  ['border-status-blue', 'border-brand-500'],

  // Plain text
  ['text-status-red', 'text-red-700'],
  ['text-status-green', 'text-green-700'],
  ['text-status-blue', 'text-brand-700'],
];

const SRC = 'src';
const EXTS = ['.ts', '.tsx', '.css'];
const SKIP = new Set([
  // globals.css's --color-status-* block is dropped manually after the sweep
  'src/app/globals.css',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(path);
  }
  return out;
}

let touched = 0;
let totalSubs = 0;

for (const file of walk(SRC)) {
  if (SKIP.has(file)) continue;
  let src = readFileSync(file, 'utf8');
  let subs = 0;
  for (const [from, to] of REPLACEMENTS) {
    const parts = src.split(from);
    if (parts.length > 1) {
      subs += parts.length - 1;
      src = parts.join(to);
    }
  }
  if (subs > 0) {
    writeFileSync(file, src);
    console.log(`${file}: ${subs} replacements`);
    touched++;
    totalSubs += subs;
  }
}

console.log(`\nDone. ${totalSubs} replacements in ${touched} files.`);
