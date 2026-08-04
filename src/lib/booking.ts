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

export function dayNumber(date: string) {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 0 ? 7 : day;
}

export function defaultHours(dayOfWeek: number) {
  if (dayOfWeek === 7) return { enabled: false, start: "08:30", end: "14:00" };
  if (dayOfWeek === 6) return { enabled: true, start: "08:30", end: "14:00" };
  return { enabled: true, start: "08:30", end: "18:30" };
}
