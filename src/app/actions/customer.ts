"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, verifyPassword } from "@/lib/auth";
import {
  createCustomerSession,
  deleteAllCustomerSessions,
  deleteCustomerSession,
  getCustomerCollection,
  requireCustomer,
} from "@/lib/customer-auth";
import { getMongoClient } from "@/lib/mongodb";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function authError(area: "login" | "register", message: string): never {
  redirect(`/customer/${area}?error=${encodeURIComponent(message)}`);
}

function centerMessage(tab: string, type: "error" | "success", message: string): never {
  redirect(`/customer/dashboard?tab=${tab}&${type}=${encodeURIComponent(message)}`);
}

export async function registerCustomer(formData: FormData) {
  const name = value(formData, "name");
  const phone = value(formData, "phone");
  const email = value(formData, "email").toLowerCase();
  const password = value(formData, "password");

  if (name.length < 2 || phone.length < 7 || !email.includes("@") || password.length < 10) {
    authError("register", "Enter valid contact details and a password of at least 10 characters.");
  }

  const customers = await getCustomerCollection();
  if (await customers.findOne({ email })) {
    authError("register", "An account already uses this email. Log in instead.");
  }

  const now = new Date();
  const result = await customers.insertOne({
    name,
    phone,
    email,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });
  const customer = await customers.findOne({ _id: result.insertedId });
  if (!customer) authError("register", "Unable to create your account.");
  await createCustomerSession(customer);
  redirect("/customer/dashboard");
}

export async function loginCustomer(formData: FormData) {
  const email = value(formData, "email").toLowerCase();
  const password = value(formData, "password");
  const customers = await getCustomerCollection();
  const customer = await customers.findOne({ email });

  if (!customer || !(await verifyPassword(password, customer.passwordHash))) {
    authError("login", "Email or password is incorrect.");
  }
  await createCustomerSession(customer);
  redirect("/customer/dashboard");
}

export async function logoutCustomer() {
  await deleteCustomerSession();
  redirect("/");
}

export async function updateCustomerProfile(formData: FormData) {
  const customer = await requireCustomer();
  const name = value(formData, "name");
  const phone = value(formData, "phone");
  const email = value(formData, "email").toLowerCase();
  if (name.length < 2 || phone.length < 7 || !email.includes("@")) {
    centerMessage("profile", "error", "Enter valid contact information.");
  }

  const customers = await getCustomerCollection();
  const duplicate = await customers.findOne({ email, _id: { $ne: customer._id } });
  if (duplicate) centerMessage("profile", "error", "Another account already uses that email.");

  const oldEmail = customer.email;
  await customers.updateOne(
    { _id: customer._id },
    { $set: { name, phone, email, updatedAt: new Date() } },
  );

  const client = await getMongoClient();
  await client
    .db("hqonmain")
    .collection("appointments")
    .updateMany(
      {
        $or: [{ customerId: customer._id }, { email: oldEmail }],
        status: { $in: ["pending", "confirmed"] },
      },
      { $set: { name, phone, email, updatedAt: new Date() } },
    );

  revalidatePath("/customer/dashboard");
  centerMessage("profile", "success", "Profile updated.");
}

export async function changeCustomerPassword(formData: FormData) {
  const customer = await requireCustomer();
  const currentPassword = value(formData, "currentPassword");
  const newPassword = value(formData, "newPassword");
  const customers = await getCustomerCollection();
  const record = await customers.findOne({ _id: customer._id });

  if (!record || !(await verifyPassword(currentPassword, record.passwordHash))) {
    centerMessage("security", "error", "Your current password is incorrect.");
  }
  if (newPassword.length < 10) {
    centerMessage("security", "error", "Your new password must be at least 10 characters.");
  }

  await customers.updateOne(
    { _id: customer._id },
    { $set: { passwordHash: await hashPassword(newPassword), updatedAt: new Date() } },
  );
  await deleteAllCustomerSessions(customer._id);
  redirect("/customer/login?success=Password%20updated.%20Please%20log%20in%20again.");
}

export async function cancelCustomerAppointment(formData: FormData) {
  const customer = await requireCustomer();
  const appointmentId = value(formData, "appointmentId");
  if (!ObjectId.isValid(appointmentId)) {
    centerMessage("appointments", "error", "Invalid appointment.");
  }

  const client = await getMongoClient();
  const result = await client
    .db("hqonmain")
    .collection("appointments")
    .updateOne(
      {
        _id: new ObjectId(appointmentId),
        $or: [{ customerId: customer._id }, { email: customer.email }],
        status: { $in: ["pending", "confirmed"] },
      },
      { $set: { status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() } },
    );
  if (!result.matchedCount) {
    centerMessage("appointments", "error", "This appointment cannot be cancelled.");
  }
  revalidatePath("/customer/dashboard");
  centerMessage("appointments", "success", "Appointment cancelled.");
}
