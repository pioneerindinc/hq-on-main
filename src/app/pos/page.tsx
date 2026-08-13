import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ObjectId } from "mongodb";
import {
  completePosAppointment,
  logoutPos,
  updatePosAppointmentStatus,
} from "@/app/actions/pos";
import { PosBarberSelector } from "@/components/pos-barber-selector";
import { AppointmentSchedule, normalizeScheduleDate } from "@/components/appointment-schedule";
import { PosCashOutButton } from "@/components/pos-cash-out-button";
import { PosDrawerReconciliation } from "@/components/pos-drawer-reconciliation";
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
import { getServiceCatalog, type ServiceCatalogItem } from "@/lib/services";

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

type DrawerCloseout = {
  businessDate?: unknown;
  countedDrawerCents?: unknown;
  varianceCents?: unknown;
  expectedDrawerCents?: unknown;
  actualDrawerCents?: unknown;
  expectedPhysicalDrawerCents?: unknown;
  targetDrawerCents?: unknown;
  reconciledByName?: unknown;
  reconciledAt?: unknown;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function cents(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function closeoutTime(value: unknown) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) return "unknown time";
  return value.toLocaleTimeString("en-US", {
    timeZone: process.env.BARBERSHOP_TIME_ZONE || "America/Indiana/Indianapolis",
    hour: "numeric",
    minute: "2-digit",
  });
}

