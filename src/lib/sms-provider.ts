import "server-only";

import { getMongoClient } from "@/lib/mongodb";

export async function sendVerificationCode(phone: string, code: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const apiKey = process.env.TWILIO_API_KEY?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const from = process.env.TWILIO_PHONE_NUMBER?.trim();
  const credentials = apiKey && apiKeySecret
    ? { username: apiKey, password: apiKeySecret }
    : authToken && accountSid
      ? { username: accountSid, password: authToken }
      : null;
  if (!accountSid || !credentials || (!messagingServiceSid && !from)) {
    throw new Error("SMS verification is not configured.");
  }

  const params = new URLSearchParams({
    To: phone,
    Body: `HQ on Main verification code: ${code}. It expires in 10 minutes. Do not share this code.`,
  });
  if (messagingServiceSid) params.set("MessagingServiceSid", messagingServiceSid);
  else params.set("From", from!);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const result = await response.json() as { sid?: string; message?: string };
  if (!response.ok || !result.sid) throw new Error(result.message || "Unable to send verification code.");
  const client = await getMongoClient();
  await client.db("hqonmain").collection("smsMessages").insertOne({
    kind: "customer-verification",
    audience: "customer",
    to: phone,
    twilioMessageSid: result.sid,
    status: "queued",
    createdAt: new Date(),
  });
  return { sent: true };
}
