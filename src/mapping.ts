import { z } from "zod";
import type { PayrollTimeEntry, WfmEmployee, WfmTimecard } from "./types.js";

/**
 * Declarative field mapping from the WFM timecard (joined with its employee)
 * to the payroll schema. Changing a mapping is a config change, not a code change,
 * the same way an iPaaS like Dell Boomi treats maps.
 */
export type Transform = "string" | "hoursToMinutes" | "isoDate" | "upper";

export interface FieldMap {
  target: keyof PayrollTimeEntry;
  source: string; // dot path into { timecard, employee }
  transform?: Transform;
}

export interface MappingConfig {
  fields: FieldMap[];
  /** WFM pay codes translated to payroll earning codes. Unknown codes are rejected. */
  payCodes: Record<string, string>;
}

export const defaultMapping: MappingConfig = {
  fields: [
    { target: "employeeId", source: "employee.personNumber", transform: "string" },
    { target: "location", source: "employee.homeStore", transform: "upper" },
    { target: "workDate", source: "timecard.workDate", transform: "isoDate" },
    { target: "regularMinutes", source: "timecard.regularHours", transform: "hoursToMinutes" },
    { target: "overtimeMinutes", source: "timecard.overtimeHours", transform: "hoursToMinutes" },
    { target: "sourceId", source: "timecard.id", transform: "string" },
    { target: "sourceVersion", source: "timecard.version" },
  ],
  payCodes: { REG: "E01", HOLIDAY: "E07", PTO: "E10", SICK: "E12" },
};

export const payrollEntrySchema = z.object({
  employeeId: z.string().min(1),
  location: z.string().regex(/^[A-Z0-9-]+$/, "location must be an uppercase store code"),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  regularMinutes: z.number().int().min(0).max(24 * 60),
  overtimeMinutes: z.number().int().min(0).max(24 * 60),
  earningCode: z.string().min(1),
  sourceId: z.string().min(1),
  sourceVersion: z.number().int().min(1),
});

export class MappingError extends Error {}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function applyTransform(value: unknown, transform?: Transform): unknown {
  if (value === undefined || value === null) return value;
  switch (transform) {
    case "string":
      return String(value);
    case "upper":
      return String(value).trim().toUpperCase();
    case "isoDate": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new MappingError(`invalid date: ${String(value)}`);
      return d.toISOString().slice(0, 10);
    }
    case "hoursToMinutes": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new MappingError(`invalid hours: ${String(value)}`);
      return Math.round(n * 60);
    }
    default:
      return value;
  }
}

/** Maps one timecard to a payroll entry, or throws MappingError with a readable reason. */
export function mapTimecard(
  timecard: WfmTimecard,
  employee: WfmEmployee | undefined,
  config: MappingConfig = defaultMapping,
): PayrollTimeEntry {
  if (!employee) throw new MappingError(`no employee record for ${timecard.personNumber}`);
  const ctx = { timecard, employee };
  const out: Record<string, unknown> = {};
  for (const f of config.fields) out[f.target] = applyTransform(getPath(ctx, f.source), f.transform);

  const earningCode = config.payCodes[timecard.payCode];
  if (!earningCode) throw new MappingError(`unmapped pay code: ${timecard.payCode}`);
  out.earningCode = earningCode;

  const parsed = payrollEntrySchema.safeParse(out);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new MappingError(issues);
  }
  return parsed.data;
}
