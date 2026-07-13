// Pure personalization for campaign SMS bodies (0103). Staff write the
// template by hand (no AI drafting — intent non-goal); the supported
// variables are the closed set below. Rendering happens per recipient at
// dispatch time and the result is handed straight to Twilio — the RENDERED
// body is never persisted (the template is stored once on `sms_sends`, D5),
// so customer names don't linger in the ledger after the retention purge.

export type SmsTemplateVars = {
  firstName: string | null;
  lastName: string | null;
  dealerName: string | null;
};

const VARIABLE_MAP: Record<string, keyof SmsTemplateVars> = {
  first_name: 'firstName',
  last_name: 'lastName',
  dealer_name: 'dealerName',
};

// `{{ first_name }}` and `{{first_name}}` both render; an unknown variable is
// left verbatim so a typo stays visible in the pre-send preview instead of
// silently vanishing. A known variable with no value renders as '' ("Hi
// {{first_name}}," → "Hi ," — imperfect but honest), and doubled spaces left
// behind mid-sentence are collapsed.
export function renderSmsBody(template: string, vars: SmsTemplateVars): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (raw, name: string) => {
      const key = VARIABLE_MAP[name];
      if (!key) return raw;
      return vars[key]?.trim() ?? '';
    })
    .replace(/ {2,}/g, ' ');
}

/** Variables the composer UI advertises + the preview validates against. */
export const SMS_TEMPLATE_VARIABLES = Object.keys(VARIABLE_MAP) as Array<
  keyof typeof VARIABLE_MAP
>;
