import { z } from "zod";

/**
 * All configuration comes from environment variables. In Kubernetes these are
 * injected from a Secret that is synced from Google Secret Manager (see k8s/),
 * so no credential ever lives in the image or the repo.
 */
const schema = z.object({
  PORT: z.coerce.number().default(8080),
  WFM_BASE_URL: z.string().url(),
  WFM_API_TOKEN: z.string().min(1),
  PAYROLL_WEBHOOK_URL: z.string().url(),
  PAYROLL_SIGNING_SECRET: z.string().min(16, "PAYROLL_SIGNING_SECRET must be at least 16 characters"),
  ADMIN_TOKEN: z.string().min(16, "ADMIN_TOKEN must be at least 16 characters"),
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(300),
  STATE_FILE: z.string().default("data/state.json"),
  STALE_AFTER_SECONDS: z.coerce.number().int().min(60).default(1800),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid configuration:\n  ${problems}`);
  }
  return parsed.data;
}
