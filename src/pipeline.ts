import { createHash, randomUUID } from "node:crypto";
import { defaultMapping, mapTimecard, MappingError, type MappingConfig } from "./mapping.js";
import type { PayrollSink } from "./sinks/payrollSink.js";
import type { WfmClient } from "./sources/wfmClient.js";
import type { StateStore, SyncState } from "./store/stateStore.js";
import { silentLogger, type Logger } from "./logger.js";
import type { DeadLetter, RunReport, WfmEmployee, WfmTimecard } from "./types.js";

export interface SyncDeps {
  client: Pick<WfmClient, "employees" | "timecardPages">;
  sink: PayrollSink;
  store: StateStore;
  mapping?: MappingConfig;
  logger?: Logger;
  keepRuns?: number;
}

/** Same timecard + same version = same key, so re-reads and retries are never booked twice. */
export function idempotencyKey(tc: Pick<WfmTimecard, "id" | "version">): string {
  return createHash("sha256").update(`${tc.id}:${tc.version}`).digest("hex").slice(0, 32);
}

function deadLetter(stage: DeadLetter["stage"], reason: string, record: unknown): DeadLetter {
  return { id: randomUUID(), stage, reason, record, attempts: 1, createdAt: new Date().toISOString() };
}

/**
 * One incremental sync: read timecards changed since the last cursor, map them,
 * deliver them to payroll, and checkpoint after every page. Bad records go to a
 * dead-letter queue instead of stopping the run.
 */
export async function runSync(deps: SyncDeps): Promise<RunReport> {
  const { client, sink, store, mapping = defaultMapping, logger = silentLogger, keepRuns = 50 } = deps;
  const started = Date.now();
  const report: RunReport = {
    runId: randomUUID(),
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    fetched: 0,
    skippedUnapproved: 0,
    skippedDuplicates: 0,
    delivered: 0,
    deadLettered: 0,
    cursor: null,
    ok: true,
  };
  const state: SyncState = await store.load();
  report.cursor = state.cursor;

  try {
    const employees = new Map<string, WfmEmployee>();
    for await (const e of client.employees()) employees.set(e.personNumber, e);
    logger.log("info", "sync.start", { runId: report.runId, cursor: state.cursor, employees: employees.size });

    for await (const page of client.timecardPages(state.cursor)) {
      let pageMax = state.cursor;
      for (const tc of page.items) {
        report.fetched++;
        if (!pageMax || tc.updatedAt > pageMax) pageMax = tc.updatedAt;
        if (!tc.approved) {
          report.skippedUnapproved++;
          continue;
        }
        const key = idempotencyKey(tc);
        if (state.processed[key]) {
          report.skippedDuplicates++;
          continue;
        }
        const employee = employees.get(tc.personNumber);
        let entry;
        try {
          entry = mapTimecard(tc, employee, mapping);
        } catch (err) {
          if (!(err instanceof MappingError)) throw err;
          state.deadLetters.push(deadLetter("mapping", err.message, { timecard: tc, employee }));
          report.deadLettered++;
          logger.log("warn", "sync.mapping_failed", { timecardId: tc.id, reason: err.message });
          continue;
        }
        try {
          await sink.deliver(entry, key);
          state.processed[key] = new Date().toISOString();
          report.delivered++;
        } catch (err) {
          state.deadLetters.push(deadLetter("delivery", (err as Error).message, { timecard: tc, employee }));
          report.deadLettered++;
          logger.log("error", "sync.delivery_failed", { timecardId: tc.id, reason: (err as Error).message });
        }
      }
      state.cursor = pageMax; // checkpoint: a crash mid-run resumes from the last finished page
      await store.save(state);
    }
  } catch (err) {
    report.ok = false;
    report.error = (err as Error).message;
    logger.log("error", "sync.failed", { runId: report.runId, error: report.error });
  }

  report.cursor = state.cursor;
  report.durationMs = Date.now() - started;
  state.runs = [report, ...state.runs].slice(0, keepRuns);
  await store.save(state);
  logger.log(report.ok ? "info" : "error", "sync.finish", { ...report });
  return report;
}

/** Re-maps and re-delivers dead letters, e.g. after a mapping fix or a payroll outage ends. */
export async function replayDeadLetters(
  deps: Omit<SyncDeps, "client">,
): Promise<{ replayed: number; stillFailing: number }> {
  const { sink, store, mapping = defaultMapping, logger = silentLogger } = deps;
  const state = await store.load();
  const remaining: DeadLetter[] = [];
  let replayed = 0;
  for (const dl of state.deadLetters) {
    const { timecard, employee } = dl.record as { timecard: WfmTimecard; employee?: WfmEmployee };
    const key = idempotencyKey(timecard);
    if (state.processed[key]) {
      replayed++; // already delivered by a later run
      continue;
    }
    try {
      await sink.deliver(mapTimecard(timecard, employee, mapping), key);
      state.processed[key] = new Date().toISOString();
      replayed++;
    } catch (err) {
      remaining.push({ ...dl, attempts: dl.attempts + 1, reason: (err as Error).message });
      logger.log("warn", "replay.failed", { deadLetterId: dl.id, reason: (err as Error).message });
    }
  }
  state.deadLetters = remaining;
  await store.save(state);
  return { replayed, stillFailing: remaining.length };
}
