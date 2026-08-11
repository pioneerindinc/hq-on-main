export function normalizePhone(phone: unknown) {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function formatPhone(phone: unknown) {
  const normalized = normalizePhone(phone);
  if (!normalized) return String(phone ?? "");
  const digits = normalized.slice(1);
  if (digits.length === 11 && digits.startsWith("1")) {
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return normalized;
}

export function splitCustomerName(name: unknown) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export function customerDisplayName(customer: { name?: string; firstName?: string; lastName?: string }) {
  return customer.name?.trim() || [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
}
