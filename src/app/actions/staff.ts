"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaffCollection, hashPassword, requireStaffRole } from "@/lib/auth";
import { displayTime } from "@/lib/booking";
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

export async function saveAvailability(formData: FormData) {
  const barber = await requireStaffRole("barber");
  const client = await getMongoClient();
  const availability = client.db("hqonmain").collection("availability");
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  await Promise.all(
    days.map((day, index) =>
      availability.updateOne(
        { barberId: barber._id, dayOfWeek: index + 1 },
        {
          $set: {
            barberId: barber._id,
            barberName: barber.name,
            dayOfWeek: index + 1,
            day,
            enabled: formData.get(`${day}_enabled`) === "on",
            start: value(formData, `${day}_start`) || "09:00",
            end: value(formData, `${day}_end`) || "17:00",
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
  const required = ["name", "phone", "email", "service", "date", "time"];
  if (required.some((field) => !value(formData, field))) {
    dashboardError("barber", "Complete all appointment fields.");
  }
  const serviceName = value(formData, "service");
  const offeredServiceIds = barber.services ?? [...SERVICE_IDS];
  const allowedNames = new Set<string>(SERVICE_NAMES);
  const offeredNames = new Set<string>(
    SERVICE_CATALOG
      .filter((service) => offeredServiceIds.includes(service.id))
      .map((service) => service.name),
  );
  if (!allowedNames.has(serviceName) || !offeredNames.has(serviceName)) {
    dashboardError("barber", "Choose a service you currently offer.");
  }

  const client = await getMongoClient();
  const now = new Date();
  const appointment = {
    name: value(formData, "name"),
    phone: value(formData, "phone"),
    email: value(formData, "email").toLowerCase(),
    service: serviceName,
    barber: barber.name,
    barberId: barber._id,
    requestedDate: value(formData, "date"),
    requestedTime: value(formData, "time"),
    status: "confirmed",
    notes: value(formData, "notes"),
    source: "barber",
    smsConsent: formData.get("smsConsent") === "on",
    smsConsentAt: formData.get("smsConsent") === "on" ? now : undefined,
    smsConsentSource: formData.get("smsConsent") === "on" ? "staff-confirmed" : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const result = await client.db("hqonmain").collection("appointments").insertOne(appointment);
  await sendAppointmentConfirmation({ ...appointment, _id: result.insertedId });

  revalidatePath("/barber/dashboard");
}

export async function updateBarberAppointment(formData: FormData) {
  const barber = await requireStaffRole("barber");
  const id = value(formData, "appointmentId");
  if (!ObjectId.isValid(id)) dashboardError("barber", "Invalid appointment.");
  const status = value(formData, "status");
  const date = value(formData, "date");
  const time = value(formData, "time");
  if (
    !["pending", "confirmed", "completed", "cancelled", "no-show"].includes(status) ||
    !date ||
    !time
  ) {
    dashboardError("barber", "Choose a valid date, time, and status.");
  }

  const client = await getMongoClient();
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
          requestedTime: time,
          status,
          notes: value(formData, "notes"),
          updatedAt: new Date(),
        },
      },
    );

  if (!result.matchedCount) dashboardError("barber", "Appointment not found.");
  revalidatePath("/barber/dashboard");
}

export async function createBarber(formData: FormData) {
  await requireStaffRole("admin");
  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  const password = value(formData, "password");
  const specialty = value(formData, "specialty");

  if (name.length < 2 || !email.includes("@") || password.length < 10) {
    dashboardError("admin", "Enter a valid name, email, and temporary password of 10+ characters.");
  }

  const staff = await getStaffCollection();
  if (await staff.findOne({ email })) {
    dashboardError("admin", "A staff account already uses that email.");
  }

  const now = new Date();
  await staff.insertOne({
    name,
    email,
    specialty,
    role: "barber",
    active: true,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });

  revalidatePath("/admin/dashboard");
}

export async function updateBarber(formData: FormData) {
  await requireStaffRole("admin");
  const id = value(formData, "barberId");
  if (!ObjectId.isValid(id)) dashboardError("admin", "Invalid barber account.");

  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  if (name.length < 2 || !email.includes("@")) {
    dashboardError("admin", "Enter a valid name and email.");
  }

  const update: Record<string, unknown> = {
    name,
    email,
    specialty: value(formData, "specialty"),
    active: value(formData, "active") === "true",
    updatedAt: new Date(),
  };

  const newPassword = value(formData, "password");
  if (newPassword) {
    if (newPassword.length < 10) dashboardError("admin", "New passwords must be at least 10 characters.");
    update.passwordHash = await hashPassword(newPassword);
  }

  const staff = await getStaffCollection();
  await staff.updateOne(
    { _id: new ObjectId(id), role: "barber" },
    { $set: update },
  );

  if (!update.active || newPassword) {
    const client = await getMongoClient();
    await client
      .db("hqonmain")
      .collection("staffSessions")
      .deleteMany({ staffId: new ObjectId(id) });
  }
  revalidatePath("/admin/dashboard");
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

  if (
    name.length < 2 ||
    phone.length < 7 ||
    !email.includes("@") ||
    !SERVICE_NAMES.includes(serviceName as (typeof SERVICE_NAMES)[number]) ||
    !ObjectId.isValid(barberId) ||
    !date ||
    !time ||
    !["pending", "confirmed", "completed", "cancelled", "no-show"].includes(status)
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

  return {
    name,
    phone,
    email,
    serviceName,
    serviceId: service.id,
    price: service.price,
    barber,
    date,
    time,
    status,
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
    notes: values.notes,
    source: "admin",
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
        notes: values.notes,
        updatedAt: new Date(),
      },
    },
  );
  if (!result.matchedCount) dashboardError("admin", "Appointment not found.", "appointments");

  revalidatePath("/admin/dashboard");
  redirect("/admin/dashboard?tab=appointments");
}
