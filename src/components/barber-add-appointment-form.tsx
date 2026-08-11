"use client";

import { useMemo, useState } from "react";
import { addBarberAppointment } from "@/app/actions/staff";
import { StaffCustomerFields } from "@/components/staff-customer-fields";
import {
  dayNumber,
  displayTime,
  generateHalfHourSlots,
  isSlotDuringBreak,
  normalizeTime,
} from "@/lib/booking";

type ServiceOption = { id: string; name: string; price: string };
type ScheduleDay = {
  dayOfWeek: number;
  enabled: boolean;
  start: string;
  end: string;
  breakEnabled: boolean;
  breakStart: string;
  breakEnd: string;
};
type BookedSlot = { date: string; time: string };

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function BarberAddAppointmentForm({
  services,
  schedule,
  bookedSlots,
}: {
  services: ServiceOption[];
  schedule: ScheduleDay[];
  bookedSlots: BookedSlot[];
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const today = localDateValue(new Date());
  const selectedSchedule = date
    ? schedule.find((row) => row.dayOfWeek === dayNumber(date))
    : undefined;
  const openTimes = useMemo(() => {
    if (!date || !selectedSchedule?.enabled) return [];
    const occupied = new Set(
      bookedSlots
        .filter((slot) => slot.date === date)
        .map((slot) => normalizeTime(slot.time)),
    );
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    return generateHalfHourSlots(selectedSchedule.start, selectedSchedule.end).filter(
      (slot) =>
        !occupied.has(slot) &&
        !isSlotDuringBreak(slot, selectedSchedule) &&
        (date !== today || slot > currentTime),
    );
  }, [bookedSlots, date, selectedSchedule, today]);

  return (
    <form className="portal-form portal-form-grid" action={addBarberAppointment}>
      <StaffCustomerFields />
      <label>Booking source
        <select name="bookingSource" defaultValue="staff"><option value="staff">In shop / staff</option><option value="phone">Phone call</option></select>
      </label>
      <label>Visit type
        <select name="visitType" defaultValue="appointment" required>
          <option value="appointment">Appointment</option>
          <option value="walk-in">Walk-in</option>
        </select>
      </label>
      <label>Service
        <select name="service" required defaultValue="">
          <option value="" disabled>Select service</option>
          {services.map((service) => (
            <option key={service.id} value={service.name}>{service.name} · {service.price}</option>
          ))}
        </select>
      </label>
      <label>Date
        <input
          min={today}
          name="date"
          type="date"
          required
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setTime("");
          }}
        />
      </label>
      <div className="portal-slot-field portal-wide">
        <span>Available times</span>
        {!date && <p>Choose a date to see the barber&apos;s open times.</p>}
        {date && !selectedSchedule?.enabled && <p>This barber is not scheduled to work on the selected day.</p>}
        {date && selectedSchedule?.enabled && openTimes.length === 0 && <p>No appointment times are available on this date.</p>}
        {openTimes.length > 0 && (
          <div className="portal-slot-grid">
            {openTimes.map((slot) => (
              <label className={time === slot ? "selected" : ""} key={slot}>
                <input checked={time === slot} name="time" onChange={() => setTime(slot)} required type="radio" value={slot} />
                <span>{displayTime(slot)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <label className="portal-wide">Notes<input name="notes" placeholder="Optional notes" /></label>
      <label className="account-check portal-wide">
        <input name="smsConsent" type="checkbox" />
        <span>After hearing the HQ on Main SMS disclosure, the customer explicitly agreed to receive up to 2 appointment texts.</span>
      </label>
      <button className="button button-primary portal-wide" disabled={!date || !time} type="submit">Add appointment</button>
    </form>
  );
}
