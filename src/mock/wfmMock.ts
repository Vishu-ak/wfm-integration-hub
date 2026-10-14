import { createServer, type Server } from "node:http";
import type { WfmEmployee, WfmTimecard } from "../types.js";

export interface WfmMockOptions {
  employees: WfmEmployee[];
  timecards: WfmTimecard[];
  token: string;
  /** Fail every Nth request with 503 to exercise retries. 0 = never. */
  failEvery?: number;
}

/** A tiny stand-in for a UKG-style WFM API, used for local demos and tests. */
export function createWfmMock(opts: WfmMockOptions): Server {
  let count = 0;
  return createServer((req, res) => {
    count++;
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${opts.token}`) return json(401, { error: "unauthorized" });
    if (opts.failEvery && count % opts.failEvery === 0) return json(503, { error: "temporarily unavailable" });

    const limit = Number(url.searchParams.get("limit") ?? 100);
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    const page = <T>(all: T[]) => {
      const items = all.slice(offset, offset + limit);
      return { items, nextCursor: offset + limit < all.length ? String(offset + limit) : null };
    };

    if (url.pathname === "/api/v1/employees") return json(200, page(opts.employees));
    if (url.pathname === "/api/v1/timecards") {
      const since = url.searchParams.get("updatedSince");
      const filtered = opts.timecards
        .filter((t) => !since || t.updatedAt >= since)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      return json(200, page(filtered));
    }
    return json(404, { error: "not found" });
  });
}
