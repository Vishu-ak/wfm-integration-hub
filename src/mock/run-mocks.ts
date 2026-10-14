import { jsonLogger } from "../logger.js";
import { createPayrollMock } from "./payrollMock.js";
import { sampleEmployees, sampleTimecards } from "./sampleData.js";
import { createWfmMock } from "./wfmMock.js";

const token = process.env.WFM_API_TOKEN ?? "dev-wfm-token";
const secret = process.env.PAYROLL_SIGNING_SECRET ?? "dev-signing-secret-change-me";

createWfmMock({ employees: sampleEmployees, timecards: sampleTimecards(), token, failEvery: 7 }).listen(9001, () =>
  jsonLogger.log("info", "mock.wfm.listening", { url: "http://localhost:9001" }),
);
const payroll = createPayrollMock(secret, 2);
payroll.server.listen(9002, () => jsonLogger.log("info", "mock.payroll.listening", { url: "http://localhost:9002/webhook" }));
