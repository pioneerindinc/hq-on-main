import { formatMoney, formatWholeDollarMoney } from "@/lib/money";
import type { PerformancePeriod } from "@/lib/register-performance";

export function RegisterPerformance({ periods }: { periods: PerformancePeriod[] }) {
  return (
    <div className="performance-periods">
      {periods.map((period) => (
        <article className="performance-period" key={period.id}>
          <header>
            <div><h3>{period.label}</h3><p>{period.rangeLabel}</p></div>
            <span>{period.completedCuts} completed</span>
          </header>
          <dl>
            <div><dt>Total register</dt><dd>{formatMoney(period.registerCents)}</dd></div>
            <div className="performance-payout"><dt>Commission payouts</dt><dd>{formatWholeDollarMoney(period.payoutCents)}</dd></div>
            <div><dt>Appointments</dt><dd>{period.appointments}</dd></div>
            <div><dt>Walk-ins</dt><dd>{period.walkIns}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}
