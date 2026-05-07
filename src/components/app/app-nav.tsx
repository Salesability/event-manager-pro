'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = { href: string; label: string; admin?: true };

const TABS: readonly Tab[] = [
  { href: '/calendar', label: 'Calendar' },
  { href: '/production', label: 'Production List' },
  { href: '/reports', label: 'Reports' },
  { href: '/dealerships', label: 'Dealers' },
  { href: '/admin/lookups', label: 'Lookups', admin: true },
  { href: '/admin/people', label: 'People', admin: true },
];

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => !t.admin || isAdmin);

  return (
    <nav className="flex items-center gap-1">
      {tabs.map((tab, i) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        // Visual separator on every non-admin → admin transition. Handles
        // both the contiguous-admin-suffix shape we ship today (separator
        // before the first admin tab only) and any future non-contiguous
        // arrangement without re-thinking the predicate. Skipped at i === 0
        // because there's no "previous tab" to transition from.
        const prev = i > 0 ? tabs[i - 1] : null;
        const showSeparator = !!(tab.admin && prev && !prev.admin);
        return (
          <span key={tab.href} className="flex items-center gap-1">
            {showSeparator && (
              <span
                aria-hidden
                className="mx-2 h-5 w-px bg-white/20"
              />
            )}
            <Link
              href={tab.href}
              className={
                'rounded-md px-4 py-2 text-sm font-medium transition ' +
                (active
                  ? 'bg-stone-400/40 text-white'
                  : 'text-white/75 hover:bg-white/10 hover:text-white')
              }
            >
              {tab.label}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
