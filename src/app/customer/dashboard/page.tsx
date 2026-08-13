import type { Metadata } from "next";
import Link from "next/link";
import { ObjectId } from "mongodb";
import {
  addCustomerDependent,
  cancelCustomerAppointment,
  logoutCustomer,
  updateCustomerDependent,
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
  { id: "family", label: "Family", description: "People you book for" },
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
  recipientName?: string;
  recipientType?: "self" | "dependent";
  recipientProfileId?: string;
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
                        <small className="customer-appointment-recipient">For {appointment.recipientName ?? customer.name}</small>
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
                        <div><strong>{appointment.service ?? "Appointment"}</strong><span>For {appointment.recipientName ?? customer.name} · {appointment.barber ?? "HQ Barber"}</span></div>
                        <p>{formatDisplayDate(appointment.requestedDate) || "Date pending"} · {displayTime(appointment.requestedTime ?? "")}</p>
                        <span className={`appointment-status ${appointment.status ?? "completed"}`}>{appointment.status ?? "completed"}</span>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}

            {activeTab === "family" && (
              <>
                <div className="customer-panel-heading">
                  <div><p className="eyebrow">People I book for</p><h2>Family profiles</h2></div>
                  <strong>{1 + (customer.dependents ?? []).filter((dependent) => dependent.active !== false).length}</strong>
                </div>
                <p className="customer-family-intro">Your verified phone controls the account. Each person keeps their own appointment history and does not need a separate login.</p>

                <div className="customer-family-list">
                  <article className="customer-family-card account-holder">
                    <div className="customer-family-avatar">{customer.name.slice(0, 1)}</div>
                    <div><small>Account holder</small><h3>{customer.name}</h3><p>Uses your verified mobile number</p></div>
                    <Link className="button button-secondary" href="/book">Book for {customer.firstName || customer.name.split(" ")[0]}</Link>
                  </article>

                  {(customer.dependents ?? []).map((dependent) => {
                    const dependentName = [dependent.firstName, dependent.lastName].filter(Boolean).join(" ");
                    const visits = appointments.filter((appointment) => appointment.recipientProfileId === dependent.id);
                    return (
                      <article className={`customer-family-card${dependent.active === false ? " inactive" : ""}`} key={dependent.id}>
                        <div className="customer-family-avatar">{dependent.firstName.slice(0, 1)}</div>
                        <div className="customer-family-details">
                          <small>{dependent.relationship === "dependent" ? "Dependent" : "Child"}{dependent.active === false ? " · Inactive" : ""}</small>
                          <h3>{dependentName}</h3>
                          <p>{visits.length} {visits.length === 1 ? "visit" : "visits"} in their history</p>
                        </div>
                        {dependent.active !== false && <Link className="button button-secondary" href={`/book?recipient=${encodeURIComponent(dependent.id)}`}>Book for {dependent.firstName}</Link>}
                        <details className="customer-family-edit">
                          <summary>Edit profile</summary>
                          <form className="portal-form" action={updateCustomerDependent}>
                            <input type="hidden" name="dependentId" value={dependent.id} />
                            <label>First name<input name="firstName" defaultValue={dependent.firstName} required maxLength={80} /></label>
                            <label>Last name <small>Optional</small><input name="lastName" defaultValue={dependent.lastName ?? ""} maxLength={100} /></label>
                            <label>Relationship<select name="relationship" defaultValue={dependent.relationship ?? "child"}><option value="child">Child</option><option value="dependent">Dependent</option></select></label>
                            <label>Status<select name="active" defaultValue={dependent.active === false ? "false" : "true"}><option value="true">Active</option><option value="false">Inactive</option></select></label>
                            <button className="button button-primary wide" type="submit">Save family profile</button>
                          </form>
                        </details>
                      </article>
                    );
                  })}
                </div>

                <section className="customer-family-add">
                  <div><p className="eyebrow">Add someone</p><h3>New family profile</h3><p>Children and dependents do not need their own phone number or email.</p></div>
                  <form className="portal-form" action={addCustomerDependent}>
                    <label>First name<input name="firstName" required maxLength={80} /></label>
                    <label>Last name (optional)<input name="lastName" maxLength={100} /></label>
                    <label className="wide">Relationship<select name="relationship" defaultValue="child"><option value="child">Child</option><option value="dependent">Dependent</option></select></label>
                    <button className="button button-primary wide" type="submit">Add family member</button>
                  </form>
                </section>
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

  );
}
