'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/calendar', label: 'Calendar' },
  { href: '/production', label: 'Production List' },
  { href: '/lists', label: 'Manage Lists' },
  { href: '/admin/lookups', label: 'Lookups' },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {TABS.map((tab) => {
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
