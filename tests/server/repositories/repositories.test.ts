import { describe, it, expect, beforeEach } from "vitest";
import { FakeFirestore } from "./fake-firestore";
import type { Firestore } from "firebase-admin/firestore";
import {
  RepositoryError,
  validateId,
  clampLimit,
  moneyToDecimalString,
  decimalStringToMoney,
} from "@/server/repositories/common";
import { membersRepo } from "@/server/repositories/members";
import { instrumentsRepo } from "@/server/repositories/instruments";
import { transactionsRepo } from "@/server/repositories/transactions";
import { seriesRepo } from "@/server/repositories/series";
import { forecastsRepo } from "@/server/repositories/forecasts";
import { decisionsRepo } from "@/server/repositories/decisions";
import { simulationsRepo } from "@/server/repositories/simulations";
import { auditRepo } from "@/server/repositories/audit";
import { FirestoreMembershipStore } from "@/server/auth";
import { setAdminFirestore } from "@/server/firebase-admin";
import { Money } from "@/engine/money";

describe("Typed Firestore Repositories", () => {
  let fakeDb: FakeFirestore;
  let db: Firestore;

  beforeEach(() => {
    fakeDb = new FakeFirestore();
    db = fakeDb as unknown as Firestore;
    setAdminFirestore(db);
  });

  describe("ID validation and path security", () => {
    it("accepts valid alphanumeric, underscore, and hyphen IDs", () => {
      expect(validateId("org_alpha-123")).toBe("org_alpha-123");
      expect(validateId("user_09AZ_-")).toBe("user_09AZ_-");
    });

    it("rejects path traversal attempts containing ../ or /", () => {
      expect(() => validateId("../org_alpha")).toThrow(RepositoryError);
      expect(() => validateId("orgs/sub/id")).toThrow(RepositoryError);
      expect(() => validateId("../../etc/passwd")).toThrow(RepositoryError);
    });

    it("rejects empty or whitespace-only IDs", () => {
      expect(() => validateId("")).toThrow(RepositoryError);
      expect(() => validateId("   ")).toThrow(RepositoryError);
    });

    it("rejects IDs exceeding 64 characters", () => {
      const longId = "a".repeat(65);
      expect(() => validateId(longId)).toThrow(RepositoryError);
    });
  });

  describe("Money serialization and precision preservation", () => {
    it("round-trips Money values exceeding 2^53 (Number.MAX_SAFE_INTEGER) without precision loss", async () => {
      // 2^53 + 1 = 9007199254740993
      const hugeMinorStr = "9007199254740993";
      const hugeMoney = Money.fromMinor(hugeMinorStr, "USD");

      const created = await instrumentsRepo.create(
        "org_alpha",
        {
          name: "Sovereign Mega-Bond",
          annualRateBps: 350,
          settlementLagHours: 24,
          penaltyBps: 50,
          capacity: hugeMoney,
          minHoldHours: 48,
        },
        "actor_sys",
        db
      );

      expect(created.capacityMinor).toBe(hugeMinorStr);
      expect(created.capacity.amountMinor.toString()).toBe(hugeMinorStr);

      const fetched = await instrumentsRepo.get("org_alpha", created.id, db);
      expect(fetched).not.toBeNull();
      expect(fetched?.capacityMinor).toBe(hugeMinorStr);
      expect(fetched?.capacity.amountMinor.toString()).toBe(hugeMinorStr);
    });

    it("converts numbers and BigInt accurately to decimal strings", () => {
      expect(moneyToDecimalString(BigInt("123456789012345678"))).toBe("123456789012345678");
      expect(moneyToDecimalString(15000)).toBe("15000");
      expect(decimalStringToMoney("15000").amountMinor).toBe(15000n);
    });
  });

  describe("Schema validation & converter enforcement", () => {
    it("rejects malformed member documents in the database", async () => {
      // Directly inject a malformed document into fake storage
      await db.doc("orgs/org_alpha/members/bad_user").set({
        orgId: "org_alpha",
        uid: "bad_user",
        role: "superuser", // Invalid role enum
        createdAt: new Date(),
        createdBy: "admin",
      });

      await expect(membersRepo.get("org_alpha", "bad_user", db)).rejects.toThrow(
        RepositoryError
      );
    });

    it("rejects malformed instrument documents", async () => {
      await db.doc("orgs/org_alpha/instruments/bad_inst").set({
        id: "bad_inst",
        orgId: "org_alpha",
        name: "Broken Instrument",
        annualRateBps: -10, // Invalid: must be non-negative
        capacityMinor: "1000",
      });

      await expect(instrumentsRepo.get("org_alpha", "bad_inst", db)).rejects.toThrow(
        RepositoryError
      );
    });
  });

  describe("Transaction batched insert (500 write limit)", () => {
    it("splits writes into chunks of <= 500 when inserting more than 500 transactions", async () => {
      const TOTAL_TX = 1050;
      const transactions = Array.from({ length: TOTAL_TX }, (_, i) => ({
        ts: new Date("2026-03-01T00:00:00Z"),
        type: "deposit" as const,
        amount: "50000",
        source: "synthetic" as const,
        seed: i,
      }));

      const results = await transactionsRepo.batchInsert(
        "org_alpha",
        transactions,
        "generator_actor",
        db
      );

      expect(results).toHaveLength(TOTAL_TX);
      // 1050 writes should result in 3 batches (500 + 500 + 50)
      expect(fakeDb.batchCommitCount).toBe(3);
      expect(fakeDb.batchWritesCount).toBe(1050);
    });
  });

  describe("Audit repository immutability constraint", () => {
    it("does not expose update or delete methods on auditRepo", () => {
      const anyRepo = auditRepo as Record<string, unknown>;
      expect(anyRepo.update).toBeUndefined();
      expect(anyRepo.delete).toBeUndefined();
      expect(anyRepo.remove).toBeUndefined();
    });

    it("allows appending and reading immutable audit entries", async () => {
      const entry = await auditRepo.append(
        "org_alpha",
        {
          actorUid: "analyst_1",
          action: "RUN_FORECAST",
          refPath: "orgs/org_alpha/forecasts/fc_123",
          beforeHash: "hash_a",
          afterHash: "hash_b",
        },
        db
      );

      expect(entry.id).toBeDefined();
      expect(entry.action).toBe("RUN_FORECAST");

      const fetched = await auditRepo.get("org_alpha", entry.id, db);
      expect(fetched).not.toBeNull();
      expect(fetched?.actorUid).toBe("analyst_1");
    });
  });

  describe("Bounded pagination and limit caps", () => {
    it("clamps limits to a minimum of 1 and a maximum cap", () => {
      expect(clampLimit(undefined, 50, 500)).toBe(50);
      expect(clampLimit(-10, 50, 500)).toBe(1);
      expect(clampLimit(0, 50, 500)).toBe(1);
      expect(clampLimit(25, 50, 500)).toBe(25);
      expect(clampLimit(1000, 50, 500)).toBe(500); // capped at maxLimit
    });

    it("respects requested limits when listing instruments", async () => {
      for (let i = 0; i < 5; i++) {
        await instrumentsRepo.create(
          "org_alpha",
          {
            name: `Asset ${i}`,
            annualRateBps: 100 * i,
            settlementLagHours: 1,
            penaltyBps: 0,
            capacity: "1000000",
            minHoldHours: 1,
          },
          "admin",
          db
        );
      }

      const limited = await instrumentsRepo.list("org_alpha", { limit: 2 }, db);
      expect(limited).toHaveLength(2);
    });
  });

  describe("Series bucket repository", () => {
    it("upserts hourly buckets keyed by ISO hour and reads range", async () => {
      const hour1 = new Date("2026-03-01T10:00:00Z");
      const hour2 = new Date("2026-03-01T11:00:00Z");

      await seriesRepo.upsertBucket(
        "org_alpha",
        {
          hourStart: hour1,
          inMinor: "150000",
          outMinor: "40000",
        },
        db
      );

      await seriesRepo.upsertBucket(
        "org_alpha",
        {
          hourStart: hour2,
          inMinor: "200000",
          outMinor: "80000",
        },
        db
      );

      const list = await seriesRepo.listRange(
        "org_alpha",
        new Date("2026-03-01T09:00:00Z"),
        new Date("2026-03-01T12:00:00Z"),
        { limit: 10 },
        db
      );

      expect(list).toHaveLength(2);
      expect(list[0].inFlow.amountMinor).toBe(150000n);
      expect(list[1].outFlow.amountMinor).toBe(80000n);
    });
  });

  describe("Forecasts and Decisions repositories", () => {
    it("persists and retrieves forecast and decision records", async () => {
      const forecast = await forecastsRepo.create(
        "org_alpha",
        {
          method: "hour_of_week_smoothing",
          params: { alpha: 0.2 },
          asOf: new Date("2026-03-01T00:00:00Z"),
          horizon: 24,
          points: [
            { ts: new Date("2026-03-01T01:00:00Z"), mean: "12000000" },
          ],
          residualQuantiles: { "0.05": -50000, "0.50": 0, "0.95": 60000 },
          backtest: { mase: 0.85, pinball: 1420 },
        },
        "system_actor",
        db
      );

      expect(forecast.id).toBeDefined();

      const decision = await decisionsRepo.create(
        "org_alpha",
        {
          forecastId: forecast.id,
          confidence: 0.99,
          reserve: "5000000",
          surplus: "2500000",
          allocations: [
            { instrumentId: "inst_1", amount: "2500000" },
          ],
          status: "OPTIMAL",
          expectedNetYield: "45000",
          explanation: "Allocated surplus to Treasury Bills at 4.5% APY",
        },
        "system_actor",
        db
      );

      expect(decision.id).toBeDefined();

      const fetchedDecision = await decisionsRepo.get("org_alpha", decision.id, db);
      expect(fetchedDecision).not.toBeNull();
      expect(fetchedDecision?.reserve.amountMinor).toBe(5000000n);
      expect(fetchedDecision?.allocations[0].amount.amountMinor).toBe(2500000n);
    });
  });

  describe("Simulations repository", () => {
    it("persists and lists stress scenario simulation records", async () => {
      await simulationsRepo.create(
        "org_alpha",
        {
          scenario: "outflow_shock",
          seed: 12345,
          policy: "baseline",
          metrics: { maxDrawdownMinor: "1500000", breached: false },
        },
        "risk_analyst",
        db
      );

      const list = await simulationsRepo.list("org_alpha", { scenario: "outflow_shock" }, db);
      expect(list).toHaveLength(1);
      expect(list[0].scenario).toBe("outflow_shock");
      expect(list[0].seed).toBe(12345);
    });
  });

  describe("FirestoreMembershipStore integration", () => {
    it("correctly resolves member role via membersRepo", async () => {
      await membersRepo.putRole("org_alpha", "member_42", "admin", "owner", db);

      const store = new FirestoreMembershipStore();
      const role = await store.getRole("org_alpha", "member_42");
      expect(role).toBe("admin");

      const nonMemberRole = await store.getRole("org_alpha", "nobody");
      expect(nonMemberRole).toBeNull();
    });
  });
});
