import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ObjectId } from "mongodb";
import {
  createAdminAppointment,
  createBarber,
  updateAdminAppointment,
  updateBarber,
} from "@/app/actions/staff";
import { StaffHeader } from "@/components/staff-header";
import { RegisterPerformance } from "@/components/register-performance";
import { getStaffCollection, requireStaffRole } from "@/lib/auth";
import { currentShopDateTime, formatDisplayDate, normalizeTime } from "@/lib/booking";
import { barberPhotoUrl } from "@/lib/barber-profile";
import { getCustomerCollection } from "@/lib/customer-auth";
import { getMongoClient } from "@/lib/mongodb";
import { formatMoney, formatWholeDollarMoney, roundCashPayoutCents } from "@/lib/money";
import {
  type PerformancePayout,
  type PerformanceSale,
  buildPerformancePeriods,
  performanceRangeStart,
} from "@/lib/register-performance";
import { SERVICE_CATALOG } from "@/lib/services";

export const metadata: Metadata = {
  title: "Admin Dashboard | HQ on Main",
  robots: { index: false, follow: false },
};

const adminTabs = [
  { id: "add-barber", label: "Add barber", description: "Create team access" },
  { id: "barbers", label: "Manage barbers", description: "Profiles and access" },
  { id: "add-appointment", label: "Add appointment", description: "Create a booking" },
  { id: "appointments", label: "Appointments", description: "View and edit bookings" },
  { id: "customers", label: "Customers", description: "Registered accounts" },
  { id: "register", label: "Daily register", description: "Cash and commissions" },
  { id: "performance", label: "Performance", description: "Barber totals and visits" },  
] as const;
type AdminTab = (typeof adminTabs)[number]["id"];

type PerformanceSaleRecord = PerformanceSale & {
  barberId?: ObjectId;
  barber?: string;
  status?: string;
  checkoutMethod?: string;
};

type PerformancePayoutRecord = PerformancePayout & {
  barberId?: ObjectId;
  barberName?: string;
};

