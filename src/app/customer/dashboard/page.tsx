import type { Metadata } from "next";
import Link from "next/link";
import { ObjectId } from "mongodb";
import {
  cancelCustomerAppointment,
  logoutCustomer,
  updateCustomerProfile,
} from "@/app/actions/customer";
import { currentShopDateTime, displayTime, formatDisplayDate } from "@/lib/booking";
import { requireCustomer } from "@/lib/customer-auth";
import { getMongoClient } from "@/lib/mongodb";

export const metadata: Metadata = {
  title: "Customer Center | HQ on Main",
  robots: { index: false, follow: false },
};

const tabs = [
  { id: "appointments", label: "Appointments", description: "Upcoming and past visits" },
  { id: "profile", label: "Profile", description: "Contact information" },
] as const;
type Tab = (typeof tabs)[number]["id"];

type Appointment = {
  _id: ObjectId;
  service?: string;
  price?: string;
  barber?: string;
  requestedDate?: string;
  requestedTime?: string;
  status?: string;
  createdAt?: Date;
};

function isTab(value?: string): value is Tab {
  return tabs.some((tab) => tab.id === value);
}

export default async function CustomerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; error?: string; success?: string }>;
}) {
  const customer = await requireCustomer();
  const { tab, error, success } = await searchParams;
  const activeTab: Tab = isTab(tab) ? tab : "appointments";
  const client = await getMongoClient();
  const appointments = await client
    .db("hqonmain")
    .collection<Appointment>("appointments")
    .find({ customerId: customer._id })
    .sort({ requestedDate: -1, requestedTime: -1 })
    .limit(100)
    .toArray();
  const today = currentShopDateTime().date;
  const upcoming = appointments.filter(
    (appointment) =>
      (appointment.requestedDate ?? "") >= today &&
      !["completed", "cancelled", "no-show"].includes(appointment.status ?? ""),
  );
  const history = appointments.filter((appointment) => !upcoming.includes(appointment));

  return (
    <main className="customer-center-page">
      <div className="container customer-center-content">
        <section className="customer-center-title">
          <div><p className="eyebrow">Your HQ</p><h1>Welcome back,<br />{customer.name.split(" ")[0]}.</h1></div>
          <div className="customer-center-actions">
            <Link className="button button-primary" href="/book">Book another visit →</Link>
            <form action={logoutCustomer}><button className="button button-secondary" type="submit">Sign out</button></form>
          </div>
        </section>

        <div className="customer-center-layout">
          <aside className="customer-center-nav">
            <p>Customer center</p>
            {tabs.map((item, index) => (
              <Link
                className={activeTab === item.id ? "active" : ""}
                href={`/customer/dashboard?tab=${item.id}`}
                aria-current={activeTab === item.id ? "page" : undefined}
                key={item.id}
              >
                <span>0{index + 1}</span>
                <div><strong>{item.label}</strong><small>{item.description}</small></div>
              </Link>
            ))}
          </aside>

          <section className="customer-center-panel">
            {error && <p className="portal-alert error" role="alert">{error}</p>}
            {success && <p className="customer-alert-success" role="status">{success}</p>}

            {activeTab === "appointments" && (
              <>
                <div className="customer-panel-heading">
                  <div><p className="eyebrow">Your schedule</p><h2>Upcoming visits</h2></div>
                  <strong>{upcoming.length}</strong>
                </div>
                <div className="customer-appointment-list">
                  {upcoming.length === 0 && (
                    <div className="customer-empty"><h3>No upcoming appointments.</h3><p>Ready for your next cut?</p><Link className="button button-primary" href="/book">Book now</Link></div>
                  )}
                  {upcoming.map((appointment) => (
                    <article className="customer-appointment-card" key={appointment._id.toString()}>
                      <div className="customer-date-block">
                        <strong>{formatDisplayDate(appointment.requestedDate)}</strong>
                      </div>
                      <div>
                        <span className={`appointment-status ${appointment.status ?? "pending"}`}>{appointment.status ?? "pending"}</span>
                        <h3>{appointment.service ?? "Appointment"}</h3>
                        <p>{appointment.barber ?? "HQ Barber"} · {displayTime(appointment.requestedTime ?? "")}</p>
                      </div>
                      <form action={cancelCustomerAppointment}>
                        <input type="hidden" name="appointmentId" value={appointment._id.toString()} />
                        <button type="submit">Cancel appointment</button>
                      </form>
                    </article>
                  ))}
                </div>

                {history.length > 0 && (
                  <div className="customer-history">
                    <h2>Past activity</h2>
                    {history.map((appointment) => (
                      <article key={appointment._id.toString()}>
                        <div><strong>{appointment.service ?? "Appointment"}</strong><span>{appointment.barber ?? "HQ Barber"}</span></div>
                        <p>{formatDisplayDate(appointment.requestedDate) || "Date pending"} · {displayTime(appointment.requestedTime ?? "")}</p>
                        <span className={`appointment-status ${appointment.status ?? "completed"}`}>{appointment.status ?? "completed"}</span>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === "profile" && (
              <>
                <div className="customer-panel-heading"><div><p className="eyebrow">Your details</p><h2>Profile</h2></div></div>
                <form className="portal-form customer-profile-form" action={updateCustomerProfile}>
                  <label>Full name<input name="name" defaultValue={customer.name} required minLength={2} /></label>
                  <label>Verified mobile<input value={customer.phone} readOnly disabled /></label>
                  <label className="wide">Email address <small>Optional</small><input name="email" type="email" defaultValue={customer.email ?? ""} /></label>
                  <button className="button button-primary wide" type="submit">Save profile</button>
                </form>
                <p className="customer-form-note">Changes also update your active appointments.</p>
              </>
            )}

          </section>
        </div>
      </div>
    </main>
  );
}
