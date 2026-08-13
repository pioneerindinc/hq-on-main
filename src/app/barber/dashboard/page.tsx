import type { Metadata } from "next";
import Link from "next/link";
import { ObjectId } from "mongodb";
import {
  saveAvailability,
  saveBarberServices,
  updateBarberAppointment,
} from "@/app/actions/staff";
import { updateBarberAccount } from "@/app/actions/barber-account";
import { BarberAddAppointmentForm } from "@/components/barber-add-appointment-form";
import { BarberTotalsReport } from "@/components/barber-totals-report";
import { AppointmentSchedule, normalizeScheduleDate } from "@/components/appointment-schedule";
import { StaffHeader } from "@/components/staff-header";
import { requireStaffRole } from "@/lib/auth";
import {
  type BarberTotalsPayout,
  buildBarberTotalsReport,
  normalizeTotalsDate,
  normalizeTotalsPeriod,
  totalsRange,
} from "@/lib/barber-totals";
import { currentShopDateTime, dayNumber, defaultHours } from "@/lib/booking";
import { getMongoClient } from "@/lib/mongodb";
import { getServiceCatalog } from "@/lib/services";

export const metadata: Metadata = {
  title: "Barber Dashboard | HQ on Main",
  robots: { index: false, follow: false },
};

const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const statuses = ["pending", "confirmed", "completed", "cancelled", "no-show"];
const dashboardTabs = [
  { id: "availability", label: "Availability", description: "Weekly working hours" },
  { id: "services", label: "Services", description: "What you offer" },
  { id: "add", label: "Add appointment", description: "Create a booking" },
  { id: "appointments", label: "Appointments", description: "Manage your guests" },
  { id: "totals", label: "Totals", description: "Register and completed cuts" },
  { id: "account", label: "Account", description: "Login, PIN, and notifications" },
] as const;

type DashboardTab = (typeof dashboardTabs)[number]["id"];

type Availability = {
  day: string;
  dayOfWeek: number;
  enabled: boolean;
  start: string;
  end: string;
  breakEnabled?: boolean;
  breakStart?: string;
  breakEnd?: string;
};

type BarberPerformancePayout = BarberTotalsPayout & {
  barberId?: ObjectId;
};

type Appointment = {
  _id: ObjectId;
  name?: string;
  phone?: string;
  email?: string;
  service?: string;
  requestedDate?: string;
  requestedTime?: string;
  status?: string;
  visitType?: string;
  source?: string;
  notes?: string;
  checkoutAmountCents?: number;
  commissionAmountCents?: number;
  checkoutMethod?: string;
};

