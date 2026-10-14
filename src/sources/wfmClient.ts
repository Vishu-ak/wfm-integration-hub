import { fetchWithRetry, type RetryOptions, defaultRetry } from "../http.js";
import type { Page, WfmEmployee, WfmTimecard } from "../types.js";

/** Minimal client for a UKG-style WFM REST API: bearer auth and cursor pagination. */
export class WfmClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private retry: RetryOptions = defaultRetry,
  ) {}

  private async get<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    const res = await fetchWithRetry(
      url.toString(),
      { headers: { authorization: `Bearer ${this.token}`, accept: "application/json" } },
      this.retry,
    );
    return (await res.json()) as T;
  }

  async *employees(pageSize = 100): AsyncGenerator<WfmEmployee> {
    let cursor: string | undefined;
    do {
      const page = await this.get<Page<WfmEmployee>>("/api/v1/employees", { limit: String(pageSize), cursor });
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  /** Timecards changed after `since`, page by page, so the caller can checkpoint after each page. */
  async *timecardPages(since: string | null, pageSize = 100): AsyncGenerator<Page<WfmTimecard>> {
    let cursor: string | undefined;
    do {
      const page = await this.get<Page<WfmTimecard>>("/api/v1/timecards", {
        limit: String(pageSize),
        updatedSince: since ?? undefined,
        cursor,
      });
      yield page;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
}
