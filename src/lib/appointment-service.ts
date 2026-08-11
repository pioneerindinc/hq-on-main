import "server-only";

import type { Db, ObjectId } from "mongodb";

export const BOOKING_SOURCES = ["online", "phone", "staff", "walk_in", "vapi", "rebook"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export async function createAppointment({
  db,
  appointment,
  bookingSource,
  customerId,
  recipientName,
  recipientType = "self",
  recipientProfileId,
  createdByUserId,
}: {
  db: Db;
  appointment: Record<string, unknown>;
  bookingSource: BookingSource;
  customerId?: ObjectId;
  recipientName: string;
  recipientType?: "self" | "dependent";
  recipientProfileId?: string;
  createdByUserId?: ObjectId;
}) {
  const now = new Date();
  const document = {
    ...appointment,
    bookingSource,
    ...(customerId ? { customerId } : {}),
    recipientName,
    recipientType,
    ...(recipientProfileId ? { recipientProfileId } : {}),
    ...(createdByUserId ? { createdByUserId } : {}),
    createdAt: appointment.createdAt ?? now,
    updatedAt: now,
  };
  const result = await db.collection("appointments").insertOne(document);
  return { ...document, _id: result.insertedId };
}
