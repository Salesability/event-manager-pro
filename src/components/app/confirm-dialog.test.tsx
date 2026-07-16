import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ConfirmDialog, type ConfirmOptions } from './confirm-dialog';

type AnyEl = ReactElement<{
  children?: unknown;
  color?: string;
  destructive?: boolean;
  outline?: boolean;
  onClick?: () => void;
  open?: boolean;
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

function render(options: ConfirmOptions, onResolve = vi.fn()) {
  const tree = ConfirmDialog({ open: true, options, onResolve }) as AnyEl;
  return { tree, onResolve };
}

describe('ConfirmDialog', () => {
  it('renders title, message, and default button labels', () => {
    const { tree } = render({ title: 'Launch send?', message: '3 recipients.' });
    expect(findByText(tree, 'Launch send?')).toBeDefined();
    expect(findByText(tree, '3 recipients.')).toBeDefined();
    expect(findByText(tree, 'Cancel')).toBeDefined();
    expect(findByText(tree, 'Confirm')).toBeDefined();
  });

  it('honors label overrides and omits the description when no message', () => {
    const { tree } = render({
      title: 'Cancel campaign?',
      confirmLabel: 'Cancel campaign',
      cancelLabel: 'Keep it',
    });
    expect(findByText(tree, 'Cancel campaign')).toBeDefined();
    expect(findByText(tree, 'Keep it')).toBeDefined();
    expect(findByText(tree, 'Confirm')).toBeUndefined();
  });

  it('uses the brand primary for non-destructive confirms', () => {
    const { tree } = render({ title: 'Send?' });
    const confirmBtn = findByText(tree, 'Confirm');
    expect(confirmBtn?.props.color).toBe('brand');
    expect(confirmBtn?.props.destructive).toBeUndefined();
  });

  it('uses the soft-red destructive variant when destructive', () => {
    const { tree } = render({ title: 'Remove?', destructive: true });
    const confirmBtn = findByText(tree, 'Confirm');
    expect(confirmBtn?.props.destructive).toBe(true);
    expect(confirmBtn?.props.color).toBeUndefined();
  });

  it('resolves false from Cancel and true from the confirm action', () => {
    const { tree, onResolve } = render({ title: 'Sure?' });
    findByText(tree, 'Cancel')?.props.onClick?.();
    expect(onResolve).toHaveBeenLastCalledWith(false);
    findByText(tree, 'Confirm')?.props.onClick?.();
    expect(onResolve).toHaveBeenLastCalledWith(true);
  });

  it('passes open through to the Alert and closes as resolve(false)', () => {
    const { tree, onResolve } = render({ title: 'Sure?' });
    expect(tree.props.open).toBe(true);
    const onClose = (tree.props as { onClose?: () => void }).onClose;
    onClose?.();
    expect(onResolve).toHaveBeenLastCalledWith(false);
  });
});
