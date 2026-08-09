"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getStaffCollection, verifyPassword } from "@/lib/auth";
import {
  type DailyHours,
  currentShopDateTime,
  dayNumber,
  defaultHours,
} from "@/lib/booking";
import {
  formatWholeDollarMoney,
  parseMoneyToCents,
  roundCashPayoutCents,
} from "@/lib/money";
import { getMongoClient } from "@/lib/mongodb";
import {
  createPosSession,
  deletePosSession,
  getCurrentPosBarber,
} from "@/lib/pos-auth";
import { SERVICE_CATALOG, SERVICE_IDS } from "@/lib/services";
import { sendAppointmentCancellationNotifications } from "@/lib/twilio-sms";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function posError(message: string): never {
  redirect(`/pos?error=${encodeURIComponent(message)}`);
}

type CommissionPayoutAudit = {
  amountCents: number;
  paidAt: Date;
  paidByStaffId: ObjectId;
  paidByName: string;
};

type CommissionPayoutRecord = {
  businessDate: string;
  barberId: ObjectId;
  barberName: string;
  calculatedCommissionCents: number;
  roundedPayoutCents: number;
  paidAmountCents: number;
  history: CommissionPayoutAudit[];
  createdAt: Date;
  updatedAt: Date;
};

export async function loginPos(formData: FormData) {
  const barberId = value(formData, "barberId");
  const pin = value(formData, "pin");
  if (!ObjectId.isValid(barberId) || !/^\d{4,6}$/.test(pin)) {
    posError("Enter your 4–6 digit POS PIN.");
  }

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const staffId = new ObjectId(barberId);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const attempts = db.collection("posLoginAttempts");
  await attempts.createIndex({ createdAt: 1 }, { expireAfterSeconds: 600 });
  if (await attempts.countDocuments({ staffId, createdAt: { $gte: tenMinutesAgo } }) >= 8) {
    posError("Too many PIN attempts. Wait ten minutes and try again.");
  }

  const staff = await getStaffCollection();
  const barber = await staff.findOne({
    _id: staffId,
    role: "barber",
    active: true,
  });
  const valid = Boolean(barber?.posPinHash) && await verifyPassword(pin, barber!.posPinHash!);
  if (!barber || !valid) {
    await attempts.insertOne({ staffId, createdAt: new Date() });
    posError("That PIN was not recognized.");
  }

  const shopNow = currentShopDateTime();
  const weekday = dayNumber(shopNow.date);
  const savedHours = await db.collection<DailyHours>("availability").findOne({
    barberId: barber._id,
    dayOfWeek: weekday,
  });
  const hours = savedHours ?? defaultHours(weekday);
  if (hours.enabled !== true || shopNow.time < String(hours.start) || shopNow.time >= String(hours.end)) {
    posError("You are not currently within your scheduled working hours.");
  }

  await attempts.deleteMany({ staffId });
  await createPosSession(barber._id);
  redirect("/pos");
}

export async function logoutPos() {
  await deletePosSession();
  redirect("/pos");
}

export async function completePosAppointment(formData: FormData) {
  const barber = await getCurrentPosBarber();
  if (!barber) posError("Your register session expired. Enter your PIN again.");

  const appointmentId = value(formData, "appointmentId");
  const amountCents = parseMoneyToCents(value(formData, "amount"));
  if (!ObjectId.isValid(appointmentId) || amountCents === null || amountCents <= 0) {
    posError("Enter a valid cash total before completing the appointment.");
  }

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const today = currentShopDateTime().date;
  const appointmentObjectId = new ObjectId(appointmentId);
  const appointment = await db.collection("appointments").findOne({
    _id: appointmentObjectId,
    $or: [{ barberId: barber._id }, { barber: barber.name }],
    requestedDate: today,
  });
  if (!appointment) posError("That appointment is not available in your register.");
  if (typeof appointment.checkoutAmountCents === "number") {
    posError("That appointment has already been checked out.");
  }

  const commissionPercentage = Math.min(100, Math.max(0, Number(barber.commissionPercentage ?? 0)));
  const commissionAmountCents = Math.round(amountCents * commissionPercentage / 100);
  const now = new Date();
  const result = await db.collection("appointments").updateOne(
    { _id: appointmentObjectId, checkoutAmountCents: { $exists: false } },
    {
      $set: {
        status: "completed",
        checkoutMethod: "cash",
        checkoutAmountCents: amountCents,
        commissionPercentageSnapshot: commissionPercentage,
        commissionAmountCents,
        shopAmountCents: amountCents - commissionAmountCents,
        completedAt: now,
        completedByStaffId: barber._id,
        updatedAt: now,
      },
    },
  );
  if (!result.modifiedCount) posError("That appointment was already checked out. Refresh the register.");

  revalidatePath("/pos");
  redirect(`/pos?notice=${encodeURIComponent("Cash checkout recorded.")}`);
}

