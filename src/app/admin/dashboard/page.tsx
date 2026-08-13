import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ObjectId } from "mongodb";
import {
  createAdminAppointment,
  createBarber,
  createBarberCredentialReset,
  createService,
  updateAdminAppointment,
  updateBarber,
  updateService,
} from "@/app/actions/staff";
import { AdminServiceDeleteButton } from "@/components/admin-service-delete-button";
import { AppointmentSchedule, normalizeScheduleDate } from "@/components/appointment-schedule";
import { BarberTotalsReport } from "@/components/barber-totals-report";
import { BarberSetupLink } from "@/components/barber-setup-link";
import { FinancialDashboardPanel, type FinancialView } from "@/components/financial-dashboard";
import { StaffHeader } from "@/components/staff-header";
import { StaffCustomerFields } from "@/components/staff-customer-fields";
import { getStaffCollection, requireStaffRole } from "@/lib/auth";
import {
  type BarberTotalsPayout,
  type BarberTotalsSale,
  buildBarberTotalsReport,
  normalizeTotalsDate,
  normalizeTotalsPeriod,
  totalsRange,
} from "@/lib/barber-totals";
import { currentShopDateTime, dayNumber, defaultHours, displayTime, formatDisplayDate, normalizeTime, type DailyHours } from "@/lib/booking";
import { barberPhotoUrl } from "@/lib/barber-profile";
import { getCustomerCollection } from "@/lib/customer-auth";
import { getMongoClient } from "@/lib/mongodb";
import { getFinancialDashboard } from "@/lib/financial-ledger";
import { formatMoney, formatWholeDollarMoney, roundCashPayoutCents } from "@/lib/money";
import { customerDisplayName, formatPhone } from "@/lib/phone";
import { getServiceCatalog } from "@/lib/services";

export const metadata: Metadata = {
  title: "Admin Dashboard | HQ on Main",
  robots: { index: false, follow: false },
};

const adminTabs = [
  { id: "barbers", label: "Manage barbers", description: "Profiles and access" },
  { id: "add-barber", label: "Add barber", description: "Create team access" },
  { id: "services", label: "Services", description: "Menu and pricing" },
  { id: "appointments", label: "Appointments", description: "View and edit bookings" },
  { id: "add-appointment", label: "Add appointment", description: "Create a booking" },
  { id: "register", label: "Daily register", description: "Cash and commissions" },
  { id: "customers", label: "Customers", description: "Customer records and identity status" },
  { id: "performance", label: "Performance", description: "Barber totals and visits" },  
  { id: "calls", label: "Booking calls", description: "Events and outcomes" },
  { id: "financials", label: "Financials", description: "Ledger and statements" },
] as const;
type AdminTab = (typeof adminTabs)[number]["id"];

type PerformanceSaleRecord = BarberTotalsSale & {
  barberId?: ObjectId;
  barber?: string;
  status?: string;
  checkoutMethod?: string;
};

type PerformancePayoutRecord = BarberTotalsPayout & {
  barberId?: ObjectId;
  barberName?: string;
};

type VoiceCallEventRecord = {
  callId: string;
  type?: string;
  status?: string;
  endedReason?: string;
  toolNames?: string[];
  occurredAt?: Date;
  receivedAt?: Date;
};

type VoiceCallRecord = {
  _id: ObjectId;
  callId: string;
  callType?: string;
  eventType?: string;
  status?: string;
  endedReason?: string;
  customerNumber?: string;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  cost?: number;
  summary?: string;
  successEvaluation?: string;
  structuredData?: unknown;
  transcript?: string;
  recordingUrl?: string;
  logUrl?: string;
  recordingConsentType?: string;
  recordingConsentGranted?: boolean;
  events?: Omit<VoiceCallEventRecord, "callId">[];
  createdAt?: Date;
  updatedAt?: Date;
};

type DrawerCloseoutRecord = {
  businessDate: string;
  openingDrawerCents?: number;
  expectedDrawerCents?: number;
  actualDrawerCents?: number;
  expectedPhysicalDrawerCents?: number;
  targetDrawerCents?: number;
  cashSalesCents?: number;
  barberPayoutsCents?: number;
  hqRetainedCents?: number;
  countedDrawerCents?: number;
  varianceCents?: number;
  reconciledByName?: string;
  reconciledAt?: Date;
  status?: string;
};

type FinancialAuditEventRecord = {
  _id: ObjectId;
  businessDate: string;
  summary?: string;
  reason?: string;
  changedByName?: string;
  changedAt?: Date;
  changes?: Array<{ field?: string; before?: string; after?: string }>;
};

type ScheduleAvailabilityRecord = DailyHours & {
  barberId: ObjectId;
  dayOfWeek: number;
};

function isAdminTab(value?: string): value is AdminTab {
  return adminTabs.some((tab) => tab.id === value);
}

function financialView(value?: string): FinancialView {
  return value === "profit-loss" || value === "balance-sheet" || value === "accounts" ? value : "ledger";
}

const callDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: process.env.BARBERSHOP_TIME_ZONE || "America/Indiana/Indianapolis",
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatCallDateTime(value?: Date | string) {
  if (!value) return "Not available";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? "Not available" : callDateTimeFormatter.format(date);
}

