import { describe, expect, it } from 'vitest';
import { classifyTwilioWebhook, isStopMessage, STATUS_RANK } from './webhook-events';

describe('classifyTwilioWebhook', () => {
  it('classifies a status callback and maps Twilio statuses onto the ledger enum', () => {
    expect(
      classifyTwilioWebhook({ MessageSid: 'SM1', MessageStatus: 'delivered' }),
    ).toEqual({ kind: 'status', messageSid: 'SM1', status: 'delivered', errorCode: null });
    expect(
      classifyTwilioWebhook({ MessageSid: 'SM1', MessageStatus: 'sending' }),
    ).toMatchObject({ kind: 'status', status: 'queued' });
    expect(
      classifyTwilioWebhook({ MessageSid: 'SM1', MessageStatus: 'accepted' }),
    ).toMatchObject({ kind: 'status', status: 'queued' });
    expect(
      classifyTwilioWebhook({
        MessageSid: 'SM1',
        MessageStatus: 'undelivered',
        ErrorCode: '30007',
      }),
    ).toEqual({ kind: 'status', messageSid: 'SM1', status: 'undelivered', errorCode: '30007' });
  });

  it('ignores unknown statuses and sid-less callbacks instead of guessing', () => {
    expect(
      classifyTwilioWebhook({ MessageSid: 'SM1', MessageStatus: 'exploded' }),
    ).toMatchObject({ kind: 'ignored' });
    expect(classifyTwilioWebhook({ MessageStatus: 'delivered' })).toMatchObject({
      kind: 'ignored',
    });
  });

  it('classifies an inbound message (SmsStatus=received)', () => {
    expect(
      classifyTwilioWebhook({
        SmsStatus: 'received',
        From: '+19025551234',
        Body: 'STOP',
        MessageSid: 'SM_in',
      }),
    ).toEqual({ kind: 'inbound', messageSid: 'SM_in', from: '+19025551234', body: 'STOP' });
  });

  it('ignores an unrecognized shape', () => {
    expect(classifyTwilioWebhook({ Foo: 'bar' })).toMatchObject({ kind: 'ignored' });
  });
});

describe('isStopMessage', () => {
  it('matches the CTIA keyword set as whole messages, case-insensitively', () => {
    for (const body of ['STOP', 'stop', ' Stop ', 'STOP.', 'stop!!', 'UNSUBSCRIBE', 'stopall', 'Cancel', 'END', 'quit']) {
      expect(isStopMessage(body), body).toBe(true);
    }
  });

  it('does not match keywords embedded in longer messages', () => {
    for (const body of ['please stop texting me', 'when does the sale end', 'stop it now', '']) {
      expect(isStopMessage(body), body).toBe(false);
    }
  });
});

describe('STATUS_RANK', () => {
  it('orders queued < sent < terminal states, terminals tied', () => {
    expect(STATUS_RANK.queued).toBeLessThan(STATUS_RANK.sent);
    expect(STATUS_RANK.sent).toBeLessThan(STATUS_RANK.delivered);
    expect(STATUS_RANK.delivered).toBe(STATUS_RANK.failed);
    expect(STATUS_RANK.delivered).toBe(STATUS_RANK.undelivered);
  });
});
