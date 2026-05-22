'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import type { BillingField } from '@/features/schedule/queries';
import { setBillingAdjustment } from './actions';

function fmt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString();
}

/** Inline-editable billing-figure cell on the /reports Full Production Report
 *  (0059). Admin-only — only mounted when the page resolves
 *  `reports:edit-billing`. Shows the effective value (override ?? original);
 *  saving on blur/Enter UPSERTs the adjustment, and clearing the field DELETEs
 *  it so the original campaign value comes back. The original is shown beneath
 *  the input whenever an override is active, so it's never lost from view. */
export function BillingCell({
  campaignId,
  field,
  original,
  override,
}: {
  campaignId: number;
  field: BillingField;
  original: number | null;
  override: number | undefined;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const effective = override ?? original ?? null;
  const current = effective == null ? '' : String(effective);
  const [text, setText] = useState(current);
  const isOverridden = override != null;

  function save() {
    const trimmed = text.trim();
    if (trimmed === current) return; // no-op when unchanged
    startTransition(async () => {
      const fd = new FormData();
      fd.set('campaignId', String(campaignId));
      fd.set('field', field);
      fd.set('value', trimmed);
      const result = toLegacyResult(await setBillingAdjustment(fd));
      if ('ok' in result) {
        toast.success(trimmed === '' ? 'Adjustment cleared' : 'Adjustment saved');
        router.refresh(); // re-pull so the aggregate tabs reflect the new total
      } else {
        toast.error(result.error);
        setText(current); // revert the input on failure
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        aria-label={`Edit ${field.replace('_', ' ')}`}
        placeholder="—"
        className="w-24 rounded border border-zinc-200 bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
      />
      {isOverridden && (
        <span className="text-[10px] text-zinc-400" title="Original campaign value (clear the field to restore)">
          orig <span className="line-through">{fmt(original)}</span>
        </span>
      )}
    </div>
  );
}
