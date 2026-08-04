import { timingSafeEqual } from "node:crypto";
import { getMongoClient } from "@/lib/mongodb";
import {
  appointmentInstant,
  isSmsConfigured,
  sendAppointmentReminder,
  type SmsAppointment,
} from "@/lib/twilio-sms";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isSmsConfigured()) {
    return Response.json(
      { error: "Twilio messaging is not fully configured." },
      { status: 503 },
    );
  }

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const now = new Date();
  const staleClaim = new Date(now.getTime() - 60 * 60 * 1000);
  const appointments = await db
    .collection<SmsAppointment>("appointments")
    .find({
      status: "confirmed",
      smsConsent: true,
      reminderSentAt: { $exists: false },
      $or: [
        { reminderClaimedAt: { $exists: false } },
        { reminderClaimedAt: { $lt: staleClaim } },
      ],
    })
    .project<SmsAppointment>({
      name: 1,
      phone: 1,
      service: 1,
      barber: 1,
      requestedDate: 1,
      requestedTime: 1,
      smsConsent: 1,
    })
    .limit(500)
    .toArray();

  const leadMinutes = positiveNumber(process.env.TWILIO_REMINDER_HOURS_BEFORE, 24) * 60;
  const windowMinutes = positiveNumber(process.env.TWILIO_REMINDER_WINDOW_MINUTES, 20);
  let sent = 0;
  let failed = 0;

  for (const appointment of appointments) {
    const appointmentAt = appointmentInstant(
      text(appointment.requestedDate),
      text(appointment.requestedTime),
    );
    if (!appointmentAt) continue;
    const minutesUntil = (appointmentAt.getTime() - now.getTime()) / 60_000;
    if (minutesUntil > leadMinutes || minutesUntil <= leadMinutes - windowMinutes) continue;

    const claimed = await db.collection("appointments").updateOne(
      {
        _id: appointment._id,
        reminderSentAt: { $exists: false },
        $or: [
          { reminderClaimedAt: { $exists: false } },
          { reminderClaimedAt: { $lt: staleClaim } },
        ],
      },
      { $set: { reminderClaimedAt: now } },
    );
    if (!claimed.modifiedCount) continue;

    const result = await sendAppointmentReminder(appointment);
    if (result.sent) {
      sent += 1;
      await db.collection("appointments").updateOne(
        { _id: appointment._id },
        {
          $set: {
            reminderSentAt: new Date(),
            reminderMessageSid: result.sid,
          },
          $unset: { reminderClaimedAt: "" },
        },
      );
    } else {
      failed += 1;
      await db.collection("appointments").updateOne(
        { _id: appointment._id },
        {
          $set: { reminderLastErrorAt: new Date() },
          $unset: { reminderClaimedAt: "" },
        },
      );
    }
  }

  return Response.json({
    checked: appointments.length,
    sent,
    failed,
    reminderHoursBefore: leadMinutes / 60,
  });
}

function isAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
