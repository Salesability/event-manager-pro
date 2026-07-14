import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { UnreadCountPill } from './unread-count-pill';

// Node-env render check (no DOM) — the pill is hook-free, so call it as a
// plain function. Mirrors token-pill.test.tsx.

describe('UnreadCountPill', () => {
  it('renders the count with an aria-label', () => {
    const el = UnreadCountPill({ count: 3 }) as ReactElement<{
      'aria-label': string;
      children: unknown;
    }>;
    expect(el).not.toBeNull();
    expect(el.props['aria-label']).toBe('3 unread');
    expect(el.props.children).toBe(3);
  });

  it('renders nothing at zero (badge only exists when something needs action)', () => {
    expect(UnreadCountPill({ count: 0 })).toBeNull();
    expect(UnreadCountPill({ count: -1 })).toBeNull();
  });

  it('caps the display at 99+', () => {
    const el = UnreadCountPill({ count: 250 }) as ReactElement<{ children: unknown }>;
    expect(el.props.children).toBe('99+');
  });
});
