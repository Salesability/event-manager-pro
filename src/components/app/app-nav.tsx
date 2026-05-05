'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = { href: string; label: string; admin?: true };

const TABS: readonly Tab[] = [
  { href: '/calendar', label: 'Calendar' },
  { href: '/production', label: 'Production List' },
  { href: '/lists', label: 'Manage Lists' },
  { href: '/admin/lookups', label: 'Lookups', admin: true },
  { href: '/admin/people', label: 'People', admin: true },
  // `Users` retires in 0020 Phase 4 — kept alongside People for one transitional release.
  { href: '/admin/users', label: 'Users', admin: true },
];

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = TABS.filter((t) => !t.admin || isAdmin);

  return (
    <nav className="flex gap-1">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              'rounded-md px-4 py-2 text-sm font-medium transition ' +
              (active
                ? 'bg-stone-400/40 text-white'
                : 'text-white/60 hover:bg-white/10 hover:text-white')
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
