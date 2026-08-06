import "server-only";

import { ObjectId, type Db } from "mongodb";
import { displayTime, formatDisplayDate, normalizeTime } from "@/lib/booking";
import { getMongoClient } from "@/lib/mongodb";

const DATABASE_NAME = "hqonmain";
const TIME_ZONE = process.env.BARBERSHOP_TIME_ZONE || "America/Indiana/Indianapolis";

export type SmsAppointment = {
  _id: ObjectId;
  name?: unknown;
  phone?: unknown;
  service?: unknown;
  barber?: unknown;
  requestedDate?: unknown;
  requestedTime?: unknown;
  smsConsent?: unknown;
};

type SmsKind = "confirmation" | "reminder";

export async function sendAppointmentConfirmation(appointment: SmsAppointment) {
  if (appointment.smsConsent !== true) return { sent: false, reason: "no-consent" };

  const message =
    `HQ on Main: ${text(appointment.name)}, your ${text(appointment.service)} with ` +
    `${text(appointment.barber)} is confirmed for ${formatDisplayDate(text(appointment.requestedDate))} ` +
    `at ${displayTime(text(appointment.requestedTime))}. Reply STOP to unsubscribe or HELP for help.`;

  return sendAppointmentMessage(appointment, "confirmation", message);
}

export async function sendAppointmentReminder(appointment: SmsAppointment) {
  if (appointment.smsConsent !== true) return { sent: false, reason: "no-consent" };

  const message =
    `Reminder from HQ on Main: your ${text(appointment.service)} with ` +
    `${text(appointment.barber)} is ${formatDisplayDate(text(appointment.requestedDate))} at ` +
    `${displayTime(text(appointment.requestedTime))}. Reply STOP to unsubscribe or HELP for help.`;

  return sendAppointmentMessage(appointment, "reminder", message);
}

export function isSmsConfigured() {
  const credentials = twilioCredentials();
  const sender =
    process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ||
    process.env.TWILIO_PHONE_NUMBER?.trim();
  return Boolean(credentials && sender);
}

export function appointmentInstant(date: string, time: string) {
  const normalized = normalizeTime(time);
  const match = `${date}T${normalized}`.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!match) return null;

  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  let timestamp = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );

  for (let pass = 0; pass < 2; pass += 1) {
    const actual = zonedParts(new Date(timestamp));
    const desiredAsUtc = Date.UTC(
      desired.year,
      desired.month - 1,
      desired.day,
      desired.hour,
      desired.minute,
    );
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    timestamp += desiredAsUtc - actualAsUtc;
  }

  return new Date(timestamp);
}

async function sendAppointmentMessage(
  appointment: SmsAppointment,
  kind: SmsKind,
  body: string,
) {
  const credentials = twilioCredentials();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const from = process.env.TWILIO_PHONE_NUMBER?.trim();
  const to = normalizeE164(text(appointment.phone));
  const client = await getMongoClient();
  const db = client.db(DATABASE_NAME);
  const now = new Date();

  if (!credentials || (!messagingServiceSid && !from)) {
    await recordSms(db, {
      appointmentId: appointment._id,
      kind,
      to,
      status: "not-configured",
      createdAt: now,
    });
    return { sent: false, reason: "not-configured" };
  }
  if (!to) {
    await recordSms(db, {
      appointmentId: appointment._id,
      kind,
      status: "invalid-number",
      createdAt: now,
    });
    return { sent: false, reason: "invalid-number" };
  }

  const params = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid) params.set("MessagingServiceSid", messagingServiceSid);
  else if (from) params.set("From", normalizeE164(from) || from);

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${credentials.username}:${credentials.password}`,
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    const result = (await response.json()) as {
      sid?: string;
      status?: string;
      code?: number;
      message?: string;
    };
    if (!response.ok || !result.sid) {
      throw new Error(result.message || `Twilio returned HTTP ${response.status}.`);
    }

    await recordSms(db, {
      appointmentId: appointment._id,
      kind,
      to,
      twilioMessageSid: result.sid,
      status: result.status || "queued",
      createdAt: now,
    });
    return { sent: true, sid: result.sid };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
    console.error("Twilio appointment SMS failed", {
      appointmentId: appointment._id.toString(),
      kind,
      error: errorMessage,
    });
    await recordSms(db, {
      appointmentId: appointment._id,
      kind,
      to,
      status: "failed",
      error: errorMessage,
      createdAt: now,
    });
    return { sent: false, reason: "send-failed" };
  }
}

function twilioCredentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const apiKey = process.env.TWILIO_API_KEY?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid) return null;
  if (apiKey && apiKeySecret) {
    return { accountSid, username: apiKey, password: apiKeySecret };
  }
  if (authToken) {
    return { accountSid, username: accountSid, password: authToken };
  }
  return null;
}

async function recordSms(
  db: Db,
  record: Record<string, unknown>,
) {
  try {
    await db.collection("smsMessages").insertOne(record);
  } catch (error) {
    console.error("Could not record Twilio SMS attempt", error);
  }
}

function normalizeE164(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
