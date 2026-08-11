import test from "node:test";
import assert from "node:assert/strict";

function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

test("normalizes common US phone formats to one identity", () => {
  const formats = ["3175550123", "(317) 555-0123", "+1 317 555 0123", "1-317-555-0123"];
  assert.deepEqual(formats.map(normalizePhone), Array(4).fill("+13175550123"));
});

test("rejects invalid phone identities", () => {
  assert.equal(normalizePhone("555-0123"), null);
  assert.equal(normalizePhone(""), null);
});

test("preserves valid international E.164 input", () => {
  assert.equal(normalizePhone("+442071838750"), "+442071838750");
});
