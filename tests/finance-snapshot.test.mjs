import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import {
  buildFinanceSnapshot,
  financeIntegrationKeyMatches,
  financeSnapshotAuthorization,
} from "../src/lib/finance-snapshot.ts";

const now = new Date("2026-08-31T18:00:00.000Z");

test("authenticates the configured integration key without accepting missing or incorrect keys", () => {
  assert.equal(financeIntegrationKeyMatches("shared-read-secret", "shared-read-secret"), true);
  assert.equal(financeIntegrationKeyMatches("shared-read-secret", "incorrect"), false);
  assert.equal(financeIntegrationKeyMatches("shared-read-secret", null), false);
  assert.equal(financeIntegrationKeyMatches(undefined, "shared-read-secret"), false);
  assert.equal(financeSnapshotAuthorization(undefined, "shared-read-secret"), "unconfigured");
  assert.equal(financeSnapshotAuthorization("shared-read-secret", null), "unauthorized");
  assert.equal(financeSnapshotAuthorization("shared-read-secret", "incorrect"), "unauthorized");
  assert.equal(financeSnapshotAuthorization("shared-read-secret", "shared-read-secret"), "authorized");
});

test("returns only completed cash sales, paid payouts, and closed closeouts", () => {
  const includedSaleId = new ObjectId();
  const includedPayoutId = new ObjectId();
  const includedCloseoutId = new ObjectId();
  const barberId = new ObjectId();
  const snapshot = buildFinanceSnapshot({
    generatedAt: now,
    contractors: [],
    sales: [
      sale({ _id: includedSaleId, barberId }),
      sale({ status: "confirmed", barberId }),
      sale({ checkoutMethod: "card", barberId }),
    ],
    payouts: [
      payout({ _id: includedPayoutId, barberId }),
      payout({ barberId, history: [], status: "pending" }),
      payout({ barberId, paidAmountCents: 0 }),
    ],
    closeouts: [
      closeout({ _id: includedCloseoutId }),
      closeout({ status: "open" }),
    ],
  });

  assert.deepEqual(snapshot.sales.map(({ id }) => id), [includedSaleId.toString()]);
  assert.deepEqual(snapshot.payouts.map(({ id }) => id), [includedPayoutId.toString()]);
  assert.deepEqual(snapshot.closeouts.map(({ id }) => id), [includedCloseoutId.toString()]);
  const { businessDate, hqRetainedCents, varianceCents, status } = snapshot.closeouts[0];
  assert.deepEqual(
    { businessDate, hqRetainedCents, varianceCents, status },
    { businessDate: "2026-08-31", hqRetainedCents: 14000, varianceCents: 0, status: "closed" },
  );
});

test("uses stable source IDs and updated timestamps as advancing revisions", () => {
  const id = new ObjectId();
  const barberId = new ObjectId();
  const first = buildFinanceSnapshot({
    generatedAt: now,
    contractors: [],
    sales: [sale({ _id: id, barberId, updatedAt: "2026-08-31T17:00:00.000Z" })],
    payouts: [],
    closeouts: [],
  }).sales[0];
  const corrected = buildFinanceSnapshot({
    generatedAt: now,
    contractors: [],
    sales: [sale({ _id: id, barberId, checkoutAmountCents: 4000, updatedAt: "2026-08-31T18:00:00.000Z" })],
    payouts: [],
    closeouts: [],
  }).sales[0];

  assert.equal(first.id, corrected.id);
  assert.notEqual(first.revision, corrected.revision);
  assert.equal(corrected.grossCents, 4000);
  assert.equal(corrected.revision, corrected.updatedAt);
});

test("omits records with fractional cents and emits no sensitive or internal fields", () => {
  const barberId = new ObjectId();
  const snapshot = buildFinanceSnapshot({
    generatedAt: now,
    contractors: [{
      _id: barberId,
      name: "Barber name",
      email: "barber@example.com",
      phone: "",
      active: true,
      commissionPercentage: 60,
      updatedAt: now,
      passwordHash: "secret-hash",
      taxId: "sensitive",
    }],
    sales: [
      sale({ barberId, customerName: "Customer", phone: "3175550123", notes: "Private" }),
      sale({ barberId, checkoutAmountCents: 3500.5 }),
    ],
    payouts: [payout({ barberId, paidAmountCents: 2100.5 })],
    closeouts: [closeout({ varianceCents: 0.5 })],
  });

  assert.equal(snapshot.sales.length, 1);
  assert.equal(snapshot.payouts.length, 0);
  assert.equal(snapshot.closeouts.length, 0);
  assert.deepEqual(Object.keys(snapshot.contractors[0]).sort(), [
    "active", "commissionPercentage", "email", "id", "name", "phone", "updatedAt",
  ]);
  assert.deepEqual(Object.keys(snapshot.sales[0]).sort(), [
    "barberId", "barberName", "businessDate", "grossCents", "id", "revision", "updatedAt",
  ]);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["customerName", "notes", "passwordHash", "taxId", "financialAccounts", "financialJournalEntries"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("preserves signed integer drawer variances", () => {
  const snapshot = buildFinanceSnapshot({
    generatedAt: now,
    contractors: [],
    sales: [],
    payouts: [],
    closeouts: [closeout({ varianceCents: -125 })],
  });

  assert.equal(snapshot.closeouts[0].varianceCents, -125);
});

test("rejects closeouts with missing or invalid retained cash cents", () => {
  const snapshot = buildFinanceSnapshot({
    generatedAt: now,
    contractors: [],
    sales: [],
    payouts: [],
    closeouts: [
      closeout({ hqRetainedCents: undefined }),
      closeout({ hqRetainedCents: 14000.5 }),
      closeout({ hqRetainedCents: -100 }),
    ],
  });

  assert.deepEqual(snapshot.closeouts, []);
});

function sale(overrides = {}) {
  return {
    _id: new ObjectId(),
    status: "completed",
    checkoutMethod: "cash",
    checkoutAmountCents: 3500,
    requestedDate: "2026-08-31",
    barberId: new ObjectId(),
    barber: "Barber name",
    updatedAt: now,
    ...overrides,
  };
}

function payout(overrides = {}) {
  return {
    _id: new ObjectId(),
    paidAmountCents: 2100,
    businessDate: "2026-08-31",
    barberId: new ObjectId(),
    barberName: "Barber name",
    history: [{ paidAt: now }],
    updatedAt: now,
    ...overrides,
  };
}

function closeout(overrides = {}) {
  return {
    _id: new ObjectId(),
    businessDate: "2026-08-31",
    hqRetainedCents: 14000,
    varianceCents: 0,
    status: "closed",
    updatedAt: now,
    ...overrides,
  };
}
