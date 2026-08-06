import { ObjectId } from "mongodb";
import {
  type DailyHours,
  dayNumber,
  defaultHours,
  displayTime,
  generateHalfHourSlots,
  isSlotDuringBreak,
  normalizeTime,
} from "@/lib/booking";
import { getStaffCollection } from "@/lib/auth";
import { getMongoClient } from "@/lib/mongodb";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const barberId = params.get("barberId") ?? "";
  const date = params.get("date") ?? "";

  if (!ObjectId.isValid(barberId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ message: "Choose a valid barber and date." }, { status: 400 });
  }
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (date < today) {
    return Response.json({ message: "Choose today or a future date." }, { status: 400 });
  }

  const staff = await getStaffCollection();
  const barber = await staff.findOne({
    _id: new ObjectId(barberId),
    role: "barber",
    active: true,
  });
  if (!barber) return Response.json({ message: "Barber not found." }, { status: 404 });

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const dayOfWeek = dayNumber(date);
  const customHours = await db.collection<DailyHours>("availability").findOne({
    barberId: barber._id,
    dayOfWeek,
  });
  const hours = customHours ?? defaultHours(dayOfWeek);

  if (!hours.enabled) return Response.json({ slots: [] });

  const appointments = await db
    .collection("appointments")
    .find({
      $or: [{ barberId: barber._id }, { barber: barber.name }],
      requestedDate: date,
      status: { $nin: ["cancelled", "no-show"] },
    })
    .project({ requestedTime: 1 })
    .toArray();
  const occupied = new Set(
    appointments.map((appointment) => normalizeTime(String(appointment.requestedTime ?? ""))),
  );
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const slots = generateHalfHourSlots(String(hours.start), String(hours.end))
    .filter((time) => {
      if (occupied.has(time)) return false;
      if (isSlotDuringBreak(time, hours)) return false;
      if (date !== today) return true;
      const [hour, minute] = time.split(":").map(Number);
      return hour * 60 + minute > currentMinutes;
    })
    .map((value) => ({ value, label: displayTime(value) }));

  return Response.json({ slots });
}
