import { createHash, timingSafeEqual } from "node:crypto";

export const FINANCE_SNAPSHOT_CONTRACT_VERSION = 1 as const;
export const FINANCE_SNAPSHOT_ORGANIZATION_ID = "hq-on-main" as const;

type SourceRecord = {
  _id?: unknown;
  [key: string]: unknown;
};

export type FinanceSnapshot = {
  ok: true;
  contractVersion: typeof FINANCE_SNAPSHOT_CONTRACT_VERSION;
  organizationId: typeof FINANCE_SNAPSHOT_ORGANIZATION_ID;
  generatedAt: string;
  contractors: Array<{
    id: string;
    name: string;
    email: string;
    phone: string;
    active: boolean;
    commissionPercentage: number;
    updatedAt: string;
  }>;
  sales: Array<{
    id: string;
    revision: string;
    businessDate: string;
    barberId: string;
    barberName: string;
    grossCents: number;
    updatedAt: string;
  }>;
  payouts: Array<{
    id: string;
    revision: string;
    businessDate: string;
    barberId: string;
    barberName: string;
    paidAmountCents: number;
    reference?: string;
    updatedAt: string;
  }>;
  closeouts: Array<{
    id: string;
    revision: string;
    businessDate: string;
    hqRetainedCents: number;
    varianceCents: number;
    status: "closed";
    updatedAt: string;
  }>;
};

export type FinanceSnapshotAuthorization = "authorized" | "unconfigured" | "unauthorized";

export function financeSnapshotAuthorization(configuredSecret: string | undefined, suppliedSecret: string | null): FinanceSnapshotAuthorization {
  if (!configuredSecret) return "unconfigured";
  return financeIntegrationKeyMatches(configuredSecret, suppliedSecret) ? "authorized" : "unauthorized";
}

export function financeIntegrationKeyMatches(configuredSecret: string | undefined, suppliedSecret: string | null) {
  if (!configuredSecret || !suppliedSecret) return false;
  const configuredDigest = createHash("sha256").update(configuredSecret).digest();
  const suppliedDigest = createHash("sha256").update(suppliedSecret).digest();
  return timingSafeEqual(configuredDigest, suppliedDigest);
}

export function buildFinanceSnapshot({
  generatedAt,
  contractors,
  sales,
  payouts,
  closeouts,
}: {
  generatedAt: Date;
  contractors: readonly SourceRecord[];
  sales: readonly SourceRecord[];
  payouts: readonly SourceRecord[];
  closeouts: readonly SourceRecord[];
}): FinanceSnapshot {
  return {
    ok: true,
    contractVersion: FINANCE_SNAPSHOT_CONTRACT_VERSION,
    organizationId: FINANCE_SNAPSHOT_ORGANIZATION_ID,
    generatedAt: generatedAt.toISOString(),
    contractors: contractors.flatMap((record) => {
      const id = stableId(record._id);
      const name = text(record.name);
      const updatedAt = isoTimestamp(record.updatedAt);
      const commissionPercentage = finitePercentage(record.commissionPercentage);
      if (!id || !name || !updatedAt || commissionPercentage === null) return [];
      return [{
        id,
        name,
        email: text(record.email),
        phone: text(record.phone),
        active: record.active === true,
        commissionPercentage,
        updatedAt,
      }];
    }).sort(byId),
    sales: sales.flatMap((record) => {
      const id = stableId(record._id);
      const updatedAt = isoTimestamp(record.updatedAt);
      const businessDate = dateOnly(record.requestedDate);
      const barberId = stableId(record.barberId);
      const barberName = text(record.barber);
      const grossCents = integerCents(record.checkoutAmountCents, true);
      if (
        record.status !== "completed" ||
        record.checkoutMethod !== "cash" ||
        !id || !updatedAt || !businessDate || !barberId || !barberName || grossCents === null
      ) return [];
      return [{ id, revision: updatedAt, businessDate, barberId, barberName, grossCents, updatedAt }];
    }).sort(byId),
    payouts: payouts.flatMap((record) => {
      const id = stableId(record._id);
      const updatedAt = isoTimestamp(record.updatedAt);
      const businessDate = dateOnly(record.businessDate);
      const barberId = stableId(record.barberId);
      const barberName = text(record.barberName);
      const paidAmountCents = integerCents(record.paidAmountCents, false);
      if (!isPaidPayout(record) || !id || !updatedAt || !businessDate || !barberId || !barberName || paidAmountCents === null) return [];
      const reference = text(record.reference);
      return [{
        id,
        revision: updatedAt,
        businessDate,
        barberId,
        barberName,
        paidAmountCents,
        ...(reference ? { reference } : {}),
        updatedAt,
      }];
    }).sort(byId),
    closeouts: closeouts.flatMap((record) => {
      const id = stableId(record._id);
      const updatedAt = isoTimestamp(record.updatedAt);
      const businessDate = dateOnly(record.businessDate);
      const hqRetainedCents = integerCents(record.hqRetainedCents, true);
      const varianceCents = signedIntegerCents(record.varianceCents);
      if (record.status !== "closed" || !id || !updatedAt || !businessDate || hqRetainedCents === null || varianceCents === null) return [];
      return [{ id, revision: updatedAt, businessDate, hqRetainedCents, varianceCents, status: "closed" as const, updatedAt }];
    }).sort(byId),
  };
}

function stableId(value: unknown) {
  if (value === null || value === undefined) return "";
  const id = String(value).trim();
  return id && id !== "undefined" && id !== "null" && id !== "[object Object]" ? id : "";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateOnly(value: unknown) {
  const date = text(value);
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

function isoTimestamp(value: unknown) {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.valueOf()) ? date.toISOString() : "";
}

function integerCents(value: unknown, allowZero: boolean) {
  return Number.isSafeInteger(value) && (allowZero ? Number(value) >= 0 : Number(value) > 0) ? Number(value) : null;
}

function signedIntegerCents(value: unknown) {
  return Number.isSafeInteger(value) ? Number(value) : null;
}

function finitePercentage(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function isPaidPayout(record: SourceRecord) {
  if (record.status === "paid" || isoTimestamp(record.paidAt)) return true;
  return Array.isArray(record.history) && record.history.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return Boolean(isoTimestamp((entry as { paidAt?: unknown }).paidAt));
  });
}

function byId<T extends { id: string }>(left: T, right: T) {
  return left.id.localeCompare(right.id);
}
