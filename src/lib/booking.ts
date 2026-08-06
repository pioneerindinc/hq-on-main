export function normalizeTime(time: string) {
  if (/^\d{2}:\d{2}$/.test(time)) return time;
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  if (match[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function displayTime(time: string) {
  const normalized = normalizeTime(time);
  if (!normalized) return time;
  const [hourText, minute] = normalized.split(":");
  const hour = Number(hourText);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${period}`;
}

export function generateHalfHourSlots(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  const slots: string[] = [];

  for (let minutes = startTotal; minutes < endTotal; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return slots;
}

export type DailyHours = {
  enabled?: unknown;
  start?: unknown;
  end?: unknown;
  breakEnabled?: unknown;
  breakStart?: unknown;
  breakEnd?: unknown;
};

export function isSlotDuringBreak(time: string, hours: DailyHours) {
  if (hours.breakEnabled !== true) return false;
  const slotStart = timeMinutes(normalizeTime(time));
  const breakStart = timeMinutes(normalizeTime(String(hours.breakStart ?? "")));
  const breakEnd = timeMinutes(normalizeTime(String(hours.breakEnd ?? "")));
  if (slotStart === null || breakStart === null || breakEnd === null || breakStart >= breakEnd) {
    return false;
  }
  const slotEnd = slotStart + 30;
  return slotStart < breakEnd && slotEnd > breakStart;
}

export function isTimeDuringBreak(time: string, hours: DailyHours) {
  if (hours.breakEnabled !== true) return false;
  const current = timeMinutes(normalizeTime(time));
  const breakStart = timeMinutes(normalizeTime(String(hours.breakStart ?? "")));
  const breakEnd = timeMinutes(normalizeTime(String(hours.breakEnd ?? "")));
  return (
    current !== null &&
    breakStart !== null &&
    breakEnd !== null &&
    breakStart < breakEnd &&
    current >= breakStart &&
    current < breakEnd
  );
}

export function isSlotWithinHours(time: string, hours: DailyHours) {
  const normalized = normalizeTime(time);
  if (hours.enabled !== true || !normalized) return false;
  return (
    generateHalfHourSlots(String(hours.start ?? ""), String(hours.end ?? "")).includes(normalized) &&
    !isSlotDuringBreak(normalized, hours)
  );
}

function timeMinutes(time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function dayNumber(date: string) {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 0 ? 7 : day;
}

export function defaultHours(dayOfWeek: number) {
  if (dayOfWeek === 7) return { enabled: false, start: "08:30", end: "14:00" };
  if (dayOfWeek === 6) return { enabled: true, start: "08:30", end: "14:00" };
  return { enabled: true, start: "08:30", end: "18:30" };
}

export function currentShopDateTime(
  timeZone = process.env.BARBERSHOP_TIME_ZONE || "America/Indiana/Indianapolis",
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function formatDisplayDate(value: string | Date | undefined | null) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return `${match[2]}/${match[3]}/${match[1]}`;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.BARBERSHOP_TIME_ZONE || "America/Indiana/Indianapolis",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(parsed);
}
