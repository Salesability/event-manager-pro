'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useContext } from 'react';
import { CapabilityContext } from '@/components/auth/capability-provider';
import type { Capability } from '@/lib/auth/capabilities';

type Tab = { href: string; label: string; requiresAdmin?: true; capability?: Capability };

// `requiresAdmin` hides the tab from coaches in the bar. Production + Dealers
// are operationally-shaped (daily back-office views) but admin-audience —
// they stay top-level (not in the Admin dropdown, which is settings-shaped)
// so admins can reach them without a menu click. Coaches don't see them at
// all. Route-level enforcement is in `src/lib/supabase/middleware.ts`
// (`ADMIN_PATHS`) + `assertCan('admin:access')` on each page (0028 → 0036).
const OPERATIONAL_TABS: readonly Tab[] = [
  { href: '/calendar', label: 'Calendar' },
  { href: '/production', label: 'Production List', requiresAdmin: true },
  { href: '/reports', label: 'Reports' },
  { href: '/dealerships', label: 'Dealers', requiresAdmin: true },
  { href: '/quotes', label: 'Quotes', capability: 'quote:edit' },
];

// Admin lives behind a single labeled dropdown rather than as flat top-level
// tabs. Two reasons: (1) admin pages are settings-shaped (configure once,
// revisit rarely) and over-promote when sat at the same prominence as the
// daily-use operational tabs; (2) admin destinations always grow — collapsing
// them under one trigger means future pages (org settings, audit log,
// integrations) drop in without bar-width pressure.
const ADMIN_TABS: readonly Tab[] = [
  { href: '/admin/people', label: 'People' },
  { href: '/admin/lookups', label: 'Lookups' },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  // Pull the bound `can` predicate from context once at the top level so
  // capability checks inside the filter callback aren't hook calls (which
  // would violate rules-of-hooks even with a constant tab list).
  const ctx = useContext(CapabilityContext);
  const can = ctx?.can ?? (() => false);
  const operationalTabs = OPERATIONAL_TABS.filter(
    (t) => (!t.requiresAdmin || isAdmin) && (!t.capability || can(t.capability)),
  );
  const adminActive = ADMIN_TABS.some((t) => isActive(pathname, t.href));

  return (
    <nav className="flex items-center gap-1">
      {operationalTabs.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
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
        );
      })}
      {isAdmin && <AdminMenu pathname={pathname} adminActive={adminActive} />}
    </nav>
  );
}

function AdminMenu({
  pathname,
  adminActive,
}: {
  pathname: string;
  adminActive: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Admin menu"
        className={
          'ml-2 flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 data-[state=open]:bg-white/15 data-[state=open]:text-white ' +
          (adminActive
            ? 'bg-stone-400/40 text-white'
            : 'text-white/75 hover:bg-white/10 hover:text-white')
        }
      >
        Admin
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 min-w-[12rem] overflow-hidden rounded-lg border border-stone-200 bg-white p-1 shadow-[0_8px_24px_rgba(15,30,60,0.18)]"
        >
          {ADMIN_TABS.map((tab) => {
            const active = isActive(pathname, tab.href);
            return (
              <DropdownMenu.Item key={tab.href} asChild>
                <Link
                  href={tab.href}
                  className={
                    'flex w-full cursor-pointer items-center rounded px-2 py-1.5 text-sm outline-none transition data-[highlighted]:bg-accent/10 data-[highlighted]:text-navy ' +
                    (active
                      ? 'bg-stone-100 font-medium text-navy'
                      : 'text-stone-700')
                  }
                >
                  {tab.label}
                </Link>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
