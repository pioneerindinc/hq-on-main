import "server-only";

import { ObjectId, type Db } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import { customerDisplayName, normalizePhone, splitCustomerName } from "@/lib/phone";
import type { Customer, CustomerRecord } from "@/lib/customer-auth";

export type CustomerSource = "online" | "staff" | "phone" | "walk_in" | "vapi" | "migration";

function phonePattern(normalizedPhone: string) {
  const digits = normalizedPhone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return new RegExp(digits.split("").map((digit) => `${digit}\\D*`).join("") + "$", "i");
}

export async function findCustomersByPhone(db: Db, phone: unknown) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return { normalizedPhone: null, customers: [] as Customer[] };
  let customers = await db.collection<CustomerRecord>("customers").find({ normalizedPhone }).sort({ createdAt: 1 }).toArray();
  if (!customers.length) {
    customers = await db.collection<CustomerRecord>("customers").find({ phone: phonePattern(normalizedPhone) }).sort({ createdAt: 1 }).limit(10).toArray();
  }
  return { normalizedPhone, customers };
}

export async function resolveCustomer({
  phone,
  firstName,
  lastName,
  name,
  email,
  source,
  verified = false,
  createdByUserId,
}: {
  phone: unknown;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  source: CustomerSource;
  verified?: boolean;
  createdByUserId?: ObjectId;
}) {
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const match = await findCustomersByPhone(db, phone);
  if (!match.normalizedPhone) throw new Error("A valid mobile phone number is required.");
  const suppliedName = name?.trim() || [firstName, lastName].filter(Boolean).join(" ").trim();
  const split = splitCustomerName(suppliedName);
  const normalizedEmail = email?.trim().toLowerCase() || undefined;
  const now = new Date();
  const emailCandidate = !match.customers.length && normalizedEmail
    ? await db.collection<CustomerRecord>("customers").findOne({ email: normalizedEmail })
    : null;
  const emailCandidatePhone = emailCandidate ? normalizePhone(emailCandidate.normalizedPhone || emailCandidate.phone) : null;
  const safeEmailCandidate = emailCandidate && !emailCandidatePhone ? emailCandidate : null;

  if (match.customers.length || safeEmailCandidate) {
    const customer = match.customers[0] || safeEmailCandidate!;
    const duplicate = match.customers.length > 1;
    await db.collection<CustomerRecord>("customers").updateOne(
      { _id: customer._id },
      {
        $set: {
          normalizedPhone: match.normalizedPhone,
          phone: match.normalizedPhone,
          ...(!customer.firstName && split.firstName ? { firstName: split.firstName } : {}),
          ...(!customer.lastName && split.lastName ? { lastName: split.lastName } : {}),
          ...(!customer.name && suppliedName ? { name: suppliedName } : {}),
          ...(!customer.email && normalizedEmail ? { email: normalizedEmail } : {}),
          ...(verified ? { phoneVerifiedAt: now, status: "active" as const } : {}),
          ...(duplicate ? { possibleDuplicate: true, duplicateReviewKey: match.normalizedPhone } : {}),
          updatedAt: now,
        },
      },
    );
    if (duplicate) {
      await db.collection<CustomerRecord>("customers").updateMany(
        { _id: { $in: match.customers.slice(1).map((item) => item._id) } },
        { $set: { possibleDuplicate: true, duplicateReviewKey: match.normalizedPhone, updatedAt: now } },
      );
    }
    return (await db.collection<CustomerRecord>("customers").findOne({ _id: customer._id }))!;
  }

  if (!split.firstName) throw new Error("A customer first name is required.");
  const ambiguousEmail = Boolean(emailCandidate && emailCandidatePhone && emailCandidatePhone !== match.normalizedPhone);
  if (ambiguousEmail && emailCandidate) {
    await db.collection<CustomerRecord>("customers").updateOne(
      { _id: emailCandidate._id },
      { $set: { possibleDuplicate: true, duplicateReviewKey: `email:${normalizedEmail}`, updatedAt: now } },
    );
  }
  const record: CustomerRecord = {
    name: customerDisplayName({ firstName: split.firstName, lastName: split.lastName }),
    firstName: split.firstName,
    lastName: split.lastName,
    phone: match.normalizedPhone,
    normalizedPhone: match.normalizedPhone,
    ...(verified ? { phoneVerifiedAt: now } : {}),
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    createdBySource: source,
    ...(createdByUserId ? { createdByUserId } : {}),
    status: "active",
    ...(ambiguousEmail ? { possibleDuplicate: true, duplicateReviewKey: `email:${normalizedEmail}` } : {}),
    createdAt: now,
    updatedAt: now,
  };
  try {
    const result = await db.collection<CustomerRecord>("customers").insertOne(record);
    return { ...record, _id: result.insertedId };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      const existing = await db.collection<CustomerRecord>("customers").findOne({ normalizedPhone: match.normalizedPhone });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function linkAppointmentsToCustomer(customer: Customer) {
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const normalizedPhone = customer.normalizedPhone || normalizePhone(customer.phone);
  if (!normalizedPhone) return 0;
  const candidates = await db.collection("appointments").find({
    $or: [{ customerId: { $exists: false } }, { customerId: null }],
    phone: phonePattern(normalizedPhone),
  }).project({ _id: 1 }).toArray();
  if (!candidates.length) return 0;
  const result = await db.collection("appointments").updateMany(
    { _id: { $in: candidates.map((item) => item._id) } },
    { $set: { customerId: customer._id, customerLinkedAt: new Date(), updatedAt: new Date() } },
  );
  return result.modifiedCount;
}
