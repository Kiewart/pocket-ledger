/**
 * Date helpers.
 *
 * Transaction and rate dates are stored as `YYYY-MM-DD` calendar strings with
 * no time or zone attached. All month/year arithmetic here is therefore done
 * on plain integers and strings rather than on `Date` objects.
 *
 * This matters: a previous implementation built `YYYY-MM-01` at UTC midnight
 * and then formatted it in local time, which shifts the value by a day in
 * every timezone west of Greenwich. That silently dropped transactions
 * recorded on the first or last day of a month from the dashboard, budgets and
 * reports. Keep all calendar math zone-free.
 */

export type ISODate = string;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

/** Local calendar date as `YYYY-MM-DD`. */
export function toISODate(date: Date): ISODate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

/** Month key for the current local date, e.g. "2026-11". */
export function currentMonthKey(): string {
  return monthKey(todayISO());
}

/** Build a local `Date` at midday so DST transitions cannot shift the day. */
export function parseISODate(date: ISODate): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

export function isValidISODate(date: string): boolean {
  if (!ISO_DATE_PATTERN.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return false;
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(date.slice(0, 7));
}

/** `YYYY-MM` month key for a transaction date. */
export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Shift a month key by `delta` months (negative moves backwards). */
export function addMonthsToKey(monthKeyValue: string, delta: number): string {
  const [yearText, monthText] = monthKeyValue.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKeyValue;

  const absolute = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(absolute / 12);
  const newMonth = absolute - newYear * 12 + 1;
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`;
}

export function daysInMonth(monthKeyValue: string): number {
  const [yearText, monthText] = monthKeyValue.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 30;
  // Day 0 of the next month is the last day of this one. Only the day number
  // is read back, so no string is ever formatted through a timezone.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidMonthKey(value: string): boolean {
  if (!MONTH_KEY_PATTERN.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/** First and last calendar day of a month, inclusive. */
export function monthRange(monthKeyValue: string): { start: ISODate; end: ISODate } {
  const days = daysInMonth(monthKeyValue);
  return {
    start: `${monthKeyValue}-01`,
    end: `${monthKeyValue}-${String(days).padStart(2, '0')}`,
  };
}

/** First and last day of a calendar year, inclusive. */
export function yearRange(year: number): { start: ISODate; end: ISODate } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTH_ABBR = MONTH_NAMES.map((name) => name.slice(0, 3));
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const WEEKDAY_ABBR = WEEKDAY_NAMES.map((name) => name.slice(0, 3));

/**
 * Format a `YYYY-MM-DD` date using a small token set:
 * `yyyy`, `yy`, `MMMM`, `MMM`, `MM`, `M`, `dd`, `d`, `EEEE`, `EEE`.
 */
export function formatISODate(date: ISODate, pattern: string): string {
  if (!ISO_DATE_PATTERN.test(date)) return date;
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;

  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return pattern.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE/g, (token) => {
    switch (token) {
      case 'yyyy':
        return String(year);
      case 'yy':
        return String(year).slice(-2);
      case 'MMMM':
        return MONTH_NAMES[month - 1] ?? '';
      case 'MMM':
        return MONTH_ABBR[month - 1] ?? '';
      case 'MM':
        return String(month).padStart(2, '0');
      case 'M':
        return String(month);
      case 'dd':
        return String(day).padStart(2, '0');
      case 'd':
        return String(day);
      case 'EEEE':
        return WEEKDAY_NAMES[weekday] ?? '';
      case 'EEE':
        return WEEKDAY_ABBR[weekday] ?? '';
      default:
        return token;
    }
  });
}

/** Format a `YYYY-MM` key, e.g. `formatMonthKey('2026-03', 'MMMM yyyy')`. */
export function formatMonthKey(monthKeyValue: string, pattern = 'MMMM yyyy'): string {
  if (!MONTH_KEY_PATTERN.test(monthKeyValue)) return monthKeyValue;
  return formatISODate(`${monthKeyValue}-01`, pattern);
}

/** ISO week key, used for weekly grouping. */
export function weekKey(date: ISODate): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  const week = 1 + Math.round(diff / (7 * 86_400_000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Last `count` month keys ending at `end`, oldest first. */
export function lastMonthKeys(end: string, count: number): string[] {
  const keys: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    keys.push(addMonthsToKey(end, -index));
  }
  return keys;
}

/** Month keys between two dates, inclusive, oldest first. */
export function monthKeysBetween(start: string, end: string): string[] {
  const keys: string[] = [];
  let cursor = monthKey(start);
  const last = monthKey(end);
  let guard = 0;
  while (cursor <= last && guard < 1200) {
    keys.push(cursor);
    cursor = addMonthsToKey(cursor, 1);
    guard += 1;
  }
  return keys;
}

/** Every calendar day between two dates, inclusive. */
export function dateKeysBetween(start: ISODate, end: ISODate): ISODate[] {
  const keys: ISODate[] = [];
  if (start > end) return keys;
  let [year, month, day] = start.split('-').map(Number) as [number, number, number];
  let guard = 0;
  while (guard < 4000) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (key > end) break;
    keys.push(key);
    day += 1;
    if (day > daysInMonth(`${year}-${String(month).padStart(2, '0')}`)) {
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    guard += 1;
  }
  return keys;
}

/** Days from `a` to `b` (b − a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function yearOf(date: ISODate): number {
  return Number(date.slice(0, 4));
}
