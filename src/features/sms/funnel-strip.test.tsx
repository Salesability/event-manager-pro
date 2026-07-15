import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { FunnelStrip } from './funnel-strip';

// Node-env render check (no DOM), mirrors inbox-thread-list.test.tsx: call
// the hook-free strip as a plain function and assert on its flattened text.
function texts(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const c of node) texts(c, out);
    return out;
  }
  if (typeof node === 'object' && 'props' in (node as object)) {
    texts((node as ReactElement<{ children?: unknown }>).props?.children, out);
  }
  return out;
}

describe('FunnelStrip', () => {
  it('renders the five funnel numbers with their labels', () => {
    const all = texts(
      FunnelStrip({
        funnel: { sent: 42, delivered: 39, responses: 7, noResponse: 35, stops: 2 },
      }),
    ).join('');
    expect(all).toContain('42 sent');
    expect(all).toContain('39 delivered');
    expect(all).toContain('7 responses');
    expect(all).toContain('35 no response');
    expect(all).toContain('2 stops');
  });

  it('singularizes a lone response', () => {
    const all = texts(
      FunnelStrip({
        funnel: { sent: 3, delivered: 0, responses: 1, noResponse: 2, stops: 0 },
      }),
    ).join('');
    expect(all).toContain('1 response');
    expect(all).not.toContain('1 responses');
  });
});
