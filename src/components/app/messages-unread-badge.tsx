'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getInboxUnreadCount } from '@/features/sms/actions';
import { toLegacyResult } from '@/lib/actions/legacy-result';
import { UnreadCountPill } from './unread-count-pill';

// Live unread badge on the Messages nav tab (0107). Polls the sms:send-gated
// count action on an interval (intent: updates within ~a minute of a new
// inbound) and re-polls on every route change, so reading a thread on
// /messages drops the count as soon as you navigate. Only mounts for users
// who see the Messages tab, so the poll never fires without the capability.

const POLL_MS = 45_000;

export function MessagesUnreadBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const result = toLegacyResult<{ ok: true; count: number }>(
          await getInboxUnreadCount(new FormData()),
        );
        if (alive && 'ok' in result) setCount(result.count);
      } catch {
        // Transient poll failure (offline, deploy blip) — keep the last count.
      }
    }
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pathname]);

  return <UnreadCountPill count={count} />;
}