function appointmentPriceCents(appointment: PosAppointment, services: ServiceCatalogItem[]) {
  const savedPrice = priceLabelToCents(appointment.price);
  if (savedPrice !== null) return savedPrice;
  const service = services.find((item) => item.name === text(appointment.service));
  return priceLabelToCents(service?.price);
}

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; view?: string; scheduleDate?: string }>;
}) {
  const { error, notice, view, scheduleDate } = await searchParams;
  const activeView = view === "cashout" ? "cashout" : "checkout";
  const currentBarber = await getCurrentPosBarber();
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const shopNow = currentShopDateTime();
  const selectedScheduleDate = normalizeScheduleDate(scheduleDate, shopNow.date);

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

  const [appointments, dailySales, payouts, barbers, drawerCloseout, scheduleAppointments, scheduleAvailability] = await Promise.all([
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
    db.collection<DrawerCloseout>("drawerCloseouts").findOne({ businessDate: shopNow.date }),
    db.collection<PosAppointment>("appointments").find({ requestedDate: selectedScheduleDate }).sort({ requestedTime: 1 }).toArray(),
    db.collection<AvailabilityRecord>("availability").find({ dayOfWeek: dayNumber(selectedScheduleDate) }).toArray(),
  ]);
  const scheduleBarbers = barbers.filter((barber) => barber.active || scheduleAppointments.some((appointment) =>
    appointment.barberId?.toString() === barber._id.toString() || appointment.barber === barber.name,
  ));
  const scheduleHours = new Map(scheduleAvailability.map((hours) => [hours.barberId.toString(), hours]));
  const serviceCatalog = await getServiceCatalog();
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
  const payoutsDueCount = teamPayouts.filter((row) => row.due > 0).length;
  const cashSalesCents = dailySales.reduce((total, sale) => total + cents(sale.checkoutAmountCents), 0);
  const paidPayoutsCents = payouts.reduce((total, payout) => total + cents(payout.paidAmountCents), 0);
  const expectedDrawerCents = 20_000 + cashSalesCents - paidPayoutsCents;
  const offeredServiceIds = currentBarber.services ?? serviceCatalog.map((service) => service.id);
  const walkInServices = serviceCatalog.filter((service) => offeredServiceIds.includes(service.id));

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

        <nav className="pos-register-tabs" aria-label="Register sections">
          <Link className={activeView === "checkout" ? "active" : ""} href="/pos" aria-current={activeView === "checkout" ? "page" : undefined}>
            <span>Checkout</span><small>Appointments and walk-ins</small>
          </Link>
          <Link className={activeView === "cashout" ? "active" : ""} href="/pos?view=cashout" aria-current={activeView === "cashout" ? "page" : undefined}>
            <span>Cash Out</span><small>{payoutsDueCount ? `${payoutsDueCount} ${payoutsDueCount === 1 ? "barber" : "barbers"} due` : "End-of-day payouts"}</small>
          </Link>
        </nav>

        {activeView === "cashout" ? (

        <section className="pos-team-payouts" aria-labelledby="team-payout-heading">
          <div className="pos-payout-heading">
            <div><p className="eyebrow">End-of-day</p><h1 id="team-payout-heading">Cash out</h1></div>
            <p>{formatDisplayDate(shopNow.date)} · Rounded to whole dollars</p>
          </div>
          {teamPayouts.length > 0 ? (
            <div className="pos-payout-grid">
              {teamPayouts.map(({ barber, due }) => (
                <article className="pos-payout-card" key={barber._id.toString()}>
                  <div>
                    <small>Barber</small>
                    <h2>{barber.name}</h2>
                  </div>
                  <div className="pos-payout-amount">
                    <small>Pay today</small>
                    <strong>{formatWholeDollarMoney(due)}</strong>
                  </div>
                  {due > 0 ? (
                    <PosCashOutButton
                      barberId={barber._id.toString()}
                      barberName={barber.name}
                      amount={formatWholeDollarMoney(due)}
                      requiresAuditReason={Boolean(drawerCloseout)}
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
          <PosDrawerReconciliation
            targetCents={expectedDrawerCents}
            payoutsDueCount={payoutsDueCount}
            priorCloseout={drawerCloseout ? {
              expectedPhysicalDrawerCents: cents(drawerCloseout.expectedPhysicalDrawerCents ?? drawerCloseout.targetDrawerCents ?? 20_000),
              countedDrawerCents: cents(drawerCloseout.countedDrawerCents),
              varianceCents: cents(drawerCloseout.varianceCents),
              reconciledByName: text(drawerCloseout.reconciledByName, "Staff"),
              reconciledAt: closeoutTime(drawerCloseout.reconciledAt),
            } : undefined}
          />
        </section>

        ) : (
          <div className="pos-checkout-workspace">
            <div className="pos-checkout-heading">
              <div><p className="eyebrow">Today&apos;s register</p><h1>Checkout</h1></div>
            </div>

        <AppointmentSchedule
          date={selectedScheduleDate}
          today={shopNow.date}
          barbers={scheduleBarbers.map((barber) => ({ id: barber._id.toString(), name: barber.name }))}
          appointments={scheduleAppointments.map((appointment) => {
            const appointmentId = appointment._id.toString();
            const belongsToCurrentBarber = appointment.barberId?.toString() === currentBarber._id.toString() || appointment.barber === currentBarber.name;
            return {
              id: appointmentId,
              barberId: appointment.barberId?.toString(),
              barber: text(appointment.barber),
              name: text(appointment.name, "Guest"),
              service: text(appointment.service),
              time: text(appointment.requestedTime),
              status: text(appointment.status, "pending"),
              visitType: text(appointment.visitType, "appointment"),
              href: belongsToCurrentBarber && selectedScheduleDate === shopNow.date ? `#pos-appointment-${appointmentId}` : undefined,
            };
          })}
          hoursByBarber={Object.fromEntries(scheduleBarbers.map((barber) => [
            barber._id.toString(),
            scheduleHours.get(barber._id.toString()) ?? defaultHours(dayNumber(selectedScheduleDate)),
          ]))}
          basePath="/pos"
          baseParams={{ view: "checkout" }}
          emptyMessage="No appointments are scheduled at the shop for this day."
        />

        <PosWalkInCheckout services={walkInServices} requiresAuditReason={Boolean(drawerCloseout)} />

        <section className="pos-appointments-section">
          <div className="pos-section-heading">
            <div><p className="eyebrow">Today&apos;s book</p><h1>Appointments</h1></div>
            <strong>{appointments.length}</strong>
          </div>

          <div className="pos-appointment-list">
            {appointments.length === 0 && <p className="pos-empty">No appointments are assigned to you today.</p>}
            {appointments.map((appointment) => {
              const status = text(appointment.status, "pending");
              const knownPrice = appointmentPriceCents(appointment, serviceCatalog);
              const isCompleted = status === "completed" && typeof appointment.checkoutAmountCents === "number";
              const canCheckout = ["pending", "confirmed", "completed"].includes(status) && !isCompleted;
              return (
                <article className={`pos-appointment-card status-${status}`} id={`pos-appointment-${appointment._id.toString()}`} key={appointment._id.toString()}>
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
                        {drawerCloseout && (
                          <label className="pos-checkout-audit-reason">Post-closeout reason
                            <input name="auditReason" minLength={3} maxLength={300} placeholder="Why is this checkout being added after closeout?" required />
                          </label>
                        )}
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
        )}
      </div>
    </main>
  );
}
