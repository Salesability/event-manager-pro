import { z } from 'zod';
import { ACTIVITY_KINDS, DEALER_PRIORITIES, PIPELINE_STAGES } from './pipeline';

// Validation for the prospecting-pipeline Server Actions (0087). Imported by the
// client panel (via `zodResolver`) and the actions (via
// `safeParse(Object.fromEntries(formData))`).
//
// Wire-format note: `Object.fromEntries(FormData)` yields strings; blank fields
// arrive as `''`. Optional fields therefore accept `''`. The action distinguishes
// "field absent" (preserve) from "field present as ''" (clear to null) via
// `formData.has(...)`, mirroring `updateDealer`'s patch discipline.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date: passes the shape check AND round-trips (rejects
// `2026-02-31` → would silently roll to Mar 3, and `2026-99-99` → would make
// Postgres throw on the `date` column). Anchored at UTC midnight to avoid TZ
// drift in the comparison.
function isRealIsoDate(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// A calendar date (YYYY-MM-DD) or '' (= clear). next_action_at is a `date`
// column, so no time-of-day.
const dateOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === '' || isRealIsoDate(v), 'Enter a valid date.');

// owner picklist submits a coach's auth-user uuid, or '' to clear.
const ownerOrEmpty = z
  .string()
  .trim()
  .refine((v) => v === '' || UUID_RE.test(v), 'Invalid owner.');

export const dealerPipelineSchema = z.object({
  // '' (= no stage) is tolerated by the schema but treated as "no change" by the
  // action — a prospect always carries a real stage.
  stage: z.union([z.enum(PIPELINE_STAGES), z.literal('')]).optional(),
  priority: z.union([z.enum(DEALER_PRIORITIES), z.literal('')]).optional(),
  ownerId: ownerOrEmpty.optional(),
  nextAction: z
    .string()
    .trim()
    .max(500, 'Next action must be 500 characters or fewer.')
    .optional(),
  nextActionAt: dateOrEmpty.optional(),
});

export type DealerPipelineValues = z.infer<typeof dealerPipelineSchema>;

export const logActivitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS, { error: 'Pick an activity type.' }),
  note: z
    .string()
    .trim()
    .max(2000, 'Note must be 2000 characters or fewer.')
    .optional(),
  // optional backdate — defaults to now in the action when blank/absent.
  occurredAt: dateOrEmpty.optional(),
  // optional: set the next promise in the same submit as logging the touch.
  nextAction: z
    .string()
    .trim()
    .max(500, 'Next action must be 500 characters or fewer.')
    .optional(),
  nextActionAt: dateOrEmpty.optional(),
});

export type LogActivityValues = z.infer<typeof logActivitySchema>;
