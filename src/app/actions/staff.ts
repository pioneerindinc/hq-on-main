"use server";

import { Binary, ObjectId, type Db } from "mongodb";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaffCollection, requireStaffRole } from "@/lib/auth";
import {
  type DailyHours,
  dayNumber,
  defaultHours,
  displayTime,
  isSlotDuringBreak,
  isSlotWithinHours,
  normalizeTime,
} from "@/lib/booking";
import { getMongoClient } from "@/lib/mongodb";
import { createAppointment, resolveAppointmentRecipient, type BookingSource } from "@/lib/appointment-service";
import { resolveCustomer } from "@/lib/customer-identity";
import { issueBarberSetupToken } from "@/lib/barber-setup";
import { hasDrawerCloseout, recordPostCloseoutChange, type FinancialAuditChange } from "@/lib/financial-audit";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { ensureServiceCatalog, getServiceCatalog } from "@/lib/services";
import {
  sendAppointmentCancellationNotifications,
  sendAppointmentConfirmation,
  sendBarberNewAppointment,
} from "@/lib/twilio-sms";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function dashboardError(area: "admin" | "barber", message: string, tab?: string): never {
  const tabParam = tab ? `tab=${encodeURIComponent(tab)}&` : "";
  redirect(`/${area}/dashboard?${tabParam}error=${encodeURIComponent(message)}`);
}

const MAX_BARBER_PHOTO_BYTES = 3 * 1024 * 1024;

async function readBarberPhoto(formData: FormData, tab: "add-barber" | "barbers") {
  const entry = formData.get("photo");
  if (!(entry instanceof File) || entry.size === 0) return null;
  if (entry.size > MAX_BARBER_PHOTO_BYTES) {
    dashboardError("admin", "Barber photos must be 3 MB or smaller.", tab);
  }

  const bytes = new Uint8Array(await entry.arrayBuffer());
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isWebp = bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const contentType = isJpeg ? "image/jpeg" : isPng ? "image/png" : isWebp ? "image/webp" : null;
  if (!contentType) {
    dashboardError("admin", "Upload a JPEG, PNG, or WebP barber photo.", tab);
  }

  return { data: new Binary(bytes), contentType };
}

async function saveBarberPhoto(
  db: Db,
  barberId: ObjectId,
  photo: { data: Binary; contentType: string },
  updatedAt: Date,
) {
  const photos = db.collection("barberPhotos");
  await photos.createIndex({ barberId: 1 }, { unique: true });
  await photos.updateOne(
    { barberId },
    { $set: { barberId, ...photo, updatedAt } },
    { upsert: true },
  );
}

