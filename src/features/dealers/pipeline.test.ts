import { describe, expect, it } from 'vitest';
import {
  dealerActivityKind,
  dealerPipelineStage,
  dealerPriority,
} from '@/lib/db/schema';
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  addDaysIso,
  DEALER_PRIORITIES,
  DEALER_PRIORITY_LABELS,
  isIdle,
  isOverdue,
  isStale,
  isStalled,
  matchesDueBucket,
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGES,
  STALE_DAYS,
  STALLED_DAYS,
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

// ---- Commitment-queue bucketing (Phase 5) -----------------------------------
const TODAY = '2026-06-22';

describe('addDaysIso', () => {
  it('adds days across a month boundary', () => {
    expect(addDaysIso('2026-06-28', 7)).toBe('2026-07-05');
  });
  it('subtracts with negatives', () => {
    expect(addDaysIso('2026-06-22', -1)).toBe('2026-06-21');
  });
});

describe('isOverdue', () => {
  it('is true for a past due date', () => {
    expect(isOverdue('2026-06-21', TODAY)).toBe(true);
  });
  it('is false for today or future', () => {
    expect(isOverdue(TODAY, TODAY)).toBe(false);
    expect(isOverdue('2026-06-23', TODAY)).toBe(false);
  });
  it('is false when there is no due date', () => {
    expect(isOverdue(null, TODAY)).toBe(false);
  });
});

describe('matchesDueBucket', () => {
  it('overdue = strictly before today', () => {
    expect(matchesDueBucket('2026-06-21', TODAY, 'overdue')).toBe(true);
    expect(matchesDueBucket(TODAY, TODAY, 'overdue')).toBe(false);
  });
  it('today = exactly today', () => {
    expect(matchesDueBucket(TODAY, TODAY, 'today')).toBe(true);
    expect(matchesDueBucket('2026-06-23', TODAY, 'today')).toBe(false);
  });
  it('week = today through +7 days inclusive (excludes overdue + further out)', () => {
    expect(matchesDueBucket(TODAY, TODAY, 'week')).toBe(true);
    expect(matchesDueBucket('2026-06-29', TODAY, 'week')).toBe(true); // +7
    expect(matchesDueBucket('2026-06-30', TODAY, 'week')).toBe(false); // +8
    expect(matchesDueBucket('2026-06-21', TODAY, 'week')).toBe(false); // overdue
  });
  it('never matches a null due date', () => {
    for (const b of ['overdue', 'today', 'week'] as const) {
      expect(matchesDueBucket(null, TODAY, b)).toBe(false);
    }
  });
});

describe('isIdle', () => {
  it('is idle with no / blank next action', () => {
    expect(isIdle(null)).toBe(true);
    expect(isIdle('   ')).toBe(true);
  });
  it('is not idle with a real next action', () => {
    expect(isIdle('Call Tuesday')).toBe(false);
  });
});

// ---- Dashboard blocker thresholds (0088) ------------------------------------
const NOW = new Date('2026-07-06T12:00:00Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

describe('isStalled', () => {
  it('is stalled when in-stage longer than the threshold', () => {
    expect(isStalled(daysAgo(STALLED_DAYS + 1), NOW)).toBe(true);
  });
  it('is not stalled exactly at the threshold (strictly greater)', () => {
    expect(isStalled(daysAgo(STALLED_DAYS), NOW)).toBe(false);
  });
  it('is not stalled well within the threshold', () => {
    expect(isStalled(daysAgo(3), NOW)).toBe(false);
  });
  it('is not stalled when the stage-change stamp is null (age unknown)', () => {
    expect(isStalled(null, NOW)).toBe(false);
  });
});

describe('isStale', () => {
  it('is stale when the last touch is older than the threshold', () => {
    expect(isStale(daysAgo(STALE_DAYS + 1), NOW)).toBe(true);
  });
  it('is not stale exactly at the threshold (strictly greater)', () => {
    expect(isStale(daysAgo(STALE_DAYS), NOW)).toBe(false);
  });
  it('is not stale with a recent touch', () => {
    expect(isStale(daysAgo(2), NOW)).toBe(false);
  });
  it('is stale when never contacted (null last-contacted)', () => {
    expect(isStale(null, NOW)).toBe(true);
  });
});
