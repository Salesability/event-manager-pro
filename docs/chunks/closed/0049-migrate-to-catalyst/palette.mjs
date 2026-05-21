#!/usr/bin/env node
/**
 * Logo-anchored OKLCH brand ramp generator.
 *
 * Seed: #1a5fa8 (eyedropper anchor from public/saledayevents-logo.jpg, range
 * #1a5fa8–#1f6bc2). In OKLCH that's approximately L=0.441 C=0.121 H=252.5°.
 *
 * Tailwind v4's @theme block reads `oklch(...)` values directly, so we emit
 * the ramp as oklch() literals and let the browser do the color-space
 * conversion at render time. No JS color library needed.
 *
 * Lightness steps mirror Tailwind's default named-color spacing (50 light →
 * 950 darkest), centered on the seed at brand-500. Chroma tapers toward both
 * ends — lighter tints can't carry the seed's full chroma without going muddy,
 * and darker shades can't either. Hue stays constant.
 *
 * Run: node docs/chunks/0049-migrate-to-catalyst/palette.mjs > /tmp/ramp.css
 * Then paste into src/app/globals.css's @theme block.
 */

const SEED_HUE = 252.5;
const SEED_CHROMA = 0.121; // OKLCH chroma at L=0.441 for #1a5fa8

// Tailwind-style lightness ramp. brand-500 = seed lightness.
// Chroma tapers — peaks near 400-500, lower at extremes (matches Tailwind blue's shape).
const stops = [
  { name: '50', l: 0.97, c: 0.018 },
  { name: '100', l: 0.94, c: 0.034 },
  { name: '200', l: 0.88, c: 0.064 },
  { name: '300', l: 0.78, c: 0.094 },
  { name: '400', l: 0.62, c: 0.118 },
  { name: '500', l: 0.441, c: 0.121 }, // seed: #1a5fa8
  { name: '600', l: 0.40, c: 0.115 },
  { name: '700', l: 0.35, c: 0.103 },
  { name: '800', l: 0.30, c: 0.088 },
  { name: '900', l: 0.25, c: 0.070 },
  { name: '950', l: 0.19, c: 0.050 },
];

for (const { name, l, c } of stops) {
  console.log(`  --color-brand-${name}: oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${SEED_HUE});`);
}
