import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import type { StaffRecord } from "@/lib/auth";

const SETUP_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueBarberSetupToken({
  staffId,
  createdByStaffId,
  purpose,
}: {
  staffId: ObjectId;
  createdByStaffId: ObjectId;
  purpose: "onboarding" | "reset";
}) {
  const client = await getMongoClient();
  const tokens = client.db("hqonmain").collection("barberSetupTokens");
  await Promise.all([
    tokens.createIndex({ tokenHash: 1 }, { unique: true }),
    tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    tokens.updateMany({ staffId, consumedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }),
  ]);
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await tokens.insertOne({
    tokenHash: hashToken(token),
    staffId,
    createdByStaffId,
    purpose,
    createdAt: now,
    expiresAt: new Date(now.valueOf() + SETUP_LIFETIME_MS),
  });
  return token;
}

export async function getBarberSetupInvitation(token: string) {
  if (token.length < 32) return null;
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const invitation = await db.collection("barberSetupTokens").findOne({
    tokenHash: hashToken(token),
    consumedAt: { $exists: false },
    revokedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  if (!invitation || !(invitation.staffId instanceof ObjectId)) return null;
  const barber = await db.collection("staff").findOne({ _id: invitation.staffId, role: "barber", active: true });
  if (!barber) return null;
  return { name: String(barber.name), email: String(barber.email), purpose: invitation.purpose === "reset" ? "reset" as const : "onboarding" as const };
}

export async function completeBarberCredentialSetup({
  token,
  passwordHash,
  posPinHash,
  phone,
  smsNotificationsEnabled,
}: {
  token: string;
  passwordHash: string;
  posPinHash: string;
  phone: string;
  smsNotificationsEnabled: boolean;
}) {
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const session = client.startSession();
  let staffId: ObjectId | null = null;
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const invitation = await db.collection("barberSetupTokens").findOne({
        tokenHash: hashToken(token),
        consumedAt: { $exists: false },
        revokedAt: { $exists: false },
        expiresAt: { $gt: now },
      }, { session });
      if (!invitation || !(invitation.staffId instanceof ObjectId)) throw new Error("This setup link is invalid or has expired.");
      staffId = invitation.staffId;
      const updated = await db.collection("staff").updateOne(
        { _id: staffId, role: "barber", active: true },
        {
          $set: {
            passwordHash,
            posPinHash,
            phone,
            smsNotificationsEnabled,
            credentialsConfiguredAt: now,
            ...(smsNotificationsEnabled ? { smsConsentAt: now, smsConsentSource: "barber-self-setup" } : {}),
            updatedAt: now,
          },
          ...(!smsNotificationsEnabled ? { $unset: { smsConsentAt: "", smsConsentSource: "" } } : {}),
        },
        { session },
      );
      if (!updated.modifiedCount) throw new Error("This barber account is unavailable.");
      await db.collection("barberSetupTokens").updateOne({ _id: invitation._id }, { $set: { consumedAt: now } }, { session });
      await db.collection("staffSessions").deleteMany({ staffId }, { session });
      await db.collection("posSessions").deleteMany({ staffId }, { session });
    });
  } finally {
    await session.endSession();
  }
  if (!staffId) throw new Error("This setup link is invalid or has expired.");
  return db.collection<StaffRecord>("staff").findOne({ _id: staffId, role: "barber", active: true });
}
