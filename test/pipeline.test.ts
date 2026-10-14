import { afterEach, describe, expect, it } from "vitest";
import { defaultMapping } from "../src/mapping.js";
import { createPayrollMock } from "../src/mock/payrollMock.js";
import { sampleEmployees, sampleTimecards } from "../src/mock/sampleData.js";
import { createWfmMock } from "../src/mock/wfmMock.js";
import { replayDeadLetters, runSync } from "../src/pipeline.js";
import { PayrollWebhookSink } from "../src/sinks/payrollSink.js";
import { WfmClient } from "../src/sources/wfmClient.js";
import { MemoryStateStore } from "../src/store/stateStore.js";
import { close, fastRetry, listen } from "./helpers.js";

const TOKEN = "wfm-token";
const SECRET = "payroll-signing-secret";
const servers: Array<import("node:http").Server> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
});

async function setup(opts: { failEvery?: number; payrollFailFirst?: number } = {}) {
  const timecards = sampleTimecards();
  const wfm = createWfmMock({ employees: sampleEmployees, timecards, token: TOKEN, failEvery: opts.failEvery });
  const payroll = createPayrollMock(SECRET, opts.payrollFailFirst ?? 0);
  servers.push(wfm, payroll.server);
  const wfmUrl = await listen(wfm);
  const payrollUrl = await listen(payroll.server);
  const store = new MemoryStateStore();
  const deps = {
    client: new WfmClient(wfmUrl, TOKEN, fastRetry),
    sink: new PayrollWebhookSink(`${payrollUrl}/webhook`, SECRET, fastRetry),
    store,
  };
  return { deps, payroll, timecards, store };
}

describe("runSync", () => {
  it("delivers every approved, mappable timecard and dead-letters the rest", async () => {
    const { deps, payroll, timecards } = await setup();
    const report = await runSync(deps);
    const unapproved = timecards.filter((t) => !t.approved).length;
    expect(report.ok).toBe(true);
    expect(report.fetched).toBe(timecards.length);
    expect(report.skippedUnapproved).toBe(unapproved);
    expect(report.deadLettered).toBe(1); // the BEREAVEMENT pay code
    expect(report.delivered).toBe(timecards.length - unapproved - 1);
    expect(payroll.received.size).toBe(report.delivered);
  });

  it("is idempotent: a second run books nothing twice", async () => {
    const { deps, payroll } = await setup();
    const first = await runSync(deps);
    const second = await runSync(deps);
    expect(second.delivered).toBe(0);
    expect(payroll.received.size).toBe(first.delivered);
  });

  it("picks up an edited timecard as a new version", async () => {
    const { deps, payroll, timecards } = await setup();
    await runSync(deps);
    const edited = { ...timecards[0], version: 2, regularHours: 7.5, updatedAt: "2026-10-12T10:00:00.000Z" };
    timecards.push(edited);
    const report = await runSync(deps);
    expect(report.delivered).toBe(1);
    expect([...payroll.received.values()].some((e) => e.sourceId === edited.id && e.sourceVersion === 2)).toBe(true);
  });

  it("rides out a flaky WFM API and a short payroll outage through retries", async () => {
    const { deps, payroll } = await setup({ failEvery: 3, payrollFailFirst: 2 });
    const report = await runSync(deps);
    expect(report.ok).toBe(true);
    expect(report.delivered).toBeGreaterThan(0);
    expect(payroll.received.size).toBe(report.delivered);
  });

  it("replays dead letters once the mapping is fixed", async () => {
    const { deps, payroll } = await setup();
    await runSync(deps);
    const fixed = { ...defaultMapping, payCodes: { ...defaultMapping.payCodes, BEREAVEMENT: "E15" } };
    const result = await replayDeadLetters({ ...deps, mapping: fixed });
    expect(result).toEqual({ replayed: 1, stillFailing: 0 });
    expect([...payroll.received.values()].some((e) => e.earningCode === "E15")).toBe(true);
  });

  it("records a failed run instead of crashing when the WFM API rejects credentials", async () => {
    const { deps } = await setup();
    const report = await runSync({ ...deps, client: new WfmClient((deps.client as any).baseUrl, "wrong", fastRetry) });
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/401/);
  });
});
