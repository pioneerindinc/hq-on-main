import { ObjectId } from "mongodb";
import { createCustomerSession, getCurrentCustomer, getCustomerCollection } from "@/lib/customer-auth";
import { hashPassword, getStaffCollection } from "@/lib/auth";
import { type DailyHours, dayNumber, defaultHours, isSlotWithinHours, normalizeTime } from "@/lib/booking";
import { getMongoClient } from "@/lib/mongodb";
import { serviceById } from "@/lib/services";
import { sendAppointmentConfirmation, sendBarberNewAppointment } from "@/lib/twilio-sms";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const serviceId = String(body.serviceId ?? "");
    const barberId = String(body.barberId ?? "");
    const date = String(body.date ?? "");
    const time = normalizeTime(String(body.time ?? ""));
    const service = serviceById(serviceId);

    if (!service || !ObjectId.isValid(barberId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) {
      return Response.json({ message: "Your booking selections are incomplete." }, { status: 400 });
    }
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (date < today) {
      return Response.json({ message: "Appointments cannot be booked in the past." }, { status: 400 });
    }

    const staff = await getStaffCollection();
    const barber = await staff.findOne({
      _id: new ObjectId(barberId),
      role: "barber",
      active: true,
      $or: [{ services: serviceId }, { services: { $exists: false } }],
    });
    if (!barber) {
      return Response.json({ message: "That barber does not offer this service." }, { status: 400 });
    }

    const client = await getMongoClient();
    const db = client.db("hqonmain");
    const dayOfWeek = dayNumber(date);
    const customHours = await db.collection<DailyHours>("availability").findOne({
      barberId: barber._id,
      dayOfWeek,
    });
    const hours = customHours ?? defaultHours(dayOfWeek);
    if (!isSlotWithinHours(time, hours)) {
      return Response.json({ message: "That time is outside the barber’s availability." }, { status: 409 });
    }

    const conflict = await db.collection("appointments").findOne({
      $or: [{ barberId: barber._id }, { barber: barber.name }],
      requestedDate: date,
      requestedTime: { $in: [time, displayLegacyTime(time)] },
      status: { $nin: ["cancelled", "no-show"] },
    });
    if (conflict) {
      return Response.json({ message: "That time was just booked. Please choose another." }, { status: 409 });
    }

    const signedInCustomer = await getCurrentCustomer();
    const name = signedInCustomer?.name ?? String(body.name ?? "").trim();
    const email = signedInCustomer?.email ?? String(body.email ?? "").trim().toLowerCase();
    const phone = signedInCustomer?.phone ?? String(body.phone ?? "").trim();

    if (name.length < 2 || !email.includes("@") || phone.length < 7) {
      return Response.json({ message: "Enter your name, email, and phone number." }, { status: 400 });
    }

    let customerId = signedInCustomer?._id;
    if (!signedInCustomer && body.createAccount === true) {
      const password = String(body.password ?? "");
      if (password.length < 10) {
        return Response.json({ message: "Account passwords must be at least 10 characters." }, { status: 400 });
      }
      const customers = await getCustomerCollection();
      if (await customers.findOne({ email })) {
        return Response.json({ message: "An account already uses this email. Log in instead." }, { status: 409 });
      }
      const now = new Date();
      const result = await customers.insertOne({
        name,
        email,
        phone,
        passwordHash: await hashPassword(password),
        createdAt: now,
        updatedAt: now,
      });
      const customer = await customers.findOne({ _id: result.insertedId });
      if (customer) {
        customerId = customer._id;
        await createCustomerSession(customer);
      }
    }

    const appointment = {
      name,
      email,
      phone,
      customerId,
      service: service.name,
      serviceId: service.id,
      price: service.price,
      barber: barber.name,
      barberId: barber._id,
      requestedDate: date,
      requestedTime: time,
      status: "confirmed",
      source: "online",
      smsConsent: body.smsConsent === true,
      smsConsentAt: body.smsConsent === true ? new Date() : undefined,
      smsConsentSource: body.smsConsent === true ? "online-booking" : undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await db.collection("appointments").insertOne(appointment);
    const savedAppointment = { ...appointment, _id: result.insertedId };
    const [sms, barberSms] = await Promise.all([
      sendAppointmentConfirmation(savedAppointment),
      sendBarberNewAppointment(savedAppointment),
    ]);

    return Response.json({
      confirmationId: result.insertedId.toString().slice(-8).toUpperCase(),
      sms,
      barberSms,
      appointment: {
        service: service.name,
        price: service.price,
        barber: barber.name,
        date,
        time,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Booking confirmation failed", error);
    return Response.json({ message: "We couldn’t complete your booking. Please try again." }, { status: 500 });
  }
}

function displayLegacyTime(time: string) {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}
