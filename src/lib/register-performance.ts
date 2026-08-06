import { formatDisplayDate } from "@/lib/booking";

export type PerformanceSale = {
  requestedDate?: string;
  checkoutAmountCents?: number;
  visitType?: string;
  source?: string;
};

export type PerformancePayout = {
  businessDate?: string;
  paidAmountCents?: number;
};

export type PerformancePeriod = {
  id: "day" | "week" | "month";
  label: string;
  rangeLabel: string;
  registerCents: number;
  payoutCents: number;
  completedCuts: number;
  appointments: number;
  walkIns: number;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function startOfWeek(today: string) {
  const date = parseIsoDate(today);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return isoDate(date);
}

export function performanceMonthStart(today: string) {
  const date = parseIsoDate(today);
  date.setUTCDate(1);
  return isoDate(date);
}

export function performanceRangeStart(today: string) {
  const monthStart = performanceMonthStart(today);
  const weekStart = startOfWeek(today);
  return weekStart < monthStart ? weekStart : monthStart;
}

function cents(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function isWalkIn(sale: PerformanceSale) {
  return sale.visitType === "walk-in" || sale.source === "walk-in";
}

export function buildPerformancePeriods(
  sales: PerformanceSale[],
  payouts: PerformancePayout[],
  today: string,
): PerformancePeriod[] {
  const ranges = [
    { id: "day" as const, label: "Today", start: today },
    { id: "week" as const, label: "This week", start: startOfWeek(today) },
    { id: "month" as const, label: "This month", start: performanceMonthStart(today) },
  ];

  return ranges.map(({ id, label, start }) => {
    const periodSales = sales.filter((sale) => {
      const date = String(sale.requestedDate ?? "");
      return date >= start && date <= today;
    });
    const periodPayouts = payouts.filter((payout) => {
      const date = String(payout.businessDate ?? "");
      return date >= start && date <= today;
    });
    const walkIns = periodSales.filter(isWalkIn).length;
    return {
      id,
      label,
      rangeLabel: start === today
        ? formatDisplayDate(today)
        : `${formatDisplayDate(start)} – ${formatDisplayDate(today)}`,
      registerCents: periodSales.reduce((total, sale) => total + cents(sale.checkoutAmountCents), 0),
      payoutCents: periodPayouts.reduce((total, payout) => total + cents(payout.paidAmountCents), 0),
      completedCuts: periodSales.length,
      appointments: periodSales.length - walkIns,
      walkIns,
    };
  });
}
