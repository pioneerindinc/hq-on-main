import { getStaffCollection } from "@/lib/auth";
import { serviceById } from "@/lib/services";

export async function GET(request: Request) {
  const serviceId = new URL(request.url).searchParams.get("serviceId") ?? "";
  if (!serviceById(serviceId)) {
    return Response.json({ message: "Choose a valid service." }, { status: 400 });
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

  return Response.json({
    barbers: barbers.map((barber) => ({
      id: barber._id.toString(),
      name: barber.name,
      specialty: barber.specialty ?? "HQ Barber",
    })),
  });
}
