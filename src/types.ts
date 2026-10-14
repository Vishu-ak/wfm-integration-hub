/** A worker record as exposed by the workforce management (WFM) system. */
export interface WfmEmployee {
  personNumber: string;
  firstName: string;
  lastName: string;
  homeStore: string;
  payRule: "HOURLY" | "SALARIED";
  status: "ACTIVE" | "TERMINATED";
}

/** One approved timecard day from the WFM system. */
export interface WfmTimecard {
  id: string;
  personNumber: string;
  workDate: string; // YYYY-MM-DD
  regularHours: number;
  overtimeHours: number;
  payCode: string;
  approved: boolean;
  version: number; // bumps every time the timecard is edited
  updatedAt: string; // ISO timestamp
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** What the payroll system expects for every time entry. */
export interface PayrollTimeEntry {
  employeeId: string;
  location: string;
  workDate: string;
  regularMinutes: number;
  overtimeMinutes: number;
  earningCode: string;
  sourceId: string;
  sourceVersion: number;
}

export interface DeadLetter {
  id: string;
  stage: "mapping" | "delivery";
  reason: string;
  record: unknown;
  attempts: number;
  createdAt: string;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  durationMs: number;
  fetched: number;
  skippedUnapproved: number;
  skippedDuplicates: number;
  delivered: number;
  deadLettered: number;
  cursor: string | null;
  ok: boolean;
  error?: string;
}
