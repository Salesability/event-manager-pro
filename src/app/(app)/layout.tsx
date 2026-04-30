import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/app/app-header';
import { getUser } from '@/lib/supabase/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader email={user.email ?? 'unknown'} />
      <main className="mx-auto w-full max-w-[1440px] px-8 py-8">{children}</main>
    </div>
  );
}
