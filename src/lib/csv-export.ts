/**
 * Reserve Juggler - Audit CSV Export Helper (RFC 4180 Compliant)
 */

export interface CsvAuditRecord {
  timestamp: string;
  hour?: number;
  type: string;
  message: string;
  source?: string;
}

/**
 * Escapes a single CSV field value according to RFC 4180.
 * If the value contains a comma, newline, or double quote, it is wrapped in double quotes
 * and any internal double quotes are escaped by doubling them ("").
 */
export function escapeCsvField(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates an RFC 4180 compliant CSV string from simulation audit logs and stored decisions.
 */
export function generateAuditCsv(
  auditLogs: Array<{ hour?: number; timestamp: string; message: string; type: string }>,
  storedDecisions?: Array<{ id: string; timestamp?: string; createdAt?: string; status: string; rationale?: string }>
): string {
  const headers = ["timestamp", "hour", "type", "message", "source"];
  const rows: string[] = [headers.join(",")];

  for (const log of auditLogs) {
    rows.push(
      [
        escapeCsvField(log.timestamp),
        escapeCsvField(log.hour !== undefined ? log.hour : ""),
        escapeCsvField(log.type),
        escapeCsvField(log.message),
        escapeCsvField("replay-simulation"),
      ].join(",")
    );
  }

  if (storedDecisions && storedDecisions.length > 0) {
    for (const dec of storedDecisions) {
      rows.push(
        [
          escapeCsvField(dec.timestamp || dec.createdAt || ""),
          escapeCsvField(""),
          escapeCsvField(`STORED_DECISION_${dec.status}`),
          escapeCsvField(dec.rationale || `Decision ID: ${dec.id}`),
          escapeCsvField("stored-firestore"),
        ].join(",")
      );
    }
  }

  return rows.join("\r\n");
}
