import "server-only";

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "mongodb";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

function secret() {
  const value = process.env.CUSTOMER_OTP_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("CUSTOMER_OTP_SECRET must contain at least 32 characters.");
  return value;
}

export function newVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function newChallengeId() {
  return randomBytes(24).toString("base64url");
}

export function verificationHash(challengeId: string, code: string) {
  return createHmac("sha256", secret()).update(`${challengeId}:${code}`).digest("hex");
}

export function hashesMatch(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  return createHash("sha256").update(`${secret()}:${forwarded.trim()}`).digest("hex");
}

export async function ensureVerificationIndexes(db: Db) {
  const challenges = db.collection("customerVerificationChallenges");
  await Promise.all([
    challenges.createIndex({ challengeId: 1 }, { unique: true }),
    challenges.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    challenges.createIndex({ normalizedPhone: 1, createdAt: -1 }),
    challenges.createIndex({ requestFingerprint: 1, createdAt: -1 }),
  ]);
  return challenges;
}
