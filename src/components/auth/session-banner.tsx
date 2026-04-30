import { signOut } from '@/features/auth/actions';
import { getUser } from '@/lib/supabase/session';

export async function SessionBanner() {
  const user = await getUser();

  if (!user) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-6 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <span className="font-mono text-zinc-700 dark:text-zinc-300">{user.email}</span>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
