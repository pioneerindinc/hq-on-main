import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { ObjectId, WithId } from "mongodb";
import { redirect } from "next/navigation";
import { getMongoClient } from "@/lib/mongodb";

const CUSTOMER_COOKIE = "hq_customer_session";
const SESSION_LENGTH_MS = 1000 * 60 * 60 * 24 * 30;

export type CustomerRecord = {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Customer = WithId<CustomerRecord>;
export type SafeCustomer = Omit<Customer, "passwordHash">;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getCustomerCollection() {
  const client = await getMongoClient();
  return client.db("hqonmain").collection<CustomerRecord>("customers");
}

export async function createCustomerSession(customer: Customer) {
  const client = await getMongoClient();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LENGTH_MS);
  await client.db("hqonmain").collection("customerSessions").insertOne({
    tokenHash: hashToken(token),
    customerId: customer._id,
    expiresAt,
    createdAt: new Date(),
  });
  (await cookies()).set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteCustomerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_COOKIE)?.value;
  if (token) {
    const client = await getMongoClient();
    await client
      .db("hqonmain")
      .collection("customerSessions")
      .deleteOne({ tokenHash: hashToken(token) });
  }
  cookieStore.delete(CUSTOMER_COOKIE);
}

export async function deleteAllCustomerSessions(customerId: ObjectId) {
  const client = await getMongoClient();
  await client
    .db("hqonmain")
    .collection("customerSessions")
    .deleteMany({ customerId });
  (await cookies()).delete(CUSTOMER_COOKIE);
}

export async function getCurrentCustomer(): Promise<SafeCustomer | null> {
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const session = await db.collection("customerSessions").findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session || !(session.customerId instanceof ObjectId)) return null;
  const customer = await db
    .collection<CustomerRecord>("customers")
    .findOne({ _id: session.customerId });
  if (!customer) return null;
  const { passwordHash: _passwordHash, ...safeCustomer } = customer;
  void _passwordHash;
  return safeCustomer;
}

export async function requireCustomer() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/customer/login");
  return customer;
}
