import "server-only";

import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ObjectId, WithId } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "hq_staff_session";
const SESSION_LENGTH_MS = 1000 * 60 * 60 * 24 * 14;

export type StaffRole = "admin" | "barber";

export type StaffRecord = {
  name: string;
  email: string;
  phone?: string;
  smsNotificationsEnabled?: boolean;
  smsConsentAt?: Date;
  smsConsentSource?: string;
  role: StaffRole;
  adminAccess?: boolean;
  active: boolean;
  specialty?: string;
  nickname?: string;
  bio?: string;
  hasPhoto?: boolean;
  photoUpdatedAt?: Date;
  services?: string[];
  commissionPercentage?: number;
  posPinHash?: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StaffMember = WithId<StaffRecord>;
export type AuthenticatedStaff = Omit<StaffMember, "passwordHash" | "posPinHash">;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, key] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !key) return false;

  const expected = Buffer.from(key, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function getStaffCollection() {
  const client = await getMongoClient();
  return client.db("hqonmain").collection<StaffRecord>("staff");
}

export async function createSession(staff: StaffMember) {
  const client = await getMongoClient();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LENGTH_MS);

  await client.db("hqonmain").collection("staffSessions").insertOne({
    tokenHash: hashToken(token),
    staffId: staff._id,
    role: staff.role,
    expiresAt,
    createdAt: new Date(),
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
  process.env.AUTH_COOKIE_SECURE === "true" ||
  (process.env.AUTH_COOKIE_SECURE !== "false" &&
    process.env.NODE_ENV === "production"),
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    const client = await getMongoClient();
    await client
      .db("hqonmain")
      .collection("staffSessions")
      .deleteOne({ tokenHash: hashToken(token) });
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentStaff(): Promise<AuthenticatedStaff | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const session = await db.collection("staffSessions").findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });

  if (!session || !(session.staffId instanceof ObjectId)) return null;

  const staff = await db.collection<StaffMember>("staff").findOne({
    _id: session.staffId,
    active: true,
  });

  if (!staff) return null;

  const {
    passwordHash: _passwordHash,
    posPinHash: _posPinHash,
    ...safeStaff
  } = staff;
  void _passwordHash;
  void _posPinHash;
  return safeStaff;
}

export async function requireStaffRole(role: StaffRole) {
  const staff = await getCurrentStaff();
  if (!staff) redirect(role === "admin" ? "/admin/login" : "/barber/login");
  const authorized = (
    staff.role === role ||
    (role === "admin" && staff.role === "barber" && staff.adminAccess === true)
  );
  if (!authorized) {
    redirect(role === "admin" ? "/admin/login" : "/barber/login");
  }
  return staff;
}

export async function adminSetupRequired() {
  const staff = await getStaffCollection();
  return (await staff.countDocuments({ role: "admin" })) === 0;
}
