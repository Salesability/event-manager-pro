import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app/app-header';
import { Toaster } from '@/components/ui/toaster';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import { isAdmin } from '@/lib/auth/require-admin';
import { getUser } from '@/lib/supabase/session';

// Staff-app gate. The `/auth/callback` route runs the same decision tree on
// the *first* request after sign-in; this gate makes that decision durable
// across direct URL access (otherwise a contact-only auth user could bypass
// the callback redirect by typing `/calendar` themselves). See
// docs/wiki/auth.md → "Login routing".
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) {
    redirect('/login');
  }

  // Admins always pass — the gate trusts `app_metadata.role` so an admin can
  // operate before any team_member_roles row exists (e.g. bootstrap).
  if (!isAdmin(user)) {
    const membership = await loadCurrentMembership();
    if (!membership || membership.roles.length === 0) {
      const reason = membership?.hasDealerContact
        ? 'Portal not yet available'
        : 'Account not provisioned';
      redirect(`/auth/auth-error?reason=${encodeURIComponent(reason)}`);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader email={user.email ?? 'unknown'} isAdmin={isAdmin(user)} />
      <main className="mx-auto w-full max-w-[1440px] px-8 py-8">{children}</main>
      <Toaster />
    </div>
  );
}