export async function checkoutPosWalkIn(formData: FormData) {
  const barber = await getCurrentPosBarber();
  if (!barber) posError("Your register session expired. Enter your PIN again.");

  const name = value(formData, "name");
  const phone = value(formData, "phone");
  const serviceId = value(formData, "serviceId");
  const amountCents = parseMoneyToCents(value(formData, "amount"));
  const service = SERVICE_CATALOG.find((item) => item.id === serviceId);
  const offeredServiceIds = barber.services ?? [...SERVICE_IDS];
  if (
    name.length < 2 ||
    !service ||
    !offeredServiceIds.includes(service.id) ||
    amountCents === null ||
    amountCents <= 0
  ) {
    posError("Enter the walk-in guest, an offered service, and a valid cash total.");
  }

  const commissionPercentage = Math.min(100, Math.max(0, Number(barber.commissionPercentage ?? 0)));
  const commissionAmountCents = Math.round(amountCents * commissionPercentage / 100);
  const shopNow = currentShopDateTime();
  const now = new Date();
  const client = await getMongoClient();
  await client.db("hqonmain").collection("appointments").insertOne({
    name,
    phone,
    email: "",
    service: service.name,
    serviceId: service.id,
    price: service.price,
    barber: barber.name,
    barberId: barber._id,
    requestedDate: shopNow.date,
    requestedTime: shopNow.time,
    status: "completed",
    visitType: "walk-in",
    source: "pos-walk-in",
    checkoutMethod: "cash",
    checkoutAmountCents: amountCents,
    commissionPercentageSnapshot: commissionPercentage,
    commissionAmountCents,
    shopAmountCents: amountCents - commissionAmountCents,
    completedAt: now,
    completedByStaffId: barber._id,
    createdAt: now,
    updatedAt: now,
  });

  revalidatePath("/pos");
  revalidatePath("/barber/dashboard");
  revalidatePath("/admin/dashboard");
  redirect(`/pos?notice=${encodeURIComponent(`${name}'s walk-in cash checkout was recorded.`)}`);
}

export async function updatePosAppointmentStatus(formData: FormData) {
  const barber = await getCurrentPosBarber();
  if (!barber) posError("Your register session expired. Enter your PIN again.");

  const appointmentId = value(formData, "appointmentId");
  const status = value(formData, "status");
  if (!ObjectId.isValid(appointmentId) || !["confirmed", "cancelled", "no-show"].includes(status)) {
    posError("Choose a valid appointment status.");
  }

  const client = await getMongoClient();
  const appointments = client.db("hqonmain").collection("appointments");
  const filter = {
    _id: new ObjectId(appointmentId),
    $or: [{ barberId: barber._id }, { barber: barber.name }],
    requestedDate: currentShopDateTime().date,
    status: { $ne: "completed" },
  };
  const appointment = await appointments.findOne(filter);
  if (!appointment) posError("That appointment could not be updated.");
  const result = await appointments.updateOne(
    filter,
    {
      $set: {
        status,
        posStatusUpdatedAt: new Date(),
        posStatusUpdatedByStaffId: barber._id,
        updatedAt: new Date(),
      },
    },
  );
  if (!result.matchedCount) posError("That appointment could not be updated.");
  if (appointment.status !== "cancelled" && status === "cancelled") {
    await sendAppointmentCancellationNotifications({ ...appointment, _id: appointment._id });
  }

  revalidatePath("/pos");
  redirect("/pos");
}

export async function cashOutBarberCommission(formData: FormData) {
  const payingBarber = await getCurrentPosBarber();
  if (!payingBarber) posError("Your register session expired. Enter your PIN again.");

  const barberId = value(formData, "barberId");
  if (!ObjectId.isValid(barberId)) posError("Choose a valid barber payout.");

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const targetId = new ObjectId(barberId);
  const target = await db.collection("staff").findOne({ _id: targetId, role: "barber" });
  if (!target) posError("That barber could not be found.");

  const businessDate = currentShopDateTime().date;
  const sales = await db.collection("appointments").find({
    $or: [{ barberId: targetId }, { barber: target.name }],
    requestedDate: businessDate,
    status: "completed",
    checkoutMethod: "cash",
    commissionAmountCents: { $type: "number" },
  }).project({ commissionAmountCents: 1 }).toArray();
  const earnedAmountCents = sales.reduce(
    (total, sale) => total + Number(sale.commissionAmountCents ?? 0),
    0,
  );
  if (earnedAmountCents <= 0) posError("There is no commission due to that barber today.");
  const roundedPayoutCents = roundCashPayoutCents(earnedAmountCents);

  const payouts = db.collection<CommissionPayoutRecord>("commissionPayouts");
  await payouts.createIndex({ businessDate: 1, barberId: 1 }, { unique: true });
  const existing = await payouts.findOne({ businessDate, barberId: targetId });
  const alreadyPaidCents = Number(existing?.paidAmountCents ?? 0);
  const dueAmountCents = Math.max(0, roundedPayoutCents - alreadyPaidCents);
  if (dueAmountCents <= 0) posError(`${target.name} has already been cashed out for today.`);

  const paidAt = new Date();
  const auditEntry = {
    amountCents: dueAmountCents,
    paidAt,
    paidByStaffId: payingBarber._id,
    paidByName: payingBarber.name,
  };

  try {
    if (existing) {
      const result = await payouts.updateOne(
        { _id: existing._id, paidAmountCents: alreadyPaidCents },
        {
          $inc: { paidAmountCents: dueAmountCents },
          $set: {
            barberName: target.name,
            calculatedCommissionCents: earnedAmountCents,
            roundedPayoutCents,
            updatedAt: paidAt,
          },
          $push: { history: auditEntry },
        },
      );
      if (!result.modifiedCount) posError("That payout changed on another register. Refresh and check again.");
    } else {
      await payouts.insertOne({
        businessDate,
        barberId: targetId,
        barberName: target.name,
        calculatedCommissionCents: earnedAmountCents,
        roundedPayoutCents,
        paidAmountCents: dueAmountCents,
        history: [auditEntry],
        createdAt: paidAt,
        updatedAt: paidAt,
      });
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      posError("That barber was just cashed out on another register. Refresh and check again.");
    }
    throw error;
  }

  revalidatePath("/pos");
  revalidatePath("/admin/dashboard");
  redirect(`/pos?notice=${encodeURIComponent(`${target.name} was cashed out ${formatWholeDollarMoney(dueAmountCents)}.`)}`);
}
