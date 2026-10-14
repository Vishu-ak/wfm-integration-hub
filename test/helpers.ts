import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

export async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

export const fastRetry = { retries: 4, baseDelayMs: 1, maxDelayMs: 5, timeoutMs: 2000 };
