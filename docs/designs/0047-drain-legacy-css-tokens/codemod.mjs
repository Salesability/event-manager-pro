#!/usr/bin/env node
// Legacy-token codemod for 0047. Replaces legacy named tokens with semantic
// tokens in-place. Idempotent: re-running on already-migrated files is a no-op.
// Run with: node docs/designs/0047-drain-legacy-css-tokens/codemod.mjs <file...>

import { readFileSync, writeFileSync } from 'node:fs';

const RULES = [
  // Order matters: most-specific first so partial matches don't corrupt.
  // Opacity-modifier variants come before the bare class.
  [/hover:bg-navy-pale\/40\b/g, 'hover:bg-primary/5'],
  [/hover:bg-navy-pale\/60\b/g, 'hover:bg-primary/5'],
  [/bg-navy-pale\/40\b/g, 'bg-primary/5'],
  [/bg-navy-pale\/60\b/g, 'bg-primary/5'],

  [/hover:bg-navy-pale\b/g, 'hover:bg-primary/10'],
  [/hover:bg-navy-light\b/g, 'hover:bg-primary/90'],
  [/hover:border-navy\b/g, 'hover:border-primary'],
  [/hover:text-navy\b/g, 'hover:text-primary'],
  [/hover:border-stone-400\b/g, 'hover:border-input'],
  [/hover:bg-stone-100\b/g, 'hover:bg-muted'],
  [/hover:bg-stone-200\b/g, 'hover:bg-muted'],

  // ring-navy/{N} and accent-navy variants (utility-color leftovers)
  [/focus-visible:ring-navy\/(\d+)\b/g, 'focus-visible:ring-primary/$1'],
  [/ring-navy\/(\d+)\b/g, 'ring-primary/$1'],
  [/accent-navy\b/g, 'accent-primary'],

  [/bg-navy-pale\b/g, 'bg-primary/10'],
  [/bg-navy-light\b/g, 'bg-primary/90'],

  // stone bg's with opacity modifiers — preserve the modifier
  [/bg-stone-50\/(\d+)\b/g, 'bg-muted/$1'],
  [/bg-stone-100\/(\d+)\b/g, 'bg-muted/$1'],
  [/bg-stone-200\/(\d+)\b/g, 'bg-muted/$1'],
  [/bg-stone-400\/(\d+)\b/g, 'bg-muted-foreground/$1'],

  [/bg-stone-50\b/g, 'bg-muted'],
  [/bg-stone-100\b/g, 'bg-muted'],
  [/bg-stone-200\b/g, 'bg-muted'],
  [/bg-stone-400\b/g, 'bg-muted-foreground'],

  [/text-stone-400\b/g, 'text-muted-foreground/70'],
  [/text-stone-500\b/g, 'text-muted-foreground'],
  [/text-stone-600\b/g, 'text-muted-foreground'],
  [/text-stone-700\b/g, 'text-foreground'],
  [/text-stone-800\b/g, 'text-foreground'],

  [/border-stone-100\b/g, 'border-border'],
  [/border-stone-200\b/g, 'border-border'],
  [/border-stone-300\b/g, 'border-input'],

  // divide-stone-* (table/list row dividers — same mapping as border-stone-*)
  [/divide-stone-100\b/g, 'divide-border'],
  [/divide-stone-200\b/g, 'divide-border'],
  [/divide-stone-300\b/g, 'divide-input'],

  [/bg-cream\b/g, 'bg-background'],

  // navy variants — must come after the prefixed forms (navy-pale, navy-light)
  [/border-navy\b/g, 'border-primary'],
  [/text-navy\b/g, 'text-primary'],
  [/bg-navy\b/g, 'bg-primary'],

  // font-display retirement — alias gets dropped from globals.css when callsites=0
  [/\bfont-display\b/g, 'font-sans font-bold tracking-tight'],
];

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: codemod.mjs <file...>');
  process.exit(1);
}

let totalChanged = 0;
for (const path of files) {
  const src = readFileSync(path, 'utf8');
  let out = src;
  for (const [re, replacement] of RULES) {
    out = out.replace(re, replacement);
  }
  if (out !== src) {
    writeFileSync(path, out);
    totalChanged++;
    console.log(`changed: ${path}`);
  } else {
    console.log(`no-op:   ${path}`);
  }
}
console.log(`\n${totalChanged}/${files.length} files changed`);
