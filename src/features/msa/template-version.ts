import 'server-only';

// MSA prose is rendered in-repo via `src/lib/pdf/render-msa.ts` and uploaded
// inline per envelope. There is no provider-side template; this function
// denormalizes the active prose version into
// `master_service_agreements.templateVersion` at draft-create time so each
// MSA row carries the version of the prose it was rendered against. Bump
// `MSA_TEMPLATE_VERSION` manually on each prose revision; bumps are visible
// in deploy diffs.
//
// Provider-agnostic: this helper lived under `src/lib/dropbox-sign/` until
// 0051-dropbox-sign-to-boldsign (Phase 6 relocation) — the prose-version
// concern has nothing to do with the e-signature provider.
export function currentMsaTemplateVersion(): string | { error: string } {
  const version = process.env.MSA_TEMPLATE_VERSION?.trim();
  if (!version) return { error: 'MSA_TEMPLATE_VERSION is not set.' };
  return version;
}