function isAdminTab(value?: string): value is AdminTab {
  return adminTabs.some((tab) => tab.id === value);
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tab?: string }>;
}) {
  const admin = await requireStaffRole("admin");
  const staff = await getStaffCollection();
  const customersCollection = await getCustomerCollection();
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const businessDate = currentShopDateTime().date;
  const performanceStart = performanceRangeStart(businessDate);
  const [barbers, customers, appointments, appointmentCount, registerSales, registerPayouts, performanceSales, performancePayouts] = await Promise.all([
    staff.find({ role: "barber" }).sort({ active: -1, name: 1 }).toArray(),
    customersCollection.find({}).sort({ createdAt: -1 }).limit(250).toArray(),
    db.collection("appointments")
      .find({})
      .sort({ requestedDate: -1, requestedTime: -1 })
      .limit(250)
      .toArray(),
    db.collection("appointments").countDocuments(),
    db.collection("appointments").find({
      requestedDate: businessDate,
      status: "completed",
      checkoutMethod: "cash",
      checkoutAmountCents: { $gte: 0 },
    }).toArray(),
    db.collection("commissionPayouts").find({ businessDate }).toArray(),
    db.collection<PerformanceSaleRecord>("appointments").find({
      requestedDate: { $gte: performanceStart, $lte: businessDate },
      status: "completed",
      checkoutMethod: "cash",
      checkoutAmountCents: { $gte: 0 },
    }).toArray(),
    db.collection<PerformancePayoutRecord>("commissionPayouts").find({
      businessDate: { $gte: performanceStart, $lte: businessDate },
    }).toArray(),
  ]);
  const appointmentCounts = await Promise.all(
    customers.map((customer) =>
      db.collection("appointments").countDocuments({
        $or: [{ customerId: customer._id }, { email: customer.email }],
      }),
    ),
  );
  const { error, tab } = await searchParams;
  const activeTab: AdminTab = isAdminTab(tab) ? tab : "barbers";
  const performanceByBarber = new Map(barbers.map((barber) => {
    const sales = performanceSales.filter((sale) =>
      sale.barberId?.toString() === barber._id.toString() || sale.barber === barber.name,
    );
    const payouts = performancePayouts.filter((payout) =>
      payout.barberId?.toString() === barber._id.toString() || payout.barberName === barber.name,
    );
    return [barber._id.toString(), buildPerformancePeriods(sales, payouts, businessDate)];
  }));
  const paidByBarber = new Map(
    registerPayouts.map((payout) => [String(payout.barberId ?? ""), Number(payout.paidAmountCents ?? 0)]),
  );
  const registerRows = barbers.map((barber) => {
    const sales = registerSales.filter((sale) =>
      sale.barberId?.toString() === barber._id.toString() || sale.barber === barber.name,
    );
    const commission = sales.reduce((total, sale) => total + Number(sale.commissionAmountCents ?? 0), 0);
    const roundedPayout = roundCashPayoutCents(commission);
    const paid = paidByBarber.get(barber._id.toString()) ?? 0;
    return {
      barber,
      count: sales.length,
      gross: sales.reduce((total, sale) => total + Number(sale.checkoutAmountCents ?? 0), 0),
      commission,
      roundedPayout,
      paid,
      due: Math.max(0, roundedPayout - paid),
      shop: sales.reduce((total, sale) => total + Number(sale.checkoutAmountCents ?? 0), 0) - roundedPayout,
    };
  });
  const registerTotals = registerRows.reduce(
    (total, row) => ({
      count: total.count + row.count,
      gross: total.gross + row.gross,
      commission: total.commission + row.commission,
      paid: total.paid + row.paid,
      due: total.due + row.due,
      shop: total.shop + row.shop,
    }),
    { count: 0, gross: 0, commission: 0, paid: 0, due: 0, shop: 0 },
  );

  return (
    <main className="portal-page">
      <StaffHeader name={admin.name} area="Admin" />
      <div className="container portal-content">
        <section className="portal-title">
          <div><p className="eyebrow">Management workspace</p><h1>Run the shop.</h1></div>
          <div className="portal-stats">
            <div><strong>{barbers.filter((barber) => barber.active).length}</strong><span>Active barbers</span></div>
            <div><strong>{customers.length}</strong><span>Customers</span></div>
            <div><strong>{appointmentCount}</strong><span>Appointments</span></div>
          </div>
        </section>
        {error && <p className="portal-alert error" role="alert">{error}</p>}

        <div className="barber-workspace admin-workspace">
          <aside className="portal-sidebar" aria-label="Admin dashboard sections">
            <p>Management</p>
            <nav>
              {adminTabs.map((item) => (
                <Link
                  className={activeTab === item.id ? "active" : ""}
                  href={`/admin/dashboard?tab=${item.id}`}
                  aria-current={activeTab === item.id ? "page" : undefined}
                  key={item.id}
                >
                  <div><strong>{item.label}</strong><small>{item.description}</small></div>
                  {item.id === "customers" && customers.length > 0 && <b>{customers.length}</b>}
                  {item.id === "appointments" && appointments.length > 0 && <b>{appointments.length}</b>}
                  {item.id === "register" && registerTotals.count > 0 && <b>{registerTotals.count}</b>}
                </Link>
              ))}
            </nav>
          </aside>

          <div className="portal-tab-panel">
            {activeTab === "add-barber" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Add a barber</h2></div>
                  <p>Create login access and a staff profile.</p>
                </div>
                <form className="portal-form portal-form-grid" action={createBarber}>
                  <label>Full name<input name="name" required minLength={2} /></label>
                  <label>Email<input name="email" type="email" required /></label>
                  <label>Mobile phone<input name="phone" type="tel" placeholder="(317) 555-0123" /></label>
                  <label>Nickname<input name="nickname" maxLength={60} placeholder="Optional public nickname" /></label>
                  <label>Specialty<input name="specialty" maxLength={120} placeholder="Fades, beard work, classic cuts" /></label>
                  <label>Temporary password<input name="password" type="password" required minLength={10} autoComplete="new-password" /></label>
                  <label>Commission percentage<input name="commissionPercentage" type="number" min="0" max="100" step="0.1" required /></label>
                  <label>POS PIN<input name="posPin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} required autoComplete="new-password" /></label>
                  <label className="portal-wide">Bio<textarea name="bio" rows={5} maxLength={1200} placeholder="Tell customers about this barber, their approach, and specialties." /></label>
                  <label className="portal-wide">Profile photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /><small>Square JPEG, PNG, or WebP recommended. Maximum 3 MB.</small></label>
                  <label className="account-check portal-wide">
                    <input name="smsNotificationsEnabled" type="checkbox" />
                    <span>The barber agreed to receive automated HQ on Main texts for new and cancelled appointments. Frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.</span>
                  </label>
                  <button className="button button-primary portal-wide" type="submit">Add barber account</button>
                </form>
              </section>
            )}

            {activeTab === "barbers" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Manage barbers</h2></div>
                  <p>Edit profiles, reset passwords, or deactivate access.</p>
                </div>
                <div className="staff-list">
                  {barbers.length === 0 && <p className="portal-empty">No barber accounts yet.</p>}
                  {barbers.map((barber) => (
                    <form className={`staff-card ${barber.active ? "" : "inactive"}`} action={updateBarber} key={barber._id.toString()}>
                      <input type="hidden" name="barberId" value={barber._id.toString()} />
                      <div className="staff-card-title">
                        <span className="staff-avatar">
                          {barber.hasPhoto ? (
                            <Image src={barberPhotoUrl(barber._id.toString(), barber.photoUpdatedAt)} alt="" width={64} height={64} />
                          ) : barber.name.slice(0, 1)}
                        </span>
                        <div><h3>{barber.name}</h3><p>{barber.active ? "Active" : "Inactive"}</p></div>
                      </div>
                      <div className="staff-edit-grid">
                        <label>Name<input name="name" defaultValue={barber.name} required /></label>
                        <label>Email<input name="email" type="email" defaultValue={barber.email} required /></label>
                        <label>Mobile phone<input name="phone" type="tel" defaultValue={barber.phone ?? ""} placeholder="(317) 555-0123" /></label>
                        <label>Nickname<input name="nickname" maxLength={60} defaultValue={barber.nickname ?? ""} placeholder="Optional public nickname" /></label>
                        <label>Specialty<input name="specialty" maxLength={120} defaultValue={barber.specialty ?? ""} /></label>
                        <label>Access
                          <select name="active" defaultValue={String(barber.active)}>
                            <option value="true">Active</option>
                            <option value="false">Deactivated</option>
                          </select>
                        </label>
                        <label>Commission %
                          <input name="commissionPercentage" type="number" min="0" max="100" step="0.1" defaultValue={barber.commissionPercentage ?? 0} required />
                        </label>
                        <label>New POS PIN
                          <input name="posPin" type="password" inputMode="numeric" pattern="[0-9]{4,6}" minLength={4} maxLength={6} placeholder={barber.posPinHash ? "PIN is set — leave blank to keep" : "Set a 4–6 digit PIN"} autoComplete="new-password" />
                        </label>
                        <label className="portal-wide">New password
                          <input name="password" type="password" minLength={10} placeholder="Leave blank to keep current password" autoComplete="new-password" />
                        </label>
                        <label className="portal-wide">Bio
                          <textarea name="bio" rows={5} maxLength={1200} defaultValue={barber.bio ?? ""} placeholder="Tell customers about this barber." />
                        </label>
                        <label className="portal-wide">Replace profile photo
                          <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
                          <small>Square JPEG, PNG, or WebP recommended. Maximum 3 MB.</small>
                        </label>
                        {barber.hasPhoto && (
                          <label className="account-check portal-wide">
                            <input name="removePhoto" type="checkbox" />
                            <span>Remove the current profile photo</span>
                          </label>
                        )}
                        <label className="account-check portal-wide">
                          <input name="smsNotificationsEnabled" type="checkbox" defaultChecked={barber.smsNotificationsEnabled === true} />
                          <span>The barber agreed to receive automated HQ on Main texts for new and cancelled appointments. Frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.</span>
                        </label>
                      </div>
                      <button className="portal-save" type="submit">Save changes</button>
                    </form>
                  ))}
                </div>
              </section>
            )}

            {activeTab === "add-appointment" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Add appointment</h2></div>
                  <p>Create a phone, walk-in, or staff-assisted booking.</p>
                </div>
                <form className="portal-form portal-form-grid" action={createAdminAppointment}>
                  <label>Guest name<input name="name" required minLength={2} /></label>
                  <label>Phone<input name="phone" type="tel" required /></label>
                  <label>Email<input name="email" type="email" required /></label>
                  <label>Visit type
                    <select name="visitType" defaultValue="appointment" required>
                      <option value="appointment">Appointment</option>
                      <option value="walk-in">Walk-in</option>
                    </select>
                  </label>
                  <label>Barber
                    <select name="barberId" required defaultValue="">
                      <option value="" disabled>Select barber</option>
                      {barbers.filter((barber) => barber.active).map((barber) => (
                        <option value={barber._id.toString()} key={barber._id.toString()}>{barber.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>Service
                    <select name="service" required defaultValue="">
                      <option value="" disabled>Select service</option>
                      {SERVICE_CATALOG.map((service) => <option key={service.id}>{service.name}</option>)}
                    </select>
                  </label>
                  <label>Status
                    <select name="status" defaultValue="confirmed">
                      <option>pending</option><option>confirmed</option><option>completed</option>
                      <option>cancelled</option><option>no-show</option>
                    </select>
                  </label>
                  <label>Date<input name="date" type="date" required /></label>
                  <label>Time<input name="time" type="time" required /></label>
                  <label className="portal-wide">Notes<input name="notes" placeholder="Optional appointment notes" /></label>
                  <label className="account-check portal-wide">
                    <input name="smsConsent" type="checkbox" />
                    <span>After hearing the HQ on Main SMS disclosure, the customer explicitly agreed to receive up to 2 appointment texts.</span>
                  </label>
                  <button className="button button-primary portal-wide" type="submit">Create appointment</button>
                </form>
              </section>
            )}

            {activeTab === "appointments" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Appointments</h2></div>
                  <p>View and update every shop appointment.</p>
                </div>
                <div className="admin-appointment-list">
                  {appointments.length === 0 && <p className="portal-empty">No appointments yet.</p>}
                  {appointments.map((appointment) => {
                    const assignedBarberId = appointment.barberId?.toString() ?? "";
                    return (
                      <form className="admin-appointment-card" action={updateAdminAppointment} key={appointment._id.toString()}>
                        <input type="hidden" name="appointmentId" value={appointment._id.toString()} />
                        <div className="admin-appointment-title">
                          <span>{String(appointment.name ?? "?").slice(0, 1)}</span>
                          <div>
                            <h3>{String(appointment.name ?? "Guest")}</h3>
                            <p>{formatDisplayDate(String(appointment.requestedDate ?? "")) || "No date"} · {String(appointment.requestedTime ?? "No time")}</p>
                          </div>
                        </div>
                        <div className="admin-appointment-fields">
                          <label>Guest name<input name="name" defaultValue={String(appointment.name ?? "")} required /></label>
                          <label>Phone<input name="phone" type="tel" defaultValue={String(appointment.phone ?? "")} required /></label>
                          <label>Email<input name="email" type="email" defaultValue={String(appointment.email ?? "")} required /></label>
                          <label>Visit type
                            <select name="visitType" defaultValue={String(appointment.visitType ?? (appointment.source === "walk-in" ? "walk-in" : "appointment"))} required>
                              <option value="appointment">Appointment</option>
                              <option value="walk-in">Walk-in</option>
                            </select>
                          </label>
                          <label>Barber
                            <select name="barberId" defaultValue={assignedBarberId} required>
                              <option value="" disabled>Select barber</option>
                              {barbers.filter((barber) => barber.active || barber._id.toString() === assignedBarberId).map((barber) => (
                                <option value={barber._id.toString()} key={barber._id.toString()}>{barber.name}</option>
                              ))}
                            </select>
                          </label>
                          <label>Service
                            <select name="service" defaultValue={String(appointment.service ?? "")} required>
                              {SERVICE_CATALOG.map((service) => <option key={service.id}>{service.name}</option>)}
                            </select>
                          </label>
                          <label>Status
                            <select name="status" defaultValue={String(appointment.status ?? "pending")}>
                              <option>pending</option><option>confirmed</option><option>completed</option>
                              <option>cancelled</option><option>no-show</option>
                            </select>
                          </label>
                          <label>Date<input name="date" type="date" defaultValue={String(appointment.requestedDate ?? "")} required /></label>
                          <label>Time<input name="time" type="time" defaultValue={normalizeTime(String(appointment.requestedTime ?? ""))} required /></label>
                          <label className="portal-wide">Notes<input name="notes" defaultValue={String(appointment.notes ?? "")} /></label>
                        </div>
                        <button className="portal-save" type="submit">Save appointment</button>
                      </form>
                    );
                  })}
                </div>
              </section>
            )}

            {activeTab === "customers" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Customer accounts</h2></div>
                  <p>Registered customers and their contact information.</p>
                </div>
                <div className="admin-customer-list">
                  {customers.length === 0 && <p className="portal-empty">No registered customer accounts yet.</p>}
                  {customers.map((customer, index) => (
                    <article className="admin-customer-card" key={customer._id.toString()}>
                      <div className="admin-customer-person">
                        <span>{customer.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                        <div><h3>{customer.name}</h3><p>Joined {formatDisplayDate(customer.createdAt)}</p></div>
                      </div>
                      <dl>
                        <div><dt>Email</dt><dd><a href={`mailto:${customer.email}`}>{customer.email}</a></dd></div>
                        <div><dt>Phone</dt><dd><a href={`tel:${customer.phone}`}>{customer.phone}</a></dd></div>
                        <div><dt>Appointments</dt><dd>{appointmentCounts[index]}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeTab === "register" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Daily register</h2></div>
                  <p>{formatDisplayDate(businessDate)} · Rounded payouts and shop pay.</p>
                </div>
                <div className="admin-register-totals">
                  <div><small>Cash collected</small><strong>{formatMoney(registerTotals.gross)}</strong></div>
                  <div><small>Rounded payout due</small><strong>{formatWholeDollarMoney(registerTotals.due)}</strong></div>
                  <div><small>Shop pay</small><strong>{formatMoney(registerTotals.shop)}</strong></div>
                </div>
                <div className="admin-register-list">
                  {registerRows.map((row) => (
                    <article className="admin-register-card" key={row.barber._id.toString()}>
                      <div className="admin-register-barber">
                        <span>{row.barber.name.slice(0, 1)}</span>
                        <div><h3>{row.barber.name}</h3><p>{row.count} completed cash {row.count === 1 ? "sale" : "sales"}</p></div>
                      </div>
                      <dl>
                        <div><dt>Commission rate</dt><dd>{row.barber.commissionPercentage ?? 0}%</dd></div>
                        <div><dt>Cash sales</dt><dd>{formatMoney(row.gross)}</dd></div>
                        <div className="payout"><dt>Cash payout due</dt><dd>{formatWholeDollarMoney(row.due)}</dd><small>{formatWholeDollarMoney(row.paid)} paid today</small></div>
                        <div><dt>Shop pay</dt><dd>{formatMoney(row.shop)}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {activeTab === "performance" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Barber performance</h2></div>
                  <p>Completed cash sales, payouts, appointments, and walk-ins.</p>
                </div>
                <div className="admin-performance-list">
                  {barbers.map((barber) => (
                    <article className="admin-performance-barber" key={barber._id.toString()}>
                      <header>
                        <div><h3>{barber.name}</h3><p>{barber.active ? "Active barber" : "Inactive barber"}</p></div>
                      </header>
                      <RegisterPerformance periods={performanceByBarber.get(barber._id.toString()) ?? []} />
                    </article>
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
