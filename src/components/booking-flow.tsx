"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { displayTime, formatDisplayDate } from "@/lib/booking";
import type { ServiceCatalogItem } from "@/lib/services";
import { PhoneAuthFlow, type PhoneCustomer } from "@/components/phone-auth-flow";

type Barber = { id: string; name: string; specialty: string; photoUrl?: string | null };
type Slot = { value: string; label: string };
type Customer = PhoneCustomer;
type Confirmation = {
  confirmationId: string;
  appointment: { service: string; price: string; barber: string; date: string; time: string; recipientName: string };
};

const steps = ["Service", "Barber", "Day & time", "Your info", "Confirmation"];

function SmsConsent({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <div className={`sms-consent ${className}`.trim()}>
      <label className="account-check">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span>Text me appointment confirmation and reminder messages from HQ on Main (up to 2 messages per appointment). Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.</span>
      </label>
      <p>Consent is optional and is not required to book. See our <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
    </div>
  );
}

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function BookingFlow({ services, initialRecipientId }: { services: ServiceCatalogItem[]; initialRecipientId?: string }) {
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
  const [recipientProfileId, setRecipientProfileId] = useState("self");
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
  const service = services.find((item) => item.id === serviceId);
  const selectedDependent = customer?.dependents.find((dependent) => dependent.id === recipientProfileId);
  const recipientName = selectedDependent
    ? [selectedDependent.firstName, selectedDependent.lastName].filter(Boolean).join(" ")
    : customer?.name ?? "Not selected";

  useEffect(() => {
    fetch("/api/customer/me")
      .then((response) => response.json())
      .then((data: { customer: Customer | null }) => {
        setCustomer(data.customer);
        if (initialRecipientId && data.customer?.dependents.some((dependent) => dependent.id === initialRecipientId)) {
          setRecipientProfileId(initialRecipientId);
        }
      })
      .catch(() => undefined);
  }, [initialRecipientId]);

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

  async function completeBooking(selectedRecipientId = recipientProfileId) {
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
          recipientProfileId: selectedRecipientId === "self" ? null : selectedRecipientId,
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
                  {services.map((item) => (
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
                      <span className="booking-barber-photo">
                        {item.photoUrl ? (
                          <Image src={item.photoUrl} alt="" width={70} height={70} />
                        ) : item.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}
                      </span>
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
                            aria-label={formatDisplayDate(item.value)}
                          >
                            {item.day}
                          </button>
                        ) : <span key={`blank-${index}`} />
                      )}
                    </div>
                  </div>
                  <div className="booking-times">
                    <h3>{date ? formatDisplayDate(date) : "Select a date"}</h3>
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
                <div className="booking-step-title"><div><h2>Verify your number</h2><p>Your mobile number securely connects this visit to your history.</p></div></div>
                {customer ? (
                  <div className="customer-signed-in">
                    <span>{customer.name.slice(0, 1)}</span>
                    <div><small>Verified account</small><h3>{customer.name}</h3><p>{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</p></div>
                    <fieldset className="booking-recipient-picker">
                      <legend>Book for</legend>
                      <button className={recipientProfileId === "self" ? "active" : ""} type="button" onClick={() => setRecipientProfileId("self")}>
                        <strong>{customer.firstName || customer.name.split(" ")[0]}</strong><small>Myself</small>
                      </button>
                      {customer.dependents.map((dependent) => (
                        <button className={recipientProfileId === dependent.id ? "active" : ""} type="button" onClick={() => setRecipientProfileId(dependent.id)} key={dependent.id}>
                          <strong>{dependent.firstName}</strong><small>{dependent.relationship === "dependent" ? "Dependent" : "Child"}</small>
                        </button>
                      ))}
                      <Link href="/customer/dashboard?tab=family">Manage family profiles</Link>
                    </fieldset>
                    <SmsConsent checked={smsConsent} onChange={setSmsConsent} />
                    <button className="button button-primary" disabled={loading} onClick={() => completeBooking()} type="button">
                      {loading ? "Confirming…" : "Confirm appointment"}
                    </button>
                  </div>
                ) : (
                  <div className="booking-phone-auth">
                    <SmsConsent checked={smsConsent} onChange={setSmsConsent} />
                    <PhoneAuthFlow onAuthenticated={async (verifiedCustomer) => {
                      setCustomer(verifiedCustomer);
                      const requestedDependent = initialRecipientId && verifiedCustomer.dependents.some((dependent) => dependent.id === initialRecipientId)
                        ? initialRecipientId
                        : "self";
                      setRecipientProfileId(requestedDependent);
                      if (verifiedCustomer.dependents.length === 0) await completeBooking("self");
                    }} />
                  </div>
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
                  <span><small>Date</small><strong>{formatDisplayDate(confirmation.appointment.date)}</strong></span>
                  <span><small>Time</small><strong>{displayTime(confirmation.appointment.time)}</strong></span>
                  <span><small>Appointment for</small><strong>{confirmation.appointment.recipientName}</strong></span>
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
                <div><dt>Date</dt><dd>{date ? formatDisplayDate(date) : "Not selected"}</dd></div>
                <div><dt>Time</dt><dd>{time ? displayTime(time) : "Not selected"}</dd></div>
                {customer && <div><dt>Book for</dt><dd>{recipientName}</dd></div>}
              </dl>
              <p className="summary-note">HQ is cash only. An ATM is available in the shop.</p>
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
