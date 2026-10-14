export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
}

export const defaultRetry: RetryOptions = { retries: 4, baseDelayMs: 250, maxDelayMs: 8000, timeoutMs: 10000 };

export class HttpError extends Error {
  constructor(public status: number, public body: string, public retryable: boolean) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 408, 425, 429 and 5xx are worth retrying; other 4xx mean the request itself is wrong. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Exponential backoff with full jitter, honouring Retry-After when the server sends it. */
export function backoffDelay(attempt: number, opts: RetryOptions, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, opts.maxDelayMs);
  }
  const ceiling = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

/**
 * fetch() with a per-attempt timeout and retries on transient failures
 * (network errors, timeouts, 408/425/429/5xx). Non-retryable responses throw immediately.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = defaultRetry,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.ok) return res;
      const body = await res.text();
      const retryable = isRetryableStatus(res.status);
      lastError = new HttpError(res.status, body, retryable);
      if (!retryable || attempt === opts.retries) throw lastError;
      await sleep(backoffDelay(attempt, opts, res.headers.get("retry-after")));
    } catch (err) {
      if (err instanceof HttpError && (!err.retryable || attempt === opts.retries)) throw err;
      lastError = err;
      if (attempt === opts.retries) break;
      if (!(err instanceof HttpError)) await sleep(backoffDelay(attempt, opts));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
