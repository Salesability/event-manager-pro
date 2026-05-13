import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { PageHeader } from './page-header';

type AnyEl = ReactElement<{ children?: unknown; className?: string }>;

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

describe('PageHeader', () => {
  it('renders the title inside an <h1>', () => {
    const tree = PageHeader({ title: 'Quotes' }) as AnyEl;
    const h1 = walk(tree).find((el) => el.type === 'h1');
    expect(h1).toBeDefined();
    expect(h1?.props.children).toBe('Quotes');
  });

  it('uses the post-0042 bold-Inter title type scale', () => {
    const tree = PageHeader({ title: 'Quotes' }) as AnyEl;
    const h1 = walk(tree).find((el) => el.type === 'h1');
    expect(h1?.props.className).toMatch(/font-sans/);
    expect(h1?.props.className).toMatch(/font-bold/);
    expect(h1?.props.className).toMatch(/tracking-tight/);
    expect(h1?.props.className).toMatch(/text-3xl/);
  });

  it('renders the actions slot when actions are provided', () => {
    const sentinel = { type: 'button', props: { children: 'Save' } } as unknown as ReactElement;
    const tree = PageHeader({ title: 'Quotes', actions: sentinel }) as AnyEl;
    const slot = walk(tree).find(
      (el) => el.type === 'div' && /shrink-0/.test(el.props.className ?? ''),
    );
    expect(slot).toBeDefined();
    expect(slot?.props.children).toBe(sentinel);
  });

  it('omits the actions slot when no actions are provided', () => {
    const tree = PageHeader({ title: 'Quotes' }) as AnyEl;
    const slot = walk(tree).find(
      (el) => el.type === 'div' && /shrink-0/.test(el.props.className ?? ''),
    );
    expect(slot).toBeUndefined();
  });

  it('renders a description paragraph when provided', () => {
    const tree = PageHeader({ title: 'Quotes', description: 'All quotes' }) as AnyEl;
    const p = walk(tree).find((el) => el.type === 'p');
    expect(p?.props.children).toBe('All quotes');
  });

  it('parks below the 64px AppHeader (sticky top-16 z-10) when sticky', () => {
    const tree = PageHeader({ title: 'Quotes', sticky: true }) as AnyEl;
    expect(tree.props.className).toMatch(/sticky/);
    expect(tree.props.className).toMatch(/top-16/);
    expect(tree.props.className).toMatch(/z-10/);
  });

  it('omits sticky classes by default', () => {
    const tree = PageHeader({ title: 'Quotes' }) as AnyEl;
    expect(tree.props.className).not.toMatch(/\bsticky\b/);
    expect(tree.props.className).not.toMatch(/\btop-16\b/);
  });
});
