"use server";

import { Binary, ObjectId, type Db } from "mongodb";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaffCollection, hashPassword, requireStaffRole } from "@/lib/auth";
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
import { SERVICE_CATALOG, SERVICE_IDS, SERVICE_NAMES } from "@/lib/services";
import { sendAppointmentConfirmation } from "@/lib/twilio-sms";

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
  const services = SERVICE_CATALOG
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
  const required = ["name", "phone", "email", "service", "date", "time", "visitType"];
  if (required.some((field) => !value(formData, field))) {
    dashboardError("barber", "Complete all appointment fields.", "add");
  }
  const serviceName = value(formData, "service");
  const visitType = value(formData, "visitType");
  if (!["appointment", "walk-in"].includes(visitType)) {
    dashboardError("barber", "Choose appointment or walk-in.", "add");
  }
  const offeredServiceIds = barber.services ?? [...SERVICE_IDS];
  const allowedNames = new Set<string>(SERVICE_NAMES);
  const offeredNames = new Set<string>(
    SERVICE_CATALOG
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
  const service = SERVICE_CATALOG.find((item) => item.name === serviceName)!;
  const now = new Date();
  const appointment = {
    name: value(formData, "name"),
    phone: value(formData, "phone"),
    email: value(formData, "email").toLowerCase(),
    service: serviceName,
    serviceId: service.id,
    price: service.price,
    barber: barber.name,
    barberId: barber._id,
    requestedDate: date,
    requestedTime: time,
    status: "confirmed",
    visitType,
    notes: value(formData, "notes"),
    source: visitType === "walk-in" ? "walk-in" : "barber",
    smsConsent: formData.get("smsConsent") === "on",
    smsConsentAt: formData.get("smsConsent") === "on" ? now : undefined,
    smsConsentSource: formData.get("smsConsent") === "on" ? "staff-confirmed" : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection("appointments").insertOne(appointment);
  await sendAppointmentConfirmation({ ...appointment, _id: result.insertedId });

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
  const result = await client
    .db("hqonmain")
    .collection("appointments")
    .updateOne(
      {
        _id: new ObjectId(id),
        $or: [{ barberId: barber._id }, { barber: barber.name }],
      },
      {
        $set: {
          requestedDate: date,
          requestedTime: normalizedTime,
          status,
          visitType,
          notes: value(formData, "notes"),
          updatedAt: new Date(),
        },
      },
    );

  if (!result.matchedCount) dashboardError("barber", "Appointment not found.", "appointments");
  revalidatePath("/barber/dashboard");
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
  await requireStaffRole("admin");
  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  const password = value(formData, "password");
  const posPin = value(formData, "posPin");
  const commissionPercentage = Number(value(formData, "commissionPercentage"));
  const specialty = value(formData, "specialty");
  const nickname = value(formData, "nickname");
  const bio = value(formData, "bio");
  const photo = await readBarberPhoto(formData, "add-barber");

  if (
    name.length < 2 ||
    !email.includes("@") ||
    password.length < 10 ||
    !/^\d{4,6}$/.test(posPin) ||
    !Number.isFinite(commissionPercentage) ||
    commissionPercentage < 0 ||
    commissionPercentage > 100 ||
    specialty.length > 120 ||
    nickname.length > 60 ||
    bio.length > 1200
  ) {
    dashboardError(
      "admin",
      "Enter valid account details, a 4–6 digit POS PIN, and a commission from 0% to 100%.",
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
    active: true,
    passwordHash: await hashPassword(password),
    posPinHash: await hashPassword(posPin),
    commissionPercentage,
    createdAt: now,
    updatedAt: now,
  });
  if (photo) {
    const client = await getMongoClient();
    await saveBarberPhoto(client.db("hqonmain"), result.insertedId, photo, now);
  }

  revalidatePath("/admin/dashboard");
  revalidatePath("/barbers");
  revalidatePath("/book");
}

export async function updateBarber(formData: FormData) {
  await requireStaffRole("admin");
  const id = value(formData, "barberId");
  if (!ObjectId.isValid(id)) dashboardError("admin", "Invalid barber account.");

  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  const commissionPercentage = Number(value(formData, "commissionPercentage"));
  const specialty = value(formData, "specialty");
  const nickname = value(formData, "nickname");
  const bio = value(formData, "bio");
  const photo = await readBarberPhoto(formData, "barbers");
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
    dashboardError("admin", "Enter a valid name, email, and commission from 0% to 100%.", "barbers");
  }

  const update: Record<string, unknown> = {
    name,
    email,
    specialty,
    nickname,
    bio,
    commissionPercentage,
    active: value(formData, "active") === "true",
    updatedAt: new Date(),
  };

  const newPassword = value(formData, "password");
  if (newPassword) {
    if (newPassword.length < 10) dashboardError("admin", "New passwords must be at least 10 characters.");
    update.passwordHash = await hashPassword(newPassword);
  }

  const newPosPin = value(formData, "posPin");
  if (newPosPin) {
    if (!/^\d{4,6}$/.test(newPosPin)) {
      dashboardError("admin", "POS PINs must contain 4–6 digits.", "barbers");
    }
    update.posPinHash = await hashPassword(newPosPin);
  }

  const staff = await getStaffCollection();
  const barberId = new ObjectId(id);
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

  if (!update.active || newPassword || newPosPin) {
    await client
      .db("hqonmain")
      .collection("staffSessions")
      .deleteMany({ staffId: barberId });
    if (!update.active || newPosPin) {
      await client
        .db("hqonmain")
        .collection("posSessions")
        .deleteMany({ staffId: barberId });
    }
  }
  revalidatePath("/admin/dashboard");
  revalidatePath("/barbers");
  revalidatePath("/book");
}

