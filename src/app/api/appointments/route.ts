import { getMongoClient } from "@/lib/mongodb";
import { SERVICE_NAMES } from "@/lib/services";
import { sendBarberNewAppointment } from "@/lib/twilio-sms";

const allowedServices = new Set<string>(SERVICE_NAMES);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const required = ["name", "phone", "email", "service", "barber", "date", "time"];

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

    if (!allowedServices.has(body.service as string)) {
      return Response.json({ message: "Please select a valid service." }, { status: 400 });
    }

    const appointmentDate = new Date(`${body.date as string}T12:00:00`);
    if (Number.isNaN(appointmentDate.valueOf())) {
      return Response.json({ message: "Please select a valid date." }, { status: 400 });
    }

    const client = await getMongoClient();
    const appointment = {
      name: (body.name as string).trim(),
      phone: (body.phone as string).trim(),
      email: (body.email as string).trim().toLowerCase(),
      service: body.service,
      barber: body.barber,
      requestedDate: body.date,
      requestedTime: body.time,
      status: "pending",
      createdAt: new Date(),
    };

    const result = await client
      .db("hqonmain")
      .collection("appointments")
      .insertOne(appointment);
    await sendBarberNewAppointment({ ...appointment, _id: result.insertedId });

    return Response.json(
      { id: result.insertedId.toString(), message: "Appointment requested." },
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
