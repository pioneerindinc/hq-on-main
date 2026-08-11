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
  formatMoney,
  formatWholeDollarMoney,
  parseMoneyToCents,
  roundCashPayoutCents,
} from "@/lib/money";
import { getMongoClient } from "@/lib/mongodb";
import { createAppointment } from "@/lib/appointment-service";
import { resolveCustomer } from "@/lib/customer-identity";
import { normalizePhone } from "@/lib/phone";
import { hasDrawerCloseout, recordPostCloseoutChange } from "@/lib/financial-audit";
import {
  createPosSession,
  deletePosSession,
  getCurrentPosBarber,
} from "@/lib/pos-auth";
import { getServiceCatalog } from "@/lib/services";
import { sendAppointmentCancellationNotifications } from "@/lib/twilio-sms";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function posError(message: string, view?: "cashout"): never {
  const viewParam = view ? `view=${view}&` : "";
  redirect(`/pos?${viewParam}error=${encodeURIComponent(message)}`);
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

type DrawerCloseoutAudit = {
  countedDrawerCents: number;
  varianceCents: number;
  reconciledAt: Date;
  reconciledByStaffId: ObjectId;
  reconciledByName: string;
};

type DrawerCloseoutRecord = DrawerCloseoutAudit & {
  businessDate: string;
  openingDrawerCents: number;
  targetDrawerCents: number;
  cashSalesCents: number;
  barberPayoutsCents: number;
  expectedDrawerCents: number;
  actualDrawerCents: number;
  expectedPhysicalDrawerCents: number;
  hqRetainedCents: number;
  status: "closed";
  history: DrawerCloseoutAudit[];
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
  const auditReason = value(formData, "auditReason");
  const isAfterCloseout = await hasDrawerCloseout(db, today);
  if (isAfterCloseout && auditReason.length < 3) {
    posError("Enter a reason for adding a cash checkout after today’s drawer was closed.");
  }
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
  if (appointment.customerId instanceof ObjectId) {
    await db.collection("customers").updateOne({ _id: appointment.customerId }, { $set: { lastVisitAt: now, updatedAt: now } });
  }
  await recordPostCloseoutChange({
    db,
    businessDate: today,
    actor: barber,
    entityType: "appointment",
    entityId: appointmentObjectId,
    summary: `${barber.name} completed ${String(appointment.name ?? "Guest")}'s appointment after closeout.`,
    reason: auditReason,
    changes: [{ field: "Cash total", before: "Not checked out", after: formatMoney(amountCents) }],
  });

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
  const serviceCatalog = await getServiceCatalog();
  const service = serviceCatalog.find((item) => item.id === serviceId);
  const offeredServiceIds = barber.services ?? serviceCatalog.map((item) => item.id);
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
  const db = client.db("hqonmain");
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  if (phone && !normalizedPhone) posError("Enter a valid mobile number or leave it blank.");
  const customer = normalizedPhone
    ? await resolveCustomer({ phone: normalizedPhone, name, source: "walk_in", createdByUserId: barber._id })
    : null;
  const auditReason = value(formData, "auditReason");
  if (await hasDrawerCloseout(db, shopNow.date) && auditReason.length < 3) {
    posError("Enter a reason for adding a walk-in after today’s drawer was closed.");
  }
  const savedAppointment = await createAppointment({ db, bookingSource: "walk_in", customerId: customer?._id, recipientName: name, createdByUserId: barber._id, appointment: {
    name,
    phone: customer?.phone ?? "",
    email: "",
    customerId: customer?._id,
    recipientName: name,
    recipientType: "self",
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
    bookingSource: "walk_in",
    createdByUserId: barber._id,
    checkoutMethod: "cash",
    checkoutAmountCents: amountCents,
    commissionPercentageSnapshot: commissionPercentage,
    commissionAmountCents,
    shopAmountCents: amountCents - commissionAmountCents,
    completedAt: now,
    completedByStaffId: barber._id,
    createdAt: now,
    updatedAt: now,
  } });
  if (customer) await db.collection("customers").updateOne({ _id: customer._id }, { $set: { lastVisitAt: now, updatedAt: now } });
  await recordPostCloseoutChange({
    db,
    businessDate: shopNow.date,
    actor: barber,
    entityType: "appointment",
    entityId: savedAppointment._id,
    summary: `${barber.name} added a walk-in checkout after closeout.`,
    reason: auditReason,
    changes: [{ field: "Cash total", before: "No sale", after: formatMoney(amountCents) }],
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
  if (!payingBarber) posError("Your register session expired. Enter your PIN again.", "cashout");

  const barberId = value(formData, "barberId");
  if (!ObjectId.isValid(barberId)) posError("Choose a valid barber payout.", "cashout");

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const targetId = new ObjectId(barberId);
  const target = await db.collection("staff").findOne({ _id: targetId, role: "barber" });
  if (!target) posError("That barber could not be found.", "cashout");

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
  if (earnedAmountCents <= 0) posError("There is no commission due to that barber today.", "cashout");
  const roundedPayoutCents = roundCashPayoutCents(earnedAmountCents);

  const payouts = db.collection<CommissionPayoutRecord>("commissionPayouts");
  await payouts.createIndex({ businessDate: 1, barberId: 1 }, { unique: true });
  const existing = await payouts.findOne({ businessDate, barberId: targetId });
  const alreadyPaidCents = Number(existing?.paidAmountCents ?? 0);
  const dueAmountCents = Math.max(0, roundedPayoutCents - alreadyPaidCents);
  if (dueAmountCents <= 0) posError(`${target.name} has already been cashed out for today.`, "cashout");
  const auditReason = value(formData, "auditReason");
  if (await hasDrawerCloseout(db, businessDate) && auditReason.length < 3) {
    posError("Enter a reason for changing a barber payout after drawer closeout.", "cashout");
  }

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
      if (!result.modifiedCount) posError("That payout changed on another register. Refresh and check again.", "cashout");
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
      posError("That barber was just cashed out on another register. Refresh and check again.", "cashout");
    }
    throw error;
  }

  await recordPostCloseoutChange({
    db,
    businessDate,
    actor: payingBarber,
    entityType: "barber-payout",
    entityId: targetId,
    summary: `${target.name}'s payout changed after closeout.`,
    reason: auditReason,
    changes: [{
      field: "Barber payout",
      before: formatMoney(alreadyPaidCents),
      after: formatMoney(alreadyPaidCents + dueAmountCents),
    }],
  });

  revalidatePath("/pos");
  revalidatePath("/admin/dashboard");
  redirect(`/pos?view=cashout&notice=${encodeURIComponent(`${target.name} was cashed out ${formatWholeDollarMoney(dueAmountCents)}.`)}`);
}

export async function reconcileCashDrawer(formData: FormData) {
  const closingBarber = await getCurrentPosBarber();
  if (!closingBarber) posError("Your register session expired. Enter your PIN again.", "cashout");

  const countedDrawerCents = parseMoneyToCents(value(formData, "countedAmount"));
  if (countedDrawerCents === null) posError("Enter a valid cash total for the drawer.", "cashout");

  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const businessDate = currentShopDateTime().date;
  const [sales, payouts, barbers] = await Promise.all([
    db.collection("appointments").find({
      requestedDate: businessDate,
      status: "completed",
      checkoutMethod: "cash",
      checkoutAmountCents: { $type: "number" },
    }).project({ checkoutAmountCents: 1, commissionAmountCents: 1, barberId: 1, barber: 1 }).toArray(),
    db.collection<CommissionPayoutRecord>("commissionPayouts").find({ businessDate }).toArray(),
    db.collection("staff").find({ role: "barber" }).project({ name: 1 }).toArray(),
  ]);
  const cashSalesCents = sales.reduce((total, sale) => total + Number(sale.checkoutAmountCents ?? 0), 0);
  const barberPayoutsCents = payouts.reduce((total, payout) => total + Number(payout.paidAmountCents ?? 0), 0);
  const paidByBarber = new Map(payouts.map((payout) => [payout.barberId.toString(), Number(payout.paidAmountCents ?? 0)]));
  const unpaidPayout = barbers.some((barber) => {
    const earned = sales
      .filter((sale) => sale.barberId?.toString() === barber._id.toString() || sale.barber === barber.name)
      .reduce((total, sale) => total + Number(sale.commissionAmountCents ?? 0), 0);
    return roundCashPayoutCents(earned) > (paidByBarber.get(barber._id.toString()) ?? 0);
  });
  if (unpaidPayout) posError("Finish all barber payouts before saving the drawer closeout.", "cashout");

  const openingDrawerCents = 20_000;
  const hqRetainedCents = cashSalesCents - barberPayoutsCents;
  const expectedDrawerCents = cashSalesCents;
  const actualDrawerCents = countedDrawerCents + barberPayoutsCents - openingDrawerCents;
  const expectedPhysicalDrawerCents = openingDrawerCents + hqRetainedCents;
  const varianceCents = actualDrawerCents - expectedDrawerCents;
  const reconciledAt = new Date();
  const audit: DrawerCloseoutAudit = {
    countedDrawerCents,
    varianceCents,
    reconciledAt,
    reconciledByStaffId: closingBarber._id,
    reconciledByName: closingBarber.name,
  };
  const closeouts = db.collection<DrawerCloseoutRecord>("drawerCloseouts");
  await closeouts.createIndex({ businessDate: 1 }, { unique: true });
  try {
    await closeouts.insertOne({
      businessDate,
      openingDrawerCents,
      targetDrawerCents: expectedPhysicalDrawerCents,
      expectedDrawerCents,
      actualDrawerCents,
      expectedPhysicalDrawerCents,
      cashSalesCents,
      barberPayoutsCents,
      hqRetainedCents,
      countedDrawerCents,
      varianceCents,
      status: "closed",
      reconciledAt,
      reconciledByStaffId: closingBarber._id,
      reconciledByName: closingBarber.name,
      history: [audit],
      createdAt: reconciledAt,
      updatedAt: reconciledAt,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      posError("Today’s drawer closeout is already saved. Financial history cannot be overwritten.", "cashout");
    }
    throw error;
  }

  revalidatePath("/pos");
  revalidatePath("/admin/dashboard");
  const result = varianceCents === 0
    ? "Drawer closeout saved. The counted drawer matches the expected cash."
    : varianceCents > 0
      ? `Drawer closeout saved. The drawer is ${formatMoney(varianceCents)} over.`
      : `Drawer closeout saved. The drawer is ${formatMoney(Math.abs(varianceCents))} short.`;
  redirect(`/pos?view=cashout&notice=${encodeURIComponent(result)}`);
}
