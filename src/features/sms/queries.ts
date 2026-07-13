import 'server-only';

import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  campaigns,
  dealers,
  smsMessages,
  smsOptOuts,
  smsRecipients,
  smsSends,
} from '@/lib/db/schema';
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
