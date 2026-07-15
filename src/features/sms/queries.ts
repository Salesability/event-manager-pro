import 'server-only';

import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsRecipients,
  smsSends,
  smsThreads,
} from '@/lib/db/schema';
import { compareFingerprints } from '@/lib/sms/identity';
import { smsEligibility, type SmsEligibility } from './eligibility';

// Accept either the app pool or a transaction so `launchSmsSend` can evaluate
// inside its tx and the integration test can drive a rolled-back run
// (cf. campaign-delivery.ts / accept-gate.ts).
type Database = typeof db;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export type EvaluatedRecipient = {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  consentBasis: 'express' | 'implied_purchase' | 'implied_inquiry';
  lastContactAt: string | null;
  identityHmac: string | null;
  eligibility: SmsEligibility;
};

export type RecipientEvaluation = {
  recipients: EvaluatedRecipient[];
  summary: {
    total: number;
    eligible: number;
    excludedOptOut: number;
    excludedStaleConsent: number;
  };
};

// The single source for "who would this send actually go to" — the pre-send
// review summary (intent success criterion: exclusions visible with reasons)
// and `launchSmsSend`'s exclusion pass both call this, so the panel can never
// promise a different audience than the launch delivers.
export async function evaluateCampaignRecipients(
  campaignId: number,
  now: Date = new Date(),
  exec: Executor = db,
): Promise<RecipientEvaluation> {
  const rows = await exec
    .select({
      id: smsRecipients.id,
      phone: smsRecipients.phone,
      firstName: smsRecipients.firstName,
      lastName: smsRecipients.lastName,
      consentBasis: smsRecipients.consentBasis,
      lastContactAt: smsRecipients.lastContactAt,
      identityHmac: smsRecipients.identityHmac,
    })
    .from(smsRecipients)
    .where(eq(smsRecipients.campaignId, campaignId));

  const optedOut = new Set<string>();
  if (rows.length) {
    const optOutRows = await exec
      .select({ phone: smsOptOuts.phone })
      .from(smsOptOuts)
      .where(
        inArray(
          smsOptOuts.phone,
          rows.map((r) => r.phone),
        ),
      );
    for (const r of optOutRows) optedOut.add(r.phone);
  }

  const recipients: EvaluatedRecipient[] = rows.map((r) => ({
    ...r,
    eligibility: smsEligibility({
      consentBasis: r.consentBasis,
      lastContactAt: r.lastContactAt,
      optedOut: optedOut.has(r.phone),
      now,
    }),
  }));

  const summary = {
    total: recipients.length,
    eligible: recipients.filter((r) => r.eligibility.eligible).length,
    excludedOptOut: recipients.filter(
      (r) => !r.eligibility.eligible && r.eligibility.reason === 'opted_out',
    ).length,
    excludedStaleConsent: recipients.filter(
      (r) => !r.eligibility.eligible && r.eligibility.reason === 'stale_consent',
    ).length,
  };

  return { recipients, summary };
}

export type SmsSendLogEntry = {
  id: number;
  body: string;
  createdAt: Date;
  totalRecipients: number;
  excludedOptOut: number;
  excludedStaleConsent: number;
  messageCounts: Record<string, number>;
};

// Send log for the campaign panel: one entry per launch with per-status
// message tallies (queued/sent/delivered/undelivered/failed).
export async function loadSmsSendLog(campaignId: number): Promise<SmsSendLogEntry[]> {
  const sends = await db
    .select({
      id: smsSends.id,
      body: smsSends.body,
      createdAt: smsSends.createdAt,
      totalRecipients: smsSends.totalRecipients,
      excludedOptOut: smsSends.excludedOptOut,
      excludedStaleConsent: smsSends.excludedStaleConsent,
    })
    .from(smsSends)
    .where(eq(smsSends.campaignId, campaignId))
    .orderBy(desc(smsSends.createdAt));

  if (!sends.length) return [];

  const counts = await db
    .select({
      sendId: smsMessages.sendId,
      status: smsMessages.status,
      count: sql<number>`count(*)::int`,
    })
    .from(smsMessages)
    .where(
      inArray(
        smsMessages.sendId,
        sends.map((s) => s.id),
      ),
    )
    .groupBy(smsMessages.sendId, smsMessages.status);

  return sends.map((s) => ({
    ...s,
    messageCounts: Object.fromEntries(
      counts.filter((c) => c.sendId === s.id).map((c) => [c.status, c.count]),
    ),
  }));
}

export type RecipientHistoryEntry = {
  phone: string;
  priorCount: number;
  lastStatus: string;
  lastAt: Date;
  /** Person-continuity verdict (0105): the current import's fingerprint vs the
   *  most recent historical send to this number for this dealer. `matches` =
   *  same name-on-number as before; `differs` = likely recycled number or a
   *  name change — treat inherited history/consent with suspicion; `unknown` =
   *  no fingerprint on one side (nameless row, unset key, or pre-0105 rows). */
  identity: 'matches' | 'differs' | 'unknown';
};

