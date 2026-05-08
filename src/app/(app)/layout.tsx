import { AppHeader } from '@/components/app/app-header';
import { CapabilityProvider } from '@/components/auth/capability-provider';
import { Toaster } from '@/components/ui/toaster';
import { loadCurrentMembership } from '@/lib/auth/load-team-membership';
import { isAdmin } from '@/lib/auth/require-admin';
import { requireStaffAccess } from '@/lib/auth/require-staff-access';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffAccess();
  // React-cached — same call as requireStaffAccess made internally, so no
  // extra DB hit. Provider only needs roles + coachContactId for capability
  // decisions; user comes through the auth check already.
  const membership = await loadCurrentMembership();

  return (
    <CapabilityProvider
      user={user}
      roles={membership?.roles ?? []}
      coachContactId={membership?.coachContactId ?? null}
    >
      <div className="flex min-h-screen flex-col">
        <AppHeader email={user.email ?? 'unknown'} isAdmin={isAdmin(user)} />
        <main className="mx-auto w-full max-w-[1440px] px-8 py-8">{children}</main>
        <Toaster />
      </div>
    </CapabilityProvider>
  );
}
