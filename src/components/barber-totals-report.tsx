import Link from "next/link";
import { displayTime, formatDisplayDate } from "@/lib/booking";
import type { BarberTotalsReport, TotalsPeriod } from "@/lib/barber-totals";
import { formatMoney, formatWholeDollarMoney } from "@/lib/money";

const periods: Array<{ id: TotalsPeriod; label: string }> = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

function reportHref(
  period: TotalsPeriod,
  date: string,
  basePath: string,
  fixedParams: Record<string, string>,
) {
  const params = new URLSearchParams({ ...fixedParams, period, date });
  return `${basePath}?${params.toString()}`;
}

function isWalkIn(visit: BarberTotalsReport["visits"][number]) {
  return visit.visitType === "walk-in" || visit.source === "walk-in" || visit.source === "pos-walk-in";
}

export function BarberTotalsReport({
  report,
  today,
  basePath = "/barber/dashboard",
  fixedParams = { tab: "totals" },
  showBarber = false,
}: {
  report: BarberTotalsReport;
  today: string;
  basePath?: string;
  fixedParams?: Record<string, string>;
  showBarber?: boolean;
}) {
  const canGoNext = report.nextAnchor <= today;
  const reportUrl = (period: TotalsPeriod, date: string) =>
    reportHref(period, date, basePath, fixedParams);

  return (
    <div className="barber-totals-report">
      <div className="barber-totals-controls">
        <nav aria-label="Totals period">
          {periods.map((period) => (
            <Link
              className={report.period === period.id ? "active" : ""}
              href={reportUrl(period.id, report.anchor)}
              aria-current={report.period === period.id ? "page" : undefined}
              key={period.id}
            >
              {period.label}
            </Link>
          ))}
        </nav>
        <form method="get" action={basePath}>
          {Object.entries(fixedParams).map(([name, value]) => (
            <input type="hidden" name={name} value={value} key={name} />
          ))}
          <input type="hidden" name="period" value={report.period} />
          <label>Choose a date<input name="date" type="date" defaultValue={report.anchor} max={today} /></label>
          <button type="submit">View</button>
        </form>
      </div>

      <div className="barber-totals-range">
        <Link href={reportUrl(report.period, report.previousAnchor)} aria-label={`Previous ${report.period}`}>←</Link>
        <div><small>Viewing {report.period}</small><h3>{report.rangeLabel}</h3></div>
        {canGoNext ? (
          <Link href={reportUrl(report.period, report.nextAnchor)} aria-label={`Next ${report.period}`}>→</Link>
        ) : (
          <span aria-hidden="true">→</span>
        )}
      </div>

      <dl className="barber-totals-summary">
        <div><dt>Total register</dt><dd>{formatMoney(report.registerCents)}</dd></div>
        <div className="earned"><dt>Commission earned</dt><dd>{formatMoney(report.commissionEarnedCents)}</dd></div>
        <div><dt>Cash paid out</dt><dd>{formatWholeDollarMoney(report.payoutCents)}</dd></div>
        <div><dt>Completed cuts</dt><dd>{report.completedCuts}</dd></div>
        <div><dt>Appointments</dt><dd>{report.appointments}</dd></div>
        <div><dt>Walk-ins</dt><dd>{report.walkIns}</dd></div>
      </dl>

      {report.period !== "day" && (
        <section className="barber-totals-panel">
          <header><div><h3>Daily breakdown</h3><p>Every day in this {report.period}.</p></div></header>
          <div className="barber-daily-table-wrap">
            <table className="barber-daily-table">
              <thead><tr><th>Date</th><th>Cuts</th><th>Appts / walk-ins</th><th>Register</th><th>Commission</th><th>Paid out</th></tr></thead>
              <tbody>
                {report.days.map((day) => (
                  <tr key={day.date}>
                    <td><Link href={reportUrl("day", day.date)}>{formatDisplayDate(day.date)}</Link></td>
                    <td>{day.completedCuts}</td>
                    <td>{day.appointments} / {day.walkIns}</td>
                    <td>{formatMoney(day.registerCents)}</td>
                    <td>{formatMoney(day.commissionEarnedCents)}</td>
                    <td>{formatWholeDollarMoney(day.payoutCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="barber-totals-panel">
        <header><div><h3>Services performed</h3><p>Completed services in this {report.period}.</p></div></header>
        {report.services.length ? (
          <div className="barber-service-totals">
            {report.services.map((service) => (
              <article key={service.service}>
                <div><h4>{service.service}</h4><span>{service.completedCuts} {service.completedCuts === 1 ? "cut" : "cuts"}</span></div>
                <dl><div><dt>Register</dt><dd>{formatMoney(service.registerCents)}</dd></div><div><dt>Commission</dt><dd>{formatMoney(service.commissionEarnedCents)}</dd></div></dl>
              </article>
            ))}
          </div>
        ) : <p className="portal-empty">No completed services in this {report.period}.</p>}
      </section>

      <section className="barber-totals-panel">
        <header><div><h3>Completed visits</h3><p>The individual work included in these totals.</p></div><span>{report.visits.length}</span></header>
        {report.visits.length ? (
          <div className="barber-visit-list">
            {report.visits.map((visit, index) => (
              <article key={String(visit._id ?? `${visit.requestedDate}-${visit.requestedTime}-${index}`)}>
                <div className="barber-visit-date"><strong>{formatDisplayDate(visit.requestedDate ?? "")}</strong><span>{displayTime(visit.requestedTime ?? "")}</span></div>
                <div className="barber-visit-guest"><strong>{visit.name || "Walk-In"}</strong><span>{visit.service || "Service not specified"}{showBarber && ` · ${visit.barber || "Unassigned"}`}</span></div>
                <span className={`barber-visit-type ${isWalkIn(visit) ? "walk-in" : "appointment"}`}>{isWalkIn(visit) ? "Walk-in" : "Appointment"}</span>
                <div><small>Register</small><strong>{formatMoney(visit.checkoutAmountCents ?? 0)}</strong></div>
                <div><small>Commission</small><strong>{formatMoney(visit.commissionAmountCents ?? 0)}</strong></div>
              </article>
            ))}
          </div>
        ) : <p className="portal-empty">No completed visits in this {report.period}.</p>}
      </section>
    </div>
  );
}
