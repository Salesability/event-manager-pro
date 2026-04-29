'use client';

import { useState, useTransition } from 'react';
import { ping } from './actions';

export function Ping() {
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            setResult(await ping());
          })
        }
        disabled={isPending}
        className="rounded-md border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {isPending ? 'Pinging…' : 'Ping the server'}
      </button>
      {result && (
        <p className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
          Server time: <span className="text-zinc-900 dark:text-zinc-100">{result}</span>
        </p>
      )}
    </div>
  );
}
