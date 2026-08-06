import type { Metadata } from "next";
import Link from "next/link";
import { ObjectId } from "mongodb";
import {
  saveAvailability,
  saveBarberServices,
  updateBarberAppointment,
} from "@/app/actions/staff";
import { BarberAddAppointmentForm } from "@/components/barber-add-appointment-form";
import { RegisterPerformance } from "@/components/register-performance";
import { StaffHeader } from "@/components/staff-header";
import { requireStaffRole } from "@/lib/auth";
import { currentShopDateTime, defaultHours } from "@/lib/booking";
import { getMongoClient } from "@/lib/mongodb";
import {
  type PerformancePayout,
  buildPerformancePeriods,
  performanceRangeStart,
} from "@/lib/register-performance";
import { SERVICE_CATALOG, SERVICE_IDS } from "@/lib/services";

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

type BarberPerformancePayout = PerformancePayout & {
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
  searchParams: Promise<{ error?: string; tab?: string }>;
}) {
  const barber = await requireStaffRole("barber");
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const barberAppointmentFilter = { $or: [{ barberId: barber._id }, { barber: barber.name }] };
  const today = currentShopDateTime().date;
  const rangeStart = performanceRangeStart(today);
  const [availabilityRows, appointments, activeAppointmentSlots, performanceSales, performancePayouts] = await Promise.all([
    db.collection<Availability>("availability").find({ barberId: barber._id }).toArray(),
    db.collection<Appointment>("appointments")
      .find(barberAppointmentFilter)
      .sort({ requestedDate: 1, requestedTime: 1 })
      .limit(100)
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
      requestedDate: { $gte: rangeStart, $lte: today },
      status: "completed",
      checkoutMethod: "cash",
      checkoutAmountCents: { $gte: 0 },
    }).toArray(),
    db.collection<BarberPerformancePayout>("commissionPayouts").find({
      barberId: barber._id,
      businessDate: { $gte: rangeStart, $lte: today },
    }).toArray(),
  ]);
  const availability = new Map(availabilityRows.map((row) => [row.day, row]));
  const { error, tab } = await searchParams;
  const activeTab: DashboardTab = isDashboardTab(tab) ? tab : "totals";
  const selectedServices = barber.services ?? [...SERVICE_IDS];
  const offeredServices = SERVICE_CATALOG.filter((service) =>
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
  const performancePeriods = buildPerformancePeriods(performanceSales, performancePayouts, today);
  const upcoming = appointments.filter(
    (appointment) =>
      (appointment.requestedDate ?? "") >= today &&
      !["cancelled", "completed"].includes(appointment.status ?? ""),
  );

  return (
    <main className="portal-page">
      <StaffHeader name={barber.name} area="Barber" />
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
            {activeTab === "totals" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Your totals</h2></div>
                  <p>Completed cash sales and recorded commission payouts.</p>
                </div>
                <RegisterPerformance periods={performancePeriods} />
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
                  <p>Select every service guests can book with you.</p>
                </div>
                <form className="service-selector" action={saveBarberServices}>
                  {SERVICE_CATALOG.map((service) => (
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
                  <p>Add a phone, walk-in, or in-shop booking.</p>
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
                  <p>Update timing, status, and notes.</p>
                </div>
                <div className="appointment-list">
                  {appointments.length === 0 && <p className="portal-empty">No appointments assigned yet.</p>}
                  {appointments.map((appointment) => (
                    <form className="appointment-card" action={updateBarberAppointment} key={appointment._id.toString()}>
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
