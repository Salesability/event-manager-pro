import { describe, expect, it } from 'vitest';
import {
  dealerActivityKind,
  dealerPipelineStage,
  dealerPriority,
} from '@/lib/db/schema';
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  DEALER_PRIORITIES,
  DEALER_PRIORITY_LABELS,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGES,
} from './pipeline';

// Drift guard (0087): the client-side value arrays in `pipeline.ts` must stay in
// lock-step with the drizzle pgEnums — a mismatch should fail CI here rather than
// surface as a runtime "invalid input value for enum" in production.
describe('pipeline value sets match the DB enums', () => {
  it('pipeline stages', () => {
    expect([...PIPELINE_STAGES]).toEqual([...dealerPipelineStage.enumValues]);
  });
  it('priorities', () => {
    expect([...DEALER_PRIORITIES]).toEqual([...dealerPriority.enumValues]);
  });
  it('activity kinds', () => {
    expect([...ACTIVITY_KINDS]).toEqual([...dealerActivityKind.enumValues]);
  });
});

describe('every value has a human label', () => {
  it('stages', () => {
    for (const s of PIPELINE_STAGES) expect(PIPELINE_STAGE_LABELS[s]).toBeTruthy();
  });
  it('priorities', () => {
    for (const p of DEALER_PRIORITIES) expect(DEALER_PRIORITY_LABELS[p]).toBeTruthy();
  });
  it('activity kinds', () => {
    for (const k of ACTIVITY_KINDS) expect(ACTIVITY_KIND_LABELS[k]).toBeTruthy();
  });
});
