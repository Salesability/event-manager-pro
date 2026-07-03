'use client';

import {
  Dropdown,
  DropdownButton,
  DropdownMenu,
  DropdownItem,
  DropdownDivider,
  DropdownHeader,
} from '@/components/catalyst/dropdown';
import { signOut } from '@/features/auth/actions';

// Replaces the inline avatar pill + email + standalone Sign out button that
// the staff-app header used to render side-by-side. The menu collapses
// account chrome (email display + sign-out) behind a single avatar trigger
// — pulls ~30% of the bar width back, and creates the affordance home for
// future per-user settings (profile, theme, MFA).
//
// Catalyst Dropdown (Headless UI) over Popover because it ships keyboard
// semantics — roving tabindex, arrow-key item navigation, Escape close,
// focus-restore to the trigger — that match menu-pattern expectations.

export function UserMenu({ email }: { email: string }) {
  const initials = deriveInitials(email);

  return (
    <Dropdown>
      <DropdownButton
        as="button"
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-500 text-[11px] font-bold text-white">
          {initials}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3 w-3 text-white/70"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </DropdownButton>
      <DropdownMenu anchor="bottom end" className="min-w-[14rem]">
        <DropdownHeader>
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Signed in as
          </div>
          <div className="max-w-[20rem] break-all text-xs text-zinc-900" title={email}>
            {email}
          </div>
        </DropdownHeader>
        <DropdownDivider />
        {/* Sign-out is a Server Action. Wrap the menu item in a `<form
            action={signOut}>` so the menu close + form submit don't race.
            The DropdownItem renders as a submit button. `col-span-full` makes
            the form span the menu's grid (the DropdownMenu is a grid); without
            it the form collapses to the first `auto` column and the button —
            and "Sign out" — wraps. */}
        <form action={signOut} className="col-span-full">
          <DropdownItem type="submit">Sign out</DropdownItem>
        </form>
      </DropdownMenu>
    </Dropdown>
  );
}

// Pull the first two alphanumeric chars from the email's local part. Falls
// back to '?' on degenerate input (`@example.com`, `....`, empty). Caps at 2
// chars; uppercase. Avoids the cosmetic-but-ugly initials that
// `email.slice(0, 2)` produces for emails starting with a non-letter.
function deriveInitials(email: string): string {
  const local = email.split('@', 1)[0] ?? '';
  const letters = local.replace(/[^a-zA-Z0-9]/g, '');
  const picked = letters.slice(0, 2);
  return picked ? picked.toUpperCase() : '?';
}
