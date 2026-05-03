import Link from 'next/link';
import { signOut } from '@/features/auth/actions';
import { AppNav } from './app-nav';

type AppHeaderProps = {
  email: string;
};

export function AppHeader({ email }: AppHeaderProps) {
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-navy px-8 shadow-[0_4px_16px_rgba(15,30,60,0.12)] print:hidden">
      <Link href="/calendar" className="flex items-center gap-3 text-white">
        <span className="font-display text-xl tracking-tight">Event Manager</span>
        <span className="rounded bg-stone-400/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/90">
          Pro
        </span>
      </Link>

      <div className="flex items-center gap-4">
        <AppNav />
        <div className="flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-400 text-[11px] font-bold text-white">
            {initials}
          </span>
          <span className="text-xs text-white/85">{email}</span>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-medium text-white/90 transition hover:border-white/40 hover:bg-white/10"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
