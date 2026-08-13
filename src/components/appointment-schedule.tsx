import type { CSSProperties } from "react";
import Link from "next/link";
import { displayTime, generateHalfHourSlots, isSlotDuringBreak, normalizeTime, type DailyHours } from "@/lib/booking";

export type ScheduleBarber = {
  id: string;
  name: string;
};

export type ScheduleAppointment = {
  id: string;
  barberId?: string;
  barber?: string;
  name: string;
  service?: string;
  time: string;
  status?: string;
  visitType?: string;
  href?: string;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function headingDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function appointmentBelongsToBarber(appointment: ScheduleAppointment, barber: ScheduleBarber) {
  return appointment.barberId === barber.id || (!appointment.barberId && appointment.barber === barber.name);
}

function slotState(slot: string, hours: DailyHours) {
  if (hours.enabled !== true || slot < String(hours.start ?? "") || slot >= String(hours.end ?? "")) return "unavailable";
  if (isSlotDuringBreak(slot, hours)) return "break";
  return "available";
}

function scheduleHref(basePath: string, baseParams: Record<string, string>, date: string) {
  const params = new URLSearchParams({ ...baseParams, scheduleDate: date });
  return `${basePath}?${params.toString()}`;
}

export function normalizeScheduleDate(value: string | undefined, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || isoDate(parsed) !== value ? fallback : value;
}

export function AppointmentSchedule({
  date,
  today,
  barbers,
  appointments,
  hoursByBarber,
  basePath,
  baseParams,
  emptyMessage = "No appointments scheduled for this day.",
}: {
  date: string;
  today: string;
  barbers: ScheduleBarber[];
  appointments: ScheduleAppointment[];
  hoursByBarber: Record<string, DailyHours>;
  basePath: string;
  baseParams: Record<string, string>;
  emptyMessage?: string;
}) {
  const allHours = Object.values(hoursByBarber).filter((hours) => hours.enabled === true);
  const start = allHours.map((hours) => String(hours.start ?? "08:30")).sort()[0] ?? "08:30";
  const end = allHours.map((hours) => String(hours.end ?? "18:30")).sort().at(-1) ?? "18:30";
  const activeAppointments = appointments.filter((appointment) => !["cancelled", "no-show"].includes(appointment.status ?? ""));
  const slots = [...new Set([
    ...generateHalfHourSlots(start, end),
    ...activeAppointments.map((appointment) => normalizeTime(appointment.time)).filter(Boolean),
  ])].sort();
  const columns = { gridTemplateColumns: `70px repeat(${Math.max(1, barbers.length)}, minmax(190px, 1fr))` } as CSSProperties;

  return (
    <section className="appointment-schedule" aria-labelledby="appointment-schedule-heading">
      <div className="appointment-schedule-toolbar">
        <div className="appointment-schedule-navigation">
          <Link href={scheduleHref(basePath, baseParams, today)}>Today</Link>
          <Link href={scheduleHref(basePath, baseParams, shiftDate(date, -1))} aria-label="Previous day">←</Link>
          <Link href={scheduleHref(basePath, baseParams, shiftDate(date, 1))} aria-label="Next day">→</Link>
        </div>
        <h3 id="appointment-schedule-heading">{headingDate(date)}</h3>
        <form method="get" action={basePath}>
          {Object.entries(baseParams).map(([name, value]) => <input type="hidden" name={name} value={value} key={name} />)}
          <label>Choose date<input type="date" name="scheduleDate" defaultValue={date} /></label>
          <button type="submit">View</button>
        </form>
      </div>

      {barbers.length ? (
        <div className="appointment-schedule-scroll">
          <div className="appointment-schedule-grid appointment-schedule-head" style={columns}>
            <span aria-hidden="true" />
            {barbers.map((barber, index) => (
              <div key={barber.id}><span style={{ "--barber-index": index } as CSSProperties}>{barber.name.slice(0, 1)}</span><strong>{barber.name}</strong></div>
            ))}
          </div>
          <div className="appointment-schedule-body">
            {slots.map((slot) => (
              <div className="appointment-schedule-grid appointment-schedule-row" style={columns} key={slot}>
                <time dateTime={`${date}T${slot}`}>{displayTime(slot)}</time>
                {barbers.map((barber) => {
                  const hours = hoursByBarber[barber.id] ?? { enabled: false };
                  const state = slotState(slot, hours);
                  const slotAppointments = activeAppointments.filter((appointment) =>
                    appointmentBelongsToBarber(appointment, barber) && normalizeTime(appointment.time) === slot,
                  );
                  return (
                    <div className={`appointment-schedule-cell ${state}`} key={barber.id}>
                      {state === "break" && slotAppointments.length === 0 && <small>Break</small>}
                      {slotAppointments.map((appointment) => {
                        const content = (
                          <>
                            <span>{displayTime(slot)}{appointment.visitType === "walk-in" ? " · Walk-in" : ""}</span>
                            <strong>{appointment.name}</strong>
                            {appointment.service && <small>{appointment.service}</small>}
                          </>
                        );
                        return appointment.href ? (
                          <Link className={`schedule-event status-${appointment.status ?? "pending"}`} href={appointment.href} key={appointment.id}>{content}</Link>
                        ) : (
                          <article className={`schedule-event status-${appointment.status ?? "pending"}`} key={appointment.id}>{content}</article>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : <p className="portal-empty">No barbers are available to display.</p>}
      {activeAppointments.length === 0 && <p className="appointment-schedule-empty">{emptyMessage}</p>}
      <div className="appointment-schedule-legend"><span className="confirmed">Confirmed</span><span className="pending">Pending</span><span className="completed">Completed</span><span className="break">Break / unavailable</span></div>
    </section>
  );
}
