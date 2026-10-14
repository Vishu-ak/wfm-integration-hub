import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { jsonLogger } from "./logger.js";
import { PayrollWebhookSink } from "./sinks/payrollSink.js";
import { WfmClient } from "./sources/wfmClient.js";
import { FileStateStore } from "./store/stateStore.js";

const config = loadConfig();
const { server, runner } = createApp({
  client: new WfmClient(config.WFM_BASE_URL, config.WFM_API_TOKEN),
  sink: new PayrollWebhookSink(config.PAYROLL_WEBHOOK_URL, config.PAYROLL_SIGNING_SECRET),
  store: new FileStateStore(config.STATE_FILE),
  logger: jsonLogger,
  adminToken: config.ADMIN_TOKEN,
  staleAfterSeconds: config.STALE_AFTER_SECONDS,
  expectScheduledRuns: config.SYNC_INTERVAL_SECONDS > 0,
});

server.listen(config.PORT, () => jsonLogger.log("info", "server.listening", { port: config.PORT }));

if (config.SYNC_INTERVAL_SECONDS > 0) {
  const tick = () => runner.trigger().catch((err) => jsonLogger.log("error", "sync.crashed", { error: String(err) }));
  tick();
  setInterval(tick, config.SYNC_INTERVAL_SECONDS * 1000).unref();
}

const shutdown = (signal: string) => {
  jsonLogger.log("info", "server.shutdown", { signal });
  server.close(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
