import { createCustomerSession } from "@/lib/customer-auth";
import { linkAppointmentsToCustomer, resolveCustomer } from "@/lib/customer-identity";
import { getMongoClient } from "@/lib/mongodb";
import { customerDisplayName } from "@/lib/phone";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const challengeId = String(body.challengeId ?? "");
    const firstName = String(body.firstName ?? "").trim();
    const lastName = String(body.lastName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (firstName.length < 1 || firstName.length > 80 || lastName.length > 100 || (email && !email.includes("@"))) {
      return Response.json({ message: "Enter your name and an optional valid email." }, { status: 400 });
    }
    const client = await getMongoClient();
    const db = client.db("hqonmain");
    const challenge = await db.collection("customerVerificationChallenges").findOne({
      challengeId,
      verifiedAt: { $exists: true },
      consumedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });
    if (!challenge) return Response.json({ message: "Phone verification expired. Request a new code." }, { status: 400 });
    const consumed = await db.collection("customerVerificationChallenges").updateOne(
      { _id: challenge._id, consumedAt: { $exists: false } },
      { $set: { consumedAt: new Date() } },
    );
    if (!consumed.modifiedCount) return Response.json({ message: "That verification has already been used." }, { status: 400 });
    const customer = await resolveCustomer({ phone: challenge.normalizedPhone, firstName, lastName, email, source: "online", verified: true });
    await linkAppointmentsToCustomer(customer);
    await createCustomerSession(customer);
    return Response.json({ customer: {
      name: customerDisplayName(customer),
      firstName: customer.firstName || firstName,
      lastName: customer.lastName || lastName,
      phone: customer.phone,
      email: customer.email || "",
      dependents: [],
    } });
  } catch (error) {
    console.error("Customer profile completion failed", error);
    return Response.json({ message: "Unable to finish your customer profile." }, { status: 500 });
  }
}
