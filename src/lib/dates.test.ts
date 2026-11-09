import { describe, expect, it } from 'vitest';
import {
  addMonthsToKey,
  currentMonthKey,
  dateKeysBetween,
  daysBetween,
  daysInMonth,
  formatISODate,
  formatMonthKey,
  isValidISODate,
  isValidMonthKey,
  lastMonthKeys,
  monthKey,
  monthKeysBetween,
  monthRange,
  parseISODate,
  toISODate,
  weekKey,
  yearRange,
} from './dates';

describe('monthRange', () => {
  it('covers the first and last day of a month', () => {
    expect(monthRange('2026-01')).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });

  it('handles 30-day months', () => {
    expect(monthRange('2026-04')).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('handles February in a common year', () => {
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('handles February in a leap year', () => {
    expect(monthRange('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(monthRange('2000-02')).toEqual({ start: '2000-02-01', end: '2000-02-29' });
  });

  it('handles the 1900 non-leap century year', () => {
    expect(monthRange('1900-02')).toEqual({ start: '1900-02-01', end: '1900-02-28' });
  });

  it('is independent of the machine timezone', () => {
    // A UTC-midnight date formatted in local time shifts by a day west of
    // Greenwich. These string values must be exact regardless of TZ.
    for (const key of ['2026-01', '2026-03', '2026-11', '2027-01']) {
      const range = monthRange(key);
      expect(range.start).toBe(`${key}-01`);
      expect(isValidISODate(range.start)).toBe(true);
      expect(isValidISODate(range.end)).toBe(true);
      expect(range.end.slice(0, 7)).toBe(key);
    }
  });
});

describe('addMonthsToKey', () => {
  it('moves forward and backward', () => {
    expect(addMonthsToKey('2026-01', 1)).toBe('2026-02');
    expect(addMonthsToKey('2026-01', -1)).toBe('2025-12');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonthsToKey('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToKey('2026-01', -1)).toBe('2025-12');
    expect(addMonthsToKey('2026-11', 14)).toBe('2028-01');
  });

  it('handles large deltas', () => {
    expect(addMonthsToKey('2026-06', 0)).toBe('2026-06');
    expect(addMonthsToKey('2026-06', 12 * 5)).toBe('2031-06');
    expect(addMonthsToKey('2026-06', -12 * 5)).toBe('2021-06');
  });
});

describe('daysInMonth', () => {
  it('knows month lengths', () => {
    expect(daysInMonth('2026-01')).toBe(31);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-12')).toBe(31);
  });
});

describe('isValidISODate', () => {
  it('accepts real dates', () => {
    expect(isValidISODate('2026-01-01')).toBe(true);
    expect(isValidISODate('2024-02-29')).toBe(true);
  });

  it('rejects impossible dates', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-04-31')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isValidISODate('')).toBe(false);
    expect(isValidISODate('2026-1-1')).toBe(false);
    expect(isValidISODate('01/01/2026')).toBe(false);
    expect(isValidISODate('yesterday')).toBe(false);
  });
});

describe('isValidMonthKey', () => {
  it('validates month keys', () => {
    expect(isValidMonthKey('2026-01')).toBe(true);
    expect(isValidMonthKey('2026-12')).toBe(true);
    expect(isValidMonthKey('2026-13')).toBe(false);
    expect(isValidMonthKey('2026-1')).toBe(false);
    expect(isValidMonthKey('')).toBe(false);
  });
});

describe('toISODate and parseISODate', () => {
  it('round-trips a local date', () => {
    const date = new Date(2026, 2, 14, 15, 30);
    expect(toISODate(date)).toBe('2026-03-14');
    const parsed = parseISODate('2026-03-14');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(14);
  });

  it('does not shift at midnight', () => {
    const lateEvening = new Date(2026, 0, 1, 23, 59, 59);
    expect(toISODate(lateEvening)).toBe('2026-01-01');
    const earlyMorning = new Date(2026, 0, 1, 0, 0, 1);
    expect(toISODate(earlyMorning)).toBe('2026-01-01');
  });
});

describe('formatISODate', () => {
  it('formats supported tokens', () => {
    expect(formatISODate('2026-03-14', 'dd MMM yyyy')).toBe('14 Mar 2026');
    expect(formatISODate('2026-03-14', 'yyyy-MM-dd')).toBe('2026-03-14');
    expect(formatISODate('2026-03-14', 'MM/dd/yyyy')).toBe('03/14/2026');
    expect(formatISODate('2026-03-14', 'dd/MM/yyyy')).toBe('14/03/2026');
    expect(formatISODate('2026-03-04', 'd MMMM')).toBe('4 March');
    expect(formatISODate('2026-03-14', 'EEEE')).toBe('Saturday');
    expect(formatISODate('2026-03-14', 'EEE')).toBe('Sat');
  });

  it('returns the input for invalid dates', () => {
    expect(formatISODate('nonsense', 'yyyy')).toBe('nonsense');
  });
});

describe('formatMonthKey', () => {
  it('formats month keys', () => {
    expect(formatMonthKey('2026-03', 'MMMM yyyy')).toBe('March 2026');
    expect(formatMonthKey('2026-03', 'MMM')).toBe('Mar');
    expect(formatMonthKey('2026-03', 'MM/yyyy')).toBe('03/2026');
  });

  it('defaults to month and year', () => {
    expect(formatMonthKey('2026-11')).toBe('November 2026');
  });
});

describe('monthKeysBetween', () => {
  it('includes both endpoint months', () => {
    expect(monthKeysBetween('2026-01-15', '2026-04-02')).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
  });

  it('handles a single month', () => {
    expect(monthKeysBetween('2026-01-01', '2026-01-31')).toEqual(['2026-01']);
  });

  it('throws no error on an inverted range', () => {
    expect(monthKeysBetween('2026-05-01', '2026-01-01')).toEqual([]);
  });
});

describe('dateKeysBetween', () => {
  it('enumerates every day', () => {
    const days = dateKeysBetween('2026-01-29', '2026-02-02');
    expect(days).toEqual(['2026-01-29', '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  });

  it('handles leap February', () => {
    const days = dateKeysBetween('2024-02-28', '2024-03-01');
    expect(days).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  });

  it('returns nothing for an inverted range', () => {
    expect(dateKeysBetween('2026-02-01', '2026-01-01')).toEqual([]);
  });
});

describe('daysBetween', () => {
  it('counts days forward and backward', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('spans month and year boundaries', () => {
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // leap year
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
  });
});

describe('lastMonthKeys', () => {
  it('returns the trailing window oldest first', () => {
    expect(lastMonthKeys('2026-03', 4)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
  });

  it('handles a count of one', () => {
    expect(lastMonthKeys('2026-03', 1)).toEqual(['2026-03']);
  });
});

describe('yearRange', () => {
  it('spans the whole year', () => {
    expect(yearRange(2026)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
});

describe('weekKey', () => {
  it('groups days into ISO weeks', () => {
    const monday = weekKey('2026-01-05');
    const friday = weekKey('2026-01-09');
    const nextMonday = weekKey('2026-01-12');
    expect(monday).toBe(friday);
    expect(monday).not.toBe(nextMonday);
  });
});

describe('monthKey', () => {
  it('extracts the month', () => {
    expect(monthKey('2026-03-14')).toBe('2026-03');
  });

  it('matches the current month key shape', () => {
    expect(currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });
});
