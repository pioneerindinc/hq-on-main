import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import type { AuthenticatedStaff, StaffMember } from "@/lib/auth";

const POS_SESSION_COOKIE = "hq_pos_session";
const POS_SESSION_LENGTH_MS = 1000 * 60 * 60 * 12;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPosSession(staffId: ObjectId) {
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + POS_SESSION_LENGTH_MS);

  const sessions = db.collection("posSessions");
  await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await sessions.deleteMany({ staffId });
  await sessions.insertOne({
    tokenHash: hashToken(token),
    staffId,
    expiresAt,
    createdAt: new Date(),
  });

  const cookieStore = await cookies();
  cookieStore.set(POS_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.AUTH_COOKIE_SECURE === "true" ||
      (process.env.AUTH_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production"),
    path: "/pos",
    expires: expiresAt,
  });
}

export async function deletePosSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(POS_SESSION_COOKIE)?.value;
  if (token) {
    const client = await getMongoClient();
    await client.db("hqonmain").collection("posSessions").deleteOne({
      tokenHash: hashToken(token),
    });
  }
  cookieStore.set(POS_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.AUTH_COOKIE_SECURE === "true" ||
      (process.env.AUTH_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production"),
    path: "/pos",
    expires: new Date(0),
  });
}

export async function getCurrentPosBarber(): Promise<AuthenticatedStaff | null> {
  const token = (await cookies()).get(POS_SESSION_COOKIE)?.value;
  if (!token) return null;

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const session = await db.collection("posSessions").findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session || !(session.staffId instanceof ObjectId)) return null;

  const barber = await db.collection<StaffMember>("staff").findOne({
    _id: session.staffId,
    role: "barber",
    active: true,
  });
  if (!barber) return null;

  const {
    passwordHash: _passwordHash,
    posPinHash: _posPinHash,
    ...safeBarber
  } = barber;
  void _passwordHash;
  void _posPinHash;
  return safeBarber;
}
