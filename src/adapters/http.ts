import { setTimeout as sleep } from "node:timers/promises";

export type Fetch = typeof fetch;

/** A non-retryable failure or an exhausted retry budget; callers treat it as transient. */
export class SourceError extends Error {
  constructor(
    readonly source: string,
    readonly status: number | null,
    message: string,
  ) {
    super(`${source}: ${message}`);
  }
}

/**
 * GET with retry on 429 (honouring Retry-After) and 5xx. Returns null on 404
 * so callers can record a definitive miss.
 */
export async function getJson<T>(
  source: string,
  url: string,
  { fetchFn = fetch, tries = 4 }: { fetchFn?: Fetch; tries?: number } = {},
): Promise<T | null> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(url, { signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      if (attempt === tries - 1) throw new SourceError(source, null, String(e));
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) return null;
    last = res;
    if (res.status !== 429 && res.status < 500) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
  }
  throw new SourceError(source, last?.status ?? null, `HTTP ${last?.status} for ${url}`);
}
