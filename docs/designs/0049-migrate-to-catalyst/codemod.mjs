#!/usr/bin/env node
/**
 * 0049 Phase 5 codemod — sweep remaining shadcn-token Tailwind classes
 * across src/. Maps the dropped semantic-token layer (Phase 2) to either
 * Tailwind defaults (zinc, white, red) or the new `brand` ramp.
 *
 * Run from repo root:
 *   node docs/designs/0049-migrate-to-catalyst/codemod.mjs
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Order matters: longer/more-specific replacements first to avoid partial overlaps.
const REPLACEMENTS = [
  // Foregrounds → text white (composite tokens that include "primary")
  ['text-primary-foreground', 'text-white'],
  ['bg-primary-foreground', 'bg-white'],
  ['text-accent-foreground', 'text-white'],
  ['bg-accent-foreground', 'bg-white'],
  ['text-secondary-foreground', 'text-zinc-900'],
  ['text-card-foreground', 'text-zinc-900'],
  ['text-popover-foreground', 'text-zinc-900'],
  ['text-destructive-foreground', 'text-white'],

  // Foreground / background neutrals
  ['text-muted-foreground', 'text-zinc-500'],
  ['bg-muted-foreground', 'bg-zinc-500'],
  ['border-muted-foreground', 'border-zinc-500'],
  ['hover:text-foreground', 'hover:text-zinc-900'],
  ['text-foreground', 'text-zinc-900'],
  ['bg-foreground', 'bg-zinc-900'],
  ['border-foreground', 'border-zinc-900'],
  ['hover:bg-background', 'hover:bg-white'],
  ['bg-background', 'bg-white'],
  ['text-background', 'text-white'],
  ['bg-card', 'bg-white'],
  ['bg-popover', 'bg-white'],
  ['bg-secondary', 'bg-zinc-100'],

  // Muted family (was warm cream/stone)
  ['hover:bg-muted/50', 'hover:bg-zinc-100/50'],
  ['hover:bg-muted', 'hover:bg-zinc-100'],
  ['focus:bg-muted', 'focus:bg-zinc-100'],
  ['aria-expanded:bg-muted', 'aria-expanded:bg-zinc-100'],
  ['bg-muted/40', 'bg-zinc-100/40'],
  ['divide-muted', 'divide-zinc-200'],
  ['border-muted', 'border-zinc-200'],
  ['bg-muted', 'bg-zinc-100'],

  // Primary (brand-blue) → brand-700 (text) / brand-600 (solids) / brand-500 (borders/rings)
  ['hover:text-primary', 'hover:text-brand-700'],
  ['hover:bg-primary/90', 'hover:bg-brand-700'],
  ['hover:bg-primary/80', 'hover:bg-brand-700'],
  ['hover:bg-primary', 'hover:bg-brand-700'],
  ['hover:border-primary', 'hover:border-brand-500'],
  ['focus:border-primary', 'focus:border-brand-500'],
  ['focus:ring-primary', 'focus:ring-brand-500'],
  ['focus-visible:border-primary', 'focus-visible:border-brand-500'],
  ['focus-visible:ring-primary', 'focus-visible:ring-brand-500'],
  ['ring-primary/30', 'ring-brand-300'],
  ['ring-primary', 'ring-brand-500'],
  ['border-primary', 'border-brand-500'],
  ['accent-primary', 'accent-brand-600'],
  ['data-[highlighted]:text-primary', 'data-[highlighted]:text-brand-700'],
  ['data-[state=checked]:bg-primary', 'data-[state=checked]:bg-brand-600'],
  ['data-[state=checked]:border-primary', 'data-[state=checked]:border-brand-500'],
  ['bg-primary/5', 'bg-brand-50'],
  ['bg-primary/10', 'bg-brand-50'],
  ['bg-primary/15', 'bg-brand-100'],
  ['bg-primary/20', 'bg-brand-100'],
  ['bg-primary/30', 'bg-brand-200'],
  ['text-primary/90', 'text-brand-700'],
  ['text-primary/80', 'text-brand-700'],
  ['text-primary', 'text-brand-700'],
  ['bg-primary', 'bg-brand-600'],

  // Accent (was gold) → brand-700 (text) / brand-600 (solids) / brand-500 (borders/rings)
  ['hover:bg-accent/10', 'hover:bg-brand-50'],
  ['hover:bg-accent', 'hover:bg-brand-600'],
  ['hover:text-accent', 'hover:text-brand-700'],
  ['hover:border-accent', 'hover:border-brand-500'],
  ['focus:border-accent', 'focus:border-brand-500'],
  ['focus:ring-accent/20', 'focus:ring-brand-500/20'],
  ['focus:ring-accent', 'focus:ring-brand-500'],
  ['focus-within:border-accent', 'focus-within:border-brand-500'],
  ['data-[highlighted]:bg-accent/10', 'data-[highlighted]:bg-brand-50'],
  ['data-[highlighted]:bg-accent', 'data-[highlighted]:bg-brand-50'],
  ['data-[highlighted]:text-accent', 'data-[highlighted]:text-brand-700'],
  ['border-accent/40', 'border-brand-200'],
  ['border-accent', 'border-brand-500'],
  ['bg-accent/10', 'bg-brand-50'],
  ['bg-accent/15', 'bg-brand-100'],
  ['bg-accent/20', 'bg-brand-100'],
  ['text-accent', 'text-brand-700'],
  ['bg-accent', 'bg-brand-600'],

  // Destructive → red
  ['text-destructive', 'text-red-700'],
  ['bg-destructive/10', 'bg-red-50'],
  ['bg-destructive/20', 'bg-red-100'],
  ['bg-destructive/30', 'bg-red-200'],
  ['bg-destructive', 'bg-red-600'],
  ['border-destructive/40', 'border-red-300'],
  ['border-destructive', 'border-red-500'],
  ['ring-destructive/20', 'ring-red-500/20'],
  ['ring-destructive/40', 'ring-red-500/40'],
  ['ring-destructive', 'ring-red-500'],
  ['aria-invalid:border-destructive', 'aria-invalid:border-red-500'],
  ['aria-invalid:ring-destructive/20', 'aria-invalid:ring-red-500/20'],
  ['aria-invalid:ring-destructive', 'aria-invalid:ring-red-500'],

  // Borders / inputs / rings
  ['hover:border-border', 'hover:border-zinc-300'],
  ['divide-border', 'divide-zinc-200'],
  ['border-border', 'border-zinc-200'],
  ['bg-border', 'bg-zinc-200'],
  ['border-input', 'border-zinc-300'],
  ['bg-input/50', 'bg-zinc-50'],
  ['bg-input/30', 'bg-zinc-50'],
  ['bg-input', 'bg-zinc-100'],
  ['focus-visible:border-ring/50', 'focus-visible:border-zinc-400/50'],
  ['focus-visible:border-ring', 'focus-visible:border-zinc-400'],
  ['focus-visible:ring-ring/50', 'focus-visible:ring-zinc-400/50'],
  ['focus-visible:ring-ring', 'focus-visible:ring-zinc-400'],
  ['ring-ring/50', 'ring-zinc-400/50'],
  ['ring-ring', 'ring-zinc-400'],

  // Shadows (deleted from globals.css)
  ['shadow-soft', 'shadow-sm'],
  ['shadow-medium', 'shadow-md'],
  ['shadow-deep', 'shadow-xl'],
];

const SRC = 'src';
const EXTS = ['.ts', '.tsx', '.css'];
// Skip these files — they're going to be deleted in Phase 7 anyway, or are intentionally unchanged
const SKIP = new Set([
  'src/components/ui/button.tsx',
  'src/components/ui/badge.tsx',
  'src/components/ui/combobox.tsx',
  'src/components/ui/dialog.tsx',
  'src/components/ui/field.tsx',
  'src/components/ui/input.tsx',
  'src/components/ui/input-group.tsx',
  'src/components/ui/label.tsx',
  'src/components/ui/popover.tsx',
  'src/components/ui/select.tsx',
  'src/components/ui/separator.tsx',
  'src/components/ui/tabs.tsx',
  'src/components/ui/textarea.tsx',
  'src/components/ui/toggle.tsx',
  'src/components/ui/toggle-group.tsx',
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
