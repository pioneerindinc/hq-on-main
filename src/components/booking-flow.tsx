"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { displayTime } from "@/lib/booking";
import { SERVICE_CATALOG, serviceById } from "@/lib/services";

type Barber = { id: string; name: string; specialty: string };
type Slot = { value: string; label: string };
type Customer = { name: string; email: string; phone: string };
type Confirmation = {
  confirmationId: string;
  appointment: { service: string; price: string; barber: string; date: string; time: string };
};

const steps = ["Service", "Barber", "Day & time", "Your info", "Confirmation"];

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function BookingFlow() {
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState("");
  const [barber, setBarber] = useState<Barber | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [infoMode, setInfoMode] = useState<"guest" | "login">("guest");
  const [createAccount, setCreateAccount] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const calendarLimits = useMemo(() => {
    const today = new Date();
    const maximum = new Date(today);
    maximum.setDate(today.getDate() + 60);
    return {
      today: localDateValue(today),
      maximum: localDateValue(maximum),
      firstMonth: today.getFullYear() * 12 + today.getMonth(),
      lastMonth: maximum.getFullYear() * 12 + maximum.getMonth(),
    };
  }, []);
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const leadingBlanks = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: leadingBlanks }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        return { day, value: localDateValue(new Date(year, month, day)) };
      }),
    ];
  }, [calendarMonth]);
  const service = serviceById(serviceId);

  useEffect(() => {
    fetch("/api/customer/me")
      .then((response) => response.json())
      .then((data: { customer: Customer | null }) => setCustomer(data.customer))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!serviceId) return;
    fetch(`/api/booking/barbers?serviceId=${encodeURIComponent(serviceId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        setBarbers(data.barbers);
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => {
    if (!barber || !date) return;
    fetch(`/api/booking/slots?barberId=${barber.id}&date=${date}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        setSlots(data.slots);
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, [barber, date]);

  function chooseService(id: string) {
    setServiceId(id);
    setBarber(null);
    setDate("");
    setTime("");
    setBarbers([]);
    setSlots([]);
    setMessage("");
    setLoading(true);
    setStep(1);
  }

  function chooseBarber(selected: Barber) {
    setBarber(selected);
    setDate("");
    setTime("");
    setSlots([]);
    setMessage("");
    setStep(2);
  }

  function goToStep(index: number) {
    if (index >= step || step === 4) return;
    setMessage("");
    setStep(index);
  }

  async function completeBooking(details?: Customer & { password?: string; createAccount?: boolean }) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/booking/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          barberId: barber?.id,
          date,
          time,
          smsConsent,
          ...details,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setConfirmation(data);
      setStep(4);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to complete your booking.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await completeBooking({
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      password: String(data.get("password") ?? ""),
      createAccount,
    });
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/customer/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setCustomer(result.customer);
      await completeBooking();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to log in.");
      setLoading(false);
    }
  }

  return (
    <main className="booking-page">
      <div className="container booking-shell">
        <header className="booking-page-heading">
          <h1>{step === 4 ? "You’re all set." : "Let’s get you sharp."}</h1>
          <p>{step === 4 ? "Your appointment is confirmed." : "Choose what works. We’ll handle the rest."}</p>
        </header>

        <nav className="booking-progress" aria-label="Booking progress">
          {steps.map((label, index) => (
            <button
              className={`${index === step ? "active" : ""} ${index < step ? "complete" : ""}`}
              disabled={index >= step || step === 4}
              onClick={() => goToStep(index)}
              type="button"
              key={label}
              aria-current={index === step ? "step" : undefined}
            >
              <span>{index < step ? "✓" : index + 1}</span>
              <strong>{label}</strong>
            </button>
          ))}
        </nav>

        <div className="booking-workspace">
          <section className="booking-step">
            {message && <p className="portal-alert error" role="alert">{message}</p>}

            {step === 0 && (
              <>
                <div className="booking-step-title"><div><h2>Select a service</h2><p>What can we do for you?</p></div></div>
                <div className="booking-service-grid">
                  {SERVICE_CATALOG.map((item) => (
                    <button type="button" onClick={() => chooseService(item.id)} key={item.id}>
                      <div><h3>{item.name}</h3><p>{item.description}</p></div>
                      <strong>{item.price}</strong>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="booking-step-title"><div><h2>Select a barber</h2><p>Only barbers offering {service?.name} are shown.</p></div></div>
                {loading && <p className="booking-loading">Finding available barbers…</p>}
                {!loading && barbers.length === 0 && (
                  <div className="booking-empty"><h3>No barbers available</h3><p>No active barber currently offers this service. Try another service or call the shop.</p></div>
                )}
                <div className="booking-barber-grid">
                  {barbers.map((item) => (
                    <button type="button" onClick={() => chooseBarber(item)} key={item.id}>
                      <span>{item.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                      <div><h3>{item.name}</h3><p>{item.specialty}</p></div>
                      <b>Choose →</b>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="booking-step-title"><div><h2>Select day & time</h2><p>Times shown are available with {barber?.name}.</p></div></div>
                <div className="booking-calendar-layout">
                  <div className="booking-calendar">
                    <div className="calendar-heading">
                      <button
                        type="button"
                        aria-label="Previous month"
                        disabled={calendarMonth.getFullYear() * 12 + calendarMonth.getMonth() <= calendarLimits.firstMonth}
                        onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                      >
                        ←
                      </button>
                      <h3>{calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3>
                      <button
                        type="button"
                        aria-label="Next month"
                        disabled={calendarMonth.getFullYear() * 12 + calendarMonth.getMonth() >= calendarLimits.lastMonth}
                        onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                      >
                        →
                      </button>
                    </div>
                    <div className="calendar-weekdays" aria-hidden="true">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
                    </div>
                    <div className="calendar-grid">
                      {calendarDays.map((item, index) =>
                        item ? (
                          <button
                            className={`${date === item.value ? "active" : ""} ${item.value === calendarLimits.today ? "today" : ""}`}
                            type="button"
                            disabled={item.value < calendarLimits.today || item.value > calendarLimits.maximum}
                            onClick={() => {
                              setDate(item.value);
                              setTime("");
                              setSlots([]);
                              setMessage("");
                              setLoading(true);
                            }}
                            key={item.value}
                            aria-label={new Date(`${item.value}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                          >
                            {item.day}
                          </button>
                        ) : <span key={`blank-${index}`} />
                      )}
                    </div>
                  </div>
                  <div className="booking-times">
                    <h3>{date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "Select a date"}</h3>
                    {!date && <p className="booking-empty-inline">Choose a day on the calendar to see open times.</p>}
                    {date && loading && <p className="booking-loading">Checking the chair…</p>}
                    {date && !loading && slots.length === 0 && <p className="booking-empty-inline">No openings on this day. Choose another date.</p>}
                    <div>
                      {slots.map((slot) => (
                        <button
                          className={time === slot.value ? "active" : ""}
                          type="button"
                          onClick={() => { setTime(slot.value); setStep(3); }}
                          key={slot.value}
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div className="booking-step-title"><div><h2>Your information</h2><p>Continue as a guest or use your saved details.</p></div></div>
                {customer ? (
                  <div className="customer-signed-in">
                    <span>{customer.name.slice(0, 1)}</span>
                    <div><small>Booking as</small><h3>{customer.name}</h3><p>{customer.email} · {customer.phone}</p></div>
                    <label className="account-check">
                      <input type="checkbox" checked={smsConsent} onChange={(event) => setSmsConsent(event.target.checked)} />
                      <span>Text me a confirmation and appointment reminder. Message and data rates may apply. Reply STOP to opt out.</span>
                    </label>
                    <button className="button button-primary" disabled={loading} onClick={() => completeBooking()} type="button">
                      {loading ? "Confirming…" : "Confirm appointment"}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="info-mode-tabs">
                      <button className={infoMode === "guest" ? "active" : ""} onClick={() => setInfoMode("guest")} type="button">Continue as guest</button>
                      <button className={infoMode === "login" ? "active" : ""} onClick={() => setInfoMode("login")} type="button">Customer login</button>
                    </div>
                    {infoMode === "guest" ? (
                      <form className="booking-info-form" onSubmit={handleGuest}>
                        <label>Full name<input name="name" required autoComplete="name" /></label>
                        <label>Phone number<input name="phone" type="tel" required autoComplete="tel" /></label>
                        <label className="wide">Email address<input name="email" type="email" required autoComplete="email" /></label>
                        <label className="account-check wide">
                          <input type="checkbox" checked={createAccount} onChange={(event) => setCreateAccount(event.target.checked)} />
                          <span>Save my information for faster booking next time</span>
                        </label>
                        <label className="account-check wide">
                          <input type="checkbox" checked={smsConsent} onChange={(event) => setSmsConsent(event.target.checked)} />
                          <span>Text me a confirmation and appointment reminder. Message and data rates may apply. Reply STOP to opt out.</span>
                        </label>
                        {createAccount && <label className="wide">Create a password<input name="password" type="password" minLength={10} required autoComplete="new-password" /><small>At least 10 characters</small></label>}
                        <button className="button button-primary wide" disabled={loading} type="submit">{loading ? "Confirming…" : "Confirm appointment"}</button>
                      </form>
                    ) : (
                      <form className="booking-info-form" onSubmit={handleLogin}>
                        <label className="wide">Email address<input name="email" type="email" required autoComplete="email" /></label>
                        <label className="wide">Password<input name="password" type="password" required autoComplete="current-password" /></label>
                        <label className="account-check wide">
                          <input type="checkbox" checked={smsConsent} onChange={(event) => setSmsConsent(event.target.checked)} />
                          <span>Text me a confirmation and appointment reminder. Message and data rates may apply. Reply STOP to opt out.</span>
                        </label>
                        <button className="button button-primary wide" disabled={loading} type="submit">{loading ? "Logging in…" : "Log in & confirm"}</button>
                      </form>
                    )}
                  </>
                )}
              </>
            )}

            {step === 4 && confirmation && (
              <div className="booking-confirmation">
                <div className="confirmation-check">✓</div>
                <p className="eyebrow">Appointment confirmed</p>
                <h2>See you then.</h2>
                <div>
                  <span><small>Service</small><strong>{confirmation.appointment.service}</strong></span>
                  <span><small>Barber</small><strong>{confirmation.appointment.barber}</strong></span>
                  <span><small>Date</small><strong>{new Date(`${confirmation.appointment.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</strong></span>
                  <span><small>Time</small><strong>{displayTime(confirmation.appointment.time)}</strong></span>
                </div>
                <Link className="button button-outline" href="/">Back to homepage</Link>
              </div>
            )}
          </section>

          {step < 4 && (
            <aside className="booking-summary">
              <p>Appointment summary</p>
              <dl>
                <div><dt>Service</dt><dd>{service?.name ?? "Not selected"} {service && <b>{service.price}</b>}</dd></div>
                <div><dt>Barber</dt><dd>{barber?.name ?? "Not selected"}</dd></div>
                <div><dt>Date</dt><dd>{date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "Not selected"}</dd></div>
                <div><dt>Time</dt><dd>{time ? displayTime(time) : "Not selected"}</dd></div>
              </dl>
              <p className="summary-note">HQ is cash only. An ATM is available in the shop.</p>
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
