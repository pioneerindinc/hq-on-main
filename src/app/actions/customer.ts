"use server";

import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  deleteCustomerSession,
  getCustomerCollection,
  requireCustomer,
} from "@/lib/customer-auth";
import { getMongoClient } from "@/lib/mongodb";
import { splitCustomerName } from "@/lib/phone";
import { sendAppointmentCancellationNotifications } from "@/lib/twilio-sms";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function centerMessage(tab: string, type: "error" | "success", message: string): never {
  redirect(`/customer/dashboard?tab=${tab}&${type}=${encodeURIComponent(message)}`);
}

export async function logoutCustomer() {
  await deleteCustomerSession();
  redirect("/");
}

export async function updateCustomerProfile(formData: FormData) {
  const customer = await requireCustomer();
  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  if (name.length < 2 || (email && !email.includes("@"))) {
    centerMessage("profile", "error", "Enter valid contact information.");
  }

  const customers = await getCustomerCollection();
  const duplicate = email ? await customers.findOne({ email, _id: { $ne: customer._id } }) : null;
  if (duplicate) centerMessage("profile", "error", "Another account already uses that email.");

  const split = splitCustomerName(name);
  await customers.updateOne(
    { _id: customer._id },
    { $set: { name, firstName: split.firstName, lastName: split.lastName, email, updatedAt: new Date() } },
  );

  const client = await getMongoClient();
  await client
    .db("hqonmain")
    .collection("appointments")
    .updateMany(
      {
        customerId: customer._id,
        status: { $in: ["pending", "confirmed"] },
      },
      { $set: { phone: customer.phone, email, updatedAt: new Date() } },
    );
  await client
    .db("hqonmain")
    .collection("appointments")
    .updateMany(
      {
        customerId: customer._id,
        recipientType: { $ne: "dependent" },
        status: { $in: ["pending", "confirmed"] },
      },
      { $set: { name, recipientName: name, updatedAt: new Date() } },
    );

  revalidatePath("/customer/dashboard");
  centerMessage("profile", "success", "Profile updated.");
}

export async function addCustomerDependent(formData: FormData) {
  const customer = await requireCustomer();
  const firstName = value(formData, "firstName");
  const lastName = value(formData, "lastName");
  const relationship = value(formData, "relationship") === "dependent" ? "dependent" : "child";
  if (firstName.length < 1 || firstName.length > 80 || lastName.length > 100) {
    centerMessage("family", "error", "Enter a valid name for this family member.");
  }
  const now = new Date();
  const customers = await getCustomerCollection();
  await customers.updateOne(
    { _id: customer._id },
    {
      $push: {
        dependents: {
          id: randomUUID(),
          firstName,
          lastName,
          relationship,
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      $set: { updatedAt: now },
    },
  );
  revalidatePath("/customer/dashboard");
  centerMessage("family", "success", `${firstName} was added to your family.`);
}

export async function updateCustomerDependent(formData: FormData) {
  const customer = await requireCustomer();
  const dependentId = value(formData, "dependentId");
  const firstName = value(formData, "firstName");
  const lastName = value(formData, "lastName");
  const relationship = value(formData, "relationship") === "dependent" ? "dependent" : "child";
  const active = value(formData, "active") !== "false";
  if (!dependentId || firstName.length < 1 || firstName.length > 80 || lastName.length > 100) {
    centerMessage("family", "error", "Enter valid family profile details.");
  }
  const customers = await getCustomerCollection();
  const result = await customers.updateOne(
    { _id: customer._id, "dependents.id": dependentId },
    {
      $set: {
        "dependents.$.firstName": firstName,
        "dependents.$.lastName": lastName,
        "dependents.$.relationship": relationship,
        "dependents.$.active": active,
        "dependents.$.updatedAt": new Date(),
        updatedAt: new Date(),
      },
    },
  );
  if (!result.matchedCount) centerMessage("family", "error", "That family profile was not found.");
  revalidatePath("/customer/dashboard");
  centerMessage("family", "success", `${firstName}'s profile was updated.`);
}

export async function cancelCustomerAppointment(formData: FormData) {
  const customer = await requireCustomer();
  const appointmentId = value(formData, "appointmentId");
  if (!ObjectId.isValid(appointmentId)) {
    centerMessage("appointments", "error", "Invalid appointment.");
  }

  const client = await getMongoClient();
  const appointments = client.db("hqonmain").collection("appointments");
  const filter = {
    _id: new ObjectId(appointmentId),
    customerId: customer._id,
    status: { $in: ["pending", "confirmed"] },
  };
  const appointment = await appointments.findOne(filter);
  if (!appointment) {
    centerMessage("appointments", "error", "This appointment cannot be cancelled.");
  }
  const result = await appointments.updateOne(
    filter,
    { $set: { status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() } },
  );
  if (!result.modifiedCount) {
    centerMessage("appointments", "error", "This appointment cannot be cancelled.");
  }
  await sendAppointmentCancellationNotifications({ ...appointment, _id: appointment._id });
  revalidatePath("/customer/dashboard");
  centerMessage("appointments", "success", "Appointment cancelled.");
}
