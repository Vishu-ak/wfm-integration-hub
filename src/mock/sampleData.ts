import type { WfmEmployee, WfmTimecard } from "../types.js";

export const sampleEmployees: WfmEmployee[] = [
  { personNumber: "100234", firstName: "Ana", lastName: "Lopez", homeStore: "st-0121", payRule: "HOURLY", status: "ACTIVE" },
  { personNumber: "100877", firstName: "Ben", lastName: "Carter", homeStore: "st-0121", payRule: "HOURLY", status: "ACTIVE" },
  { personNumber: "101450", firstName: "Chloe", lastName: "Nguyen", homeStore: "st-0457", payRule: "HOURLY", status: "ACTIVE" },
];

export function sampleTimecards(): WfmTimecard[] {
  const base = Date.parse("2026-10-05T00:00:00Z");
  const cards: WfmTimecard[] = [];
  let n = 0;
  for (const e of sampleEmployees) {
    for (let day = 0; day < 5; day++) {
      n++;
      cards.push({
        id: `TC-${String(n).padStart(5, "0")}`,
        personNumber: e.personNumber,
        workDate: new Date(base + day * 86400000).toISOString().slice(0, 10),
        regularHours: 8,
        overtimeHours: day === 4 ? 1.5 : 0,
        payCode: "REG",
        approved: day !== 3 || e.personNumber !== "101450",
        version: 1,
        updatedAt: new Date(base + day * 86400000 + n * 60000).toISOString(),
      });
    }
  }
  // One record with a pay code payroll does not know about yet: it lands in the dead-letter queue.
  cards.push({ ...cards[0], id: "TC-09999", payCode: "BEREAVEMENT", updatedAt: "2026-10-09T23:00:00.000Z" });
  return cards;
}
