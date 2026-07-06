import { describe, expect, it } from 'vitest';
import {
  activityCounts,
  blockers,
  buildPipelineDashboard,
  pipelineByOwner,
  pipelineByStage,
  type DashboardActivity,
  type DashboardDealer,
} from './dashboard';

const NOW = new Date('2026-07-06T12:00:00Z');
const TODAY = '2026-07-06';
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

function dealer(o: Partial<DashboardDealer> & { id: number; name: string }): DashboardDealer {
  return {
    status: 'prospect',
    pipelineStage: 'new',
    ownerId: null,
    ownerName: null,
    nextActionAt: null,
    lastContactedAt: null,
    stageChangedAt: null,
    archivedAt: null,
    ...o,
  };
}

function activity(
  o: Partial<DashboardActivity> & { occurredAt: Date },
): DashboardActivity {
  return { kind: 'call', createdById: 'u1', actorName: 'Jane', ...o };
}

describe('pipelineByStage', () => {
  const dealers = [
    dealer({ id: 1, name: 'A', pipelineStage: 'new' }),
    dealer({ id: 2, name: 'B', pipelineStage: 'new' }),
    dealer({ id: 3, name: 'C', pipelineStage: 'contacted' }),
    dealer({ id: 4, name: 'D', status: 'active', pipelineStage: null }), // won — excluded from bars
    dealer({ id: 5, name: 'E', pipelineStage: 'new', archivedAt: new Date() }), // archived — excluded
  ];
  const funnel = pipelineByStage(dealers);

  it('counts non-archived prospects per stage', () => {
    expect(funnel.stages.find((s) => s.stage === 'new')?.count).toBe(2);
    expect(funnel.stages.find((s) => s.stage === 'contacted')?.count).toBe(1);
  });
  it('always emits all 9 stages in funnel order with zeros', () => {
    expect(funnel.stages).toHaveLength(9);
    expect(funnel.stages[0].stage).toBe('new');
    expect(funnel.stages.find((s) => s.stage === 'lost')?.count).toBe(0);
  });
  it('totals prospects (excluding active + archived) and counts won separately', () => {
    expect(funnel.totalProspects).toBe(3);
    expect(funnel.won).toBe(1);
  });
});

describe('pipelineByOwner', () => {
  const dealers = [
    dealer({ id: 1, name: 'A', ownerId: 'u1', ownerName: 'Jane', pipelineStage: 'new' }),
    dealer({ id: 2, name: 'B', ownerId: 'u1', ownerName: 'Jane', pipelineStage: 'contacted' }),
    dealer({ id: 3, name: 'C', ownerId: 'u2', ownerName: 'Sam', pipelineStage: 'new' }),
    dealer({ id: 4, name: 'D', ownerId: null, pipelineStage: 'new' }), // unassigned
    dealer({ id: 5, name: 'E', status: 'active', ownerId: 'u1', ownerName: 'Jane' }), // won — excluded
  ];
  const rows = pipelineByOwner(dealers);

  it('groups prospects by owner, sorted by total desc then name', () => {
    expect(rows.map((r) => [r.ownerName, r.total])).toEqual([
      ['Jane', 2],
      ['Sam', 1],
      ['Unassigned', 1],
    ]);
  });
  it('breaks each owner down by stage', () => {
    const jane = rows.find((r) => r.ownerId === 'u1');
    expect(jane?.byStage.new).toBe(1);
    expect(jane?.byStage.contacted).toBe(1);
  });
  it('labels a null owner Unassigned', () => {
    expect(rows.find((r) => r.ownerId === null)?.ownerName).toBe('Unassigned');
  });
});

