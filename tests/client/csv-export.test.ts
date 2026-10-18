import { describe, it, expect } from "vitest";
import { escapeCsvField, generateAuditCsv } from "@/lib/csv-export";

describe("CSV Export & RFC 4180 Escaping", () => {
  it("escapes fields with commas, quotes, and newlines properly", () => {
    expect(escapeCsvField("simple")).toBe("simple");
    expect(escapeCsvField("has,comma")).toBe('"has,comma"');
    expect(escapeCsvField('has"quote')).toBe('"has""quote"');
    expect(escapeCsvField("has\nnewline")).toBe('"has\nnewline"');
    expect(escapeCsvField('combo, with "quotes" and \nnewline')).toBe(
      '"combo, with ""quotes"" and \nnewline"'
    );
  });

  it("handles numbers, booleans, and nulls", () => {
    expect(escapeCsvField(123)).toBe("123");
    expect(escapeCsvField(0)).toBe("0");
    expect(escapeCsvField(true)).toBe("true");
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("generates a complete CSV with headers and row data", () => {
    const events = [
      {
        hour: 17,
        timestamp: "2026-10-18T17:00:00.000Z",
        type: "SWEEP",
        message: 'Swept $5,000,000 to repo; note: "daily close"',
      },
      {
        hour: 24,
        timestamp: "2026-10-19T00:00:00.000Z",
        type: "REBALANCE",
        message: "Routine rebalance",
      },
    ];

    const storedDecisions = [
      {
        id: "dec-123",
        timestamp: "2026-10-18T12:00:00.000Z",
        status: "HEALTHY",
        rationale: "Automated sweep approved, low risk",
      },
    ];

    const csv = generateAuditCsv(events, storedDecisions);
    const lines = csv.split("\r\n");

    // Header check
    expect(lines[0]).toBe("timestamp,hour,type,message,source");

    // Row 1 with quotes and commas
    expect(lines[1]).toContain("2026-10-18T17:00:00.000Z,17,SWEEP");
    expect(lines[1]).toContain('"Swept $5,000,000 to repo; note: ""daily close"""');
    expect(lines[1]).toContain("replay-simulation");

    // Row 2
    expect(lines[2]).toBe("2026-10-19T00:00:00.000Z,24,REBALANCE,Routine rebalance,replay-simulation");

    // Stored decision row
    expect(lines[3]).toBe(
      '2026-10-18T12:00:00.000Z,,STORED_DECISION_HEALTHY,"Automated sweep approved, low risk",stored-firestore'
    );
  });
});
