import Link from 'next/link';
import { signOut } from '@/features/auth/actions';

type AuthErrorPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

type Variant = {
  headline: string;
  body: string;
  // 'signout' clears the session cookie via the signOut action and bounces
  // to /login — needed when the user is signed in but the gate kicked them
  // here, since a plain link to /login would just re-auth and loop. 'login'
  // is for the "no session yet" cases where /login is reachable directly.
  primary: 'signout' | 'login';
  showAdminMailto?: boolean;
};

const VARIANTS: Record<string, Variant> = {
  'Account not provisioned': {
    headline: 'Almost there',
    body: "You're signed in, but you haven't been added to the team yet. Ask your administrator to add you from the Users page.",
    primary: 'signout',
    showAdminMailto: true,
  },
  'Portal not yet available': {
    headline: 'Customer portal coming soon',
    body: "We've got your account on file. We'll email you when the customer portal opens.",
    primary: 'signout',
  },
};

const FALLBACK: Variant = {
  headline: 'Sign-in failed',
  body: 'The link is invalid or expired.',
  primary: 'login',
};

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const { reason } = await searchParams;
  const known = reason ? VARIANTS[reason] : undefined;
  const variant: Variant = known ?? {
    ...FALLBACK,
    body: reason || FALLBACK.body,
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-8 py-16">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {variant.headline}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{variant.body}</p>
        </div>

        {variant.primary === 'signout' ? (
          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-zinc-50 transition hover:bg-zinc-800 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Sign out
            </button>
          </form>
        ) : (
          <Link
            href="/login"
            className="rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-zinc-50 transition hover:bg-zinc-800 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Try again
          </Link>
        )}

        {variant.showAdminMailto && (
          <a
            href="mailto:david.hogan@networknode.ca?subject=SaleDay%20access%20request"
            className="text-center text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Email Admin
          </a>
        )}
      </div>
    </main>
  );
}
