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

/**
 * Yield investment instrument for deployable surplus allocation.
 */
export interface Instrument {
  /** Unique instrument identifier (e.g. "i1", "sweep-overnight") */
  id: string;

  /** Display name of the financial instrument */
  name: string;

  /**
   * Annual Percentage Yield (APY) as a decimal fraction (e.g. 0.045 = 4.50%)
   * or basis points (e.g. 450 bps). If apy > 1, it is treated as basis points.
   */
  apy: number;

  /** Maximum deployment capacity held in strict Money units */
  capacity: Money;

  /**
   * Early withdrawal penalty rate as a decimal fraction (e.g. 0.0015 = 0.15% = 15 bps)
   * or in basis points (e.g. 15). If withdrawalPenalty > 1, it is treated as basis points.
   */
  withdrawalPenalty: number;

  /** Settlement lag in hours before funds become liquid (e.g. 0 for instant, 24 for T+1) */
  settlementLagHours?: number;

  /** Minimum required hold duration in hours */
  minHoldHours?: number;

  /**
   * Probability pi_i in [0, 1] that cash emergency forces early liquidation of this position.
   * Defaults to 0 or estimated via scenario simulations.
   */
  earlyWithdrawalRisk?: number;
}

