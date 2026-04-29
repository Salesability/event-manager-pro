import { Ping } from '@/features/ping/ping';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-start justify-center gap-6 px-8 py-16 sm:px-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          event-manager-pro
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Scaffold up. Server actions wired. Tap the button to round-trip the server.
        </p>
      </div>
      <Ping />
    </main>
  );
}