// Dealer-scoped prior-send history for a campaign's recipients (0105) — the
// re-linking read that makes the purge survivable: `sms_messages.phone` joins
// history regardless of whether the original recipient rows still exist, and
// the dealer scope rides `sms_sends → campaigns.dealer_id` (never the purged
// recipient). Only phones WITH history are returned; sends for the given
// campaign itself count too (a second launch sees the first).
export async function loadRecipientHistory(
  campaignId: number,
  exec: Executor = db,
): Promise<RecipientHistoryEntry[]> {
  const [campaign] = await exec
    .select({ dealerId: campaigns.dealerId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return [];

  const current = await exec
    .select({ phone: smsRecipients.phone, identityHmac: smsRecipients.identityHmac })
    .from(smsRecipients)
    .where(eq(smsRecipients.campaignId, campaignId));
  if (!current.length) return [];

  const history = await exec
    .select({
      phone: smsMessages.phone,
      status: smsMessages.status,
      createdAt: smsMessages.createdAt,
      identityHmac: smsMessages.identityHmac,
    })
    .from(smsMessages)
    .innerJoin(smsSends, eq(smsSends.id, smsMessages.sendId))
    .innerJoin(campaigns, eq(campaigns.id, smsSends.campaignId))
    .where(
      and(
        eq(campaigns.dealerId, campaign.dealerId),
        inArray(
          smsMessages.phone,
          current.map((r) => r.phone),
        ),
      ),
    )
    .orderBy(desc(smsMessages.createdAt));

  const currentByPhone = new Map(current.map((r) => [r.phone, r.identityHmac]));
  const entries = new Map<string, RecipientHistoryEntry>();
  for (const row of history) {
    const existing = entries.get(row.phone);
    if (existing) {
      existing.priorCount++;
      continue;
    }
    // First row per phone is the most recent (desc order) — it carries the
    // last outcome and the fingerprint the continuity check compares against.
    // `compareFingerprints` handles the key-rotation case (different key ids
    // read as `unknown`, never a false "differs").
    entries.set(row.phone, {
      phone: row.phone,
      priorCount: 1,
      lastStatus: row.status,
      lastAt: row.createdAt,
      identity: compareFingerprints(
        currentByPhone.get(row.phone) ?? null,
        row.identityHmac,
      ),
    });
  }
  return [...entries.values()];
}

export type SmsCampaignContext = {
  id: number;
  status: string;
  smsEmail: number | null;
  dealerName: string;
};

// Campaign facts the SMS surface needs: the D1 gate reads `smsEmail > 0`
// (digital touches on the accepted quote = the add-on is bought) and the
// launch guard requires `status === 'booked'`.
export async function loadSmsCampaignContext(
  campaignId: number,
  exec: Executor = db,
): Promise<SmsCampaignContext | null> {
  const [row] = await exec
    .select({
      id: campaigns.id,
      status: campaigns.status,
      smsEmail: campaigns.smsEmail,
      dealerName: dealers.name,
    })
    .from(campaigns)
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return row ?? null;
}

export type SmsCampaignIndexRow = {
  campaignId: number;
  dealerName: string;
  startDate: string;
  endDate: string;
  status: 'draft' | 'booked' | 'cancelled' | 'completed';
  /** The 0103 D1 add-on gate is live right now (booked + smsEmail > 0) — the
   *  composer works; false rows are history-only (send log + replies). */
  gateActive: boolean;
  recipientCount: number;
  sendCount: number;
  lastSendAt: Date | null;
  threadCount: number;
  unreadThreads: number;
};

// Global campaign index for the /sms tab (0109): one row per SMS-relevant
// campaign — gate-active (the add-on gate above) ∪ has-history (sends or
// threads exist), owner call 2026-07-15 — so a completed event's ledger and
// replies keep a door after the launch gate lapses. Aggregates are scalar
// subselects: the qualifying set is campaigns (tens), not messages.
export async function loadSmsCampaignIndex(): Promise<SmsCampaignIndexRow[]> {
  const hasSends = sql`exists (select 1 from ${smsSends} where ${smsSends.campaignId} = ${campaigns.id})`;
  const hasThreads = sql`exists (select 1 from ${smsThreads} where ${smsThreads.campaignId} = ${campaigns.id})`;

  const rows = await db
    .select({
      campaignId: campaigns.id,
      dealerName: dealers.name,
      startDate: campaigns.startDate,
      endDate: campaigns.endDate,
      status: campaigns.status,
      smsEmail: campaigns.smsEmail,
      recipientCount: sql<number>`(select count(*)::int from ${smsRecipients} where ${smsRecipients.campaignId} = ${campaigns.id})`,
      sendCount: sql<number>`(select count(*)::int from ${smsSends} where ${smsSends.campaignId} = ${campaigns.id})`,
      lastSendAt: sql<Date | null>`(select max(${smsSends.createdAt}) from ${smsSends} where ${smsSends.campaignId} = ${campaigns.id})`.mapWith(
        (v) => (v == null ? null : new Date(v)),
      ),
      threadCount: sql<number>`(select count(*)::int from ${smsThreads} where ${smsThreads.campaignId} = ${campaigns.id})`,
      // Same unread derivation as the inbox (last_inbound_at > read pointer).
      unreadThreads: sql<number>`(select count(*)::int from ${smsThreads} where ${smsThreads.campaignId} = ${campaigns.id} and ${smsThreads.lastInboundAt} > coalesce(${smsThreads.lastReadAt}, '-infinity'))`,
    })
    .from(campaigns)
    .innerJoin(dealers, eq(dealers.id, campaigns.dealerId))
    .where(
      or(
        and(eq(campaigns.status, 'booked'), sql`${campaigns.smsEmail} > 0`),
        hasSends,
        hasThreads,
      ),
    )
    .orderBy(desc(campaigns.startDate), desc(campaigns.id));

  return rows.map((r) => ({
    campaignId: r.campaignId,
    dealerName: r.dealerName,
    startDate: r.startDate,
    endDate: r.endDate,
    status: r.status,
    gateActive: r.status === 'booked' && (r.smsEmail ?? 0) > 0,
    recipientCount: r.recipientCount,
    sendCount: r.sendCount,
    lastSendAt: r.lastSendAt,
    threadCount: r.threadCount,
    unreadThreads: r.unreadThreads,
  }));
}
