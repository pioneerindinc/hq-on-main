import type { Metadata } from "next";
import Image from "next/image";
import { ObjectId } from "mongodb";
import {
  completePosAppointment,
  logoutPos,
  updatePosAppointmentStatus,
} from "@/app/actions/pos";
import { PosBarberSelector } from "@/components/pos-barber-selector";
import { PosCashOutButton } from "@/components/pos-cash-out-button";
import { PosWalkInCheckout } from "@/components/pos-walk-in-checkout";
import { getStaffCollection } from "@/lib/auth";
import {
  type DailyHours,
  currentShopDateTime,
  dayNumber,
  defaultHours,
  displayTime,
  formatDisplayDate,
  isTimeDuringBreak,
} from "@/lib/booking";
import {
  formatMoney,
  formatWholeDollarMoney,
  priceLabelToCents,
  roundCashPayoutCents,
} from "@/lib/money";
import { getMongoClient } from "@/lib/mongodb";
import { getCurrentPosBarber } from "@/lib/pos-auth";
import { SERVICE_CATALOG } from "@/lib/services";

export const metadata: Metadata = {
  title: "Cash Register | HQ on Main",
  robots: { index: false, follow: false },
};

type AvailabilityRecord = DailyHours & {
  barberId: ObjectId;
  dayOfWeek: number;
};

type PosAppointment = {
  _id: ObjectId;
  barber?: unknown;
  barberId?: unknown;
  name?: unknown;
  phone?: unknown;
  service?: unknown;
  price?: unknown;
  requestedDate?: unknown;
  requestedTime?: unknown;
  status?: unknown;
  visitType?: unknown;
  checkoutMethod?: unknown;
  checkoutAmountCents?: unknown;
  commissionPercentageSnapshot?: unknown;
  commissionAmountCents?: unknown;
  shopAmountCents?: unknown;
};

