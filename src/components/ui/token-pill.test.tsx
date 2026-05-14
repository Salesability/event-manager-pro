import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { TokenPill } from './token-pill';

type AnyEl = ReactElement<{
  children?: unknown;
  className?: string;
  title?: string;
}>;

function isElement(node: unknown): node is AnyEl {
  return typeof node === 'object' && node !== null && 'type' in (node as object);
}

function walk(node: unknown): AnyEl[] {
  if (!isElement(node)) return [];
  const out: AnyEl[] = [node];
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const c of children) out.push(...walk(c));
  } else if (children !== undefined) {
    out.push(...walk(children));
  }
  return out;
}

describe('TokenPill', () => {
  it('renders the full value inline when shorter than maxChars', () => {
    const tree = TokenPill({ value: 'short' }) as AnyEl;
    const truncated = walk(tree).find((el) => el.props.children === 'short');
    expect(truncated).toBeDefined();
    // The pill exposes the full value via title for hover.
    const outer = walk(tree)[0];
    expect(outer?.props.title).toBe('short');
  });

  it('truncates with an ellipsis when the value exceeds maxChars (default 20)', () => {
    const long = 're_5wj99ctmZZZZAAAAAAAAA';
    const tree = TokenPill({ value: long }) as AnyEl;
    const truncated = walk(tree).find(
      (el) =>
        typeof el.props.children === 'string' &&
        el.props.children.endsWith('…'),
    );
    expect(truncated).toBeDefined();
    expect((truncated?.props.children as string).length).toBe(21); // 20 chars + ellipsis
    // Full value still on the wrapper for hover-reveal.
    expect(walk(tree)[0]?.props.title).toBe(long);
  });

  it('honors a custom maxChars override', () => {
    const tree = TokenPill({ value: 'abcdefghij', maxChars: 4 }) as AnyEl;
    const truncated = walk(tree).find(
      (el) =>
        typeof el.props.children === 'string' &&
        el.props.children.endsWith('…'),
    );
    expect(truncated?.props.children).toBe('abcd…');
  });

  it('applies the monospace + zinc chrome and merges caller className', () => {
    const tree = TokenPill({ value: 'short', className: 'ml-2' }) as AnyEl;
    const outer = walk(tree)[0];
    expect(outer?.props.className).toMatch(/font-mono/);
    expect(outer?.props.className).toMatch(/bg-zinc-100/);
    expect(outer?.props.className).toMatch(/ml-2/);
  });
});
