import { getMongoClient } from "@/lib/mongodb";
import { normalizePhone } from "@/lib/phone";
import { sendVerificationCode } from "@/lib/sms-provider";
import { ensureVerificationIndexes, newChallengeId, newVerificationCode, OTP_TTL_MS, requestFingerprint, verificationHash } from "@/lib/customer-verification";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const normalizedPhone = normalizePhone(body.phone);
    if (!normalizedPhone) return Response.json({ message: "Enter a valid mobile phone number." }, { status: 400 });
    const client = await getMongoClient();
    const db = client.db("hqonmain");
    const challenges = await ensureVerificationIndexes(db);
    const fingerprint = requestFingerprint(request);
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const [phoneRequests, addressRequests] = await Promise.all([
      challenges.countDocuments({ normalizedPhone, createdAt: { $gte: cutoff } }),
      challenges.countDocuments({ requestFingerprint: fingerprint, createdAt: { $gte: cutoff } }),
    ]);
    if (phoneRequests >= 3 || addressRequests >= 10) {
      return Response.json({ message: "Please wait before requesting another code." }, { status: 429 });
    }
    const challengeId = newChallengeId();
    const code = newVerificationCode();
    const now = new Date();
    await challenges.insertOne({
      challengeId,
      normalizedPhone,
      codeHash: verificationHash(challengeId, code),
      attempts: 0,
      requestFingerprint: fingerprint,
      createdAt: now,
      expiresAt: new Date(now.valueOf() + OTP_TTL_MS),
    });
    try {
      await sendVerificationCode(normalizedPhone, code);
    } catch (error) {
      await challenges.deleteOne({ challengeId });
      console.error("Customer verification SMS failed", error);
      return Response.json({ message: "We couldn’t send a verification code. Please try again shortly." }, { status: 503 });
    }
    return Response.json({ challengeId, message: "If this number can receive texts, a verification code is on the way." });
  } catch (error) {
    console.error("Verification request failed", error);
    return Response.json({ message: "Unable to start phone verification." }, { status: 500 });
  }
}
