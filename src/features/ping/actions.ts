'use server';

export async function ping(): Promise<string> {
  return new Date().toISOString();
}