export async function saveAvailability(formData: FormData) {
  const barber = await requireStaffRole("barber");
  const client = await getMongoClient();
  const availability = client.db("hqonmain").collection("availability");
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  const schedule = days.map((day, index) => {
    const enabled = formData.get(`${day}_enabled`) === "on";
    const start = normalizeTime(value(formData, `${day}_start`) || "09:00");
    const end = normalizeTime(value(formData, `${day}_end`) || "17:00");
    const breakEnabled = formData.get(`${day}_break_enabled`) === "on";
    const breakStart = normalizeTime(value(formData, `${day}_break_start`) || "12:00");
    const breakEnd = normalizeTime(value(formData, `${day}_break_end`) || "13:00");

    if (enabled && (!start || !end || start >= end)) {
      dashboardError("barber", `Choose valid working hours for ${day}.`, "availability");
    }
    if (
      enabled &&
      breakEnabled &&
      (!breakStart || !breakEnd || breakStart >= breakEnd || breakStart < start || breakEnd > end)
    ) {
      dashboardError(
        "barber",
        `The ${day} break must start and end within your working hours.`,
        "availability",
      );
    }

    return {
      day,
      dayOfWeek: index + 1,
      enabled,
      start,
      end,
      breakEnabled: enabled && breakEnabled,
      breakStart,
      breakEnd,
    };
  });

  await Promise.all(
    schedule.map((row) =>
      availability.updateOne(
        { barberId: barber._id, dayOfWeek: row.dayOfWeek },
        {
          $set: {
            barberId: barber._id,
            barberName: barber.name,
            ...row,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      ),
    ),
  );

  revalidatePath("/barber/dashboard");
}

export async function saveBarberServices(formData: FormData) {
  const barber = await requireStaffRole("barber");
  const serviceCatalog = await getServiceCatalog();
  const services = serviceCatalog
    .filter((service) => formData.get(`service_${service.id}`) === "on")
    .map((service) => service.id);

  const staff = await getStaffCollection();
  await staff.updateOne(
    { _id: barber._id, role: "barber" },
    { $set: { services, updatedAt: new Date() } },
  );
  revalidatePath("/barber/dashboard");
}

export async function addBarberAppointment(formData: FormData) {
  const barber = await requireStaffRole("barber");
  const required = ["name", "phone", "service", "date", "time", "visitType"];
  if (required.some((field) => !value(formData, field))) {
    dashboardError("barber", "Complete all appointment fields.", "add");
  }
  const serviceName = value(formData, "service");
  const visitType = value(formData, "visitType");
  if (!["appointment", "walk-in"].includes(visitType)) {
    dashboardError("barber", "Choose appointment or walk-in.", "add");
  }
  const serviceCatalog = await getServiceCatalog();
  const offeredServiceIds = barber.services ?? serviceCatalog.map((service) => service.id);
  const allowedNames = new Set(serviceCatalog.map((service) => service.name));
  const offeredNames = new Set<string>(
    serviceCatalog
      .filter((service) => offeredServiceIds.includes(service.id))
      .map((service) => service.name),
  );
  if (!allowedNames.has(serviceName) || !offeredNames.has(serviceName)) {
    dashboardError("barber", "Choose a service you currently offer.", "add");
  }

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const date = value(formData, "date");
  const time = await assertBarberAppointmentSlot({
    db,
    barber,
    date,
    time: value(formData, "time"),
    tab: "add",
  });
  const service = serviceCatalog.find((item) => item.name === serviceName)!;
  const bookingSource: BookingSource = visitType === "walk-in" ? "walk_in" : value(formData, "bookingSource") === "phone" ? "phone" : "staff";
  let customer;
  try {
    customer = await resolveCustomer({
      phone: value(formData, "phone"), name: value(formData, "name"), email: value(formData, "email"),
      source: bookingSource, createdByUserId: barber._id,
    });
  } catch (error) {
    dashboardError("barber", error instanceof Error ? error.message : "Enter a valid customer phone number.", "add");
  }
  const now = new Date();
  const appointment = {
    name: value(formData, "name"),
    phone: customer.phone,
    email: value(formData, "email").toLowerCase(),
    service: serviceName,
    serviceId: service.id,
    price: service.price,
    barber: barber.name,
    barberId: barber._id,
    customerId: customer._id,
    recipientName: value(formData, "name"),
    recipientType: "self",
    requestedDate: date,
    requestedTime: time,
    status: "confirmed",
    visitType,
    notes: value(formData, "notes"),
    source: visitType === "walk-in" ? "walk-in" : "barber",
    bookingSource,
    createdByUserId: barber._id,
    smsConsent: formData.get("smsConsent") === "on",
    smsConsentAt: formData.get("smsConsent") === "on" ? now : undefined,
    smsConsentSource: formData.get("smsConsent") === "on" ? "staff-confirmed" : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const savedAppointment = await createAppointment({ db, appointment, bookingSource, customerId: customer._id, recipientName: appointment.name, createdByUserId: barber._id });
  await Promise.all([
    sendAppointmentConfirmation(savedAppointment),
    sendBarberNewAppointment(savedAppointment),
  ]);

  revalidatePath("/barber/dashboard");
  redirect("/barber/dashboard?tab=appointments");
}

export async function updateBarberAppointment(formData: FormData) {
  const barber = await requireStaffRole("barber");
  const id = value(formData, "appointmentId");
  if (!ObjectId.isValid(id)) dashboardError("barber", "Invalid appointment.");
  const status = value(formData, "status");
  const visitType = value(formData, "visitType");
  const date = value(formData, "date");
  const time = value(formData, "time");
  if (
    !["pending", "confirmed", "completed", "cancelled", "no-show"].includes(status) ||
    !["appointment", "walk-in"].includes(visitType) ||
    !date ||
    !time
  ) {
    dashboardError("barber", "Choose a valid date, time, and status.");
  }

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const appointmentFilter = {
    _id: new ObjectId(id),
    $or: [{ barberId: barber._id }, { barber: barber.name }],
  };
  const existing = await db.collection("appointments").findOne(appointmentFilter);
  if (!existing) dashboardError("barber", "Appointment not found.", "appointments");
  const normalizedInputTime = normalizeTime(time);
  if (!normalizedInputTime) {
    dashboardError("barber", "Choose a valid appointment time.", "appointments");
  }
  const normalizedTime = ["pending", "confirmed"].includes(status)
    ? await assertBarberAppointmentSlot({
        db,
        barber,
        date,
        time: normalizedInputTime,
        tab: "appointments",
        excludeAppointmentId: new ObjectId(id),
      })
    : normalizedInputTime;
  const checkoutAmountCents = typeof existing.checkoutAmountCents === "number"
    ? parseMoneyToCents(value(formData, "checkoutAmount"))
    : null;
  if (typeof existing.checkoutAmountCents === "number" && checkoutAmountCents === null) {
    dashboardError("barber", "Enter a valid cash total for the completed appointment.", "appointments");
  }
  const auditChanges: FinancialAuditChange[] = [
    ...(String(existing.requestedDate ?? "") !== date ? [{ field: "Date", before: String(existing.requestedDate ?? ""), after: date }] : []),
    ...(String(existing.requestedTime ?? "") !== normalizedTime ? [{ field: "Time", before: String(existing.requestedTime ?? ""), after: normalizedTime }] : []),
    ...(String(existing.status ?? "") !== status ? [{ field: "Status", before: String(existing.status ?? ""), after: status }] : []),
    ...(String(existing.visitType ?? "appointment") !== visitType ? [{ field: "Visit type", before: String(existing.visitType ?? "appointment"), after: visitType }] : []),
    ...(checkoutAmountCents !== null && checkoutAmountCents !== Number(existing.checkoutAmountCents)
      ? [{ field: "Cash total", before: formatMoney(Number(existing.checkoutAmountCents)), after: formatMoney(checkoutAmountCents) }]
      : []),
  ];
  const closedDates = [...new Set([String(existing.requestedDate ?? ""), date])].filter(
    (businessDate) => /^\d{4}-\d{2}-\d{2}$/.test(businessDate),
  );
  const auditedDates = typeof existing.checkoutAmountCents === "number" && auditChanges.length
    ? (await Promise.all(closedDates.map(async (businessDate) => ({ businessDate, closed: await hasDrawerCloseout(db, businessDate) })))).filter((item) => item.closed).map((item) => item.businessDate)
    : [];
  const auditReason = value(formData, "auditReason");
  if (auditedDates.length && auditReason.length < 3) {
    dashboardError("barber", "Enter a reason for changing financial information after drawer closeout.", "appointments");
  }
  const commissionPercentage = Math.min(100, Math.max(0, Number(existing.commissionPercentageSnapshot ?? barber.commissionPercentage ?? 0)));
  const result = await db.collection("appointments").updateOne(
      appointmentFilter,
      {
        $set: {
          requestedDate: date,
          requestedTime: normalizedTime,
          status,
          visitType,
          notes: value(formData, "notes"),
          ...(checkoutAmountCents !== null ? {
            checkoutAmountCents,
            commissionAmountCents: Math.round(checkoutAmountCents * commissionPercentage / 100),
            shopAmountCents: checkoutAmountCents - Math.round(checkoutAmountCents * commissionPercentage / 100),
          } : {}),
          updatedAt: new Date(),
        },
      },
    );

  if (!result.matchedCount) dashboardError("barber", "Appointment not found.", "appointments");
  if (status === "completed" && existing.customerId instanceof ObjectId) {
    await db.collection("customers").updateOne({ _id: existing.customerId }, { $set: { lastVisitAt: new Date(), updatedAt: new Date() } });
  }
  await Promise.all(auditedDates.map((businessDate) => recordPostCloseoutChange({
    db,
    businessDate,
    actor: barber,
    entityType: "appointment",
    entityId: existing._id,
    summary: `${barber.name}'s appointment for ${String(existing.name ?? "Guest")} changed after closeout.`,
    reason: auditReason,
    changes: auditChanges,
  })));
  if (existing.status !== "cancelled" && status === "cancelled") {
    await sendAppointmentCancellationNotifications({
      ...existing,
      requestedDate: date,
      requestedTime: normalizedTime,
      _id: existing._id,
    });
  }
  revalidatePath("/barber/dashboard");
  revalidatePath("/admin/dashboard");
}

async function assertBarberAppointmentSlot({
  db,
  barber,
  date,
  time,
  tab,
  excludeAppointmentId,
}: {
  db: Db;
  barber: { _id: ObjectId; name: string };
  date: string;
  time: string;
  tab: "add" | "appointments";
  excludeAppointmentId?: ObjectId;
}) {
  const normalizedTime = normalizeTime(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !normalizedTime) {
    dashboardError("barber", "Choose a valid appointment date and time.", tab);
  }

  const current = currentShopDateTime();
  if (date < current.date || (date === current.date && normalizedTime <= current.time)) {
    dashboardError("barber", "Choose a future appointment time.", tab);
  }

  const dayOfWeek = dayNumber(date);
  const savedHours = await db.collection<DailyHours>("availability").findOne({
    barberId: barber._id,
    dayOfWeek,
  });
  const hours = savedHours ?? defaultHours(dayOfWeek);
  if (!hours.enabled) {
    dashboardError("barber", "You are not scheduled to work on that day.", tab);
  }
  if (isSlotDuringBreak(normalizedTime, hours)) {
    dashboardError("barber", "That time overlaps your scheduled break.", tab);
  }
  if (!isSlotWithinHours(normalizedTime, hours)) {
    dashboardError("barber", "That time is outside your scheduled working hours.", tab);
  }

  const conflict = await db.collection("appointments").findOne({
    ...(excludeAppointmentId ? { _id: { $ne: excludeAppointmentId } } : {}),
    $or: [{ barberId: barber._id }, { barber: barber.name }],
    requestedDate: date,
    requestedTime: { $in: [normalizedTime, displayTime(normalizedTime)] },
    status: { $nin: ["cancelled", "completed", "no-show"] },
  });
  if (conflict) {
    dashboardError("barber", "You already have an appointment at that time.", tab);
  }
  return normalizedTime;
}

function currentShopDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BARBERSHOP_TIME_ZONE || "America/Indiana/Indianapolis",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export async function createBarber(formData: FormData) {
  const admin = await requireStaffRole("admin");
  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  const adminAccess = formData.get("adminAccess") === "on";
  const commissionPercentage = Number(value(formData, "commissionPercentage"));
  const specialty = value(formData, "specialty");
  const nickname = value(formData, "nickname");
  const bio = value(formData, "bio");
  const photo = await readBarberPhoto(formData, "add-barber");

  if (
    name.length < 2 ||
    !email.includes("@") ||
    !Number.isFinite(commissionPercentage) ||
    commissionPercentage < 0 ||
    commissionPercentage > 100 ||
    specialty.length > 120 ||
    nickname.length > 60 ||
    bio.length > 1200
  ) {
    dashboardError(
      "admin",
      "Enter valid account details and a commission from 0% to 100%.",
      "add-barber",
    );
  }

  const staff = await getStaffCollection();
  if (await staff.findOne({ email })) {
    dashboardError("admin", "A staff account already uses that email.");
  }

  const now = new Date();
  const result = await staff.insertOne({
    name,
    email,
    specialty,
    nickname,
    bio,
    ...(photo ? { hasPhoto: true, photoUpdatedAt: now } : {}),
    role: "barber",
    adminAccess,
    active: true,
    commissionPercentage,
    createdAt: now,
    updatedAt: now,
  });
  if (photo) {
    const client = await getMongoClient();
    await saveBarberPhoto(client.db("hqonmain"), result.insertedId, photo, now);
  }
  const setupToken = await issueBarberSetupToken({ staffId: result.insertedId, createdByStaffId: admin._id, purpose: "onboarding" });

  revalidatePath("/admin/dashboard");
  revalidatePath("/barbers");
  revalidatePath("/book");
  redirect(`/admin/dashboard?tab=barbers&invite=${encodeURIComponent(setupToken)}&inviteBarber=${encodeURIComponent(name)}`);
}

export async function updateBarber(formData: FormData) {
  await requireStaffRole("admin");
  const id = value(formData, "barberId");
  if (!ObjectId.isValid(id)) dashboardError("admin", "Invalid barber account.");

  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  const adminAccess = formData.get("adminAccess") === "on";
  const commissionPercentage = Number(value(formData, "commissionPercentage"));
  const specialty = value(formData, "specialty");
  const nickname = value(formData, "nickname");
  const bio = value(formData, "bio");
  const photo = await readBarberPhoto(formData, "barbers");
  if (
    name.length < 2 ||
    (email.length > 0 && !email.includes("@")) ||
    !Number.isFinite(commissionPercentage) ||
    commissionPercentage < 0 ||
    commissionPercentage > 100 ||
    specialty.length > 120 ||
    nickname.length > 60 ||
    bio.length > 1200
  ) {
    dashboardError("admin", "Enter a valid name, email, and commission from 0% to 100%.", "barbers");
  }

  const update: Record<string, unknown> = {
    name,
    email,
    adminAccess,
    specialty,
    nickname,
    bio,
    commissionPercentage,
    active: value(formData, "active") === "true",
    updatedAt: new Date(),
  };
  const staff = await getStaffCollection();
  const barberId = new ObjectId(id);
  if (await staff.findOne({ email, _id: { $ne: barberId } })) {
    dashboardError("admin", "A staff account already uses that email.", "barbers");
  }
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const removePhoto = !photo && formData.get("removePhoto") === "on";
  if (photo) {
    const photoUpdatedAt = new Date();
    await saveBarberPhoto(db, barberId, photo, photoUpdatedAt);
    update.hasPhoto = true;
    update.photoUpdatedAt = photoUpdatedAt;
  } else if (removePhoto) {
    await db.collection("barberPhotos").deleteOne({ barberId });
  }
  await staff.updateOne(
    { _id: barberId, role: "barber" },
    {
      $set: update,
      ...(removePhoto ? { $unset: { hasPhoto: "", photoUpdatedAt: "" } } : {}),
    },
  );

  if (!update.active) {
    await client
      .db("hqonmain")
      .collection("staffSessions")
      .deleteMany({ staffId: barberId });
    await client
      .db("hqonmain")
      .collection("posSessions")
      .deleteMany({ staffId: barberId });
  }
  revalidatePath("/admin/dashboard");
  revalidatePath("/barbers");
  revalidatePath("/book");
}

export async function createBarberCredentialReset(formData: FormData) {
  const admin = await requireStaffRole("admin");
  const id = value(formData, "barberId");
  if (!ObjectId.isValid(id)) dashboardError("admin", "Invalid barber account.", "barbers");
  const staff = await getStaffCollection();
  const barber = await staff.findOne({ _id: new ObjectId(id), role: "barber" });
  if (!barber) dashboardError("admin", "Barber account not found.", "barbers");
  const token = await issueBarberSetupToken({ staffId: barber._id, createdByStaffId: admin._id, purpose: "reset" });
  redirect(`/admin/dashboard?tab=barbers&invite=${encodeURIComponent(token)}&inviteBarber=${encodeURIComponent(barber.name)}`);
}

async function adminAppointmentValues(
  formData: FormData,
  tab: "add-appointment" | "appointments",
  existingAppointment?: Record<string, unknown>,
) {
  const name = value(formData, "name");
  const phone = value(formData, "phone");
  const email = value(formData, "email").toLowerCase();
  const serviceName = value(formData, "service");
  const barberId = value(formData, "barberId");
  const date = value(formData, "date");
  const time = value(formData, "time");
  const status = value(formData, "status") || "confirmed";
  const visitType = value(formData, "visitType") || "appointment";
  const serviceCatalog = await getServiceCatalog();
  const catalogService = serviceCatalog.find((item) => item.name === serviceName);
  const service = catalogService ?? (
    tab === "appointments" && existingAppointment?.service === serviceName
      ? {
          id: String(existingAppointment.serviceId ?? "historical-service"),
          name: serviceName,
          price: String(existingAppointment.price ?? "TBD"),
        }
      : undefined
  );

  if (
    name.length < 2 ||
    phone.length < 7 ||
    !email.includes("@") ||
    !service ||
    !ObjectId.isValid(barberId) ||
    !date ||
    !time ||
    !["pending", "confirmed", "completed", "cancelled", "no-show"].includes(status)
    || !["appointment", "walk-in"].includes(visitType)
  ) {
    dashboardError("admin", "Complete all appointment fields with valid values.", tab);
  }

  const staff = await getStaffCollection();
  const barber = await staff.findOne({
    _id: new ObjectId(barberId),
    role: "barber",
    active: true,
  });
  if (!barber) dashboardError("admin", "Choose an active barber.", tab);

  const offeredServices = barber.services ?? serviceCatalog.map((item) => item.id);
  if (!service || (catalogService && !offeredServices.includes(service.id))) {
    dashboardError("admin", `${barber.name} does not offer that service.`, tab);
  }

  const normalizedTime = normalizeTime(time);
  if (!normalizedTime) {
    dashboardError("admin", "Choose a valid appointment time.", tab);
  }
  if (["pending", "confirmed"].includes(status)) {
    const client = await getMongoClient();
    const db = client.db("hqonmain");
    const dayOfWeek = dayNumber(date);
    const savedHours = await db.collection<DailyHours>("availability").findOne({
      barberId: barber._id,
      dayOfWeek,
    });
    const hours = savedHours ?? defaultHours(dayOfWeek);
    if (isSlotDuringBreak(normalizedTime, hours)) {
      dashboardError("admin", `${barber.name} has a scheduled break at that time.`, tab);
    }
    if (!isSlotWithinHours(normalizedTime, hours)) {
      dashboardError("admin", `That time is outside ${barber.name}'s working hours.`, tab);
    }
  }

  return {
    name,
    phone,
    email,
    serviceName,
    serviceId: service.id,
    price: service.price,
    barber,
    date,
    time: normalizedTime,
    status,
    visitType,
    notes: value(formData, "notes"),
  };
}

function normalizeServicePrice(input: string) {
  const price = input.trim();
  if (/^tbd$/i.test(price)) return "TBD";
  const numeric = price.replace(/^\$/, "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(numeric)) return null;
  const amount = Number(numeric);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000) return null;
  return `$${amount.toFixed(Number.isInteger(amount) ? 0 : 2)}`;
}

function serviceSlug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function revalidateServicePages() {
  revalidatePath("/admin/dashboard");
  revalidatePath("/barber/dashboard");
  revalidatePath("/services");
  revalidatePath("/book");
  revalidatePath("/pos");
}

export async function createService(formData: FormData) {
  await requireStaffRole("admin");
  const name = value(formData, "name");
  const description = value(formData, "description");
  const price = normalizeServicePrice(value(formData, "price"));
  if (name.length < 2 || name.length > 100 || description.length < 2 || description.length > 600 || !price) {
    dashboardError("admin", "Enter a service name, price such as $35 or TBD, and description.", "services");
  }

  const services = await ensureServiceCatalog();
  const duplicate = await services.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } });
  if (duplicate) dashboardError("admin", "A service with that name already exists.", "services");
  const last = await services.find({}).sort({ sortOrder: -1 }).limit(1).next();
  const baseId = serviceSlug(name) || "service";
  let id = baseId;
  let suffix = 2;
  while (await services.findOne({ id })) id = `${baseId.slice(0, 55)}-${suffix++}`;
  const now = new Date();
  await services.insertOne({
    id,
    name,
    price,
    description,
    sortOrder: Number(last?.sortOrder ?? 0) + 10,
    createdAt: now,
    updatedAt: now,
  });
  revalidateServicePages();
  redirect("/admin/dashboard?tab=services");
}

