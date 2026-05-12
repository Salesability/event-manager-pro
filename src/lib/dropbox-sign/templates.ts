import 'server-only';

// MSA prose is rendered in-repo via `src/lib/pdf/render-msa.ts` and uploaded
// inline per envelope (Open Question #3 resolved 2026-05-12). There is no
// Dropbox-Sign-side template; this module exists solely to denormalize the
// active prose version into `master_service_agreements.templateVersion` at
// draft-create time so each MSA row carries the version of the prose it was
// rendered against. Bump `MSA_TEMPLATE_VERSION` manually on each prose
// revision; bumps are visible in deploy diffs (Open Question #4).
export function currentMsaTemplateVersion(): string | { error: string } {
  const version = process.env.MSA_TEMPLATE_VERSION?.trim();
  if (!version) return { error: 'MSA_TEMPLATE_VERSION is not set.' };
  return version;
}
