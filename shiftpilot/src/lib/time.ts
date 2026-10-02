export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(utcMs: number, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second };
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const p = parts(utcMs, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(utcMs / 1000) * 1000;
}

/** Converts a local wall-clock date ("YYYY-MM-DD") and time ("HH:MM") in `tz` to epoch ms. */
export function localToUtcMs(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
}

export function localDateOf(utcMs: number, tz: string): string {
  const p = parts(utcMs, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function nextMonday(utcMs: number, tz: string): string {
  const today = localDateOf(utcMs, tz);
  return addDays(mondayOf(today), 7);
}

export function formatDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${DAY_SHORT[weekdayIndex(date)]} ${d} ${MONTH_SHORT[m - 1]}`;
}

export function shiftWindow(date: string, start: string, end: string, tz: string) {
  const startMs = localToUtcMs(date, start, tz);
  let endMs = localToUtcMs(date, end, tz);
  if (endMs <= startMs) endMs = localToUtcMs(addDays(date, 1), end, tz);
  return { startMs, endMs, hours: (endMs - startMs) / 3_600_000 };
}

/** Label with a relative-day hint so the decision model never has to do date arithmetic. */
export function relativeDayLabel(date: string, nowMs: number, tz: string): string {
  const today = localDateOf(nowMs, tz);
  if (date === today) return `today (${formatDate(date)})`;
  if (date === addDays(today, 1)) return `tomorrow (${formatDate(date)})`;
  if (date === addDays(today, -1)) return `yesterday (${formatDate(date)})`;
  return formatDate(date);
}

export function formatDateTime(utcMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(utcMs));
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 48) return m ? `${h}h ${m}m` : `${h}h`;
  return `${Math.round(h / 24)} days`;
}
