import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createPayrollMock } from "../src/mock/payrollMock.js";
import { sampleEmployees, sampleTimecards } from "../src/mock/sampleData.js";
import { createWfmMock } from "../src/mock/wfmMock.js";
import { PayrollWebhookSink } from "../src/sinks/payrollSink.js";
import { WfmClient } from "../src/sources/wfmClient.js";
import { MemoryStateStore } from "../src/store/stateStore.js";
import { close, fastRetry, listen } from "./helpers.js";

const servers: Array<import("node:http").Server> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
});

async function boot(expectScheduledRuns = true) {
  const wfm = createWfmMock({ employees: sampleEmployees, timecards: sampleTimecards(), token: "t" });
  const payroll = createPayrollMock("payroll-signing-secret");
  servers.push(wfm, payroll.server);
  const { server } = createApp({
    client: new WfmClient(await listen(wfm), "t", fastRetry),
    sink: new PayrollWebhookSink(`${await listen(payroll.server)}/webhook`, "payroll-signing-secret", fastRetry),
    store: new MemoryStateStore(),
    adminToken: "admin-token-123456",
    staleAfterSeconds: 1800,
    expectScheduledRuns,
  });
  servers.push(server);
  return listen(server);
}

const auth = { authorization: "Bearer admin-token-123456" };

describe("admin API", () => {
  it("rejects requests without the admin token", async () => {
    const url = await boot();
    expect((await fetch(`${url}/runs`)).status).toBe(401);
    expect((await fetch(`${url}/sync`, { method: "POST", headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });

  it("reports degraded health until a sync has succeeded, then ok", async () => {
    const url = await boot(true);
    expect((await fetch(`${url}/healthz`)).status).toBe(503);
    const run = await (await fetch(`${url}/sync`, { method: "POST", headers: auth })).json();
    expect(run.ok).toBe(true);
    const health = await fetch(`${url}/healthz`);
    expect(health.status).toBe(200);
    expect((await health.json()).deadLetters).toBe(1);
  });

  it("lists dead letters and replays them", async () => {
    const url = await boot(false);
    await fetch(`${url}/sync`, { method: "POST", headers: auth });
    const dls = await (await fetch(`${url}/dead-letters`, { headers: auth })).json();
    expect(dls[0].stage).toBe("mapping");
    const replay = await (await fetch(`${url}/dead-letters/replay`, { method: "POST", headers: auth })).json();
    expect(replay.stillFailing).toBe(1); // mapping not fixed yet, so it stays queued with attempts+1
  });
});
