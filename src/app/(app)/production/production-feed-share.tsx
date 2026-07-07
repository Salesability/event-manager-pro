'use client';

import { useState } from 'react';

// Admin-only helper on `/production` (0097): surfaces the ready-to-paste
// `=IMPORTDATA(...)` formula so the owner can wire a Google Sheet to the
// production feed and share it with third-party implementers. The `formula`
// (which embeds the bearer token) is computed server-side in `page.tsx` and only
// reaches this admin-gated page. Collapsed by default so the token isn't shown
// until the owner expands it.
export function ProductionFeedShare({ formula }: { formula: string | null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!formula) return;
    try {
      await navigator.clipboard.writeText(formula);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (permissions/insecure context) — the formula is
      // selectable in the code box as a fallback.
    }
  }

  return (
    <details className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm shadow-[0_1px_4px_rgba(15,30,60,0.08)] print:hidden">
      <summary className="cursor-pointer font-semibold text-zinc-900">
        Share with implementers (Google Sheet)
      </summary>
      {formula ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-zinc-500">
            Paste this into cell <strong>A1</strong> of a new Google Sheet, then share that Sheet with your
            implementers. It shows booked &amp; upcoming campaigns (delivery columns only) and refreshes about
            once an hour.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800">
              {formula}
            </code>
            <button
              type="button"
              onClick={copy}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-900 transition hover:border-brand-500 hover:text-brand-700"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-zinc-500">
          The feed isn&apos;t configured on this environment yet (<code>PRODUCTION_FEED_TOKEN</code> is unset).
          See the go-live runbook to create the <code>production-feed-token</code> secret.
        </p>
      )}
    </details>
  );
}
