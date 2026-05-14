import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { RowIdentityCell } from './row-identity-cell';

type AnyEl = ReactElement<{
  children?: unknown;
  className?: string;
  href?: string;
  type?: string;
  onClick?: () => void;
  color?: string;
  'aria-hidden'?: boolean;
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

function findByText(tree: AnyEl, text: string): AnyEl | undefined {
  return walk(tree).find((el) => el.props.children === text);
}

describe('RowIdentityCell', () => {
  it('wraps the label in a single <Link> to the supplied href', () => {
    const tree = RowIdentityCell({ label: 'Acme Inc', href: '/dealerships/12' }) as AnyEl;
    const link = walk(tree).find((el) => el.props.href === '/dealerships/12');
    expect(link).toBeDefined();
    expect(link?.props.children).toBe('Acme Inc');
    // The link is the only element carrying the href — the wrapper <span>s have none.
    const allWithHref = walk(tree).filter((el) => el.props.href != null);
    expect(allWithHref).toHaveLength(1);
  });

  it('applies the dotted-underline class composition on the label link', () => {
    const tree = RowIdentityCell({ label: 'Acme Inc', href: '/x' }) as AnyEl;
    const link = walk(tree).find((el) => el.props.href === '/x');
    expect(link?.props.className).toMatch(/underline\s+decoration-dotted/);
    expect(link?.props.className).toMatch(/hover:decoration-zinc-900/);
  });

  it('renders the icon slot as a Catalyst Badge with the requested color', () => {
    const tree = RowIdentityCell({
      label: 'quote-20260512-0900',
      href: '/quotes/4',
      icon: '📋',
      iconTone: 'brand',
    }) as AnyEl;
    const badge = walk(tree).find((el) => el.props['aria-hidden'] === true);
    expect(badge).toBeDefined();
    expect(badge?.props.color).toBe('brand');
    // The icon glyph is the Badge's only child.
    expect(badge?.props.children).toBe('📋');
    // Shape override classes keep the 28x28 square chip.
    expect(badge?.props.className).toMatch(/size-7!/);
    expect(badge?.props.className).toMatch(/px-0!/);
  });

  it('omits the icon slot entirely when no icon is supplied', () => {
    const tree = RowIdentityCell({ label: 'Acme', href: '/x' }) as AnyEl;
    const badge = walk(tree).find((el) => el.props['aria-hidden'] === true);
    expect(badge).toBeUndefined();
  });

  it('renders the sublabel in zinc-500 when provided, and omits it otherwise', () => {
    const withSublabel = RowIdentityCell({
      label: 'Acme',
      href: '/x',
      sublabel: 'Toronto · archived',
    }) as AnyEl;
    expect(findByText(withSublabel, 'Toronto · archived')).toBeDefined();

    const withoutSublabel = RowIdentityCell({ label: 'Acme', href: '/x' }) as AnyEl;
    expect(findByText(withoutSublabel, 'Toronto · archived')).toBeUndefined();
  });

  it("defaults iconTone to 'zinc' (Catalyst Badge's own default) when not specified", () => {
    const tree = RowIdentityCell({
      label: 'Acme',
      href: '/x',
      icon: <span>·</span>,
    }) as AnyEl;
    const badge = walk(tree).find((el) => el.props['aria-hidden'] === true);
    expect(badge?.props.color).toBe('zinc');
  });

  it('renders a <button> with onClick instead of a <Link> when href is omitted', () => {
    const onClick = vi.fn();
    const tree = RowIdentityCell({ label: 'Alice Coach', onClick }) as AnyEl;
    // No href anywhere in the tree on the button variant.
    const anyHref = walk(tree).find((el) => el.props.href != null);
    expect(anyHref).toBeUndefined();
    const btn = walk(tree).find(
      (el) => el.props.type === 'button' && typeof el.props.onClick === 'function',
    );
    expect(btn).toBeDefined();
    expect(btn?.props.onClick).toBe(onClick);
    expect(btn?.props.className).toMatch(/decoration-dotted/);
  });
});
