import "server-only";

import { timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { getStaffCollection } from "@/lib/auth";
import {
  dayNumber,
  defaultHours,
  displayTime,
  generateHalfHourSlots,
  normalizeTime,
} from "@/lib/booking";
import { getMongoClient } from "@/lib/mongodb";
import { SERVICE_CATALOG, serviceById } from "@/lib/services";
import { sendAppointmentConfirmation } from "@/lib/twilio-sms";

const DATABASE_NAME = "hqonmain";
const TIME_ZONE = process.env.BARBERSHOP_TIME_ZONE || "America/Indiana/Indianapolis";

export type VoiceToolCall = {
  id: string;
  function?: {
    name?: string;
    arguments?: unknown;
  };
};

type ToolResult = {
  toolCallId: string;
  result?: string;
  error?: string;
};

type VoiceBookingInput = {
  serviceId: string;
  barberId: string;
  date: string;
  time: string;
  customerName: string;
  phone: string;
  email?: string;
  notes?: string;
  smsConsent: boolean;
};

export function isAuthorizedVoiceRequest(request: Request) {
  const expected = process.env.VAPI_WEBHOOK_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const supplied = authorization.replace(/^Bearer\s+/i, "");

  if (!expected || !supplied) return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export async function runVoiceTool(
  toolCall: VoiceToolCall,
  callId: string,
): Promise<ToolResult> {
  const name = toolCall.function?.name?.trim() ?? "";
  const args = parseArguments(toolCall.function?.arguments);

  try {
    let result: unknown;
    switch (name) {
      case "list_services":
        result = listServices();
        break;
      case "list_shop_openings":
        result = await listShopOpenings({
          date: resolveVoiceAvailabilityDate(optionalStringArg(args, "date") || "today"),
          barberName: optionalStringArg(args, "barberName"),
        });
        break;
      case "list_barbers":
        result = await listBarbers(stringArg(args, "serviceId"));
        break;
      case "list_available_slots":
        result = await listAvailableSlots({
          serviceId: stringArg(args, "serviceId"),
          barberId: stringArg(args, "barberId"),
          date: stringArg(args, "date"),
        });
        break;
      case "book_appointment":
        result = await bookAppointment(
          {
            serviceId: stringArg(args, "serviceId"),
            barberId: stringArg(args, "barberId"),
            date: stringArg(args, "date"),
            time: stringArg(args, "time"),
            customerName: stringArg(args, "customerName"),
            phone: stringArg(args, "phone"),
            email: optionalStringArg(args, "email"),
            notes: optionalStringArg(args, "notes"),
            smsConsent: booleanArg(args, "smsConsent"),
          },
          toolCall.id,
          callId,
        );
        break;
      default:
        throw new VoiceToolError(`Unknown scheduling tool: ${name || "unnamed tool"}.`);
    }

    return {
      toolCallId: toolCall.id,
      result: singleLineJson(result),
    };
  } catch (error) {
    const message =
      error instanceof VoiceToolError
        ? error.message
        : "The scheduling system is temporarily unavailable. Please offer to take a message.";
    if (!(error instanceof VoiceToolError)) {
      console.error("Voice scheduling tool failed", { name, callId, error });
    }
    return { toolCallId: toolCall.id, error: singleLine(message) };
  }
}

export async function recordVoiceEvent(message: Record<string, unknown>) {
  const call = objectValue(message.call);
  const artifact = objectValue(message.artifact);
  const type = stringValue(message.type) || "unknown";
  const callId = stringValue(call.id);
  if (!callId) return;

  const client = await getMongoClient();
  const now = new Date();
  const update: Record<string, unknown> = {
    callId,
    eventType: type,
    status: stringValue(message.status) || undefined,
    endedReason: stringValue(message.endedReason) || undefined,
    customerNumber: customerNumber(call),
    updatedAt: now,
  };

  if (type === "end-of-call-report") {
    update.endedAt = now;
    if (process.env.VAPI_STORE_TRANSCRIPTS === "true") {
      update.transcript = stringValue(artifact.transcript).slice(0, 50_000);
    }
  }

  await client
    .db(DATABASE_NAME)
    .collection("voiceCalls")
    .updateOne(
      { callId },
      {
        $set: withoutUndefined(update),
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
}

function listServices() {
  return {
    services: SERVICE_CATALOG.map(({ id, name, price, description }) => ({
      id,
      name,
      price,
      description,
    })),
  };
}

async function listShopOpenings(input: { date: string; barberName?: string }) {
  validateBookableDate(input.date);
  const shopToday = currentLocalDateTime().date;
  const nextCalendarDate = addCalendarDays(input.date, 1);
  const staff = await getStaffCollection();
  const activeBarbers = await staff
    .find({ role: "barber", active: true })
    .sort({ name: 1 })
    .toArray();
  const requestedName = input.barberName?.trim().toLocaleLowerCase() ?? "";
  const barbers = requestedName
    ? activeBarbers.filter((barber) => {
        const name = stringValue(barber.name).toLocaleLowerCase();
        const firstName = name.split(/\s+/)[0];
        return name === requestedName || firstName === requestedName || name.includes(requestedName);
      })
    : activeBarbers;

  if (requestedName && barbers.length === 0) {
    const names = activeBarbers.map((barber) => stringValue(barber.name)).filter(Boolean);
    throw new VoiceToolError(
      `No active barber matched ${input.barberName}. The active barbers are: ${names.join(", ") || "none"}.`,
    );
  }

  const availability = await Promise.all(
    barbers.map(async (barber) => {
      const slots = await availableSlots(barber._id, barber.name, input.date);
      return {
        barberId: barber._id.toString(),
        barber: barber.name,
        slots: slots.map((value) => ({ value, spoken: displayTime(value) })),
      };
    }),
  );
  const openings = availability.filter((barber) => barber.slots.length > 0);

  return {
    date: input.date,
    dateSpoken: spokenDate(input.date),
    relativeToShopToday: relativeToShopToday(input.date, shopToday),
    shopToday,
    shopTodaySpoken: spokenDate(shopToday),
    timeZone: TIME_ZONE,
    requestedBarber: input.barberName || null,
    hasOpenings: openings.length > 0,
    openings,
    nextCalendarDate,
    nextCalendarDateSpoken: spokenDate(nextCalendarDate),
    nextCalendarDateRelativeToShopToday: relativeToShopToday(nextCalendarDate, shopToday),
    dateGuidance: openings.length > 0
      ? `Offer only times returned for ${spokenDate(input.date)}.`
      : `There are no openings on ${spokenDate(input.date)}. To continue, call list_shop_openings for ${nextCalendarDate}, which is ${spokenDate(nextCalendarDate)} and is ${relativeToShopToday(nextCalendarDate, shopToday)} relative to the shop's current date.`,
  };
}

async function listBarbers(serviceId: string) {
  const service = serviceById(serviceId);
  if (!service) {
    throw new VoiceToolError("That service was not recognized. Call list_services again.");
  }

  const staff = await getStaffCollection();
  const barbers = await staff
    .find({
      role: "barber",
      active: true,
      $or: [{ services: serviceId }, { services: { $exists: false } }],
    })
    .sort({ name: 1 })
    .toArray();

  return {
    service: service.name,
    barbers: barbers.map((barber) => ({
      id: barber._id.toString(),
      name: barber.name,
      specialty: barber.specialty ?? "HQ Barber",
    })),
  };
}

async function listAvailableSlots(input: {
  serviceId: string;
  barberId: string;
  date: string;
}) {
  const { service, barber } = await eligibleBarber(input.serviceId, input.barberId);
  validateBookableDate(input.date);
  const slots = await availableSlots(barber._id, barber.name, input.date);

  return {
    service: service.name,
    barber: barber.name,
    date: input.date,
    dateSpoken: spokenDate(input.date),
    relativeToShopToday: relativeToShopToday(input.date),
    timeZone: TIME_ZONE,
    slots: slots.map((value) => ({ value, spoken: displayTime(value) })),
  };
}

async function bookAppointment(
  input: VoiceBookingInput,
  toolCallId: string,
  callId: string,
) {
  const { service, barber } = await eligibleBarber(input.serviceId, input.barberId);
  validateBookableDate(input.date);
  const time = normalizeTime(input.time);
  if (!time) throw new VoiceToolError("The appointment time was not recognized.");

  const customerName = input.customerName.trim();
  const phone = normalizePhone(input.phone);
  const email = (input.email ?? "").trim().toLowerCase();
  const notes = (input.notes ?? "").trim().slice(0, 500);
  if (customerName.length < 2) {
    throw new VoiceToolError("Please confirm the customer's full name.");
  }
  if (phone.length < 10) {
    throw new VoiceToolError("Please confirm a valid callback phone number.");
  }
  if (email && !email.includes("@")) {
    throw new VoiceToolError("The email address is not valid. It may be omitted.");
  }

  const client = await getMongoClient();
  const db = client.db(DATABASE_NAME);
  await db.collection("appointments").createIndex(
    { voiceToolCallId: 1 },
    {
      unique: true,
      partialFilterExpression: { voiceToolCallId: { $type: "string" } },
      name: "unique_voice_tool_call",
    },
  );

  const prior = await db.collection("appointments").findOne({ voiceToolCallId: toolCallId });
  if (prior) return bookingConfirmation(prior, true);

  const slots = await availableSlots(barber._id, barber.name, input.date);
  if (!slots.includes(time)) {
    throw new VoiceToolError(
      "That time is no longer available. Call list_available_slots again before suggesting another time.",
    );
  }

  const now = new Date();
  const appointment = {
    name: customerName,
    email,
    phone,
    service: service.name,
    serviceId: service.id,
    price: service.price,
    barber: barber.name,
    barberId: barber._id,
    requestedDate: input.date,
    requestedTime: time,
    status: "confirmed",
    notes,
    source: "voice",
    smsConsent: input.smsConsent,
    smsConsentAt: input.smsConsent ? now : undefined,
    smsConsentSource: input.smsConsent ? "voice-verbal" : undefined,
    voiceCallId: callId || undefined,
    voiceToolCallId: toolCallId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result = await db.collection("appointments").insertOne(appointment);
    const savedAppointment = { ...appointment, _id: result.insertedId };
    const sms = await sendAppointmentConfirmation(savedAppointment);
    return { ...bookingConfirmation(savedAppointment, false), sms };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const duplicate = await db
        .collection("appointments")
        .findOne({ voiceToolCallId: toolCallId });
      if (duplicate) return bookingConfirmation(duplicate, true);
    }
    throw error;
  }
}

async function eligibleBarber(serviceId: string, barberId: string) {
  const service = serviceById(serviceId);
  if (!service) {
    throw new VoiceToolError("That service was not recognized. Call list_services again.");
  }
  if (!ObjectId.isValid(barberId)) {
    throw new VoiceToolError("That barber was not recognized. Call list_barbers again.");
  }

  const staff = await getStaffCollection();
  const barber = await staff.findOne({
    _id: new ObjectId(barberId),
    role: "barber",
    active: true,
    $or: [{ services: serviceId }, { services: { $exists: false } }],
  });
  if (!barber) {
    throw new VoiceToolError(
      "That barber does not offer the selected service. Call list_barbers again.",
    );
  }
  return { service, barber };
}

async function availableSlots(barberId: ObjectId, barberName: string, date: string) {
  const client = await getMongoClient();
  const db = client.db(DATABASE_NAME);
  const dayOfWeek = dayNumber(date);
  const customHours = await db.collection("availability").findOne({
    barberId,
    dayOfWeek,
  });
  const hours = customHours ?? defaultHours(dayOfWeek);
  if (!hours.enabled) return [];

  const appointments = await db
    .collection("appointments")
    .find({
      $or: [{ barberId }, { barber: barberName }],
      requestedDate: date,
      status: { $nin: ["cancelled", "no-show"] },
    })
    .project({ requestedTime: 1 })
    .toArray();
  const occupied = new Set(
    appointments.map((appointment) => normalizeTime(String(appointment.requestedTime ?? ""))),
  );
  const current = currentLocalDateTime();

  return generateHalfHourSlots(String(hours.start), String(hours.end)).filter((time) => {
    if (occupied.has(time)) return false;
    if (date !== current.date) return true;
    return time > current.time;
  });
}

function validateBookableDate(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new VoiceToolError("Use a valid date in YYYY-MM-DD format.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new VoiceToolError("Use a valid date in YYYY-MM-DD format.");
  }
  const today = currentLocalDateTime().date;
  if (date < today) {
    throw new VoiceToolError(
      `DATE INTERPRETATION ERROR, not an availability result: ${spokenDate(date)} is in the past. Today at the shop is ${spokenDate(today)} (${today}). Do not tell the caller this date has no openings. If the caller said today, tomorrow, or day after tomorrow, retry list_shop_openings with that exact phrase instead of supplying or guessing a year.`,
    );
  }
}

function resolveVoiceAvailabilityDate(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  const today = currentLocalDateTime().date;
  if (/\btoday\b/.test(normalized)) return today;
  if (/\bday after tomorrow\b/.test(normalized)) return addCalendarDays(today, 2);
  if (/\btomorrow\b/.test(normalized)) return addCalendarDays(today, 1);
  return value.trim();
}

function addCalendarDays(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function currentLocalDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function bookingConfirmation(appointment: Record<string, unknown>, repeated: boolean) {
  const id = appointment._id instanceof ObjectId ? appointment._id.toString() : "";
  return {
    booked: true,
    repeated,
    confirmationCode: id.slice(-8).toUpperCase(),
    service: stringValue(appointment.service),
    barber: stringValue(appointment.barber),
    date: stringValue(appointment.requestedDate),
    dateSpoken: spokenDate(stringValue(appointment.requestedDate)),
    time: displayTime(stringValue(appointment.requestedTime)),
    customerName: stringValue(appointment.name),
  };
}

function spokenDate(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function relativeToShopToday(date: string, today = currentLocalDateTime().date) {
  if (date === today) return "today";
  if (date === addCalendarDays(today, 1)) return "tomorrow";
  if (date === addCalendarDays(today, 2)) return "the day after tomorrow";
  return "a later date";
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function stringArg(args: Record<string, unknown>, key: string) {
  const value = optionalStringArg(args, key);
  if (!value) throw new VoiceToolError(`The ${key} field is required.`);
  return value;
}

function optionalStringArg(args: Record<string, unknown>, key: string) {
  return typeof args[key] === "string" ? args[key].trim() : "";
}

function booleanArg(args: Record<string, unknown>, key: string) {
  if (typeof args[key] !== "boolean") {
    throw new VoiceToolError(`The ${key} field must be true or false.`);
  }
  return args[key];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function customerNumber(call: Record<string, unknown>) {
  const customer = objectValue(call.customer);
  return stringValue(customer.number);
}

function normalizePhone(phone: string) {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

function singleLineJson(value: unknown) {
  return JSON.stringify(value).replace(/[\r\n]+/g, " ");
}

function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ");
}

function withoutUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

class VoiceToolError extends Error {}
