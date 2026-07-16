import { describe, expect, it } from 'vitest';
import { classifySeedTarget } from './guard';

const PROD_URL =
  'postgresql://postgres.fkfybeddnfxnjuxkqidp:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres';
const SANDBOX_URL =
  'postgresql://postgres.qppenapeguwevcheqwpz:pw@aws-1-us-west-2.pooler.supabase.com:6543/postgres';

describe('classifySeedTarget', () => {
  it('refuses the prod project ref even with the unknown-target opt-in set', () => {
    // The hard guard: no flag combination may admit prod (intent: "structurally
    // impossible").
    expect(classifySeedTarget(PROD_URL, false).ok).toBe(false);
    expect(classifySeedTarget(PROD_URL, true).ok).toBe(false);
  });

  it('refuses a prod ref smuggled anywhere in the URL, not just the username', () => {
    expect(
      classifySeedTarget('postgresql://u:p@db.fkfybeddnfxnjuxkqidp.supabase.co:5432/postgres', true)
        .ok,
    ).toBe(false);
  });

  it('admits the sandbox ref without any opt-in', () => {
    expect(classifySeedTarget(SANDBOX_URL, false)).toEqual({
      ok: true,
      label: 'sandbox (qppenapeguwevcheqwpz)',
    });
  });

  it('admits localhost / 127.0.0.1 without any opt-in (docker test DB)', () => {
    expect(
      classifySeedTarget('postgres://postgres:postgres@127.0.0.1:55432/event_manager_test', false)
        .ok,
    ).toBe(true);
    expect(
      classifySeedTarget('postgres://postgres:postgres@localhost:5432/event_manager_test', false)
        .ok,
    ).toBe(true);
  });

  it('refuses an unrecognized host without the opt-in, admits it with', () => {
    const unknown = 'postgresql://u:p@some-other-db.example.com:5432/postgres';
    expect(classifySeedTarget(unknown, false).ok).toBe(false);
    expect(classifySeedTarget(unknown, true).ok).toBe(true);
  });

  it('refuses a missing or unparseable DATABASE_URL', () => {
    expect(classifySeedTarget(undefined, true).ok).toBe(false);
    expect(classifySeedTarget('', true).ok).toBe(false);
    expect(classifySeedTarget('not a url', true).ok).toBe(false);
  });
});
