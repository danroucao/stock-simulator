// Snapshot: TWSE 115-year official holidaySchedule, checked 2026-10-09.
// Source: https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&queryYear=115
export const calendarYears = [2026];
const closed = new Set([
  '2026-01-01', '2026-02-12', '2026-02-13', '2026-02-15', '2026-02-16',
  '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-27', '2026-02-28',
  '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06', '2026-05-01', '2026-06-19',
  '2026-09-25', '2026-09-28', '2026-10-09', '2026-10-10', '2026-10-25', '2026-10-26', '2026-12-25',
]);
export function isTradingDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !closed.has(value);
}
export function hasTradingCalendar(value: string): boolean { return calendarYears.includes(Number(value.slice(0, 4))); }
export function latestTradingDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
  for (let offset = 0; offset < 366; offset++) {
    const candidate = date.toISOString().slice(0, 10);
    if (isTradingDate(candidate)) return candidate;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return value;
}
