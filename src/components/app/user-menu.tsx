'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { signOut } from '@/features/auth/actions';

// Replaces the inline avatar pill + email + standalone Sign out button that
// the staff-app header used to render side-by-side. The menu collapses
// account chrome (email display + sign-out) behind a single avatar trigger
// — pulls ~30% of the bar width back, and creates the affordance home for
// future per-user settings (profile, theme, MFA).
//
// Radix DropdownMenu over Popover because it ships keyboard semantics —
// roving tabindex, arrow-key item navigation, Escape close, focus-restore
// to the trigger — that match menu-pattern expectations. Same precedent as
// 0024 picking Combobox over a hand-rolled popover for the dealer picker.

export function UserMenu({ email }: { email: string }) {
  const initials = deriveInitials(email);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted-foreground text-[11px] font-bold text-white">
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
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50 min-w-[14rem] overflow-hidden rounded-lg border border-border bg-white p-1 shadow-[0_8px_24px_rgba(15,30,60,0.18)]"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Signed in as
          </DropdownMenu.Label>
          <div
            className="max-w-[20rem] break-all px-2 pb-2 text-xs text-foreground"
            title={email}
          >
            {email}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-muted" />
          {/* Sign-out is a Server Action. Wrap the menu item in a `<form
              action={signOut}>` and override Radix's default onSelect close
              with `requestSubmit()` so the form submit dispatches BEFORE
              the portal unmounts (Codex 0030 Phase 2 Medium — the natural
              `<button type="submit">` ordering is fragile across browsers
              under Radix's onSelect → unmount race). */}
          <form action={signOut}>
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault();
                const target = e.currentTarget as HTMLElement | null;
                target?.closest('form')?.requestSubmit();
              }}
              className="flex w-full cursor-pointer items-center rounded px-2 py-1.5 text-sm text-foreground outline-none transition data-[highlighted]:bg-accent/10 data-[highlighted]:text-primary"
            >
              Sign out
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