function timeInputValue(time?: string) {
  if (!time) return "";
  if (/^\d{2}:\d{2}$/.test(time)) return time;
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const period = match[3].toUpperCase();
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function isDashboardTab(value?: string): value is DashboardTab {
  return dashboardTabs.some((tab) => tab.id === value);
}

export default async function BarberDashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; tab?: string; period?: string; date?: string; scheduleDate?: string }>;
}) {
  const barber = await requireStaffRole("barber");
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const serviceCatalog = await getServiceCatalog();
  const { error, success, tab, period, date, scheduleDate } = await searchParams;
  const activeTab: DashboardTab = isDashboardTab(tab) ? tab : "totals";
  const barberAppointmentFilter = { $or: [{ barberId: barber._id }, { barber: barber.name }] };
  const today = currentShopDateTime().date;
  const selectedScheduleDate = normalizeScheduleDate(scheduleDate, today);
  const selectedPeriod = normalizeTotalsPeriod(period);
  const selectedDate = normalizeTotalsDate(date, today);
  const selectedRange = totalsRange(selectedPeriod, selectedDate);
  const [availabilityRows, appointments, activeAppointmentSlots, performanceSales, performancePayouts, scheduleAppointments] = await Promise.all([
    db.collection<Availability>("availability").find({ barberId: barber._id }).toArray(),
    db.collection<Appointment>("appointments")
      .find(barberAppointmentFilter)
      .sort({ requestedDate: -1, requestedTime: -1 })
      .limit(250)
      .toArray(),
    db.collection<Appointment>("appointments")
      .find({
        ...barberAppointmentFilter,
        status: { $nin: ["cancelled", "completed", "no-show"] },
      })
      .project({ requestedDate: 1, requestedTime: 1 })
      .toArray(),
    db.collection<Appointment>("appointments").find({
      ...barberAppointmentFilter,
      requestedDate: { $gte: selectedRange.start, $lte: selectedRange.end },
      status: "completed",
      checkoutMethod: "cash",
      checkoutAmountCents: { $gte: 0 },
    }).toArray(),
    db.collection<BarberPerformancePayout>("commissionPayouts").find({
      barberId: barber._id,
      businessDate: { $gte: selectedRange.start, $lte: selectedRange.end },
    }).toArray(),
    db.collection<Appointment>("appointments").find({
      ...barberAppointmentFilter,
      requestedDate: selectedScheduleDate,
    }).sort({ requestedTime: 1 }).toArray(),
  ]);
  const availability = new Map(availabilityRows.map((row) => [row.day, row]));
  const selectedServices = barber.services ?? serviceCatalog.map((service) => service.id);
  const offeredServices = serviceCatalog.filter((service) =>
    selectedServices.includes(service.id),
  );
  const weeklySchedule = days.map((day, index) => {
    const row = availability.get(day);
    const fallback = defaultHours(index + 1);
    return {
      dayOfWeek: index + 1,
      enabled: row?.enabled ?? fallback.enabled,
      start: row?.start ?? fallback.start,
      end: row?.end ?? fallback.end,
      breakEnabled: row?.breakEnabled ?? false,
      breakStart: row?.breakStart ?? "12:00",
      breakEnd: row?.breakEnd ?? "13:00",
    };
  });
  const bookedSlots = activeAppointmentSlots.map((appointment) => ({
      date: appointment.requestedDate ?? "",
      time: appointment.requestedTime ?? "",
  }));
  const totalsReport = buildBarberTotalsReport(performanceSales, performancePayouts, selectedRange, today);
  const upcoming = appointments.filter(
    (appointment) =>
      (appointment.requestedDate ?? "") >= today &&
      !["cancelled", "completed"].includes(appointment.status ?? ""),
  );

  return (
    <main className="portal-page">
      <StaffHeader
        name={barber.name}
        area="Barber"
        alternatePortal={barber.adminAccess ? { href: "/admin/dashboard", label: "Admin portal" } : undefined}
      />
      <div className="container portal-content">
        <section className="portal-title">
          <div><p className="eyebrow">Barber workspace</p><h1>Your chair.</h1></div>
          <div className="portal-stats">
            <div><strong>{upcoming.length}</strong><span>Upcoming</span></div>
            <div><strong>{appointments.length}</strong><span>Total records</span></div>
            <div><strong>{barber.commissionPercentage ?? 0}%</strong><span>Your commission</span></div>
          </div>
        </section>
        {error && <p className="portal-alert error" role="alert">{error}</p>}
        {success && <p className="portal-alert success" role="status">{success}</p>}

        <div className="barber-workspace">
          <aside className="portal-sidebar" aria-label="Barber dashboard sections">
            <p>Workspace</p>
            <nav>
              {dashboardTabs.map((item) => (
                <Link
                  className={activeTab === item.id ? "active" : ""}
                  href={`/barber/dashboard?tab=${item.id}`}
                  key={item.id}
                  aria-current={activeTab === item.id ? "page" : undefined}
                >
                  <span></span>
                  <div><strong>{item.label}</strong> <small>{item.description}</small></div>
                  {item.id === "appointments" && upcoming.length > 0 && (
                    <b>{upcoming.length}</b>
                  )}
                </Link>
              ))}
            </nav>
          </aside>

          <div className="portal-tab-panel">
            {activeTab === "account" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Your account</h2></div>
                </div>
                <form className="portal-form portal-form-grid barber-account-form" action={updateBarberAccount}>
                  <label>Mobile phone <small>Optional</small><input name="phone" type="tel" autoComplete="tel" defaultValue={barber.phone ?? ""} placeholder="(317) 555-0123" /></label>
                  <label className="account-check portal-wide">
                    <input name="smsNotificationsEnabled" type="checkbox" defaultChecked={barber.smsNotificationsEnabled === true} />
                    <span>I agree to receive automated HQ on Main texts for new and cancelled appointments. Frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.</span>
                  </label>
                  <div className="portal-wide barber-account-divider"><strong>Change password or POS PIN</strong><p>Leave these fields blank to keep your current credentials. Your current password is required for either change.</p></div>
                  <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" /></label>
                  <span aria-hidden="true"></span>
                  <label>New password<input name="newPassword" type="password" minLength={10} autoComplete="new-password" /></label>
                  <label>Confirm new password<input name="newPasswordConfirm" type="password" minLength={10} autoComplete="new-password" /></label>
                  <label>New POS PIN<input name="newPosPin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} autoComplete="new-password" /></label>
                  <label>Confirm new POS PIN<input name="newPosPinConfirm" type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} autoComplete="new-password" /></label>
                  <button className="button button-primary portal-wide" type="submit">Save account settings</button>
                </form>
              </section>
            )}

            {activeTab === "totals" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Your totals</h2></div>
                </div>
                <BarberTotalsReport report={totalsReport} today={today} />
              </section>
            )}

            {activeTab === "availability" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Weekly availability</h2></div>
                </div>
                <form className="availability-form" action={saveAvailability}>
                  {days.map((day, index) => {
                    const row = availability.get(day);
                    const fallback = defaultHours(index + 1);
                    return (
                      <div className="availability-row" key={day}>
                        <label className="availability-toggle">
                          <input
                            name={`${day}_enabled`}
                            type="checkbox"
                            defaultChecked={row?.enabled ?? fallback.enabled}
                          />
                          <span>{day}</span>
                        </label>
                        <label>From<input name={`${day}_start`} type="time" defaultValue={row?.start ?? fallback.start} /></label>
                        <label>To<input name={`${day}_end`} type="time" defaultValue={row?.end ?? fallback.end} /></label>
                        <div className="availability-break">
                          <label className="availability-break-toggle">
                            <input
                              name={`${day}_break_enabled`}
                              type="checkbox"
                              defaultChecked={row?.breakEnabled ?? false}
                            />
                            <span>Block lunch / break</span>
                          </label>
                          <label>Break from<input name={`${day}_break_start`} type="time" defaultValue={row?.breakStart ?? "12:00"} /></label>
                          <label>Break to<input name={`${day}_break_end`} type="time" defaultValue={row?.breakEnd ?? "13:00"} /></label>
                        </div>
                      </div>
                    );
                  })}
                  <button className="button button-primary" type="submit">Save availability</button>
                </form>
              </section>
            )}

            {activeTab === "services" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Your services</h2></div>
                </div>
                <form className="service-selector" action={saveBarberServices}>
                  {serviceCatalog.map((service) => (
                    <label className="service-option" key={service.id}>
                      <input
                        name={`service_${service.id}`}
                        type="checkbox"
                        defaultChecked={selectedServices.includes(service.id)}
                      />
                      <span><strong>{service.name}</strong><small>{service.price}</small></span>
                    </label>
                  ))}
                  <button className="button button-primary" type="submit">Save services</button>
                </form>
              </section>
            )}

            {activeTab === "add" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Add appointment</h2></div>
                </div>
                <BarberAddAppointmentForm
                  bookedSlots={bookedSlots}
                  schedule={weeklySchedule}
                  services={offeredServices}
                />
              </section>
            )}

            {activeTab === "appointments" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Appointments</h2></div>
                </div>
                <AppointmentSchedule
                  date={selectedScheduleDate}
                  today={today}
                  barbers={[{ id: barber._id.toString(), name: barber.name }]}
                  appointments={scheduleAppointments.map((appointment) => ({
                    id: appointment._id.toString(),
                    barberId: barber._id.toString(),
                    barber: barber.name,
                    name: appointment.name ?? "Guest",
                    service: appointment.service,
                    time: appointment.requestedTime ?? "",
                    status: appointment.status,
                    visitType: appointment.visitType,
                    href: `#appointment-${appointment._id.toString()}`,
                  }))}
                  hoursByBarber={{
                    [barber._id.toString()]: availability.get(days[dayNumber(selectedScheduleDate) - 1]) ?? defaultHours(dayNumber(selectedScheduleDate)),
                  }}
                  basePath="/barber/dashboard"
                  baseParams={{ tab: "appointments" }}
                  emptyMessage="You have no appointments scheduled for this day."
                />
                <div className="appointment-list">
                  {appointments.length === 0 && <p className="portal-empty">No appointments assigned yet.</p>}
                  {appointments.map((appointment) => (
                    <form className="appointment-card" id={`appointment-${appointment._id.toString()}`} action={updateBarberAppointment} key={appointment._id.toString()}>
                      <input type="hidden" name="appointmentId" value={appointment._id.toString()} />
                      <div className="appointment-person">
                        <span>{(appointment.name ?? "?").slice(0, 1)}</span>
                        <div>
                          <h3>{appointment.name ?? "Guest"}</h3>
                          <p>{appointment.phone}</p>
                          <p className="appointment-service"><small>Service</small><strong>{appointment.service ?? "Not specified"}</strong></p>
                        </div>
                      </div>
                      <label>Date<input name="date" type="date" defaultValue={appointment.requestedDate} required /></label>
                      <label>Time<input name="time" type="time" defaultValue={timeInputValue(appointment.requestedTime)} required /></label>
                      <label>Status
                        <select name="status" defaultValue={appointment.status ?? "pending"}>
                          {statuses.map((status) => <option key={status}>{status}</option>)}
                        </select>
                      </label>
                      <label>Visit type
                        <select name="visitType" defaultValue={appointment.visitType ?? (appointment.source === "walk-in" ? "walk-in" : "appointment")}>
                          <option value="appointment">Appointment</option>
                          <option value="walk-in">Walk-in</option>
                        </select>
                      </label>
                      <label>Notes<input name="notes" defaultValue={appointment.notes ?? ""} /></label>
                      {typeof appointment.checkoutAmountCents === "number" && (
                        <label>Cash total<input name="checkoutAmount" type="number" min="0.01" max="100000" step="0.01" defaultValue={(appointment.checkoutAmountCents / 100).toFixed(2)} required /></label>
                      )}
                      {typeof appointment.checkoutAmountCents === "number" && (
                        <label className="appointment-audit-reason">Correction reason<input name="auditReason" maxLength={300} placeholder="Required for changes after drawer closeout" /></label>
                      )}
                      <button className="portal-save" type="submit">Save</button>
                    </form>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
