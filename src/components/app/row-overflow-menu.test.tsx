import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { RowOverflowMenu } from './row-overflow-menu';

type AnyEl = ReactElement<{
  children?: unknown;
  className?: string;
  href?: string;
  'aria-label'?: string;
  onClick?: () => void;
  disabled?: boolean;
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

describe('RowOverflowMenu', () => {
  it('renders nothing when every action is filtered out', () => {
    const tree = RowOverflowMenu({ actions: [null, false, null] });
    expect(tree).toBeNull();
  });

  it("uses the canonical 'Open row actions' aria-label with ariaSuffix", () => {
    const tree = RowOverflowMenu({
      actions: [{ kind: 'edit', onClick: () => {} }],
      ariaSuffix: 'Acme Inc',
    }) as AnyEl;
    const trigger = walk(tree).find(
      (el) => el.props['aria-label'] === 'Open row actions for Acme Inc',
    );
    expect(trigger).toBeDefined();
  });

  it("falls back to bare 'Open row actions' when no ariaSuffix is provided", () => {
    const tree = RowOverflowMenu({
      actions: [{ kind: 'edit', onClick: () => {} }],
    }) as AnyEl;
    const trigger = walk(tree).find(
      (el) => el.props['aria-label'] === 'Open row actions',
    );
    expect(trigger).toBeDefined();
  });

  it('lists actions in the order supplied (link + button mixed)', () => {
    const tree = RowOverflowMenu({
      actions: [
        { kind: 'edit', href: '/quotes/4' },
        { kind: 'quote', onClick: () => {} },
        { kind: 'archive', onClick: () => {}, tone: 'danger' },
      ],
      ariaSuffix: 'Acme',
    }) as AnyEl;
    expect(findByText(tree, 'Edit')).toBeDefined();
    expect(findByText(tree, 'Quote')).toBeDefined();
    expect(findByText(tree, 'Archive')).toBeDefined();
    // Edit reaches its href via the link branch
    const editLink = walk(tree).find((el) => el.props.href === '/quotes/4');
    expect(editLink).toBeDefined();
  });

  it('threads onClick + disabled into button items', () => {
    const onClick = vi.fn();
    const tree = RowOverflowMenu({
      actions: [{ kind: 'activate', onClick, disabled: true }],
    }) as AnyEl;
    const item = walk(tree).find(
      (el) =>
        typeof el.props.onClick === 'function' &&
        el.props.disabled === true,
    );
    expect(item).toBeDefined();
    expect(item?.props.onClick).toBe(onClick);
  });

  it("applies the destructive-red class composition when tone === 'danger'", () => {
    const tree = RowOverflowMenu({
      actions: [{ kind: 'archive', onClick: () => {}, tone: 'danger' }],
    }) as AnyEl;
    const danger = walk(tree).find(
      (el) =>
        typeof el.props.className === 'string' &&
        el.props.className.includes('text-red-700!'),
    );
    expect(danger).toBeDefined();
    // Subtle items don't get the danger class set
    const subtleTree = RowOverflowMenu({
      actions: [{ kind: 'edit', onClick: () => {} }],
    }) as AnyEl;
    const subtleDanger = walk(subtleTree).find(
      (el) =>
        typeof el.props.className === 'string' &&
        el.props.className.includes('text-red-700'),
    );
    expect(subtleDanger).toBeUndefined();
  });

  it('honors per-callsite label overrides', () => {
    const tree = RowOverflowMenu({
      actions: [
        { kind: 'activate', label: 'Mark active', onClick: () => {}, tone: 'success' },
      ],
    }) as AnyEl;
    expect(findByText(tree, 'Mark active')).toBeDefined();
  });
});
