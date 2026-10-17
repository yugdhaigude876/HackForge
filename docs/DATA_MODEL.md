# Data Model (Firestore)

Conventions:
- Document paths: Scoped strictly under `orgs/{orgId}/<collection>/<id>`.
- Identifiers: Document and org IDs must strictly validate against `^[A-Za-z0-9_-]{1,64}$` to prevent path traversal.
- Timestamps: Stored as Firestore `Timestamp` in UTC; exposed in domain models as JavaScript `Date`. `createdAt` and `createdBy` are set immutably by repositories, not callers.
- Money: Stored as decimal strings (`capacityMinor`, `amountMinor`, `reserveMinor`, `surplusMinor`, `inMinor`, `outMinor`, `expectedNetYieldMinor`) to prevent IEEE 754 precision loss on values exceeding $2^{53}$ cents. Converted to/from immutable `Money` objects strictly at repository boundaries.
- Validation: Every document read and write is validated against Zod schemas in `src/server/repositories/schemas.ts`; malformed documents throw typed `RepositoryError`.

## Collections & Final Field Types

| Collection Path | Schema / Fields | Description |
|---|---|---|
| `orgs/{orgId}` | `id: string`<br>`name: string`<br>`currency: string` (e.g. `"USD"`)<br>`createdAt: Timestamp`<br>`createdBy: string` | Organisation metadata root. |
| `orgs/{orgId}/members/{uid}` | `orgId: string`<br>`uid: string`<br>`role: "admin" \| "analyst" \| "viewer"`<br>`createdAt: Timestamp`<br>`createdBy: string` | Organisation membership and authorization role. |
| `orgs/{orgId}/instruments/{id}` | `id: string`<br>`orgId: string`<br>`name: string`<br>`annualRateBps: number` (int)<br>`settlementLagHours: number` (int)<br>`penaltyBps: number` (int)<br>`capacityMinor: string` (decimal integer string)<br>`minHoldHours: number` (int)<br>`createdAt: Timestamp`<br>`createdBy: string`<br>`updatedAt?: Timestamp`<br>`updatedBy?: string` | Yield instruments with settlement constraints and capacity. |
| `orgs/{orgId}/transactions/{id}` | `id: string`<br>`orgId: string`<br>`ts: Timestamp`<br>`type: "deposit" \| "withdrawal" \| "settlement"`<br>`amountMinor: string` (decimal string)<br>`source: "synthetic" \| "import"`<br>`seed?: number`<br>`createdAt: Timestamp`<br>`createdBy: string` | Individual cash flow events. Ingested in batches of $\le 500$ writes. |
| `orgs/{orgId}/series/{bucketId}` | `bucketId: string` (safe ISO hour, e.g. `"2026-03-01T14-00-00Z"`)<br>`orgId: string`<br>`hourStart: Timestamp`<br>`inMinor: string`<br>`outMinor: string`<br>`updatedAt: Timestamp` | Pre-aggregated hourly net-flow buckets for fast chart and engine querying. |
| `orgs/{orgId}/forecasts/{id}` | `id: string`<br>`orgId: string`<br>`method: string`<br>`params: Record<string, unknown>`<br>`asOf: Timestamp`<br>`horizon: number`<br>`points: Array<{ ts: Timestamp, meanMinor: string, bandLowerMinor?: string, bandUpperMinor?: string }>`<br>`residualQuantiles: Record<string, number>`<br>`backtest: { mase: number, pinball: number, skillVsBaseline?: number, sampleSize?: number }`<br>`source?: "synthetic" \| "production"`<br>`createdAt: Timestamp`<br>`createdBy: string` | Point and probabilistic forecasts produced by the forecasting engine with residual quantile uncertainty bands. |
| `orgs/{orgId}/decisions/{id}` | `id: string`<br>`orgId: string`<br>`forecastId: string`<br>`confidence: number`<br>`reserveMinor: string`<br>`surplusMinor: string`<br>`availableCashMinor: string`<br>`deployedTotalMinor?: string`<br>`operationalFloorMinor?: string`<br>`horizonHours?: number`<br>`alpha?: number`<br>`expectedCumulativeFlowMinor?: string`<br>`worstCaseResidualShortfallMinor?: string`<br>`backtest?: { mase: number, sampleSize?: number }`<br>`allocations: Array<{ instrumentId: string, name?: string, amountMinor: string, annualRateBps?: number, settlementLagHours?: number, penaltyBps?: number, capacityMinor?: string }>`<br>`status: string`<br>`expectedNetYieldMinor: string`<br>`explanation: string`<br>`source?: "synthetic" \| "production"`<br>`createdAt: Timestamp`<br>`createdBy: string` | Liquidity reserve optimizations and portfolio allocations including cash balance snapshots and instrument parameters. |
| `orgs/{orgId}/simulations/{id}` | `id: string`<br>`orgId: string`<br>`scenario: string`<br>`seed: number`<br>`policy: string \| Record<string, unknown>`<br>`metrics: Record<string, unknown>`<br>`createdAt: Timestamp`<br>`createdBy: string` | Stress scenario simulation and Digital Twin runs. |
| `orgs/{orgId}/audit/{id}` | `id: string`<br>`orgId: string`<br>`actorUid: string`<br>`action: string`<br>`refPath: string`<br>`beforeHash?: string`<br>`afterHash?: string`<br>`ts: Timestamp`<br>`createdAt: Timestamp` | **Strictly append-only** immutable audit log for compliance. |

## Security Rules (`firestore.rules`)
- **Default Deny**: `match /{document=**} { allow read, write: if false; }`.
- **Org Isolation**: Reads under `orgs/{orgId}/**` require `request.auth != null && exists(/databases/$(database)/documents/orgs/$(orgId)/members/$(request.auth.uid))`. Cross-org access is impossible.
- **Server Write Boundary**: Direct client writes are denied (`allow write: if false;`) for all collections (`decisions`, `forecasts`, `simulations`, `audit`, `members`, `orgs`, `transactions`, `series`, `instruments`). All mutations must go through validated server route handlers.
- **Audit Immutability**: `audit` collection rules enforce `allow create, update, delete: if false;`, ensuring client callers (even organisation admins) cannot modify or delete audit trails.

## Composite Indexes (`firestore.indexes.json`)
The following composite indexes are configured in `firestore.indexes.json` to back repository queries:
1. `transactions`: `type ASC`, `ts DESC` (filtered time-range queries).
2. `simulations`: `scenario ASC`, `createdAt DESC` (scenario-filtered simulation history).
3. `decisions`: `createdAt DESC` (chronological decision logs).
4. `forecasts`: `createdAt DESC` (chronological forecast runs).
5. `audit`: `ts DESC` (chronological audit history).
