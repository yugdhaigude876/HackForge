import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ID = "demo-reserve-juggler";

describe("Firestore Security Rules", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: "127.0.0.1",
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();

      // Seed initial structure using privileged admin context (rules bypassed)
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();

        // Org Alpha members
        await db.doc("orgs/org_alpha/members/alice").set({
          role: "admin",
          createdAt: new Date(),
          createdBy: "system",
        });
        await db.doc("orgs/org_alpha/members/bob").set({
          role: "analyst",
          createdAt: new Date(),
          createdBy: "system",
        });
        await db.doc("orgs/org_alpha/members/charlie").set({
          role: "viewer",
          createdAt: new Date(),
          createdBy: "system",
        });

        // Org Beta member
        await db.doc("orgs/org_beta/members/david").set({
          role: "admin",
          createdAt: new Date(),
          createdBy: "system",
        });

        // Org Alpha documents
        await db.doc("orgs/org_alpha").set({
          name: "Alpha Reserve Fund",
          currency: "USD",
          createdAt: new Date(),
        });
        await db.doc("orgs/org_alpha/instruments/inst_1").set({
          name: "Treasury Bills",
          annualRateBps: 450,
        });
        await db.doc("orgs/org_alpha/transactions/tx_1").set({
          amountMinor: "100000",
          type: "deposit",
        });
        await db.doc("orgs/org_alpha/series/2026-03-01T00-00-00Z").set({
          inMinor: "100000",
          outMinor: "50000",
        });
        await db.doc("orgs/org_alpha/forecasts/fc_1").set({
          method: "seasonal_naive",
          horizon: 24,
        });
        await db.doc("orgs/org_alpha/decisions/dec_1").set({
          confidence: 0.95,
          reserveMinor: "500000",
        });
        await db.doc("orgs/org_alpha/simulations/sim_1").set({
          scenario: "liquidity_shock",
          seed: 42,
        });
        await db.doc("orgs/org_alpha/audit/aud_1").set({
          action: "DECISION_CREATED",
          actorUid: "alice",
        });
      });
    }
  });

  it("denies unauthenticated read requests", async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthedDb.doc("orgs/org_alpha/decisions/dec_1").get());
    await assertFails(unauthedDb.doc("orgs/org_alpha/instruments/inst_1").get());
  });

  it("denies authenticated read requests from non-members", async () => {
    const eveDb = testEnv.authenticatedContext("eve").firestore();
    await assertFails(eveDb.doc("orgs/org_alpha/decisions/dec_1").get());
    await assertFails(eveDb.doc("orgs/org_alpha/members/alice").get());
  });

  it("allows authenticated member read requests within their organisation", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(aliceDb.doc("orgs/org_alpha").get());
    await assertSucceeds(aliceDb.doc("orgs/org_alpha/decisions/dec_1").get());
    await assertSucceeds(aliceDb.doc("orgs/org_alpha/instruments/inst_1").get());
    await assertSucceeds(aliceDb.doc("orgs/org_alpha/members/bob").get());
  });

  it("denies a member from org A from reading documents in org B", async () => {
    // david is an admin in org_beta, but NOT a member of org_alpha
    const davidDb = testEnv.authenticatedContext("david").firestore();
    await assertFails(davidDb.doc("orgs/org_alpha/decisions/dec_1").get());
    await assertFails(davidDb.doc("orgs/org_alpha/instruments/inst_1").get());
  });

  it("denies all client writes to decisions, forecasts, simulations, and members", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();

    await assertFails(
      aliceDb.doc("orgs/org_alpha/decisions/client_dec").set({
        reserveMinor: "999999",
      })
    );

    await assertFails(
      aliceDb.doc("orgs/org_alpha/forecasts/client_fc").set({
        method: "hacked",
      })
    );

    await assertFails(
      aliceDb.doc("orgs/org_alpha/simulations/client_sim").set({
        scenario: "tampered",
      })
    );

    await assertFails(
      aliceDb.doc("orgs/org_alpha/members/intruder").set({
        role: "admin",
      })
    );
  });

  it("denies all client writes to transactions, series, instruments, and org roots", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();

    await assertFails(
      aliceDb.doc("orgs/org_alpha/transactions/client_tx").set({
        amountMinor: "1000000000",
      })
    );

    await assertFails(
      aliceDb.doc("orgs/org_alpha/series/2026-03-01T01-00-00Z").set({
        inMinor: "0",
      })
    );

    await assertFails(
      aliceDb.doc("orgs/org_alpha/instruments/client_inst").set({
        name: "Fake Asset",
      })
    );

    await assertFails(
      aliceDb.doc("orgs/org_alpha").update({
        name: "Renamed Org",
      })
    );
  });

  it("denies audit updates and deletes even for an admin member", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();

    // Deny create
    await assertFails(
      aliceDb.doc("orgs/org_alpha/audit/client_aud").set({
        action: "INJECTED_ACTION",
      })
    );

    // Deny update
    await assertFails(
      aliceDb.doc("orgs/org_alpha/audit/aud_1").update({
        action: "TAMPERED_ACTION",
      })
    );

    // Deny delete
    await assertFails(aliceDb.doc("orgs/org_alpha/audit/aud_1").delete());
  });

  it("denies access to unknown paths outside the orgs collection hierarchy", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    await assertFails(aliceDb.doc("system_settings/config").get());
    await assertFails(aliceDb.doc("unknown_collection/doc_1").set({ foo: "bar" }));
  });
});
