import "server-only";

import type { Db, ObjectId } from "mongodb";
import type { CustomerRecord } from "@/lib/customer-auth";
import { customerDisplayName } from "@/lib/phone";

export const BOOKING_SOURCES = ["online", "phone", "staff", "walk_in", "vapi", "rebook"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

function comparableName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export async function resolveAppointmentRecipient({
  db,
  customerId,
  requestedName,
  requestedType,
  requestedProfileId,
}: {
  db: Db;
  customerId?: ObjectId;
  requestedName: string;
  requestedType: "self" | "dependent";
  requestedProfileId?: string;
}) {
  if (!customerId) return { name: requestedName, type: requestedType, profileId: requestedProfileId };
  const customer = await db.collection<CustomerRecord>("customers").findOne(
    { _id: customerId },
    { projection: { name: 1, firstName: 1, lastName: 1, dependents: 1 } },
  );
  if (!customer) throw new Error("The customer record is unavailable.");
  const activeDependents = (customer.dependents ?? []).filter((dependent) => dependent.active !== false);
  if (requestedProfileId) {
    const dependent = activeDependents.find((entry) => entry.id === requestedProfileId);
    if (!dependent) throw new Error("That family profile is unavailable.");
    return {
      name: [dependent.firstName, dependent.lastName].filter(Boolean).join(" "),
      type: "dependent" as const,
      profileId: dependent.id,
    };
  }

  const matchingDependents = activeDependents.filter((dependent) =>
    comparableName([dependent.firstName, dependent.lastName].filter(Boolean).join(" ")) === comparableName(requestedName),
  );
  if (matchingDependents.length === 1) {
    const dependent = matchingDependents[0];
    return { name: requestedName, type: "dependent" as const, profileId: dependent.id };
  }
  return {
    name: requestedName || customerDisplayName(customer),
    type: "self" as const,
    profileId: undefined,
  };
}

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
  const recipient = await resolveAppointmentRecipient({
    db,
    customerId,
    requestedName: recipientName,
    requestedType: recipientType,
    requestedProfileId: recipientProfileId,
  });
  const document = {
    ...appointment,
    name: recipient.name,
    bookingSource,
    ...(customerId ? { customerId } : {}),
    recipientName: recipient.name,
    recipientType: recipient.type,
    ...(recipient.profileId ? { recipientProfileId: recipient.profileId } : {}),
    ...(createdByUserId ? { createdByUserId } : {}),
    createdAt: appointment.createdAt ?? now,
    updatedAt: now,
  };
  const result = await db.collection("appointments").insertOne(document);
  return { ...document, _id: result.insertedId };
}
