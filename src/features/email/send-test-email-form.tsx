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
import { sendTestEmail } from './actions';
import { testEmailFormSchema, type TestEmailFormValues } from './test-email-schema';

// 0064 — admin deliverability tool. Free-compose a plain-text email to any
// address. Mirrors `dealers/dealer-form.tsx`: RHF + `zodResolver` shares the
// `testEmailFormSchema` contract with the Server Action, `useTransition` drives
// the pending state, and `toLegacyResult(...)` adapts the safe-action shape.
// The success banner shows the Resend message id — the proof-of-send this tool
// exists to surface.

const submitClass =
  'rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

function valuesToFormData(values: TestEmailFormValues): FormData {
  const fd = new FormData();
  fd.set('to', values.to);
  fd.set('subject', values.subject);
  fd.set('body', values.body);
  return fd;
}

export function SendTestEmailForm() {
  const [pending, startTransition] = useTransition();
  const [sentId, setSentId] = useState<string | null>(null);

  const form = useForm<TestEmailFormValues>({
    resolver: zodResolver(testEmailFormSchema),
    defaultValues: { to: '', subject: '', body: '' },
    mode: 'onTouched',
  });
  const { register, handleSubmit, formState } = form;
  const { errors } = formState;

  const onSubmit = handleSubmit((values) => {
    setSentId(null);
    startTransition(async () => {
      const result = toLegacyResult<{ ok: true; id: string }>(
        await sendTestEmail(valuesToFormData(values)),
      );
      if ('ok' in result) {
        setSentId(result.id);
        toast.success(`Sent — message id ${result.id}`);
      } else {
        toast.error(result.error);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="mt-4 flex max-w-xl flex-col gap-3">
      <FieldGroup>
        <Field>
          <Label htmlFor="te-to">To</Label>
          <Input
            id="te-to"
            type="email"
            placeholder="you@example.com"
            aria-invalid={!!errors.to || undefined}
            {...register('to')}
          />
          {errors.to && <FieldError>{errors.to.message}</FieldError>}
        </Field>

        <Field>
          <Label htmlFor="te-subject">Subject</Label>
          <Input
            id="te-subject"
            type="text"
            aria-invalid={!!errors.subject || undefined}
            {...register('subject')}
          />
          {errors.subject && <FieldError>{errors.subject.message}</FieldError>}
        </Field>

        <Field>
          <Label htmlFor="te-body">Body</Label>
          <Textarea
            id="te-body"
            rows={8}
            aria-invalid={!!errors.body || undefined}
            {...register('body')}
          />
          {errors.body && <FieldError>{errors.body.message}</FieldError>}
          <Description>Plain text only.</Description>
        </Field>
      </FieldGroup>

      {sentId && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          Sent ✓ — Resend message id <code className="font-mono">{sentId}</code>
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
