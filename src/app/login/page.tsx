import { redirect } from 'next/navigation';
import { signInWithGoogle, signInWithMagicLink } from '@/features/auth/actions';
import { getUser } from '@/lib/supabase/session';
import { safeNextPath } from '@/lib/url';

type LoginPageProps = {
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { sent, error, next } = await searchParams;
  const target = safeNextPath(next);

  const user = await getUser();
  if (user) {
    redirect(target);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-cream px-8 py-16">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-stone-200 bg-white p-8 shadow-[0_8px_32px_rgba(15,30,60,0.18)]">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="font-display text-3xl text-navy">Event Manager Pro</h1>
          <p className="text-sm text-stone-600">Sign-in is invitation only.</p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-status-green/30 bg-status-green/10 p-4 text-sm text-status-green">
            Check <span className="font-mono">{sent}</span> for your sign-in link.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <form action={signInWithGoogle}>
              <input type="hidden" name="next" value={target} />
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 shadow-[0_1px_4px_rgba(15,30,60,0.08)] transition hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(15,30,60,0.12)]"
              >
                <GoogleG />
                Continue with Google
              </button>
            </form>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-stone-200" />
              <span className="text-xs uppercase tracking-wide text-stone-400">or</span>
              <div className="h-px flex-1 bg-stone-200" />
            </div>

            <form action={signInWithMagicLink} className="flex flex-col gap-3">
              <input type="hidden" name="next" value={target} />
              <label
                htmlFor="email"
                className="text-xs font-semibold uppercase tracking-wide text-stone-600"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20"
              />
              <button
                type="submit"
                className="rounded-lg bg-navy px-4 py-2.5 text-sm font-medium text-white transition hover:bg-navy-light hover:-translate-y-px hover:shadow-[0_1px_4px_rgba(15,30,60,0.08)]"
              >
                Send magic link
              </button>
            </form>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-status-red/30 bg-status-red/10 p-3 text-sm text-status-red">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  );
}