export async function updateService(formData: FormData) {
  await requireStaffRole("admin");
  const id = value(formData, "serviceId");
  const name = value(formData, "name");
  const description = value(formData, "description");
  const price = normalizeServicePrice(value(formData, "price"));
  if (!id || name.length < 2 || name.length > 100 || description.length < 2 || description.length > 600 || !price) {
    dashboardError("admin", "Enter a valid service name, price, and description.", "services");
  }
  const services = await ensureServiceCatalog();
  const duplicate = await services.findOne({
    id: { $ne: id },
    name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });
  if (duplicate) dashboardError("admin", "A service with that name already exists.", "services");
  const result = await services.updateOne({ id }, { $set: { name, price, description, updatedAt: new Date() } });
  if (!result.matchedCount) dashboardError("admin", "Service not found.", "services");
  revalidateServicePages();
  redirect("/admin/dashboard?tab=services");
}

export async function deleteService(formData: FormData) {
  await requireStaffRole("admin");
  const id = value(formData, "serviceId");
  const services = await ensureServiceCatalog();
  if ((await services.countDocuments()) <= 1) {
    dashboardError("admin", "The shop must keep at least one service.", "services");
  }
  const deleted = await services.deleteOne({ id });
  if (!deleted.deletedCount) dashboardError("admin", "Service not found.", "services");
  const staff = await getStaffCollection();
  await staff.updateMany({ role: "barber" }, { $pull: { services: id } });
  revalidateServicePages();
  redirect("/admin/dashboard?tab=services");
}

