import { createServer, type Server } from "node:http";
import { verify } from "../signing.js";
import type { PayrollTimeEntry } from "../types.js";

export interface PayrollMock {
  server: Server;
  received: Map<string, PayrollTimeEntry>; // idempotency key -> entry
  requests: number;
}

/**
 * Stand-in payroll webhook. It verifies the HMAC signature, honours Idempotency-Key,
 * and can fail its first `failFirst` requests with 503 to simulate an outage.
 */
export function createPayrollMock(secret: string, failFirst = 0): PayrollMock {
  const mock: PayrollMock = { server: undefined as unknown as Server, received: new Map(), requests: 0 };
  mock.server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      mock.requests++;
      const reply = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (mock.requests <= failFirst) return reply(503, { error: "payroll unavailable" });
      const ts = Number(req.headers["x-timestamp"]);
      if (!verify(secret, ts, body, String(req.headers["x-signature"] ?? ""))) return reply(401, { error: "bad signature" });
      const key = String(req.headers["idempotency-key"] ?? "");
      if (!key) return reply(400, { error: "missing idempotency key" });
      if (mock.received.has(key)) return reply(200, { status: "duplicate" });
      mock.received.set(key, JSON.parse(body));
      return reply(201, { status: "booked" });
    });
  });
  return mock;
}
