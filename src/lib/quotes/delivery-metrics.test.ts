import { describe, expect, it } from 'vitest';
import {
  BASE_EVENT_RECORDS,
  deriveDeliveryMetrics,
  type DeliveryLine,
} from './delivery-metrics';

describe('deriveDeliveryMetrics — SKU → campaign delivery-metric mapping (0094 D1)', () => {
  it('returns all-zero for an empty quote', () => {
    expect(deriveDeliveryMetrics([])).toEqual({
      qtyRecords: 0,
      smsEmail: 0,
      letters: 0,
      bdc: 0,
    });
  });

  it('maps each touch SKU onto its own metric by summed qty', () => {
    const lines: DeliveryLine[] = [
      { code: 'bdc-call', qty: 50 },
      { code: 'letter-postage', qty: 20 },
      { code: 'digital-record', qty: 300 },
    ];
    expect(deriveDeliveryMetrics(lines)).toEqual({
      qtyRecords: 0,
      smsEmail: 300,
      letters: 20,
      bdc: 50,
    });
  });

  it('counts the base-event package as 500 records', () => {
    expect(deriveDeliveryMetrics([{ code: 'base-event', qty: 1 }]).qtyRecords).toBe(
      BASE_EVENT_RECORDS,
    );
  });

  it('sums base 500 + additional-contact uplift into qtyRecords', () => {
    const lines: DeliveryLine[] = [
      { code: 'base-event', qty: 1 },
      { code: 'additional-contact', qty: 150 },
    ];
    expect(deriveDeliveryMetrics(lines).qtyRecords).toBe(650);
  });

  it('scales the base by base-event qty (a qty-2 base line is 1000 records)', () => {
    expect(deriveDeliveryMetrics([{ code: 'base-event', qty: 2 }]).qtyRecords).toBe(1000);
  });

  it('sums duplicate lines of the same SKU (rows are delete-and-reinserted, no unique)', () => {
    const lines: DeliveryLine[] = [
      { code: 'bdc-call', qty: 10 },
      { code: 'bdc-call', qty: 15 },
      { code: 'additional-contact', qty: 100 },
      { code: 'additional-contact', qty: 25 },
    ];
    const result = deriveDeliveryMetrics(lines);
    expect(result.bdc).toBe(25);
    expect(result.qtyRecords).toBe(125);
  });

  it('ignores SKUs with no delivery metric (additional-day / record-retrieval / travel) and unknown codes', () => {
    const lines: DeliveryLine[] = [
      { code: 'additional-day', qty: 3 },
      { code: 'record-retrieval', qty: 1 },
      { code: 'travel', qty: 1 },
      { code: 'some-future-sku', qty: 99 },
    ];
    expect(deriveDeliveryMetrics(lines)).toEqual({
      qtyRecords: 0,
      smsEmail: 0,
      letters: 0,
      bdc: 0,
    });
  });

  it('derives a full realistic quote', () => {
    const lines: DeliveryLine[] = [
      { code: 'base-event', qty: 1 },
      { code: 'additional-contact', qty: 350 },
      { code: 'bdc-call', qty: 40 },
      { code: 'letter-postage', qty: 850 },
      { code: 'digital-record', qty: 850 },
      { code: 'additional-day', qty: 1 },
      { code: 'travel', qty: 1 },
    ];
    expect(deriveDeliveryMetrics(lines)).toEqual({
      qtyRecords: 850, // 500 + 350
      smsEmail: 850,
      letters: 850,
      bdc: 40,
    });
  });

  it('coerces a malformed qty to 0 rather than poisoning the sum with NaN', () => {
    const lines: DeliveryLine[] = [
      { code: 'bdc-call', qty: Number.NaN },
      { code: 'bdc-call', qty: -5 },
      { code: 'bdc-call', qty: 12 },
    ];
    expect(deriveDeliveryMetrics(lines).bdc).toBe(12);
  });
});
