import { AppHeader } from '@/components/app/app-header';
import { Toaster } from '@/components/ui/toaster';
import { isAdmin } from '@/lib/auth/require-admin';
import { requireStaffAccess } from '@/lib/auth/require-staff-access';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaffAccess();

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader email={user.email ?? 'unknown'} isAdmin={isAdmin(user)} />
      <main className="mx-auto w-full max-w-[1440px] px-8 py-8">{children}</main>
      <Toaster />
    </div>
  );
}
