export function parseMoneyToCents(value: unknown) {
  const normalized = String(value ?? "").trim().replace(/[$,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) return null;
  return Math.round(amount * 100);
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function roundCashPayoutCents(cents: number) {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return Math.round(cents / 100) * 100;
}

export function formatWholeDollarMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(roundCashPayoutCents(cents) / 100);
}

export function priceLabelToCents(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\$/.test(text) ? parseMoneyToCents(text) : null;
}