async function adminAppointmentValues(formData: FormData, tab: "add-appointment" | "appointments") {
  const name = value(formData, "name");
  const phone = value(formData, "phone");
  const email = value(formData, "email").toLowerCase();
  const serviceName = value(formData, "service");
  const barberId = value(formData, "barberId");
  const date = value(formData, "date");
  const time = value(formData, "time");
  const status = value(formData, "status") || "confirmed";
  const visitType = value(formData, "visitType") || "appointment";

  if (
    name.length < 2 ||
    phone.length < 7 ||
    !email.includes("@") ||
    !SERVICE_NAMES.includes(serviceName as (typeof SERVICE_NAMES)[number]) ||
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

  const service = SERVICE_CATALOG.find((item) => item.name === serviceName);
  const offeredServices = barber.services ?? [...SERVICE_IDS];
  if (!service || !offeredServices.includes(service.id)) {
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

export async function createAdminAppointment(formData: FormData) {
  await requireStaffRole("admin");
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
  const customer = await db.collection("customers").findOne({ email: values.email });

  const now = new Date();
  const appointment = {
    name: values.name,
    phone: values.phone,
    email: values.email,
    customerId: customer?._id,
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
    smsConsent: formData.get("smsConsent") === "on",
    smsConsentAt: formData.get("smsConsent") === "on" ? now : undefined,
    smsConsentSource: formData.get("smsConsent") === "on" ? "staff-confirmed" : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection("appointments").insertOne(appointment);
  if (values.status === "confirmed") {
    await sendAppointmentConfirmation({ ...appointment, _id: result.insertedId });
  }

  revalidatePath("/admin/dashboard");
  redirect("/admin/dashboard?tab=appointments");
}

export async function updateAdminAppointment(formData: FormData) {
  await requireStaffRole("admin");
  const appointmentId = value(formData, "appointmentId");
  if (!ObjectId.isValid(appointmentId)) {
    dashboardError("admin", "Invalid appointment.", "appointments");
  }
  const values = await adminAppointmentValues(formData, "appointments");
  const client = await getMongoClient();
  const db = client.db("hqonmain");
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
  const customer = await db.collection("customers").findOne({ email: values.email });

  const result = await db.collection("appointments").updateOne(
    { _id: new ObjectId(appointmentId) },
    {
      $set: {
        name: values.name,
        phone: values.phone,
        email: values.email,
        customerId: customer?._id,
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
        updatedAt: new Date(),
      },
    },
  );
  if (!result.matchedCount) dashboardError("admin", "Appointment not found.", "appointments");

  revalidatePath("/admin/dashboard");
  redirect("/admin/dashboard?tab=appointments");
}
