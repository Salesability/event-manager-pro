import 'server-only';
import { Storage, type StorageOptions } from '@google-cloud/storage';

export type PutInput = {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
};

export type GetResult = { ok: true; body: Buffer } | { error: string };
export type PutResult = { ok: true; key: string } | { error: string };
export type SignedUrlResult = { ok: true; url: string } | { error: string };

// 7-day cap on signed-URL TTL — anything customer-facing should be re-issued
// rather than persisted as a long-lived link.
export const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

let cached: Storage | null = null;

function client(): Storage | { error: string } {
  if (cached) return cached;

  // projectId is optional: when unset, the Storage client infers it from
  // ADC / workload identity. Setting it is only useful for cross-project
  // access or to make the active project explicit in local dev.
  const opts: StorageOptions = {};
  const projectId = process.env.GCS_PROJECT_ID;
  if (projectId) opts.projectId = projectId;

  // Two credential paths:
  //   - GCS_CREDENTIALS_JSON: inline service-account JSON (12-factor friendly,
  //     used for Cloud Run env-injection or local dev without files).
  //   - Otherwise: fall through to Google ADC, which finds creds via
  //     GOOGLE_APPLICATION_CREDENTIALS or workload identity on GCP runtime.
  const inline = process.env.GCS_CREDENTIALS_JSON;
  if (inline) {
    try {
      opts.credentials = JSON.parse(inline);
    } catch {
      return { error: 'GCS_CREDENTIALS_JSON is not valid JSON.' };
    }
  }

  cached = new Storage(opts);
  return cached;
}

export async function putObject(input: PutInput): Promise<PutResult> {
  const storage = client();
  if ('error' in storage) return storage;
  try {
    const file = storage.bucket(input.bucket).file(input.key);
    await file.save(input.body, {
      contentType: input.contentType,
      resumable: false,
    });
    return { ok: true, key: input.key };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'GCS putObject failed.' };
  }
}

export async function getObject(bucket: string, key: string): Promise<GetResult> {
  const storage = client();
  if ('error' in storage) return storage;
  try {
    const [body] = await storage.bucket(bucket).file(key).download();
    return { ok: true, body };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'GCS getObject failed.' };
  }
}

export async function signedUrl(
  bucket: string,
  key: string,
  ttlSeconds: number,
): Promise<SignedUrlResult> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return { error: 'ttlSeconds must be a positive finite number.' };
  }
  const ttl = Math.min(Math.floor(ttlSeconds), MAX_SIGNED_URL_TTL_SECONDS);
  const storage = client();
  if ('error' in storage) return storage;
  try {
    const [url] = await storage.bucket(bucket).file(key).getSignedUrl({
      action: 'read',
      expires: Date.now() + ttl * 1000,
      version: 'v4',
    });
    return { ok: true, url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'GCS signedUrl failed.' };
  }
}
