import "server-only";

import { timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { getStaffCollection } from "@/lib/auth";
import {
  type DailyHours,
  dayNumber,
  defaultHours,
  displayTime,
  generateHalfHourSlots,
  isSlotDuringBreak,
  normalizeTime,
} from "@/lib/booking";
import { getMongoClient } from "@/lib/mongodb";
import { createAppointment } from "@/lib/appointment-service";
import { findCustomersByPhone, resolveCustomer } from "@/lib/customer-identity";
import { customerDisplayName, normalizePhone as normalizeCustomerPhone } from "@/lib/phone";
import { getServiceById, getServiceCatalog } from "@/lib/services";
import { sendAppointmentConfirmation, sendBarberNewAppointment } from "@/lib/twilio-sms";

const DATABASE_NAME = "hqonmain";
const TIME_ZONE = process.env.BARBERSHOP_TIME_ZONE || "America/Indiana/Indianapolis";
const SHOP_HOURS = {
  mondayThroughFriday: {
    open: "8:30 AM",
    close: "6:30 PM",
    lastAppointmentStart: "6:00 PM",
  },
  saturday: {
    open: "8:30 AM",
    close: "2:00 PM",
    lastAppointmentStart: "1:30 PM",
  },
  sunday: { closed: true },
};

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
        result = await listServices();
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
      case "lookup_customer":
        result = await lookupVoiceCustomer({
          callerPhone: optionalStringArg(args, "callerPhone"),
          spokenPhone: optionalStringArg(args, "phone"),
          callId,
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
  const artifact = objectValue(Object.keys(objectValue(message.artifact)).length ? message.artifact : call.artifact);
  const analysis = objectValue(Object.keys(objectValue(message.analysis)).length ? message.analysis : call.analysis);
  const compliance = objectValue(Object.keys(objectValue(message.compliance)).length ? message.compliance : call.compliance);
  const recordingConsent = objectValue(compliance.recordingConsent);
  const recording = objectValue(artifact.recording);
  const monoRecording = objectValue(recording.mono);
  const type = stringValue(message.type) || "unknown";
  const callId = stringValue(call.id);
  if (!callId) return;

  const client = await getMongoClient();
  const now = new Date();
  const startedAt = dateValue(message.startedAt) ?? dateValue(call.startedAt);
  const endedAt = dateValue(message.endedAt) ?? dateValue(call.endedAt);
  const status = stringValue(message.status) || stringValue(call.status) || undefined;
  const endedReason = stringValue(message.endedReason) || stringValue(call.endedReason) || undefined;
  const cost = numberValue(message.cost) ?? numberValue(call.cost);
  const toolCalls = Array.isArray(message.toolCallList)
    ? message.toolCallList
    : Array.isArray(message.toolCalls)
      ? message.toolCalls
      : [];
  const toolNames = toolCalls
    .map((entry) => stringValue(objectValue(objectValue(entry).function).name))
    .filter(Boolean)
    .slice(0, 20);
  const update: Record<string, unknown> = {
    callId,
    eventType: type,
    status,
    endedReason,
    customerNumber: customerNumber(call),
    callType: stringValue(call.type) || undefined,
    startedAt,
    endedAt,
    cost,
    durationSeconds: startedAt && endedAt
      ? Math.max(0, Math.round((endedAt.valueOf() - startedAt.valueOf()) / 1000))
      : undefined,
    updatedAt: now,
  };

  if (type === "end-of-call-report") {
    update.endedAt = endedAt ?? now;
    update.summary = stringValue(analysis.summary).slice(0, 10_000) || undefined;
    update.successEvaluation = stringValue(analysis.successEvaluation).slice(0, 2_000) || undefined;
    update.structuredData = boundedJsonValue(analysis.structuredData, 20_000);
    update.recordingUrl = firstString(
      recording.stereoUrl,
      monoRecording.combinedUrl,
      artifact.recordingUrl,
      message.recordingUrl,
    );
    update.logUrl = firstString(artifact.logUrl);
    update.recordingConsentType = stringValue(recordingConsent.type) || undefined;
    update.recordingConsentGranted = Boolean(dateValue(recordingConsent.grantedAt));
    if (process.env.VAPI_STORE_TRANSCRIPTS === "true") {
      update.transcript = stringValue(artifact.transcript).slice(0, 50_000);
    }
  }

  const event = withoutUndefined({
    type,
    status,
    endedReason,
    toolNames: toolNames.length ? toolNames : undefined,
    occurredAt: dateValue(message.timestamp),
    receivedAt: now,
  });

  const db = client.db(DATABASE_NAME);
  await Promise.all([
    db.collection("voiceCalls").updateOne(
      { callId },
      {
        $set: withoutUndefined(update),
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    ),
    db.collection("voiceCallEvents").insertOne({ callId, ...event }),
  ]);
}

async function listServices() {
  const services = await getServiceCatalog();
  return {
    shopHours: SHOP_HOURS,
    services: services.map(({ id, name, price, description }) => ({
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
  const requestedName = normalizeBarberName(input.barberName);
  const barbers = requestedName
    ? matchingBarbers(activeBarbers, requestedName)
    : activeBarbers;

  if (requestedName && barbers.length === 0) {
    const names = activeBarbers.map(barberNameWithNickname).filter(Boolean);
    throw new VoiceToolError(
      `No active barber matched ${input.barberName}. The active barbers are: ${names.join(", ") || "none"}.`,
    );
  }

  const availability = await Promise.all(
    barbers.map(async (barber) => {
      const details = await barberAvailability(barber._id, barber.name, input.date);
      return {
        barberId: barber._id.toString(),
        barber: barber.name,
        nickname: barber.nickname || null,
        aliases: barberAliases(barber),
        availabilityStatus: details.status,
        slots: details.slots.map((value) => ({ value, spoken: displayTime(value) })),
      };
    }),
  );
  const openings = availability.filter((barber) => barber.slots.length > 0);
  const requestedBarberAvailability = requestedName ? availability[0] ?? null : null;

  return {
    date: input.date,
    dateSpoken: spokenDate(input.date),
    relativeToShopToday: relativeToShopToday(input.date, shopToday),
    shopToday,
    shopTodaySpoken: spokenDate(shopToday),
    timeZone: TIME_ZONE,
    shopHours: SHOP_HOURS,
    requestedBarber: input.barberName || null,
    requestedBarberStatus: requestedBarberAvailability?.availabilityStatus ?? null,
    hasOpenings: openings.length > 0,
    openings,
    nextCalendarDate,
    nextCalendarDateSpoken: spokenDate(nextCalendarDate),
    nextCalendarDateRelativeToShopToday: relativeToShopToday(nextCalendarDate, shopToday),
    dateGuidance: requestedBarberAvailability?.availabilityStatus === "day-off"
      ? `${requestedBarberAvailability.barber} is off on ${spokenDate(input.date)}. Say that the barber is off, not booked. Offer to check another day or another barber on the requested day.`
      : requestedBarberAvailability?.availabilityStatus === "fully-booked"
        ? `${requestedBarberAvailability.barber} is scheduled to work on ${spokenDate(input.date)}, but every remaining appointment time is booked. Say that the barber is all booked up, not off. Offer another day or another barber on the requested day.`
        : requestedBarberAvailability?.availabilityStatus === "workday-ended"
          ? `${requestedBarberAvailability.barber} was scheduled on ${spokenDate(input.date)}, but the workday has ended. Do not say the barber is off or fully booked. Offer another day or another barber.`
          : openings.length > 0
            ? `Offer only times returned for ${spokenDate(input.date)}.`
            : `There are no openings on ${spokenDate(input.date)}. To continue, call list_shop_openings for ${nextCalendarDate}, which is ${spokenDate(nextCalendarDate)} and is ${relativeToShopToday(nextCalendarDate, shopToday)} relative to the shop's current date.`,
  };
}

async function listBarbers(serviceId: string) {
  const service = await getServiceById(serviceId);
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
      nickname: barber.nickname || null,
      aliases: barberAliases(barber),
      specialty: barber.specialty ?? "HQ Barber",
    })),
  };
}

function normalizeBarberName(value?: string) {
  return stringValue(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function barberAliases(barber: { name: string; nickname?: string }) {
  const name = stringValue(barber.name).trim();
  const firstName = name.split(/\s+/)[0] ?? "";
  return [...new Set([name, firstName, stringValue(barber.nickname).trim()].filter(Boolean))];
}

function barberNameWithNickname(barber: { name: string; nickname?: string }) {
  const name = stringValue(barber.name).trim();
  const nickname = stringValue(barber.nickname).trim();
  return nickname ? `${name} (${nickname})` : name;
}

function matchingBarbers<T extends { name: string; nickname?: string }>(barbers: T[], requestedName: string) {
  const exactMatches = barbers.filter((barber) =>
    barberAliases(barber).some((alias) => normalizeBarberName(alias) === requestedName),
  );
  if (exactMatches.length) return exactMatches;

  return barbers.filter((barber) =>
    barberAliases(barber).some((alias) => {
      const normalizedAlias = normalizeBarberName(alias);
      return requestedName.length >= 2 && normalizedAlias.includes(requestedName);
    }),
  );
}

async function listAvailableSlots(input: {
  serviceId: string;
  barberId: string;
  date: string;
}) {
  const { service, barber } = await eligibleBarber(input.serviceId, input.barberId);
  validateBookableDate(input.date);
  const availability = await barberAvailability(barber._id, barber.name, input.date);
  const dateRelative = relativeToShopToday(input.date);

  return {
    service: service.name,
    barber: barber.name,
    date: input.date,
    dateSpoken: spokenDate(input.date),
    relativeToShopToday: dateRelative,
    timeZone: TIME_ZONE,
    shopHours: SHOP_HOURS,
    availabilityStatus: availability.status,
    workingHours: availability.workingHours,
    slots: availability.slots.map((value) => ({ value, spoken: displayTime(value) })),
    responseGuidance: availability.status === "day-off"
      ? `${barber.name} is off ${dateRelative}. Say: "It looks like ${barber.name} is off ${dateRelative}. Would you like me to check another day, or see if another barber has anything open ${dateRelative}?" Do not say all booked up.`
      : availability.status === "fully-booked"
        ? `${barber.name} is working ${dateRelative}, but every remaining appointment time is booked. Say: "It looks like ${barber.name} is all booked up ${dateRelative}. Would you like me to check another day, or see if another barber has anything open ${dateRelative}?" Do not say the barber is off.`
        : availability.status === "workday-ended"
          ? `${barber.name}'s scheduled workday has already ended. Say that the barber is done for the day, not off or fully booked, and offer another day or another barber.`
          : `Offer one or two of the returned times naturally.`,
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

  const client = await getMongoClient();
  const db = client.db(DATABASE_NAME);
  const call = callId
    ? await db.collection("voiceCalls").findOne({ callId })
    : null;
  const phone = normalizePhone(input.phone || String(call?.customerNumber ?? call?.callerNumber ?? ""));
  const existingMatch = await findCustomersByPhone(db, phone);
  const customerName = input.customerName.trim() || (existingMatch.customers[0] ? customerDisplayName(existingMatch.customers[0]) : "");
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

  const customer = await resolveCustomer({
    phone,
    name: customerName,
    email,
    source: "vapi",
  });

  const now = new Date();
  const appointment = {
    name: customerName,
    email: email || customer.email || "",
    phone: customer.phone,
    customerId: customer._id,
    recipientName: customerName,
    recipientType: "self",
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
    bookingSource: "vapi",
    smsConsent: input.smsConsent,
    smsConsentAt: input.smsConsent ? now : undefined,
    smsConsentSource: input.smsConsent ? "voice-verbal" : undefined,
    voiceCallId: callId || undefined,
    voiceToolCallId: toolCallId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const savedAppointment = await createAppointment({ db, appointment, bookingSource: "vapi", customerId: customer._id, recipientName: customerName });
    const [sms, barberSms] = await Promise.all([
      sendAppointmentConfirmation(savedAppointment),
      sendBarberNewAppointment(savedAppointment),
    ]);
    return { ...bookingConfirmation(savedAppointment, false), sms, barberSms };
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

async function lookupVoiceCustomer({ callerPhone, spokenPhone, callId }: { callerPhone?: string; spokenPhone?: string; callId: string }) {
  const client = await getMongoClient();
  const db = client.db(DATABASE_NAME);
  const call = callId ? await db.collection("voiceCalls").findOne({ callId }) : null;
  const storedCallerPhone = String(call?.customerNumber ?? call?.callerNumber ?? "");
  const phone = [callerPhone, storedCallerPhone, spokenPhone]
    .map((candidate) => normalizeCustomerPhone(candidate))
    .find(Boolean);
  const match = await findCustomersByPhone(db, phone);
  if (!match.normalizedPhone) return { found: false, needsPhone: true };
  return {
    found: match.customers.length > 0,
    needsName: match.customers.length === 0,
    responseGuidance: match.customers.length
      ? "A customer record is already linked to this number. Do not create a separate customer; continue the booking naturally. Do not reveal appointment history."
      : "No customer record is linked yet. Ask for the customer's name once, then continue.",
  };
}

async function eligibleBarber(serviceId: string, barberId: string) {
  const service = await getServiceById(serviceId);
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
  return (await barberAvailability(barberId, barberName, date)).slots;
}

type BarberAvailabilityStatus = "available" | "day-off" | "fully-booked" | "workday-ended";

async function barberAvailability(barberId: ObjectId, barberName: string, date: string) {
  const client = await getMongoClient();
  const db = client.db(DATABASE_NAME);
  const dayOfWeek = dayNumber(date);
  const customHours = await db.collection<DailyHours>("availability").findOne({
    barberId,
    dayOfWeek,
  });
  const shopHours = defaultHours(dayOfWeek);
  const barberHours = customHours ?? shopHours;
  const start = laterTime(String(barberHours.start), String(shopHours.start));
  const end = earlierTime(String(barberHours.end), String(shopHours.end));
  const hours = { ...barberHours, start, end };
  if (!shopHours.enabled || !barberHours.enabled || !start || !end || start >= end) {
    return {
      status: "day-off" as BarberAvailabilityStatus,
      slots: [] as string[],
      workingHours: null,
    };
  }

  const workingHours = {
    start: String(hours.start),
    startSpoken: displayTime(String(hours.start)),
    end: String(hours.end),
    endSpoken: displayTime(String(hours.end)),
  };
  const current = currentLocalDateTime();
  const remainingScheduleSlots = generateHalfHourSlots(String(hours.start), String(hours.end))
    .filter((time) => !isSlotDuringBreak(time, hours))
    .filter((time) => date !== current.date || time > current.time);
  if (remainingScheduleSlots.length === 0) {
    return {
      status: "workday-ended" as BarberAvailabilityStatus,
      slots: [] as string[],
      workingHours,
    };
  }

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
  const slots = remainingScheduleSlots.filter((time) => !occupied.has(time));
  return {
    status: (slots.length > 0 ? "available" : "fully-booked") as BarberAvailabilityStatus,
    slots,
    workingHours,
  };
}

function laterTime(left: string, right: string) {
  const normalizedLeft = normalizeTime(left);
  const normalizedRight = normalizeTime(right);
  if (!normalizedLeft || !normalizedRight) return "";
  return normalizedLeft > normalizedRight ? normalizedLeft : normalizedRight;
}

function earlierTime(left: string, right: string) {
  const normalizedLeft = normalizeTime(left);
  const normalizedRight = normalizeTime(right);
  if (!normalizedLeft || !normalizedRight) return "";
  return normalizedLeft < normalizedRight ? normalizedLeft : normalizedRight;
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text) return text;
  }
  return undefined;
}

function boundedJsonValue(value: unknown, maxLength: number) {
  if (!value || typeof value !== "object") return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxLength) return JSON.parse(serialized) as unknown;
    return { truncated: true, preview: serialized.slice(0, maxLength) };
  } catch {
    return undefined;
  }
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
