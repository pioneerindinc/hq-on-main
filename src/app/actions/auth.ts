"use server";

import { redirect } from "next/navigation";
import {
  adminSetupRequired,
  createSession,
  deleteSession,
  getStaffCollection,
  hashPassword,
  StaffRole,
  verifyPassword,
} from "@/lib/auth";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function loginError(role: StaffRole, message: string): never {
  redirect(`/${role}/login?error=${encodeURIComponent(message)}`);
}

export async function login(formData: FormData) {
  const email = value(formData, "email").toLowerCase();
  const password = value(formData, "password");
  const role = value(formData, "role") as StaffRole;

  if (!["admin", "barber"].includes(role) || !email || !password) {
    loginError(role === "admin" ? "admin" : "barber", "Enter your email and password.");
  }

  const staffCollection = await getStaffCollection();
  const staff = await staffCollection.findOne(
    role === "admin"
      ? { email, $or: [{ role: "admin" }, { role: "barber", adminAccess: true }] }
      : { email, role: "barber" },
  );

  if (!staff || !staff.active || !(await verifyPassword(password, staff.passwordHash))) {
    loginError(role, "Email or password is incorrect.");
  }

  await createSession(staff);
  redirect(role === "admin" ? "/admin/dashboard" : "/barber/dashboard");
}

export async function setupFirstAdmin(formData: FormData) {
  if (!(await adminSetupRequired())) {
    redirect("/admin/login");
  }

  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  const password = value(formData, "password");

  if (name.length < 2 || !email.includes("@") || password.length < 10) {
    redirect(
      `/admin/setup?error=${encodeURIComponent(
        "Use a valid name and email, plus a password of at least 10 characters.",
      )}`,
    );
  }

  const now = new Date();
  const staffCollection = await getStaffCollection();
  const result = await staffCollection.insertOne({
    name,
    email,
    role: "admin",
    active: true,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });
  const staff = await staffCollection.findOne({ _id: result.insertedId });
  if (!staff) redirect("/admin/setup?error=Unable%20to%20create%20admin.");

  await createSession(staff);
  redirect("/admin/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/");
}