export async function createAdminAppointment(formData: FormData) {
  const admin = await requireStaffRole("admin");
  const values = await adminAppointmentValues(formData, "add-appointment");
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  if (
    ["pending", "confirmed"].includes(values.status) &&
    await db.collection("appointments").findOne({
      $or: [{ barberId: values.barber._id }, { barber: values.barber.name }],
      requestedDate: values.date,
      requestedTime: { $in: [values.time, displayTime(values.time)] },
      status: { $in: ["pending", "confirmed"] },
    })
  ) {
    dashboardError("admin", "That barber already has an appointment at this time.", "add-appointment");
  }
  let customer;
  try {
    customer = await resolveCustomer({
      phone: values.phone, name: values.name, email: values.email, source: values.visitType === "walk-in" ? "walk_in" : value(formData, "bookingSource") === "phone" ? "phone" : "staff", createdByUserId: admin._id,
    });
  } catch (error) {
    dashboardError("admin", error instanceof Error ? error.message : "Enter a valid customer phone number.", "add-appointment");
  }

  const now = new Date();
  const bookingSource: BookingSource = values.visitType === "walk-in" ? "walk_in" : value(formData, "bookingSource") === "phone" ? "phone" : "staff";
  const appointment = {
    name: values.name,
    phone: customer.phone,
    email: values.email,
    customerId: customer?._id,
    recipientName: values.name,
    recipientType: "self",
    service: values.serviceName,
    serviceId: values.serviceId,
    price: values.price,
    barber: values.barber.name,
    barberId: values.barber._id,
    requestedDate: values.date,
    requestedTime: values.time,
    status: values.status,
    visitType: values.visitType,
    notes: values.notes,
    source: values.visitType === "walk-in" ? "walk-in" : "admin",
    bookingSource,
    createdByUserId: admin._id,
    smsConsent: formData.get("smsConsent") === "on",
    smsConsentAt: formData.get("smsConsent") === "on" ? now : undefined,
    smsConsentSource: formData.get("smsConsent") === "on" ? "staff-confirmed" : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const savedAppointment = await createAppointment({ db, appointment, bookingSource, customerId: customer._id, recipientName: values.name, createdByUserId: admin._id });
  if (["pending", "confirmed"].includes(values.status)) {
    await Promise.all([
      values.status === "confirmed"
        ? sendAppointmentConfirmation(savedAppointment)
        : Promise.resolve({ sent: false, reason: "not-confirmed" }),
      sendBarberNewAppointment(savedAppointment),
    ]);
  }

  revalidatePath("/admin/dashboard");
  redirect("/admin/dashboard?tab=appointments");
}

export async function updateAdminAppointment(formData: FormData) {
  const admin = await requireStaffRole("admin");
  const appointmentId = value(formData, "appointmentId");
  if (!ObjectId.isValid(appointmentId)) {
    dashboardError("admin", "Invalid appointment.", "appointments");
  }
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const existing = await db.collection("appointments").findOne({
    _id: new ObjectId(appointmentId),
  });
  if (!existing) dashboardError("admin", "Appointment not found.", "appointments");
  const values = await adminAppointmentValues(formData, "appointments", existing);
  if (
    ["pending", "confirmed"].includes(values.status) &&
    await db.collection("appointments").findOne({
      _id: { $ne: new ObjectId(appointmentId) },
      $or: [{ barberId: values.barber._id }, { barber: values.barber.name }],
      requestedDate: values.date,
      requestedTime: { $in: [values.time, displayTime(values.time)] },
      status: { $in: ["pending", "confirmed"] },
    })
  ) {
    dashboardError("admin", "That barber already has an appointment at this time.", "appointments");
  }
  let customer;
  try {
    customer = await resolveCustomer({
      phone: values.phone,
      name: values.name,
      email: values.email,
      source: values.visitType === "walk-in" ? "walk_in" : "staff",
      createdByUserId: admin._id,
    });
  } catch (error) {
    dashboardError("admin", error instanceof Error ? error.message : "Enter a valid customer phone number.", "appointments");
  }
  const checkoutAmountCents = typeof existing.checkoutAmountCents === "number"
    ? parseMoneyToCents(value(formData, "checkoutAmount"))
    : null;
  if (typeof existing.checkoutAmountCents === "number" && checkoutAmountCents === null) {
    dashboardError("admin", "Enter a valid cash total for the completed appointment.", "appointments");
  }
  const auditChanges: FinancialAuditChange[] = [
    ...(String(existing.barber ?? "") !== values.barber.name ? [{ field: "Barber", before: String(existing.barber ?? "Unassigned"), after: values.barber.name }] : []),
    ...(String(existing.service ?? "") !== values.serviceName ? [{ field: "Service", before: String(existing.service ?? "Not specified"), after: values.serviceName }] : []),
    ...(String(existing.requestedDate ?? "") !== values.date ? [{ field: "Date", before: String(existing.requestedDate ?? ""), after: values.date }] : []),
    ...(String(existing.requestedTime ?? "") !== values.time ? [{ field: "Time", before: String(existing.requestedTime ?? ""), after: values.time }] : []),
    ...(String(existing.status ?? "") !== values.status ? [{ field: "Status", before: String(existing.status ?? ""), after: values.status }] : []),
    ...(String(existing.visitType ?? "appointment") !== values.visitType ? [{ field: "Visit type", before: String(existing.visitType ?? "appointment"), after: values.visitType }] : []),
    ...(checkoutAmountCents !== null && checkoutAmountCents !== Number(existing.checkoutAmountCents)
      ? [{ field: "Cash total", before: formatMoney(Number(existing.checkoutAmountCents)), after: formatMoney(checkoutAmountCents) }]
      : []),
  ];
  const closedDates = [...new Set([String(existing.requestedDate ?? ""), values.date])].filter(
    (businessDate) => /^\d{4}-\d{2}-\d{2}$/.test(businessDate),
  );
  const auditedDates = typeof existing.checkoutAmountCents === "number" && auditChanges.length
    ? (await Promise.all(closedDates.map(async (businessDate) => ({ businessDate, closed: await hasDrawerCloseout(db, businessDate) })))).filter((item) => item.closed).map((item) => item.businessDate)
    : [];
  const auditReason = value(formData, "auditReason");
  if (auditedDates.length && auditReason.length < 3) {
    dashboardError("admin", "Enter a reason for changing financial information after drawer closeout.", "appointments");
  }
  const commissionPercentage = Math.min(100, Math.max(0, Number(existing.commissionPercentageSnapshot ?? values.barber.commissionPercentage ?? 0)));
  const commissionAmountCents = checkoutAmountCents === null ? null : Math.round(checkoutAmountCents * commissionPercentage / 100);
  const unchangedRecipient = String(existing.customerId ?? "") === customer._id.toString()
    && String(existing.recipientName ?? existing.name ?? "").trim().toLocaleLowerCase() === values.name.trim().toLocaleLowerCase();
  const recipient = await resolveAppointmentRecipient({
    db,
    customerId: customer._id,
    requestedName: values.name,
    requestedType: "self",
    requestedProfileId: unchangedRecipient && typeof existing.recipientProfileId === "string" ? existing.recipientProfileId : undefined,
  });
  const result = await db.collection("appointments").updateOne(
    { _id: new ObjectId(appointmentId) },
    {
      $set: {
        name: recipient.name,
        phone: customer.phone,
        email: values.email,
        customerId: customer._id,
        recipientName: recipient.name,
        recipientType: recipient.type,
        ...(recipient.profileId ? { recipientProfileId: recipient.profileId } : {}),
        service: values.serviceName,
        serviceId: values.serviceId,
        price: values.price,
        barber: values.barber.name,
        barberId: values.barber._id,
        requestedDate: values.date,
        requestedTime: values.time,
        status: values.status,
        visitType: values.visitType,
        notes: values.notes,
        ...(checkoutAmountCents !== null && commissionAmountCents !== null ? {
          checkoutAmountCents,
          commissionAmountCents,
          shopAmountCents: checkoutAmountCents - commissionAmountCents,
        } : {}),
        updatedAt: new Date(),
      },
      ...(!recipient.profileId ? { $unset: { recipientProfileId: "" } } : {}),
    },
  );
  if (!result.matchedCount) dashboardError("admin", "Appointment not found.", "appointments");
  if (values.status === "completed") {
    await db.collection("customers").updateOne({ _id: customer._id }, { $set: { lastVisitAt: new Date(), updatedAt: new Date() } });
  }
  await Promise.all(auditedDates.map((businessDate) => recordPostCloseoutChange({
    db,
    businessDate,
    actor: admin,
    entityType: "appointment",
    entityId: existing._id,
    summary: `${String(existing.barber ?? values.barber.name)}'s appointment for ${String(existing.name ?? values.name)} changed after closeout.`,
    reason: auditReason,
    changes: auditChanges,
  })));
  if (existing.status !== "cancelled" && values.status === "cancelled") {
    await sendAppointmentCancellationNotifications({
      ...existing,
      name: values.name,
      phone: values.phone,
      service: values.serviceName,
      barber: values.barber.name,
      barberId: values.barber._id,
      requestedDate: values.date,
      requestedTime: values.time,
      _id: existing._id,
    });
  }

  revalidatePath("/admin/dashboard");
  redirect("/admin/dashboard?tab=appointments");
}
