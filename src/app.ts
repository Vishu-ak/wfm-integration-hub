import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { replayDeadLetters, runSync, type SyncDeps } from "./pipeline.js";
import { safeEqual } from "./signing.js";
import type { RunReport } from "./types.js";

export interface AppOptions extends SyncDeps {
  adminToken: string;
  staleAfterSeconds: number;
  /** When false, health ignores staleness (useful when syncs are only triggered manually). */
  expectScheduledRuns: boolean;
}

/** Runs one sync at a time; overlapping triggers share the in-flight run instead of racing it. */
export class SyncRunner {
  private inFlight: Promise<RunReport> | null = null;
  constructor(private deps: SyncDeps) {}
  trigger(): Promise<RunReport> {
    if (!this.inFlight) this.inFlight = runSync(this.deps).finally(() => (this.inFlight = null));
    return this.inFlight;
  }
  get running(): boolean {
    return this.inFlight !== null;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, adminToken: string): boolean {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") && safeEqual(header.slice(7), adminToken);
}

export function createApp(opts: AppOptions): { server: Server; runner: SyncRunner } {
  const runner = new SyncRunner(opts);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = `${req.method} ${url.pathname}`;

      if (route === "GET /healthz") {
        const state = await opts.store.load();
        const last = state.runs[0];
        const lastOk = state.runs.find((r) => r.ok);
        const ageSeconds = lastOk ? (Date.now() - Date.parse(lastOk.startedAt)) / 1000 : null;
        const stale = opts.expectScheduledRuns && (ageSeconds === null || ageSeconds > opts.staleAfterSeconds);
        const healthy = !stale && (!last || last.ok);
        return send(res, healthy ? 200 : 503, {
          status: healthy ? "ok" : "degraded",
          running: runner.running,
          lastRun: last ?? null,
          lastSuccessAgeSeconds: ageSeconds,
          deadLetters: state.deadLetters.length,
        });
      }

      if (!authorized(req, opts.adminToken)) return send(res, 401, { error: "unauthorized" });

      if (route === "POST /sync") return send(res, 200, await runner.trigger());
      if (route === "GET /runs") return send(res, 200, (await opts.store.load()).runs);
      if (route === "GET /dead-letters") return send(res, 200, (await opts.store.load()).deadLetters);
      if (route === "POST /dead-letters/replay") return send(res, 200, await replayDeadLetters(opts));
      return send(res, 404, { error: "not found" });
    } catch (err) {
      opts.logger?.log("error", "http.error", { error: (err as Error).message });
      return send(res, 500, { error: "internal error" });
    }
  });

  return { server, runner };
}
