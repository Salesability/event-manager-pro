'use client';

import type { ReactNode } from 'react';
import type { DuplicateResult } from './duplicate-types';

// Shared presentational "possible duplicate" callout (chunk 0085). Amber warning
// styling — matches the app's existing warning panels (quickbooks-admin.tsx) —
// because a possible duplicate is a heads-up the coach resolves, not an error.
// Each form supplies its own action buttons as children (reuse / link / create
// anyway / open existing) since the resolutions differ per surface.

export function duplicateMessage(d: DuplicateResult): string {
  switch (d.kind) {
    case 'contact':
      return `That ${d.via === 'email' ? 'email' : 'phone number'} already belongs to ${d.name}.`;
    case 'dealer-local':
      return `Looks like “${d.name}” already exists${d.address ? ` at ${d.address}` : ''}.`;
    case 'dealer-quickbooks':
      return `“${d.name}” already exists in QuickBooks.`;
  }
}

export function DuplicateNotice({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <p>{message}</p>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
