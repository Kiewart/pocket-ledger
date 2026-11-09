/**
 * Pure rate arithmetic. No I/O here — see `src/lib/fx.ts` for the database
 * backed rate resolution.
 */

import {
  RATE_SCALE,
  divRoundHalfUp,
  parseRateStringToScaled,
  pow10,
  type Minor,
} from './money';

/** Multiply two scaled rates: (a * b) / RATE_SCALE. */
export function multiplyScaledRates(a: bigint, b: bigint): bigint {
  return divRoundHalfUp(a * b, RATE_SCALE);
}

/** Invert a scaled rate: RATE_SCALE^2 / rate. */
export function invertScaledRate(rate: bigint): bigint {
  if (rate === 0n) throw new RangeError('Cannot invert a zero rate');
  return divRoundHalfUp(RATE_SCALE * RATE_SCALE, rate);
}

/**
 * Convert an amount expressed in minor units of `fromExp` into minor units of
 * `toExp` using a scaled rate (1.0 == RATE_SCALE).
 *
 *   majorTo = majorFrom * rate
 *   minorTo = minorFrom * rate * 10^toExp / 10^fromExp
 */
export function convertMinorWithRate(
  amount: Minor,
  fromExp: number,
  toExp: number,
  scaledRate: bigint,
): Minor {
  const numerator = amount * scaledRate * pow10(toExp);
  const denominator = RATE_SCALE * pow10(fromExp);
  return divRoundHalfUp(numerator, denominator);
}

/** Build a scaled rate from its decimal string form. */
export function scaledRateFromString(rate: string): bigint {
  const parsed = parseRateStringToScaled(rate);
  if (parsed === null) throw new Error(`Invalid rate: ${rate}`);
  return parsed;
}

/** True when two scaled rates are equal within 1e-9 relative tolerance. */
export function ratesEqual(a: bigint, b: bigint): boolean {
  const tolerance = RATE_SCALE / 1_000_000_000n;
  const diff = a > b ? a - b : b - a;
  return diff <= tolerance;
}

/** Days between two `YYYY-MM-DD` dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
