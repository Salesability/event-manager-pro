import 'server-only';
import { db } from '@/lib/db';
import { quickbooksConnection } from '@/lib/db/schema';
import { decrypt, encrypt } from '@/lib/crypto/sealed-box';
import { type QboTokens, refreshTokens } from './client';

// Persistence + token lifecycle for the single QuickBooks connection (chunk
// 0068). Reads/writes the `quickbooks_connection` singleton, encrypting tokens
// at rest via `sealed-box`. The HTTP calls themselves live in `./client.ts`.

// Refresh the access token this many ms BEFORE its real expiry, so a request
// that starts just under the wire still gets a live token.
const EXPIRY_SKEW_MS = 60_000;

export type QboConnection = {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  connectedById: string | null;
  updatedAt: Date;
};

// Pure: turn a token response's lifetimes into absolute expiry instants.
export function computeExpiry(
  tokens: QboTokens,
  now: Date = new Date(),
): { accessTokenExpiresAt: Date; refreshTokenExpiresAt: Date } {
  return {
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
    refreshTokenExpiresAt: new Date(now.getTime() + tokens.refreshTokenExpiresIn * 1000),
  };
}

// Pure: is the access token still good (outside the refresh skew window)?
export function accessTokenFresh(
  expiresAt: Date,
  now: Date = new Date(),
  skewMs: number = EXPIRY_SKEW_MS,
): boolean {
  return expiresAt.getTime() - now.getTime() > skewMs;
}

export async function getConnection(): Promise<QboConnection | null> {
  const rows = await db.select().from(quickbooksConnection).limit(1);
  const row = rows[0];
  if (!row) return null;
  // An environment that ships QuickBooks dormant has no QBO_TOKEN_ENC_KEY (e.g.
  // a stage service that shares the sandbox DB, which may still hold a leftover
  // connection row from QBO testing). Without the key, `decrypt` below throws
  // "QBO_TOKEN_ENC_KEY is not set" — which would crash *every* page that reads
  // the connection (the quote + dealer pages call getConnection on render).
  // Treat an undecryptable connection as not-connected so QBO simply stays
  // dormant rather than 500ing unrelated pages. Mirrors sealed-box's own check.
  if (!process.env.QBO_TOKEN_ENC_KEY?.trim()) return null;
  return {
    realmId: row.realmId,
    accessToken: decrypt(row.accessTokenEnc),
    refreshToken: decrypt(row.refreshTokenEnc),
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt,
    connectedById: row.connectedById,
    updatedAt: row.updatedAt,
  };
}

type SaveInput = {
  realmId: string;
  tokens: QboTokens;
  connectedById: string | null;
  now?: Date;
};

// Upsert the singleton row, encrypting both tokens. The UNIQUE on `singleton`
// makes `onConflictDoUpdate` collapse to the one row no matter how many connects
// happen.
export async function saveConnection({
  realmId,
  tokens,
  connectedById,
  now = new Date(),
}: SaveInput): Promise<void> {
  const { accessTokenExpiresAt, refreshTokenExpiresAt } = computeExpiry(tokens, now);
  const accessTokenEnc = encrypt(tokens.accessToken);
  const refreshTokenEnc = encrypt(tokens.refreshToken);
  await db
    .insert(quickbooksConnection)
    .values({
      singleton: true,
      realmId,
      accessTokenEnc,
      refreshTokenEnc,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      connectedById,
    })
    .onConflictDoUpdate({
      target: quickbooksConnection.singleton,
      set: { realmId, accessTokenEnc, refreshTokenEnc, accessTokenExpiresAt, refreshTokenExpiresAt, connectedById },
    });
}

export async function deleteConnection(): Promise<void> {
  await db.delete(quickbooksConnection);
}

// Returns a live access token (+ realm), refreshing and persisting the ROTATED
// refresh token when the current access token is within the skew window. Throws
// if QuickBooks isn't connected.
export async function getValidAccessToken(
  now: Date = new Date(),
): Promise<{ realmId: string; accessToken: string }> {
  const conn = await getConnection();
  if (!conn) throw new Error('QuickBooks is not connected.');
  if (accessTokenFresh(conn.accessTokenExpiresAt, now)) {
    return { realmId: conn.realmId, accessToken: conn.accessToken };
  }
  const tokens = await refreshTokens(conn.refreshToken);
  await saveConnection({ realmId: conn.realmId, tokens, connectedById: conn.connectedById, now });
  return { realmId: conn.realmId, accessToken: tokens.accessToken };
}
