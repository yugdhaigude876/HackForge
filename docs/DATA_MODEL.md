# Data Model (Firestore, planned)

Conventions: ids are Firestore auto-ids unless stated; timestamps are Firestore `Timestamp` in UTC; money is an integer in minor units stored as a number only if < 2^53, otherwise a decimal string (`amountMinor`); every document has `orgId`, `createdAt`, `createdBy`.

| Collection | Key fields |
|---|---|
| `orgs/{orgId}` | name, currency, createdAt |
| `orgs/{orgId}/members/{uid}` | role (`admin`\|`analyst`\|`viewer`) |
| `orgs/{orgId}/instruments/{id}` | name, annualRateBps, settlementLagHours, penaltyBps, capacityMinor, minHoldHours |
| `orgs/{orgId}/transactions/{id}` | ts, type (`deposit`\|`withdrawal`\|`settlement`), amountMinor, source (`synthetic`\|`import`), seed |
| `orgs/{orgId}/series/{bucketId}` | hourStart, inMinor, outMinor (pre-aggregated, bucketId = ISO hour) |
| `orgs/{orgId}/forecasts/{id}` | method, params, asOf, horizon, points[{ts,meanMinor}], residualQuantiles, backtest{mase,pinball,skillVsBaseline} |
| `orgs/{orgId}/decisions/{id}` | forecastId, confidence, reserveMinor, surplusMinor, allocations[{instrumentId,amountMinor}], status, expectedNetYieldMinor, explanation |
| `orgs/{orgId}/simulations/{id}` | scenario, seed, policy, metrics, createdAt |
| `orgs/{orgId}/audit/{id}` | actorUid, action, refPath, before/after hash, ts (append-only) |

## Security rules (principles)
- Read allowed only to authenticated members of the org.
- Client writes denied for `decisions`, `forecasts`, `simulations`, `audit`; these are written by the server (Admin SDK bypasses rules, so route code authorises).
- `audit` is never updatable or deletable by clients.
- Rules are tested with the emulator.

## Indexes
Composite: `transactions(orgId? implicit by path, ts desc, type)`; `decisions(createdAt desc)`; `simulations(scenario, createdAt desc)`. Large transaction sets are pre-aggregated into `series` to keep reads small.
