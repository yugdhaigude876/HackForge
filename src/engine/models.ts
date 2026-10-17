/**
 * Reserve Juggler - Transaction & Financial Data Models
 *
 * Defines core domain models for digital banking cash flow operations,
 * synthetic transaction generation, and hourly series aggregations.
 */

import { Money } from "@/engine/money";

export enum TransactionType {
  DEPOSIT = "DEPOSIT",
  WITHDRAWAL = "WITHDRAWAL",
  SETTLEMENT = "SETTLEMENT",
}

export type TransactionTypeLiteral = "DEPOSIT" | "WITHDRAWAL" | "SETTLEMENT";

export enum TransactionStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
}

export type TransactionStatusLiteral = "PENDING" | "COMPLETED" | "FAILED";

/**
 * Domain Transaction entity.
 * Represents an individual cash flow event (deposit, withdrawal, or merchant settlement).
 */
export interface Transaction {
  /** Unique transaction identifier (e.g., UUID) */
  id: string;

  /** Timestamp when transaction was initiated or posted */
  timestamp: Date;

  /** Type of financial flow */
  type: TransactionType;

  /** Magnitude of the transaction held in strict Money units */
  amount: Money;

  /** Current settlement status */
  status: TransactionStatus;

  /** Provenance of the transaction record */
  source?: "synthetic" | "import" | string;

  /** PRNG seed used if synthetically generated */
  seed?: string;

  /** Optional counterparty or merchant tag */
  counterparty?: string;
}

/**
 * Serializable format for persistence (e.g., Firestore conforming to DATA_MODEL.md).
 */
export interface TransactionJSON {
  id: string;
  timestamp: string; // ISO-8601
  type: TransactionType;
  amountMinor: number | string;
  currency: string;
  status: TransactionStatus;
  source?: string;
  seed?: string;
  counterparty?: string;
}

/**
 * Pre-aggregated hourly bucket for net cash flow forecasting (N_t = In_t - Out_t).
 */
export interface HourlyBucket {
  /** ISO hour identifier (e.g., "2026-10-17T09:00:00.000Z") */
  bucketId: string;

  /** Start timestamp of the hourly window */
  hourStart: Date;

  /** Total inbound cash in this hour (deposits + inbound settlements) */
  inbound: Money;

  /** Total outbound cash in this hour (withdrawals + outbound settlements) */
  outbound: Money;

  /** Net cash flow (inbound - outbound). May be positive or negative. */
  netFlow: Money;

  /** Total gross volume (inbound + outbound) */
  grossVolume: Money;

  /** Count of processed transactions */
  transactionCount: number;
}
