import type { User } from '@supabase/supabase-js';

export function isAdmin(user: User | null): boolean {
  return user?.app_metadata?.role === 'admin';
}
