import { createCustomerSession } from "@/lib/customer-auth";
import { findCustomersByPhone, linkAppointmentsToCustomer, resolveCustomer } from "@/lib/customer-identity";
import { hashesMatch, OTP_MAX_ATTEMPTS, verificationHash } from "@/lib/customer-verification";
import { getMongoClient } from "@/lib/mongodb";
import { customerDisplayName } from "@/lib/phone";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const challengeId = String(body.challengeId ?? "");
    const code = String(body.code ?? "").replace(/\D/g, "");
    const client = await getMongoClient();
    const db = client.db("hqonmain");
    const challenges = db.collection("customerVerificationChallenges");
    const challenge = await challenges.findOne({ challengeId });
    const invalid = !challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || Number(challenge.attempts ?? 0) >= OTP_MAX_ATTEMPTS || code.length !== 6;
    if (invalid) return Response.json({ message: "That code is invalid or expired. Request a new code." }, { status: 400 });
    const valid = hashesMatch(String(challenge.codeHash), verificationHash(challengeId, code));
    if (!valid) {
      await challenges.updateOne({ _id: challenge._id }, { $inc: { attempts: 1 }, $set: { lastAttemptAt: new Date() } });
      return Response.json({ message: "That code is invalid or expired. Request a new code." }, { status: 400 });
    }
    const matched = await findCustomersByPhone(db, challenge.normalizedPhone);
    if (!matched.customers.length) {
      await challenges.updateOne({ _id: challenge._id, consumedAt: { $exists: false } }, { $set: { verifiedAt: new Date() } });
      return Response.json({ verified: true, needsProfile: true, challengeId });
    }
    const consumed = await challenges.updateOne(
      { _id: challenge._id, consumedAt: { $exists: false } },
      { $set: { verifiedAt: new Date(), consumedAt: new Date() } },
    );
    if (!consumed.modifiedCount) return Response.json({ message: "That code has already been used." }, { status: 400 });
    const customer = await resolveCustomer({ phone: challenge.normalizedPhone, source: "online", verified: true });
    await linkAppointmentsToCustomer(customer);
    await createCustomerSession(customer);
    return Response.json({ verified: true, needsProfile: false, customer: safeCustomer(customer) });
  } catch (error) {
    console.error("Verification failed", error);
    return Response.json({ message: "Unable to verify that code." }, { status: 500 });
  }
}

function safeCustomer(customer: { firstName?: string; lastName?: string; name: string; phone: string; email?: string; dependents?: Array<{ id: string; firstName: string; lastName?: string; relationship?: string; active: boolean }> }) {
  return {
    name: customerDisplayName(customer),
    firstName: customer.firstName || customerDisplayName(customer).split(/\s+/)[0] || "",
    lastName: customer.lastName || customerDisplayName(customer).split(/\s+/).slice(1).join(" "),
    phone: customer.phone,
    email: customer.email || "",
    dependents: (customer.dependents ?? [])
      .filter((dependent) => dependent.active !== false)
      .map((dependent) => ({
        id: dependent.id,
        firstName: dependent.firstName,
        lastName: dependent.lastName || "",
        relationship: dependent.relationship === "dependent" ? "dependent" : "child",
      })),
  };
}