function formatCallDuration(seconds?: number) {
  if (typeof seconds !== "number") return "Not available";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.max(0, Math.round(seconds % 60));
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function formatCallCost(cost?: number) {
  return typeof cost === "number" ? `$${cost.toFixed(2)}` : "Not available";
}

function formatAuditTime(value?: Date) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.BARBERSHOP_TIME_ZONE || "America/Indiana/Indianapolis",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatCallerNumber(phone?: string) {
  if (!phone) return "Web visitor";
  const digits = phone.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10
    ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
    : phone;
}

function callTypeLabel(type?: string) {
  if (type === "webCall") return "Website microphone";
  if (type === "inboundPhoneCall") return "Inbound phone";
  if (type === "outboundPhoneCall") return "Outbound phone";
  return "Voice call";
}

function readableEvent(value?: string) {
  if (!value) return "Unknown";
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeCallUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tab?: string; customer?: string; call?: string; period?: string; date?: string; barber?: string; registerDate?: string; invite?: string; inviteBarber?: string; scheduleDate?: string; financialView?: string; financialStart?: string; financialEnd?: string; financialAsOf?: string; financialAccount?: string; financialNotice?: string }>;
}) {
  const admin = await requireStaffRole("admin");
  const { error, tab, customer: selectedCustomerId, call: selectedCallId, period, date, barber: performanceBarberId, registerDate, invite, inviteBarber, scheduleDate, financialView: requestedFinancialView, financialStart, financialEnd, financialAsOf, financialAccount } = await searchParams;
  const activeTab: AdminTab = isAdminTab(tab) ? tab : "barbers";
  const staff = await getStaffCollection();
  const customersCollection = await getCustomerCollection();
  const client = await getMongoClient();
  const db = client.db("hqonmain");
  const serviceCatalog = await getServiceCatalog();
  const businessDate = currentShopDateTime().date;
  const selectedFinancialView = financialView(requestedFinancialView);
  const financialEndDate = normalizeScheduleDate(financialEnd, businessDate);
  const requestedFinancialStart = normalizeScheduleDate(financialStart, `${businessDate.slice(0, 4)}-01-01`);
  const financialStartDate = requestedFinancialStart <= financialEndDate ? requestedFinancialStart : financialEndDate;
  const financialAsOfDate = normalizeScheduleDate(financialAsOf, financialEndDate);
  const selectedScheduleDate = normalizeScheduleDate(scheduleDate, businessDate);
  const selectedRegisterDate = normalizeTotalsDate(registerDate, businessDate);
  const selectedRegisterRange = totalsRange("day", selectedRegisterDate);
  const selectedPerformancePeriod = normalizeTotalsPeriod(period);
  const selectedPerformanceDate = normalizeTotalsDate(date, businessDate);
  const selectedPerformanceRange = totalsRange(selectedPerformancePeriod, selectedPerformanceDate);
  const [barbers, customers, appointments, appointmentCount, registerSales, registerPayouts, registerCloseout, registerAuditEvents, voiceCalls, voiceCallCount, voiceInProgressCount, voiceBookedAppointmentCount, scheduleAppointments, scheduleAvailability] = await Promise.all([
    staff.find({ role: "barber" }).sort({ active: -1, name: 1 }).toArray(),
    customersCollection.find({}).sort({ createdAt: -1 }).limit(250).toArray(),
    db.collection("appointments")
      .find({})
      .sort({ requestedDate: -1, requestedTime: -1 })
      .limit(250)
      .toArray(),
    db.collection("appointments").countDocuments(),
    db.collection("appointments").find({
      requestedDate: selectedRegisterDate,
      status: "completed",
      checkoutMethod: "cash",
      checkoutAmountCents: { $gte: 0 },
    }).toArray(),
    db.collection("commissionPayouts").find({ businessDate: selectedRegisterDate }).toArray(),
    db.collection<DrawerCloseoutRecord>("drawerCloseouts").findOne({ businessDate: selectedRegisterDate }),
    db.collection<FinancialAuditEventRecord>("financialAuditEvents").find({ businessDate: selectedRegisterDate }).sort({ changedAt: 1 }).toArray(),
    db.collection<VoiceCallRecord>("voiceCalls").find({}).sort({ updatedAt: -1 }).limit(150).toArray(),
    db.collection("voiceCalls").countDocuments(),
    db.collection("voiceCalls").countDocuments({ status: "in-progress" }),
    db.collection("appointments").countDocuments({ source: "voice" }),
    db.collection("appointments").find({ requestedDate: selectedScheduleDate }).sort({ requestedTime: 1 }).toArray(),
    db.collection<ScheduleAvailabilityRecord>("availability").find({ dayOfWeek: dayNumber(selectedScheduleDate) }).toArray(),
  ]);
  const scheduleBarbers = barbers.filter((barber) => barber.active || scheduleAppointments.some((appointment) =>
    appointment.barberId?.toString() === barber._id.toString() || appointment.barber === barber.name,
  ));
  const scheduleHours = new Map(scheduleAvailability.map((hours) => [hours.barberId.toString(), hours]));
  const selectedPerformanceBarber = performanceBarberId && ObjectId.isValid(performanceBarberId)
    ? barbers.find((barber) => barber._id.toString() === performanceBarberId) ?? null
    : null;
  const performanceAppointmentFilter = selectedPerformanceBarber
    ? { $or: [{ barberId: selectedPerformanceBarber._id }, { barber: selectedPerformanceBarber.name }] }
    : {};
  const performancePayoutFilter = selectedPerformanceBarber
    ? { $or: [{ barberId: selectedPerformanceBarber._id }, { barberName: selectedPerformanceBarber.name }] }
    : {};
  const [performanceSales, performancePayouts] = await Promise.all([
    db.collection<PerformanceSaleRecord>("appointments").find({
      ...performanceAppointmentFilter,
      requestedDate: { $gte: selectedPerformanceRange.start, $lte: selectedPerformanceRange.end },
      status: "completed",
      checkoutMethod: "cash",
      checkoutAmountCents: { $gte: 0 },
    }).toArray(),
    db.collection<PerformancePayoutRecord>("commissionPayouts").find({
      ...performancePayoutFilter,
      businessDate: { $gte: selectedPerformanceRange.start, $lte: selectedPerformanceRange.end },
    }).toArray(),
  ]);
  const appointmentCounts = await Promise.all(
    customers.map((customer) =>
      db.collection("appointments").countDocuments({
        customerId: customer._id,
      }),
    ),
  );
  const selectedCustomer = selectedCustomerId && ObjectId.isValid(selectedCustomerId)
    ? await customersCollection.findOne({ _id: new ObjectId(selectedCustomerId) })
    : null;
  const selectedCustomerAppointments = selectedCustomer
    ? await db.collection("appointments").find({
        customerId: selectedCustomer._id,
      }).sort({ requestedDate: -1, requestedTime: -1 }).toArray()
    : [];
  const selectedCall = selectedCallId && selectedCallId.length <= 200
    ? await db.collection<VoiceCallRecord>("voiceCalls").findOne({ callId: selectedCallId })
    : null;
  const selectedCallAppointments = selectedCall
    ? await db.collection("appointments").find({ voiceCallId: selectedCall.callId }).sort({ createdAt: -1 }).toArray()
    : [];
  const storedCallEvents = selectedCall
    ? await db.collection<VoiceCallEventRecord>("voiceCallEvents")
        .find({ callId: selectedCall.callId })
        .sort({ occurredAt: 1, receivedAt: 1 })
        .limit(200)
        .toArray()
    : [];
  const customerHistoryTotals = selectedCustomerAppointments.reduce(
    (totals, appointment) => {
      const status = String(appointment.status ?? "pending");
      totals.total += 1;
      if (status === "completed") totals.completed += 1;
      if (status === "no-show") totals.noShow += 1;
      if (status === "cancelled") totals.cancelled += 1;
      return totals;
    },
    { total: 0, completed: 0, noShow: 0, cancelled: 0 },
  );
  const financialDashboard = activeTab === "financials"
    ? await getFinancialDashboard({
        db,
        start: financialStartDate,
        end: financialEndDate,
        asOf: financialAsOfDate,
        cashAccountId: financialAccount,
      })
    : null;
  const performanceReport = buildBarberTotalsReport(
    performanceSales,
    performancePayouts,
    selectedPerformanceRange,
    businessDate,
  );
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
  const closeoutExpectedCents = Number(
    (typeof registerCloseout?.actualDrawerCents === "number" ? registerCloseout.expectedDrawerCents : registerCloseout?.cashSalesCents) ??
    registerCloseout?.expectedDrawerCents ??
    0,
  );
  const closeoutActualCents = Number(
    registerCloseout?.actualDrawerCents ??
    ((registerCloseout?.countedDrawerCents ?? 0) +
      (registerCloseout?.barberPayoutsCents ?? 0) -
      (registerCloseout?.openingDrawerCents ?? 20_000)),
  );
  const closeoutVarianceCents = Number(registerCloseout?.varianceCents ?? (closeoutActualCents - closeoutExpectedCents));
  const closeoutPayoutCents = Number(registerCloseout?.barberPayoutsCents ?? 0);
  const closeoutHqRetainedCents = Number(
    registerCloseout?.hqRetainedCents ??
    ((registerCloseout?.cashSalesCents ?? 0) - closeoutPayoutCents),
  );
  const voiceAppointmentByCall = new Map(
    appointments
      .filter((appointment) => typeof appointment.voiceCallId === "string")
      .map((appointment) => [String(appointment.voiceCallId), appointment]),
  );
  const selectedCallEvents = [...(storedCallEvents.length ? storedCallEvents : (selectedCall?.events ?? []))].sort((left, right) => {
    const leftTime = left.occurredAt ?? left.receivedAt;
    const rightTime = right.occurredAt ?? right.receivedAt;
    return (leftTime?.valueOf() ?? 0) - (rightTime?.valueOf() ?? 0);
  });
  const selectedRecordingUrl = safeCallUrl(selectedCall?.recordingUrl);
  const selectedLogUrl = safeCallUrl(selectedCall?.logUrl);
  const selectedStructuredData = selectedCall?.structuredData
    ? JSON.stringify(selectedCall.structuredData, null, 2)
    : "";

  return (
    <main className="portal-page">
      <StaffHeader
        name={admin.name}
        area="Admin"
        alternatePortal={admin.role === "barber" ? { href: "/barber/dashboard", label: "Barber portal" } : undefined}
      />
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
        {invite && <BarberSetupLink token={invite} barberName={inviteBarber || "the barber"} />}

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
                  {item.id === "calls" && voiceCallCount > 0 && <b>{voiceCallCount}</b>}
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
                </div>
                <form className="portal-form portal-form-grid" action={createBarber}>
                  <label>Full name<input name="name" required minLength={2} /></label>
                  <label>Email<input name="email" type="email" required /></label>
                  <label>Nickname<input name="nickname" maxLength={60} placeholder="Optional public nickname" /></label>
                  <label>Specialty<input name="specialty" maxLength={120} placeholder="Fades, beard work, classic cuts" /></label>
                  <label>Commission percentage<input name="commissionPercentage" type="number" min="0" max="100" step="0.1" required /></label>
                  <label className="portal-wide">Bio<textarea name="bio" rows={5} maxLength={1200} placeholder="Tell customers about this barber, their approach, and specialties." /></label>
                  <label className="portal-wide">Profile photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /><small>Square JPEG, PNG, or WebP recommended. Maximum 3 MB.</small></label>
                  <label className="account-check portal-wide">
                    <input name="adminAccess" type="checkbox" />
                    <span>Grant this barber full admin portal access. They will be able to manage barbers, customers, appointments, services, register reports, and other administrative settings.</span>
                  </label>
                  <p className="portal-wide portal-form-note">After saving, you&apos;ll receive a one-time link for the barber to choose their password, POS PIN, phone number, and notification preference.</p>
                  <button className="button button-primary portal-wide" type="submit">Add barber and create setup link</button>
                </form>
              </section>
            )}

            {activeTab === "barbers" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Manage barbers</h2></div>
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
                        <div><h3>{barber.name}</h3><p>{barber.active ? "Active" : "Inactive"}{barber.adminAccess ? " · Admin access" : ""}</p></div>
                      </div>
                      <div className="staff-edit-grid">
                        <label>Name<input name="name" defaultValue={barber.name} required /></label>
                        <label>Email<input name="email" type="email" defaultValue={barber.email} required /></label>
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
                          <input name="adminAccess" type="checkbox" defaultChecked={barber.adminAccess === true} />
                          <span>Grant this barber full admin portal access. They will retain their barber dashboard and POS access.</span>
                        </label>
                        <div className="portal-wide staff-self-managed-status"><strong>{barber.credentialsConfiguredAt || (barber.passwordHash && barber.posPinHash) ? "Access configured by barber" : "Barber setup pending"}</strong><span>{barber.phone || "No mobile number"} · Notifications {barber.smsNotificationsEnabled ? "enabled" : "off"}</span></div>
                      </div>
                      <div className="staff-card-actions">
                        <button className="button button-secondary" formAction={createBarberCredentialReset} type="submit">Create password/PIN reset link</button>
                        <button className="portal-save" type="submit">Save changes</button>
                      </div>
                    </form>
                  ))}
                </div>
              </section>
            )}

            {activeTab === "services" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Services</h2></div>
                </div>
                <form className="admin-service-create" action={createService}>
                  <div className="admin-service-create-heading">
                    <div><small>New menu item</small><h3>Add a service</h3></div>
                    <p>New services become available for barbers to select after they are added.</p>
                  </div>
                  <label>Service name<input name="name" required minLength={2} maxLength={100} placeholder="Example: Head shave" /></label>
                  <label>Price<input name="price" required maxLength={20} placeholder="$35 or TBD" /></label>
                  <label className="portal-wide">Description<textarea name="description" required minLength={2} maxLength={600} rows={3} placeholder="Describe what is included." /></label>
                  <button className="button button-primary portal-wide" type="submit">Add service</button>
                </form>
                <div className="admin-service-list">
                  {serviceCatalog.map((service, index) => (
                    <form className="admin-service-card" action={updateService} key={service.id}>
                      <input type="hidden" name="serviceId" value={service.id} />
                      <div className="admin-service-card-number">{String(index + 1).padStart(2, "0")}</div>
                      <div className="admin-service-fields">
                        <label>Service name<input name="name" defaultValue={service.name} required minLength={2} maxLength={100} /></label>
                        <label>Price<input name="price" defaultValue={service.price} required maxLength={20} /></label>
                        <label className="portal-wide">Description<textarea name="description" defaultValue={service.description} required minLength={2} maxLength={600} rows={3} /></label>
                      </div>
                      <div className="admin-service-actions">
                        <AdminServiceDeleteButton serviceName={service.name} />
                        <button className="portal-save" type="submit">Save changes</button>
                      </div>
                    </form>
                  ))}
                </div>
              </section>
            )}

            {activeTab === "add-appointment" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Add appointment</h2></div>
                </div>
                <form className="portal-form portal-form-grid" action={createAdminAppointment}>
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
                      {serviceCatalog.map((service) => <option key={service.id}>{service.name}</option>)}
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
                </div>
                <AppointmentSchedule
                  date={selectedScheduleDate}
                  today={businessDate}
                  barbers={scheduleBarbers.map((barber) => ({ id: barber._id.toString(), name: barber.name }))}
                  appointments={scheduleAppointments.map((appointment) => ({
                    id: appointment._id.toString(),
                    barberId: appointment.barberId?.toString(),
                    barber: String(appointment.barber ?? ""),
                    name: String(appointment.name ?? "Guest"),
                    service: String(appointment.service ?? ""),
                    time: String(appointment.requestedTime ?? ""),
                    status: String(appointment.status ?? "pending"),
                    visitType: String(appointment.visitType ?? "appointment"),
                    href: `#appointment-${appointment._id.toString()}`,
                  }))}
                  hoursByBarber={Object.fromEntries(scheduleBarbers.map((barber) => [
                    barber._id.toString(),
                    scheduleHours.get(barber._id.toString()) ?? defaultHours(dayNumber(selectedScheduleDate)),
                  ]))}
                  basePath="/admin/dashboard"
                  baseParams={{ tab: "appointments" }}
                  emptyMessage="No shop appointments are scheduled for this day."
                />
                <div className="admin-appointment-list">
                  {appointments.length === 0 && <p className="portal-empty">No appointments yet.</p>}
                  {appointments.map((appointment) => {
                    const assignedBarberId = appointment.barberId?.toString() ?? "";
                    return (
                      <form className="admin-appointment-card" id={`appointment-${appointment._id.toString()}`} action={updateAdminAppointment} key={appointment._id.toString()}>
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
                          <label>Email <small>Optional</small><input name="email" type="email" defaultValue={String(appointment.email ?? "")} /></label>
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
                              {!serviceCatalog.some((service) => service.name === String(appointment.service ?? "")) && (
                                <option>{String(appointment.service ?? "Service not specified")}</option>
                              )}
                              {serviceCatalog.map((service) => <option key={service.id}>{service.name}</option>)}
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
                          {typeof appointment.checkoutAmountCents === "number" && (
                            <label>Cash total<input name="checkoutAmount" type="number" min="0.01" max="100000" step="0.01" defaultValue={(appointment.checkoutAmountCents / 100).toFixed(2)} required /></label>
                          )}
                          <label className="portal-wide">Notes<input name="notes" defaultValue={String(appointment.notes ?? "")} /></label>
                          {typeof appointment.checkoutAmountCents === "number" && (
                            <label className="portal-wide">Correction reason
                              <input name="auditReason" maxLength={300} placeholder="Required when changing a transaction after drawer closeout" />
                            </label>
                          )}
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
                {selectedCustomer ? (
                  <div className="admin-customer-detail">
                    <Link className="admin-customer-back" href="/admin/dashboard?tab=customers">← Back to all customers</Link>
                    <div className="admin-customer-detail-heading">
                      <div className="admin-customer-person">
                        <span>{customerDisplayName(selectedCustomer).split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                        <div>
                          <p className="eyebrow">Customer history</p>
                          <h2>{customerDisplayName(selectedCustomer)}</h2>
                          <p>{selectedCustomer.phoneVerifiedAt ? "Verified mobile" : "Phone not verified"} · Created via {String(selectedCustomer.createdBySource ?? "legacy").replaceAll("_", " ")}{selectedCustomer.possibleDuplicate ? " · Possible duplicate" : ""}</p>
                          <p>{selectedCustomer.email} · {selectedCustomer.phone}</p>
                        </div>
                      </div>
                      <p>Customer since {formatDisplayDate(selectedCustomer.createdAt)}</p>
                    </div>
                    <div className="admin-customer-history-stats">
                      <div><strong>{customerHistoryTotals.total}</strong><span>Total appointments</span></div>
                      <div><strong>{customerHistoryTotals.completed}</strong><span>Completed</span></div>
                      <div><strong>{customerHistoryTotals.noShow}</strong><span>No-shows</span></div>
                      <div><strong>{customerHistoryTotals.cancelled}</strong><span>Cancelled</span></div>
                    </div>
                    <div className="admin-customer-history">
                      {selectedCustomerAppointments.length === 0 && <p className="portal-empty">This customer has no appointment history yet.</p>}
                      {selectedCustomerAppointments.map((appointment) => {
                        const status = String(appointment.status ?? "pending");
                        const visitType = String(appointment.visitType ?? (appointment.source === "walk-in" ? "walk-in" : "appointment"));
                        return (
                          <article className="admin-customer-history-row" key={appointment._id.toString()}>
                            <div className="admin-customer-history-date">
                              <strong>{formatDisplayDate(String(appointment.requestedDate ?? "")) || "No date"}</strong>
                              <span>{displayTime(String(appointment.requestedTime ?? "")) || "No time"}</span>
                            </div>
                            <div>
                              <h3>{String(appointment.service ?? "Service not specified")}</h3>
                              <p>With {String(appointment.barber ?? "Unassigned")} · {visitType === "walk-in" ? "Walk-in" : "Appointment"}</p>
                            </div>
                            <span className={`appointment-status ${status}`}>{status}</span>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="portal-section-heading">
                      <div><h2>Customer records</h2></div>
                    </div>
                    <div className="admin-customer-list">
                      {customers.length === 0 && <p className="portal-empty">No customer records yet.</p>}
                      {customers.map((customer, index) => (
                        <Link
                          className="admin-customer-card"
                          href={`/admin/dashboard?tab=customers&customer=${customer._id.toString()}`}
                          prefetch={false}
                          key={customer._id.toString()}
                        >
                          <div className="admin-customer-person">
                            <span>{customerDisplayName(customer).split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                            <div><h3>{customerDisplayName(customer)}</h3><p>{customer.phoneVerifiedAt ? "Verified mobile" : "Phone not verified"} · {String(customer.createdBySource ?? "legacy").replaceAll("_", " ")}{customer.possibleDuplicate ? " · Review duplicate" : ""}</p></div>
                          </div>
                          <dl>
                            <div><dt>Email</dt><dd>{customer.email || "Not provided"}</dd></div>
                            <div><dt>Phone</dt><dd>{formatPhone(customer.phone)}</dd></div>
                            <div><dt>Appointments</dt><dd>{appointmentCounts[index]}</dd></div>
                          </dl>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}

            {activeTab === "calls" && (
              <section className="portal-section">
                {selectedCall ? (
                  <div className="admin-call-detail">
                    <Link className="admin-customer-back" href="/admin/dashboard?tab=calls">← Back to all calls</Link>
                    <div className="admin-call-detail-heading">
                      <div>
                        <p className="eyebrow">{callTypeLabel(selectedCall.callType)}</p>
                        <h2>{formatCallerNumber(selectedCall.customerNumber)}</h2>
                        <p>{formatCallDateTime(selectedCall.startedAt ?? selectedCall.createdAt)} · Call {selectedCall.callId.slice(-8)}</p>
                      </div>
                      <span className={`admin-call-status ${selectedCall.status === "in-progress" ? "live" : ""}`}>
                        {readableEvent(selectedCall.status || selectedCall.eventType)}
                      </span>
                    </div>

                    <div className="admin-call-metrics">
                      <div><small>Duration</small><strong>{formatCallDuration(selectedCall.durationSeconds)}</strong></div>
                      <div><small>Call cost</small><strong>{formatCallCost(selectedCall.cost)}</strong></div>
                      <div><small>End reason</small><strong>{readableEvent(selectedCall.endedReason)}</strong></div>
                      <div><small>Appointment</small><strong>{selectedCallAppointments.length ? "Booked" : "None linked"}</strong></div>
                    </div>

                    <div className="admin-call-detail-grid">
                      <article className="admin-call-panel admin-call-summary">
                        <header><h3>Post-call summary</h3><span>{selectedCall.eventType === "end-of-call-report" ? "Report received" : "Awaiting report"}</span></header>
                        <p>{selectedCall.summary || "No post-call summary has been received for this call."}</p>
                        {selectedCall.successEvaluation && (
                          <div className="admin-call-evaluation">
                            <small>Success evaluation</small>
                            <strong>{selectedCall.successEvaluation}</strong>
                          </div>
                        )}
                        {(selectedRecordingUrl || selectedLogUrl) && (
                          <div className="admin-call-resource-links">
                            {selectedRecordingUrl && <a href={selectedRecordingUrl} target="_blank" rel="noreferrer">Open recording ↗</a>}
                            {selectedLogUrl && <a href={selectedLogUrl} target="_blank" rel="noreferrer">Open Vapi log ↗</a>}
                          </div>
                        )}
                      </article>

                      <article className="admin-call-panel">
                        <header><h3>Call information</h3></header>
                        <dl className="admin-call-info">
                          <div><dt>Channel</dt><dd>{callTypeLabel(selectedCall.callType)}</dd></div>
                          <div><dt>Caller</dt><dd>{formatCallerNumber(selectedCall.customerNumber)}</dd></div>
                          <div><dt>Started</dt><dd>{formatCallDateTime(selectedCall.startedAt)}</dd></div>
                          <div><dt>Ended</dt><dd>{formatCallDateTime(selectedCall.endedAt)}</dd></div>
                          <div><dt>Recording consent</dt><dd>{selectedCall.recordingConsentType ? `${readableEvent(selectedCall.recordingConsentType)} · ${selectedCall.recordingConsentGranted ? "Granted" : "Not granted"}` : "Not reported"}</dd></div>
                          <div><dt>Vapi call ID</dt><dd className="admin-call-id">{selectedCall.callId}</dd></div>
                        </dl>
                      </article>
                    </div>

                    {selectedCallAppointments.length > 0 && (
                      <article className="admin-call-panel admin-call-bookings">
                        <header><h3>Appointments booked during this call</h3><span>{selectedCallAppointments.length}</span></header>
                        {selectedCallAppointments.map((appointment) => (
                          <div className="admin-call-booking" key={appointment._id.toString()}>
                            <div><strong>{String(appointment.name ?? "Guest")}</strong><span>{String(appointment.service ?? "Service not specified")}</span></div>
                            <div><strong>{formatDisplayDate(String(appointment.requestedDate ?? ""))}</strong><span>{displayTime(String(appointment.requestedTime ?? ""))} with {String(appointment.barber ?? "Unassigned")}</span></div>
                            <span className={`appointment-status ${String(appointment.status ?? "confirmed")}`}>{String(appointment.status ?? "confirmed")}</span>
                          </div>
                        ))}
                      </article>
                    )}

                    {selectedStructuredData && (
                      <details className="admin-call-panel admin-call-disclosure">
                        <summary>Structured post-call data</summary>
                        <pre>{selectedStructuredData}</pre>
                      </details>
                    )}

                    <details className="admin-call-panel admin-call-disclosure" open={Boolean(selectedCall.transcript)}>
                      <summary>Transcript</summary>
                      {selectedCall.transcript ? (
                        <pre className="admin-call-transcript">{selectedCall.transcript}</pre>
                      ) : (
                        <p>Transcript storage is off or no transcript was included. Set <code>VAPI_STORE_TRANSCRIPTS=true</code> only after choosing an appropriate retention and privacy policy.</p>
                      )}
                    </details>

                    <article className="admin-call-panel admin-call-timeline">
                      <header><h3>Call events</h3><span>{selectedCallEvents.length}</span></header>
                      {selectedCallEvents.length === 0 && <p className="portal-empty">No individual events were retained for this older call.</p>}
                      <ol>
                        {selectedCallEvents.map((event, index) => (
                          <li key={`${event.type}-${event.receivedAt?.toString() ?? index}-${index}`}>
                            <span className={`admin-call-event-dot ${event.status === "in-progress" ? "live" : ""}`} />
                            <div>
                              <strong>{readableEvent(event.type)}</strong>
                              <p>
                                {event.status && `Status: ${readableEvent(event.status)}`}
                                {event.endedReason && ` · ${readableEvent(event.endedReason)}`}
                                {event.toolNames?.length ? ` · ${event.toolNames.map(readableEvent).join(", ")}` : ""}
                              </p>
                            </div>
                            <time>{formatCallDateTime(event.occurredAt ?? event.receivedAt)}</time>
                          </li>
                        ))}
                      </ol>
                    </article>
                  </div>
                ) : (
                  <>
                    <div className="portal-section-heading">
                      <div><h2>Booking calls</h2></div>
                    </div>
                    <div className="admin-call-overview">
                      <div><small>Total calls</small><strong>{voiceCallCount}</strong></div>
                      <div><small>In progress</small><strong>{voiceInProgressCount}</strong></div>
                      <div><small>Voice appointments</small><strong>{voiceBookedAppointmentCount}</strong></div>
                    </div>
                    <div className="admin-call-list">
                      {voiceCalls.length === 0 && (
                        <div className="portal-empty">
                          <p>No call events have been received yet.</p>
                          <small>Vapi must send status-update and end-of-call-report messages to the app webhook.</small>
                        </div>
                      )}
                      {voiceCalls.map((call) => {
                        const linkedAppointment = voiceAppointmentByCall.get(call.callId);
                        return (
                          <Link
                            className="admin-call-card"
                            href={`/admin/dashboard?tab=calls&call=${encodeURIComponent(call.callId)}`}
                            prefetch={false}
                            key={call._id.toString()}
                          >
                            <span className={`admin-call-channel ${call.callType === "webCall" ? "web" : "phone"}`} aria-hidden="true">
                              {call.callType === "webCall" ? "WEB" : "TEL"}
                            </span>
                            <div className="admin-call-card-main">
                              <h3>{formatCallerNumber(call.customerNumber)}</h3>
                              <p>{callTypeLabel(call.callType)} · {formatCallDateTime(call.startedAt ?? call.createdAt)}</p>
                            </div>
                            <div className="admin-call-card-result">
                              <strong>{linkedAppointment ? "Appointment booked" : call.summary ? "Post-call report" : readableEvent(call.eventType)}</strong>
                              <span>{linkedAppointment ? `${String(linkedAppointment.service ?? "Service")} · ${formatDisplayDate(String(linkedAppointment.requestedDate ?? ""))}` : readableEvent(call.endedReason || call.status)}</span>
                            </div>
                            <div className="admin-call-card-meta">
                              <strong>{formatCallDuration(call.durationSeconds)}</strong>
                              <span>{formatCallCost(call.cost)}</span>
                            </div>
                            <span className="admin-call-card-arrow">→</span>
                          </Link>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            )}

            {activeTab === "register" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>Daily register</h2></div>
                  <p>{formatDisplayDate(selectedRegisterDate)} · Rounded payouts and shop pay.</p>
                </div>
                <div className="admin-register-date-controls">
                  <Link
                    href={`/admin/dashboard?tab=register&registerDate=${selectedRegisterRange.previousAnchor}`}
                    aria-label="View previous day's closeout"
                  >
                    ←
                  </Link>
                  <form method="get" action="/admin/dashboard">
                    <input type="hidden" name="tab" value="register" />
                    <label>
                      Closeout date
                      <input name="registerDate" type="date" defaultValue={selectedRegisterDate} max={businessDate} />
                    </label>
                    <button type="submit">View closeout</button>
                  </form>
                  {selectedRegisterRange.nextAnchor <= businessDate ? (
                    <Link
                      href={`/admin/dashboard?tab=register&registerDate=${selectedRegisterRange.nextAnchor}`}
                      aria-label="View next day's closeout"
                    >
                      →
                    </Link>
                  ) : (
                    <span aria-hidden="true">→</span>
                  )}
                </div>
                {registerCloseout ? (
                  <section className={`admin-closeout-audit ${closeoutVarianceCents === 0 ? "balanced" : "variance"}`} aria-labelledby="closeout-audit-heading">
                    <header>
                      <div><small>Immutable closeout record</small><h3 id="closeout-audit-heading">Drawer audit</h3><p>Expected and actual drawer totals reflect the day&apos;s cash activity; the $200 opening float is excluded.</p></div>
                      <span>{registerAuditEvents.length ? "Review changes" : "Closed"}</span>
                    </header>
                    <dl className="admin-closeout-facts">
                      <div><dt>Date</dt><dd>{formatDisplayDate(registerCloseout.businessDate)}</dd></div>
                      <div><dt>Closed by</dt><dd>{registerCloseout.reconciledByName || "Staff"}</dd></div>
                      <div><dt>Time</dt><dd>{formatAuditTime(registerCloseout.reconciledAt)}</dd></div>
                      <div><dt>Expected drawer</dt><dd>{formatMoney(closeoutExpectedCents)}</dd></div>
                      <div><dt>Actual drawer</dt><dd>{formatMoney(closeoutActualCents)}</dd></div>
                      <div className="variance"><dt>Variance</dt><dd>{closeoutVarianceCents > 0 ? "+" : ""}{formatMoney(closeoutVarianceCents)}</dd></div>
                      <div><dt>Barber payouts</dt><dd>{formatMoney(closeoutPayoutCents)}</dd></div>
                      <div><dt>HQ retained</dt><dd>{formatMoney(closeoutHqRetainedCents)}</dd></div>
                      <div><dt>Status</dt><dd>Closed</dd></div>
                    </dl>
                    <div className="admin-financial-audit-log">
                      <div className="admin-financial-audit-heading">
                        <div><h4>Changes after closeout</h4><p>The original closeout above is never recalculated or overwritten.</p></div>
                        <strong>{registerAuditEvents.length}</strong>
                      </div>
                      {registerAuditEvents.length ? registerAuditEvents.map((event) => (
                        <article key={event._id.toString()}>
                          <div className="admin-audit-event-meta">
                            <strong>{event.summary || "Financial record changed"}</strong>
                            <span>Changed by {event.changedByName || "Staff"} · {formatAuditTime(event.changedAt)}</span>
                          </div>
                          <div className="admin-audit-changes">
                            {(event.changes ?? []).map((change, index) => (
                              <p key={`${event._id.toString()}-${index}`}><small>{change.field || "Value"}</small><span>{change.before || "—"}</span><b>→</b><strong>{change.after || "—"}</strong></p>
                            ))}
                          </div>
                          <p className="admin-audit-reason"><small>Reason</small>{event.reason || "No reason recorded"}</p>
                        </article>
                      )) : (
                        <p className="portal-empty">No financial records have changed since this drawer was closed.</p>
                      )}
                    </div>
                  </section>
                ) : (
                  <p className="admin-closeout-empty">No drawer closeout has been saved for {formatDisplayDate(selectedRegisterDate)}.</p>
                )}
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

            {activeTab === "financials" && financialDashboard && (
              <FinancialDashboardPanel
                dashboard={financialDashboard}
                view={selectedFinancialView}
                dates={{ start: financialStartDate, end: financialEndDate, asOf: financialAsOfDate }}
              />
            )}

            {activeTab === "performance" && (
              <section className="portal-section">
                <div className="portal-section-heading">
                  <div><h2>{selectedPerformanceBarber ? `${selectedPerformanceBarber.name}'s performance` : "Shop performance"}</h2></div>
                </div>
                <form className="admin-performance-scope" method="get" action="/admin/dashboard">
                  <input type="hidden" name="tab" value="performance" />
                  <input type="hidden" name="period" value={selectedPerformancePeriod} />
                  <input type="hidden" name="date" value={selectedPerformanceDate} />
                  <label>Whose totals?
                    <select name="barber" defaultValue={selectedPerformanceBarber?._id.toString() ?? ""}>
                      <option value="">Whole shop</option>
                      {barbers.map((barber) => (
                        <option value={barber._id.toString()} key={barber._id.toString()}>
                          {barber.name}{barber.active ? "" : " (inactive)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit">View report</button>
                </form>
                <BarberTotalsReport
                  report={performanceReport}
                  today={businessDate}
                  basePath="/admin/dashboard"
                  fixedParams={{
                    tab: "performance",
                    ...(selectedPerformanceBarber ? { barber: selectedPerformanceBarber._id.toString() } : {}),
                  }}
                  showBarber={!selectedPerformanceBarber}
                />
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
