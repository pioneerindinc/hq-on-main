import { formatDisplayDate } from "@/lib/booking";

export type TotalsPeriod = "day" | "week" | "month";

export type BarberTotalsSale = {
  _id?: unknown;
  requestedDate?: string;
  requestedTime?: string;
  name?: string;
  service?: string;
  barber?: string;
  visitType?: string;
  source?: string;
  checkoutAmountCents?: number;
  commissionAmountCents?: number;
};

export type BarberTotalsPayout = {
  businessDate?: string;
  paidAmountCents?: number;
};

export type TotalsRange = {
  period: TotalsPeriod;
  anchor: string;
  start: string;
  end: string;
  rangeLabel: string;
  previousAnchor: string;
  nextAnchor: string;
};

export type BarberTotalsReport = TotalsRange & {
  registerCents: number;
  averageTicketCents: number;
  commissionEarnedCents: number;
  payoutCents: number;
  completedCuts: number;
  appointments: number;
  walkIns: number;
  days: Array<{
    date: string;
    registerCents: number;
    averageTicketCents: number;
    commissionEarnedCents: number;
    payoutCents: number;
    completedCuts: number;
    appointments: number;
    walkIns: number;
  }>;
  services: Array<{
    service: string;
    completedCuts: number;
    registerCents: number;
    commissionEarnedCents: number;
  }>;
  visits: BarberTotalsSale[];
};

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) return null;
  return date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value)!;
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function addMonths(value: string, months: number) {
  const date = parseIsoDate(value)!;
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  return isoDate(date);
}

function startOfWeek(value: string) {
  const date = parseIsoDate(value)!;
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return isoDate(date);
}

function startOfMonth(value: string) {
  const date = parseIsoDate(value)!;
  date.setUTCDate(1);
  return isoDate(date);
}

function endOfMonth(value: string) {
  const date = parseIsoDate(value)!;
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return isoDate(date);
}

export function normalizeTotalsPeriod(value?: string): TotalsPeriod {
  return value === "week" || value === "month" ? value : "day";
}

export function normalizeTotalsDate(value: string | undefined, today: string) {
  return value && parseIsoDate(value) && value <= today ? value : today;
}

export function totalsRange(period: TotalsPeriod, anchor: string): TotalsRange {
  const start = period === "week"
    ? startOfWeek(anchor)
    : period === "month"
      ? startOfMonth(anchor)
      : anchor;
  const end = period === "week"
    ? addDays(start, 6)
    : period === "month"
      ? endOfMonth(start)
      : anchor;
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(parseIsoDate(start)!);

  return {
    period,
    anchor,
    start,
    end,
    rangeLabel: period === "day"
      ? formatDisplayDate(start)
      : period === "month"
        ? monthLabel
        : `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`,
    previousAnchor: period === "day"
      ? addDays(anchor, -1)
      : period === "week"
        ? addDays(start, -7)
        : addMonths(start, -1),
    nextAnchor: period === "day"
      ? addDays(anchor, 1)
      : period === "week"
        ? addDays(start, 7)
        : addMonths(start, 1),
  };
}

function cents(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function isWalkIn(sale: BarberTotalsSale) {
  return sale.visitType === "walk-in" || sale.source === "walk-in" || sale.source === "pos-walk-in";
}

function sumSales(sales: BarberTotalsSale[]) {
  const walkIns = sales.filter(isWalkIn).length;
  const registerCents = sales.reduce((total, sale) => total + cents(sale.checkoutAmountCents), 0);
  return {
    registerCents,
    averageTicketCents: sales.length ? Math.round(registerCents / sales.length) : 0,
    commissionEarnedCents: sales.reduce((total, sale) => total + cents(sale.commissionAmountCents), 0),
    completedCuts: sales.length,
    appointments: sales.length - walkIns,
    walkIns,
  };
}

export function buildBarberTotalsReport(
  sales: BarberTotalsSale[],
  payouts: BarberTotalsPayout[],
  range: TotalsRange,
  today: string,
): BarberTotalsReport {
  const periodSales = sales.filter((sale) => {
    const date = sale.requestedDate ?? "";
    return date >= range.start && date <= range.end;
  });
  const periodPayouts = payouts.filter((payout) => {
    const date = payout.businessDate ?? "";
    return date >= range.start && date <= range.end;
  });
  const totals = sumSales(periodSales);
  const visibleEnd = range.end < today ? range.end : today;
  const days = [];
  for (let date = range.start; date <= visibleEnd; date = addDays(date, 1)) {
    const daySales = periodSales.filter((sale) => sale.requestedDate === date);
    const dayTotals = sumSales(daySales);
    days.push({
      date,
      ...dayTotals,
      payoutCents: periodPayouts
        .filter((payout) => payout.businessDate === date)
        .reduce((total, payout) => total + cents(payout.paidAmountCents), 0),
    });
  }

  const serviceMap = new Map<string, BarberTotalsSale[]>();
  for (const sale of periodSales) {
    const service = sale.service?.trim() || "Service not specified";
    serviceMap.set(service, [...(serviceMap.get(service) ?? []), sale]);
  }

  return {
    ...range,
    ...totals,
    payoutCents: periodPayouts.reduce((total, payout) => total + cents(payout.paidAmountCents), 0),
    days,
    services: [...serviceMap.entries()]
      .map(([service, serviceSales]) => ({ service, ...sumSales(serviceSales) }))
      .map(({ service, completedCuts, registerCents, commissionEarnedCents }) => ({
        service,
        completedCuts,
        registerCents,
        commissionEarnedCents,
      }))
      .sort((left, right) => right.completedCuts - left.completedCuts || left.service.localeCompare(right.service)),
    visits: [...periodSales].sort((left, right) =>
      `${right.requestedDate ?? ""} ${right.requestedTime ?? ""}`.localeCompare(`${left.requestedDate ?? ""} ${left.requestedTime ?? ""}`),
    ),
  };
}