type CommissionPayout = {
  businessDate?: unknown;
  barberId?: unknown;
  paidAmountCents?: unknown;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function cents(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function appointmentPriceCents(appointment: PosAppointment) {
  const savedPrice = priceLabelToCents(appointment.price);
  if (savedPrice !== null) return savedPrice;
  const service = SERVICE_CATALOG.find((item) => item.name === text(appointment.service));
  return priceLabelToCents(service?.price);
}

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  const currentBarber = await getCurrentPosBarber();
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const shopNow = currentShopDateTime();

  if (!currentBarber) {
    const staff = await getStaffCollection();
    const activeBarbers = await staff.find({ role: "barber", active: true }).sort({ name: 1 }).toArray();
    const weekday = dayNumber(shopNow.date);
    const availability = await db.collection<AvailabilityRecord>("availability").find({
      barberId: { $in: activeBarbers.map((barber) => barber._id) },
      dayOfWeek: weekday,
    }).toArray();
    const hoursByBarber = new Map(availability.map((row) => [row.barberId.toString(), row]));
    const scheduledBarbers = activeBarbers.flatMap((barber) => {
      const hours = hoursByBarber.get(barber._id.toString()) ?? defaultHours(weekday);
      const onShift = hours.enabled === true && shopNow.time >= String(hours.start) && shopNow.time < String(hours.end);
      return onShift ? [{
        id: barber._id.toString(),
        name: barber.name,
        specialty: barber.specialty || "HQ Barber",
        hasPin: Boolean(barber.posPinHash),
        onBreak: isTimeDuringBreak(shopNow.time, hours),
      }] : [];
    });

    return (
      <main className="pos-page pos-login-page">
        <header className="pos-public-header">
          <Image src="/logo_hq_720_720.png" alt="HQ on Main" width={92} height={92} priority />
          <div><p>Cash register</p><strong>{formatDisplayDate(shopNow.date)}</strong></div>
        </header>
        <section className="pos-login-content">
          <p className="eyebrow">Who&apos;s at the shop?</p>
          <h1>Choose your chair.</h1>
          <p>Select your name and enter your personal register PIN.</p>
          {error && <p className="pos-alert error" role="alert">{error}</p>}
          {scheduledBarbers.length > 0 ? (
            <PosBarberSelector barbers={scheduledBarbers} />
          ) : (
            <p className="pos-empty">No barbers are currently within their scheduled working hours.</p>
          )}
        </section>
      </main>
    );
  }

  const [appointments, dailySales, payouts, barbers] = await Promise.all([
    db.collection<PosAppointment>("appointments").find({
      $or: [{ barberId: currentBarber._id }, { barber: currentBarber.name }],
      requestedDate: shopNow.date,
    }).sort({ requestedTime: 1 }).toArray(),
    db.collection<PosAppointment>("appointments").find({
      requestedDate: shopNow.date,
      status: "completed",
      checkoutMethod: "cash",
      commissionAmountCents: { $type: "number" },
    }).toArray(),
    db.collection<CommissionPayout>("commissionPayouts").find({ businessDate: shopNow.date }).toArray(),
    (await getStaffCollection()).find({ role: "barber" }).sort({ name: 1 }).toArray(),
  ]);
  const paidByBarber = new Map(
    payouts.map((payout) => [String(payout.barberId ?? ""), cents(payout.paidAmountCents)]),
  );
  const teamPayouts = barbers.map((barber) => {
    const barberSales = dailySales.filter((sale) =>
      sale.barberId?.toString() === barber._id.toString() || sale.barber === barber.name,
    );
    const earned = barberSales.reduce((total, sale) => total + cents(sale.commissionAmountCents), 0);
    const roundedPayout = roundCashPayoutCents(earned);
    const paid = paidByBarber.get(barber._id.toString()) ?? 0;
    return { barber, earned, paid, roundedPayout, due: Math.max(0, roundedPayout - paid) };
  }).filter((row) => row.earned > 0 || row.paid > 0);
  const grossCash = dailySales.reduce((total, sale) => total + cents(sale.checkoutAmountCents), 0);
  const roundedBarberPay = teamPayouts.reduce((total, row) => total + row.roundedPayout, 0);
  const shopPay = grossCash - roundedBarberPay;
  const offeredServiceIds = currentBarber.services ?? SERVICE_CATALOG.map((service) => service.id);
  const walkInServices = SERVICE_CATALOG.filter((service) => offeredServiceIds.includes(service.id));

  return (
    <main className="pos-page pos-register-page">
      <header className="pos-register-header">
        <div className="pos-register-brand">
          <Image src="/logo_hq_720_720.png" alt="HQ on Main" width={64} height={64} priority />
          <div><small>Cash register</small><strong>{currentBarber.name}</strong></div>
        </div>
        <div className="pos-register-date"><small>Business date</small><strong>{formatDisplayDate(shopNow.date)}</strong></div>
        <form action={logoutPos}><button className="pos-lock" type="submit">Lock register</button></form>
      </header>

      <div className="pos-register-shell">
        {error && <p className="pos-alert error" role="alert">{error}</p>}
        {notice && <p className="pos-alert success" role="status">{notice}</p>}

        <section className="pos-team-payouts" aria-labelledby="team-payout-heading">
          <div className="pos-payout-heading">
            <div><p className="eyebrow">End-of-day cash out</p><h1 id="team-payout-heading">Barber payouts</h1></div>
            <p>{formatDisplayDate(shopNow.date)} · Rounded to whole dollars</p>
          </div>
          <article className="pos-shop-pay-card">
            <div><small>Shop pay for today</small><strong>{formatMoney(shopPay)}</strong></div>
            <p>Cash sales after all rounded barber payouts.</p>
          </article>
          {teamPayouts.length > 0 ? (
            <div className="pos-payout-grid">
              {teamPayouts.map(({ barber, due }) => (
                <article className="pos-payout-card" key={barber._id.toString()}>
                  <div>
                    <small>Barber</small>
                    <h2>{barber.name}</h2>
                  </div>
                  <div className="pos-payout-amount">
                    <small>Due today</small>
                    <strong>{formatWholeDollarMoney(due)}</strong>
                  </div>
                  {due > 0 ? (
                    <PosCashOutButton
                      barberId={barber._id.toString()}
                      barberName={barber.name}
                      amount={formatWholeDollarMoney(due)}
                    />
                  ) : (
                    <span className="pos-paid-label">Paid out</span>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="pos-empty">No barber payouts have been earned today.</p>
          )}
        </section>

        <PosWalkInCheckout services={walkInServices} />

        <section className="pos-appointments-section">
          <div className="pos-section-heading">
            <div><p className="eyebrow">Today&apos;s book</p><h1>Appointments</h1></div>
            <strong>{appointments.length}</strong>
          </div>

          <div className="pos-appointment-list">
            {appointments.length === 0 && <p className="pos-empty">No appointments are assigned to you today.</p>}
            {appointments.map((appointment) => {
              const status = text(appointment.status, "pending");
              const knownPrice = appointmentPriceCents(appointment);
              const isCompleted = status === "completed" && typeof appointment.checkoutAmountCents === "number";
              const canCheckout = ["pending", "confirmed", "completed"].includes(status) && !isCompleted;
              return (
                <article className={`pos-appointment-card status-${status}`} key={appointment._id.toString()}>
                  <div className="pos-appointment-time">
                    <strong>{displayTime(text(appointment.requestedTime, "--:--"))}</strong>
                    <span className="pos-status">{status}</span>
                  </div>
                  <div className="pos-appointment-guest">
                    <h2>{text(appointment.name, "Guest")}</h2>
                    <p>{text(appointment.service, "Service not specified")}{appointment.visitType === "walk-in" && <b className="pos-walk-in-label">Walk-in</b>}</p>
                    <small>{text(appointment.phone)}</small>
                  </div>

                  {isCompleted ? (
                    <div className="pos-completed-sale">
                      <small>Cash received</small>
                      <strong>{formatMoney(cents(appointment.checkoutAmountCents))}</strong>
                      <span>Checkout complete</span>
                    </div>
                  ) : canCheckout ? (
                    <div className="pos-appointment-actions">
                      <form className="pos-checkout-form" action={completePosAppointment}>
                        <input name="appointmentId" type="hidden" value={appointment._id.toString()} />
                        <label>Total due
                          <span><b>$</b><input name="amount" type="number" min="0.01" max="100000" step="0.01" defaultValue={knownPrice === null ? "" : (knownPrice / 100).toFixed(2)} placeholder="Enter total" required /></span>
                        </label>
                        <button type="submit">Complete · Cash paid</button>
                      </form>
                      <form className="pos-status-actions" action={updatePosAppointmentStatus}>
                        <input name="appointmentId" type="hidden" value={appointment._id.toString()} />
                        {status === "pending" && <button name="status" value="confirmed" type="submit">Confirm</button>}
                        <button name="status" value="no-show" type="submit">No-show</button>
                        <button name="status" value="cancelled" type="submit">Cancel</button>
                      </form>
                    </div>
                  ) : (
                    <form className="pos-restore-form" action={updatePosAppointmentStatus}>
                      <input name="appointmentId" type="hidden" value={appointment._id.toString()} />
                      <button name="status" value="confirmed" type="submit">Restore as confirmed</button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