describe('activityCounts', () => {
  const activities = [
    activity({ kind: 'call', occurredAt: daysAgo(1) }), // Jane, week + month
    activity({ kind: 'email', occurredAt: daysAgo(3) }), // Jane, week + month
    activity({ kind: 'call', occurredAt: daysAgo(20) }), // Jane, month only
    activity({ kind: 'note', occurredAt: daysAgo(40) }), // Jane, excluded (>30d)
    activity({ createdById: 'u2', actorName: 'Sam', kind: 'meeting', occurredAt: daysAgo(2) }),
    activity({ createdById: null, actorName: null, kind: 'other', occurredAt: daysAgo(1) }),
  ];
  const rows = activityCounts(activities, NOW);

  it('windows this-week vs last-30 per actor', () => {
    const jane = rows.find((r) => r.actorId === 'u1');
    expect(jane?.last30).toBe(3);
    expect(jane?.thisWeek).toBe(2);
  });
  it('breaks the 30-day window down by kind (excluding older rows)', () => {
    const jane = rows.find((r) => r.actorId === 'u1');
    expect(jane?.byKind.call).toBe(2);
    expect(jane?.byKind.email).toBe(1);
    expect(jane?.byKind.note).toBe(0); // the 40-day-old note is dropped
  });
  it('collapses a null actor into an Unknown bucket', () => {
    expect(rows.find((r) => r.actorId === null)?.actorName).toBe('Unknown');
  });
  it('sorts by last-30 total desc', () => {
    expect(rows[0].actorName).toBe('Jane');
  });
});

describe('blockers', () => {
  const dealers = [
    dealer({
      id: 1,
      name: 'Stalled1',
      pipelineStage: 'contacted',
      stageChangedAt: daysAgo(30),
      lastContactedAt: daysAgo(1),
      nextActionAt: '2026-07-10',
    }),
    dealer({
      id: 2,
      name: 'Stale1',
      stageChangedAt: daysAgo(2),
      lastContactedAt: daysAgo(20),
      nextActionAt: '2026-07-10',
    }),
    dealer({
      id: 3,
      name: 'NeverTouched',
      stageChangedAt: daysAgo(1),
      lastContactedAt: null,
      nextActionAt: '2026-07-10',
    }),
    dealer({
      id: 4,
      name: 'Overdue1',
      stageChangedAt: daysAgo(1),
      lastContactedAt: daysAgo(1),
      nextActionAt: '2026-07-01',
    }),
    dealer({
      id: 5,
      name: 'Healthy',
      stageChangedAt: daysAgo(1),
      lastContactedAt: daysAgo(1),
      nextActionAt: '2026-07-10',
    }),
    dealer({
      id: 6,
      name: 'ActiveOld',
      status: 'active',
      stageChangedAt: daysAgo(100),
      lastContactedAt: null,
      nextActionAt: '2026-01-01',
    }),
  ];
  const result = blockers(dealers, NOW, TODAY);

  it('flags stalled prospects (too long in stage)', () => {
    expect(result.stalled.map((d) => d.id)).toEqual([1]);
  });
  it('flags stale prospects with never-contacted first', () => {
    expect(result.stale.map((d) => d.id)).toEqual([3, 2]);
  });
  it('flags overdue prospects', () => {
    expect(result.overdue.map((d) => d.id)).toEqual([4]);
  });
  it('never counts an active (converted) dealer as a blocker', () => {
    for (const list of [result.stalled, result.stale, result.overdue]) {
      expect(list.find((d) => d.id === 6)).toBeUndefined();
    }
  });
  it('leaves a healthy prospect out of every list', () => {
    for (const list of [result.stalled, result.stale, result.overdue]) {
      expect(list.find((d) => d.id === 5)).toBeUndefined();
    }
  });
});

describe('buildPipelineDashboard', () => {
  it('composes all four facets', () => {
    const dealers = [
      dealer({ id: 1, name: 'A', ownerId: 'u1', ownerName: 'Jane', pipelineStage: 'new' }),
    ];
    const activities = [activity({ occurredAt: daysAgo(1) })];
    const dash = buildPipelineDashboard(dealers, activities, NOW, TODAY);
    expect(dash.funnel.totalProspects).toBe(1);
    expect(dash.byOwner).toHaveLength(1);
    expect(dash.activity[0].last30).toBe(1);
    expect(dash.blockers.stale.map((d) => d.id)).toEqual([1]); // never-contacted
  });
});
