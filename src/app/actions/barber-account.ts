"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSession, getStaffCollection, hashPassword, requireStaffRole, verifyPassword } from "@/lib/auth";
import { completeBarberCredentialSetup } from "@/lib/barber-setup";
import { getMongoClient } from "@/lib/mongodb";
import { normalizePhone } from "@/lib/phone";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function settingsError(message: string): never {
  redirect(`/barber/dashboard?tab=account&error=${encodeURIComponent(message)}`);
}

export async function completeBarberSetup(formData: FormData) {
  const token = value(formData, "token");
  const password = value(formData, "password");
  const passwordConfirm = value(formData, "passwordConfirm");
  const posPin = value(formData, "posPin");
  const posPinConfirm = value(formData, "posPinConfirm");
  const phoneInput = value(formData, "phone");
  const phone = phoneInput ? normalizePhone(phoneInput) : "";
  const consent = formData.get("smsNotificationsEnabled") === "on";
  if (password.length < 10 || password !== passwordConfirm) redirect(`/barber/setup?token=${encodeURIComponent(token)}&error=${encodeURIComponent("Use a password of at least 10 characters and enter it twice.")}`);
  if (!/^\d{4,6}$/.test(posPin) || posPin !== posPinConfirm) redirect(`/barber/setup?token=${encodeURIComponent(token)}&error=${encodeURIComponent("Choose a matching 4–6 digit POS PIN.")}`);
  if (phoneInput && !phone) redirect(`/barber/setup?token=${encodeURIComponent(token)}&error=${encodeURIComponent("Enter a valid mobile phone number.")}`);
  if (consent && !phone) redirect(`/barber/setup?token=${encodeURIComponent(token)}&error=${encodeURIComponent("Enter a mobile number before enabling appointment notifications.")}`);
  try {
    const barber = await completeBarberCredentialSetup({
      token,
      passwordHash: await hashPassword(password),
      posPinHash: await hashPassword(posPin),
      phone: phone || "",
      smsNotificationsEnabled: consent,
    });
    if (!barber) throw new Error("This barber account is unavailable.");
    await createSession(barber);
  } catch (error) {
    redirect(`/barber/setup?token=${encodeURIComponent(token)}&error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to finish setup.")}`);
  }
  redirect("/barber/dashboard?tab=account&success=Account%20setup%20complete.");
}

export async function updateBarberAccount(formData: FormData) {
  const barber = await requireStaffRole("barber");
  const staff = await getStaffCollection();
  const stored = await staff.findOne({ _id: barber._id, role: "barber", active: true });
  if (!stored) settingsError("Your barber account is unavailable.");
  const phoneInput = value(formData, "phone");
  const phone = phoneInput ? normalizePhone(phoneInput) : "";
  const consent = formData.get("smsNotificationsEnabled") === "on";
  const currentPassword = value(formData, "currentPassword");
  const newPassword = value(formData, "newPassword");
  const newPasswordConfirm = value(formData, "newPasswordConfirm");
  const newPosPin = value(formData, "newPosPin");
  const newPosPinConfirm = value(formData, "newPosPinConfirm");
  if (phoneInput && !phone) settingsError("Enter a valid mobile phone number.");
  if (consent && !phone) settingsError("Enter a mobile number before enabling appointment notifications.");
  if (newPassword && (newPassword.length < 10 || newPassword !== newPasswordConfirm)) settingsError("Your new password must contain at least 10 characters and match the confirmation.");
  if (newPosPin && (!/^\d{4,6}$/.test(newPosPin) || newPosPin !== newPosPinConfirm)) settingsError("Your new POS PIN must contain 4–6 digits and match the confirmation.");
  if ((newPassword || newPosPin) && !(await verifyPassword(currentPassword, stored.passwordHash))) settingsError("Enter your current password before changing your password or PIN.");

  const now = new Date();
  const update: Record<string, unknown> = {
    phone: phone || "",
    smsNotificationsEnabled: consent,
    updatedAt: now,
    ...(newPassword ? { passwordHash: await hashPassword(newPassword) } : {}),
    ...(newPosPin ? { posPinHash: await hashPassword(newPosPin) } : {}),
    ...(consent && !stored.smsNotificationsEnabled ? { smsConsentAt: now, smsConsentSource: "barber-account-settings" } : {}),
  };
  await staff.updateOne(
    { _id: barber._id },
    { $set: update, ...(!consent ? { $unset: { smsConsentAt: "", smsConsentSource: "" } } : {}) },
  );
  if (newPosPin || newPassword) {
    const client = await getMongoClient();
    const db = client.db("hqonmain");
    if (newPosPin) await db.collection("posSessions").deleteMany({ staffId: barber._id });
    if (newPassword) {
      await db.collection("staffSessions").deleteMany({ staffId: barber._id });
      const refreshed = await staff.findOne({ _id: barber._id, active: true });
      if (!refreshed) settingsError("Your barber account is unavailable.");
      await createSession(refreshed);
    }
  }
  revalidatePath("/barber/dashboard");
  redirect("/barber/dashboard?tab=account&success=Account%20settings%20saved.");
}
