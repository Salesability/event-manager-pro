import Link from 'next/link';

type AuthErrorPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const { reason } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-8 py-16">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Sign-in failed
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {reason ?? 'The link is invalid or expired.'}
          </p>
        </div>

        <Link
          href="/login"
          className="rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-zinc-50 transition hover:bg-zinc-800 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
