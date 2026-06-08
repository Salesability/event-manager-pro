'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Field,
  FieldGroup,
  Label,
  Description,
} from '@/components/catalyst/fieldset';
import { FieldError } from '@/components/catalyst/field-compat';
import { Input } from '@/components/catalyst/input';
import { Textarea } from '@/components/catalyst/textarea';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { sendTestMsa } from './actions';
import { testMsaFormSchema, type TestMsaFormValues } from './test-msa-schema';

// 0067 — admin BoldSign-verification tool. Mirrors `email/send-test-email-form.tsx`:
// RHF + `zodResolver` shares the `testMsaFormSchema` contract with the Server
// Action, `useTransition` drives the pending state, `toLegacyResult(...)` adapts
// the safe-action shape. The success banner shows the BoldSign document id —
// the proof-of-send this tool exists to surface. In production the submit fires
// a REAL envelope to the typed recipient (the prod path being verified).

const submitClass =
  'rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

function valuesToFormData(values: TestMsaFormValues): FormData {
  const fd = new FormData();
  fd.set('to', values.to);
  fd.set('signerName', values.signerName);
  fd.set('message', values.message ?? '');
  return fd;
}

export function SendTestMsaForm() {
  const [pending, startTransition] = useTransition();
  const [sentId, setSentId] = useState<string | null>(null);

  const form = useForm<TestMsaFormValues>({
    resolver: zodResolver(testMsaFormSchema),
    defaultValues: { to: '', signerName: '', message: '' },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState } = form;
  const { errors } = formState;

  const onSubmit = handleSubmit((values) => {
    setSentId(null);
    startTransition(async () => {
      const result = toLegacyResult<{ ok: true; documentId: string }>(
        await sendTestMsa(valuesToFormData(values)),
      );
      if ('ok' in result) {
        setSentId(result.documentId);
        toast.success(`Sent — BoldSign document ${result.documentId}`);
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="mt-4 flex max-w-xl flex-col gap-3">
      <FieldGroup>
        <Field>
          <Label htmlFor="tm-to">Recipient</Label>
          <Input
            id="tm-to"
            type="email"
            placeholder="you@example.com"
            aria-invalid={!!errors.to || undefined}
            {...register('to')}
          />
          {errors.to && <FieldError>{errors.to.message}</FieldError>}
          <Description>
            In production this sends a real BoldSign envelope here — use your own address.
          </Description>
        </Field>

        <Field>
          <Label htmlFor="tm-signer">Signer name</Label>
          <Input
            id="tm-signer"
            type="text"
            placeholder="Pat Buyer"
            aria-invalid={!!errors.signerName || undefined}
            {...register('signerName')}
          />
          {errors.signerName && <FieldError>{errors.signerName.message}</FieldError>}
        </Field>

        <Field>
          <Label htmlFor="tm-message">Message (optional)</Label>
          <Textarea
            id="tm-message"
            rows={4}
            aria-invalid={!!errors.message || undefined}
            {...register('message')}
          />
          {errors.message && <FieldError>{errors.message.message}</FieldError>}
          <Description>Cover note on the signing request; a default is used if blank.</Description>
        </Field>
      </FieldGroup>

      {sentId && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          Sent ✓ — BoldSign document id <code className="font-mono">{sentId}</code>
        </p>
      )}

      <div className="mt-2 flex justify-end">
        <button type="submit" disabled={pending} className={submitClass}>
          {pending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
