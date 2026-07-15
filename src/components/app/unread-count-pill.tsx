// Count pill for the Messages nav tab (0107). Hook-free and import-light so
// the node-env render test can call it as a plain function; the polling wire
// lives in messages-unread-badge.tsx. Red on purpose — the inbox exists so
// unread replies (and soon, AI reply approvals) cannot be missed.
export function UnreadCountPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread`}
      className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-semibold leading-5 text-white"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
