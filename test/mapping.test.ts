import { describe, expect, it } from "vitest";
import { mapTimecard, MappingError } from "../src/mapping.js";
import { sampleEmployees, sampleTimecards } from "../src/mock/sampleData.js";

const tc = sampleTimecards()[4]; // day with 1.5 overtime hours
const emp = sampleEmployees[0];

describe("mapTimecard", () => {
  it("maps a WFM timecard to the payroll schema", () => {
    expect(mapTimecard(tc, emp)).toEqual({
      employeeId: "100234",
      location: "ST-0121",
      workDate: tc.workDate,
      regularMinutes: 480,
      overtimeMinutes: 90,
      earningCode: "E01",
      sourceId: tc.id,
      sourceVersion: 1,
    });
  });

  it("rejects unknown pay codes with a readable reason", () => {
    expect(() => mapTimecard({ ...tc, payCode: "BEREAVEMENT" }, emp)).toThrow(/unmapped pay code: BEREAVEMENT/);
  });

  it("rejects a timecard with no matching employee", () => {
    expect(() => mapTimecard(tc, undefined)).toThrow(MappingError);
  });

  it("rejects impossible hours through schema validation", () => {
    expect(() => mapTimecard({ ...tc, regularHours: 30 }, emp)).toThrow(/regularMinutes/);
  });
});
