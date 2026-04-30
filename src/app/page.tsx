import { Ping } from '@/features/ping/ping';
import { getUser } from '@/lib/supabase/session';

export default async function Home() {
  const user = await getUser();

  return (
    <main className="flex min-h-screen flex-col items-start justify-center gap-6 px-8 py-16 sm:px-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          event-manager-pro
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as <span className="font-mono">{user?.email ?? 'unknown'}</span>. Tap the
          button to round-trip the server.
        </p>
      </div>
      <Ping />
    </main>
  );
}
