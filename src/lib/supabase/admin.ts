import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Service-role client for admin-only operations (auth.admin.*, bypassing RLS).
// Never import this from a Client Component — `'server-only'` makes that a
// build error if a client module reaches for it.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
