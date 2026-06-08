import { assertCan } from '@/lib/auth/assert-can';
import { PageHeader } from '@/components/app/page-header';
import { SendTestMsaForm } from '@/features/msa/send-test-msa-form';

// 0067 — admin BoldSign-verification tool. Gated on the pure-admin
// `admin:access` (NOT `msa:edit`, which also admits coaches), double-covered by
// the middleware `/admin/*` admin gate (`src/lib/supabase/middleware.ts`). In
// production the form fires a REAL BoldSign envelope to the typed recipient.
export default async function SendTestMsaPage() {
  await assertCan('admin:access');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Send Test MSA"
        description="Post a one-off test BoldSign envelope to any address to verify production e-signature. Sends for real in production — use your own address."
      />
      <SendTestMsaForm />
    </div>
  );
}
