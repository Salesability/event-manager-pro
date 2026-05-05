import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/session';

export function isAdmin(user: User | null): boolean {
  return user?.app_metadata?.role === 'admin';
}

export async function requireAdmin(): Promise<User> {
  const user = await getUser();
  if (!user) redirect('/login');
  if (!isAdmin(user)) redirect('/');
  return user;
}
