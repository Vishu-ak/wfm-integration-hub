import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { fetchWithRetry, HttpError } from "../src/http.js";
import { close, fastRetry, listen } from "./helpers.js";

describe("fetchWithRetry", () => {
  it("retries 503s and then succeeds", async () => {
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      res.writeHead(calls < 3 ? 503 : 200);
      res.end("ok");
    });
    const url = await listen(server);
    const res = await fetchWithRetry(url, {}, fastRetry);
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
    await close(server);
  });

  it("does not retry a 400, because the request itself is wrong", async () => {
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      res.writeHead(400);
      res.end("bad request");
    });
    const url = await listen(server);
    await expect(fetchWithRetry(url, {}, fastRetry)).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(1);
    await close(server);
  });

  it("gives up after the retry budget", async () => {
    let calls = 0;
    const server = createServer((_req, res) => {
      calls++;
      res.writeHead(500);
      res.end("boom");
    });
    const url = await listen(server);
    await expect(fetchWithRetry(url, {}, { ...fastRetry, retries: 2 })).rejects.toThrow(/HTTP 500/);
    expect(calls).toBe(3);
    await close(server);
  });
});
