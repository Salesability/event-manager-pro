'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/catalyst/tabs';

// Dealers / Items switcher for /admin/quickbooks (chunk 0083). The ONLY client
// piece on the page: the panels are server-rendered (the dealer reconcile table
// and the catalog + item diff) and passed in as props, so no table rendering or
// data fetching crosses the client boundary — just the active-tab `useState`.
// Mirrors `reports-tabs.tsx`'s use of the Catalyst `Tabs` primitive.

type TabKey = 'dealers' | 'items';

export function QuickbooksTabs({
  dealers,
  items,
}: {
  dealers: React.ReactNode;
  items: React.ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>('dealers');

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
      <TabsList aria-label="QuickBooks detail">
        <TabsTrigger value="dealers">Dealers</TabsTrigger>
        <TabsTrigger value="items">Items</TabsTrigger>
      </TabsList>
      <TabsContent value="dealers">{dealers}</TabsContent>
      <TabsContent value="items">{items}</TabsContent>
    </Tabs>
  );
}
