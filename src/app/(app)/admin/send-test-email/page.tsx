import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { SendTestEmailForm } from '@/features/email/send-test-email-form';

// 0064 — admin deliverability tool. Gated on `email:send` (admin-only today,
// already UI-paired via the calendar Email buttons), and double-covered by the
// middleware `/admin/*` admin gate (`src/lib/supabase/middleware.ts`).
export default async function SendTestEmailPage() {
  await assertCan('email:send');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Send Test Email"
        description="Send a one-off plain-text email to any address to verify deliverability."
      />
      <SendTestEmailForm />
    </div>
  );
}
