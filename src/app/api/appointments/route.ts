import { getMongoClient } from "@/lib/mongodb";
import { createAppointment } from "@/lib/appointment-service";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { getServiceCatalog } from "@/lib/services";
import { sendBarberNewAppointment } from "@/lib/twilio-sms";

export async function POST(request: Request) {
  try {
    const customer = await getCurrentCustomer();
    if (!customer?.phoneVerifiedAt) {
      return Response.json({ message: "Verify your mobile number before reserving." }, { status: 401 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const required = ["service", "barber", "date", "time"];

    if (
      required.some(
        (field) => typeof body[field] !== "string" || !body[field]?.toString().trim(),
      )
    ) {
      return Response.json(
        { message: "Please complete every field." },
        { status: 400 },
      );
    }

    const allowedServices = new Set((await getServiceCatalog()).map((service) => service.name));
    if (!allowedServices.has(body.service as string)) {
      return Response.json({ message: "Please select a valid service." }, { status: 400 });
    }

    const appointmentDate = new Date(`${body.date as string}T12:00:00`);
    if (Number.isNaN(appointmentDate.valueOf())) {
      return Response.json({ message: "Please select a valid date." }, { status: 400 });
    }

    const client = await getMongoClient();
    const appointment = {
      name: customer.name,
      phone: customer.phone,
      email: customer.email ?? "",
      customerId: customer._id,
      recipientName: customer.name,
      recipientType: "self",
      service: body.service,
      barber: body.barber,
      requestedDate: body.date,
      requestedTime: body.time,
      status: "pending",
      source: "online",
      bookingSource: "online",
      createdAt: new Date(),
    };

    const savedAppointment = await createAppointment({ db: client.db("hqonmain"), appointment, bookingSource: "online", customerId: customer._id, recipientName: customer.name });
    await sendBarberNewAppointment(savedAppointment);

    return Response.json(
      { id: savedAppointment._id.toString(), message: "Appointment requested." },
      { status: 201 },
    );
  } catch (error) {
    console.error("Appointment request failed", error);
    return Response.json(
      { message: "We couldn’t save your request. Please call the shop instead." },
      { status: 500 },
    );
  }
}
