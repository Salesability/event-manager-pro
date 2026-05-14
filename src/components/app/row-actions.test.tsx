import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { RowActions } from './row-actions';

type AnyEl = ReactElement<{
  children?: unknown;
  className?: string;
  href?: string;
  'aria-label'?: string;
  onClick?: () => void;
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

describe('RowActions', () => {
  it('renders nothing when every action is filtered out', () => {
    const tree = RowActions({ actions: [null, false, null] });
    expect(tree).toBeNull();
  });

  it('renders a link with canonical View label when given href', () => {
    const tree = RowActions({
      actions: [{ kind: 'view', href: '/quotes/123', ariaSuffix: "Acme's quote" }],
    }) as AnyEl;
    const label = findByText(tree, 'View');
    expect(label).toBeDefined();
    // Find the wrapping Link element (carries href + aria-label)
    const link = walk(tree).find((el) => el.props.href === '/quotes/123');
    expect(link).toBeDefined();
    expect(link?.props['aria-label']).toBe("View Acme's quote");
  });

  it('renders a button with onClick + aria-label for button actions', () => {
    const onClick = vi.fn();
    const tree = RowActions({
      actions: [{ kind: 'edit', onClick, ariaSuffix: 'Acme' }],
    }) as AnyEl;
    const btn = walk(tree).find(
      (el) => el.type === 'button' && el.props['aria-label'] === 'Edit Acme',
    );
    expect(btn).toBeDefined();
    expect(typeof btn?.props.onClick).toBe('function');
  });

  it('filters out null/false entries so callers can inline conditional actions', () => {
    const tree = RowActions({
      actions: [
        { kind: 'view', href: '/x' },
        null,
        false,
        { kind: 'archive', onClick: () => {}, tone: 'danger' },
      ],
    }) as AnyEl;
    expect(findByText(tree, 'View')).toBeDefined();
    expect(findByText(tree, 'Archive')).toBeDefined();
  });

  it('applies the danger tone class for archive-style actions', () => {
    const tree = RowActions({
      actions: [{ kind: 'archive', onClick: () => {}, tone: 'danger' }],
    }) as AnyEl;
    const btn = walk(tree).find((el) => el.type === 'button');
    expect(btn?.props.className).toMatch(/text-red-700/);
  });

  it('honors a per-callsite label override', () => {
    const tree = RowActions({
      actions: [
        { kind: 'activate', label: 'Mark active', onClick: () => {}, tone: 'success' },
      ],
    }) as AnyEl;
    expect(findByText(tree, 'Mark active')).toBeDefined();
    // Override is reflected in aria-label too
    const btn = walk(tree).find(
      (el) => el.type === 'button' && el.props['aria-label'] === 'Mark active',
    );
    expect(btn).toBeDefined();
  });
});
