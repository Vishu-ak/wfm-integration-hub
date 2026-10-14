import { fetchWithRetry, type RetryOptions, defaultRetry } from "../http.js";
import { sign } from "../signing.js";
import type { PayrollTimeEntry } from "../types.js";

export interface PayrollSink {
  deliver(entry: PayrollTimeEntry, idempotencyKey: string): Promise<void>;
}

/**
 * Posts each entry to the payroll system's webhook, signed with HMAC-SHA256 and
 * carrying an Idempotency-Key so a retried delivery is never booked twice.
 */
export class PayrollWebhookSink implements PayrollSink {
  constructor(
    private url: string,
    private secret: string,
    private retry: RetryOptions = defaultRetry,
  ) {}

  async deliver(entry: PayrollTimeEntry, idempotencyKey: string): Promise<void> {
    const body = JSON.stringify(entry); // serialize once: the signed bytes are the sent bytes
    const timestamp = Math.floor(Date.now() / 1000);
    await fetchWithRetry(
      this.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-timestamp": String(timestamp),
          "x-signature": sign(this.secret, timestamp, body),
        },
        body,
      },
      this.retry,
    );
  }
}
