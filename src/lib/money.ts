/**
 * Decimal-safe money primitives.
 *
 * Pocket Ledger never stores or computes money as a JavaScript floating point
 * number. Every monetary amount is represented as an integer number of *minor
 * units* (cents, pence, yen, fils...) in a `bigint`. Conversion between
 * currencies uses integer rates stored with a fixed decimal scale, so the only
 * lossy step in the whole system is an explicit, documented rounding step.
 *
 * Rules:
 *  - `parseAmountToMinor` parses user input from its decimal *string* form.
 *  - All arithmetic is bigint.
 *  - Division rounds half-up, away from zero.
 */

export type Minor = bigint;

/** Number of decimal places used when storing an FX rate as a scaled bigint. */
export const RATE_SCALE_DECIMALS = 12;
export const RATE_SCALE = 10n ** BigInt(RATE_SCALE_DECIMALS);

export const ZERO: Minor = 0n;

export function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 18) {
    throw new RangeError(`Unsupported decimal exponent: ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

/**
 * Divide rounding half-up away from zero. This is the rounding mode used for
 * every currency conversion and for parsing amounts with excess precision.
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = a / b;
  const remainder = a % b;
  const rounded = remainder * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Parse a plain decimal string ("-1234.56") into minor units for `exponent`. */
export function parseAmountToMinor(input: string, exponent: number): Minor {
  const trimmed = input.trim();
  if (trimmed === '') throw new Error('Enter an amount');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) {
    throw new Error('Enter a valid amount');
  }

  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const [wholePart = '0', fractionPart = ''] = unsigned.split('.');
  const whole = wholePart === '' ? '0' : wholePart;
  const fraction = fractionPart;

  // Round the fraction at the currency's precision, half-up away from zero.
  const keep = fraction.slice(0, exponent).padEnd(exponent, '0');
  const dropped = fraction.slice(exponent);
  let minor = BigInt(whole + keep);
  if (dropped.length > 0) {
    const firstDropped = dropped[0];
    if (firstDropped >= '5') minor += 1n;
  }

  return negative ? -minor : minor;
}

/** Parse without throwing; returns null for invalid input. */
export function tryParseAmountToMinor(input: string, exponent: number): Minor | null {
  try {
    return parseAmountToMinor(input, exponent);
  } catch {
    return null;
  }
}

/** Exact decimal string for a minor amount, e.g. 12345 minor -> "123.45". */
export function minorToDecimalString(minor: Minor, exponent: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  if (exponent === 0) return `${negative ? '-' : ''}${abs}`;
  const scale = pow10(exponent);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(exponent, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Major units as a decimal string (no rounding). */
export function minorToMajorString(minor: Minor, exponent: number): string {
  return minorToDecimalString(minor, exponent);
}

/** Convert a major-unit decimal string into minor units. */
export function majorStringToMinor(value: string, exponent: number): Minor {
  return parseAmountToMinor(value, exponent);
}

export function addMinor(a: Minor, b: Minor): Minor {
  return a + b;
}

export function sumMinor(values: Minor[]): Minor {
  let total = ZERO;
  for (const value of values) total += value;
  return total;
}

export function absMinor(value: Minor): Minor {
  return value < 0n ? -value : value;
}

/** Multiply a minor amount by a scaled rate (`RATE_SCALE` == 1). */
export function multiplyMinorByScaled(minor: Minor, scaledFactor: bigint): Minor {
  return divRoundHalfUp(minor * scaledFactor, RATE_SCALE);
}

/**
 * Percentage of `part` within `whole`, expressed in basis points (1/100 of a
 * percent) so it stays an integer. Returns 0 when `whole` is zero.
 */
export function percentInBasisPoints(part: Minor, whole: Minor): number {
  if (whole === 0n) return 0;
  const bps = divRoundHalfUp(part * 10000n, absMinor(whole));
  return Number(bps);
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

interface CurrencyFormatParts {
  currency: string;
  group: string;
  decimal: string;
  prefix: string;
  suffix: string;
  /** Digits in the right-most group (e.g. 3 for en-US, 3 for en-IN). */
  primary: number;
  /** Digits in the groups to the left of the right-most group (e.g. 2 for en-IN). */
  secondary: number;
}

const formatCache = new Map<string, CurrencyFormatParts>();

function getFormatParts(locale: string, currency?: string): CurrencyFormatParts {
  const key = `${locale}|${currency ?? ''}`;
  const cached = formatCache.get(key);
  if (cached) return cached;

  const options: Intl.NumberFormatOptions = currency
    ? { style: 'currency', currency, currencyDisplay: 'symbol' }
    : { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 20 };
  const formatter = new Intl.NumberFormat(locale, options);
  const parts = formatter.formatToParts(1234567.89);

  let group = ',';
  let decimal = '.';
  let currencyText = '';
  let prefix = '';
  let suffix = '';

  // The numeric run can be split across several `integer` parts by grouping
  // separators, so anchor on the FIRST integer part for the prefix and the
  // LAST numeric part for the suffix.
  const firstIntegerIndex = parts.findIndex((part) => part.type === 'integer');
  let lastNumericIndex = -1;
  for (let index = 0; index < parts.length; index += 1) {
    const type = parts[index]!.type;
    if (type === 'integer' || type === 'fraction' || type === 'group' || type === 'decimal') {
      lastNumericIndex = index;
    }
  }

  for (const part of parts) {
    if (part.type === 'group') group = part.value;
    if (part.type === 'decimal') decimal = part.value;
    if (part.type === 'currency') currencyText = part.value;
  }

  if (firstIntegerIndex >= 0) {
    prefix = parts
      .slice(0, firstIntegerIndex)
      .map((part) => part.value)
      .join('');
    suffix =
      lastNumericIndex >= 0
        ? parts
            .slice(lastNumericIndex + 1)
            .map((part) => part.value)
            .join('')
        : '';
  }

  // Derive the grouping cycle from the digit groups of the sample value.
  const digitGroups: number[] = [];
  for (const part of parts) {
    if (part.type === 'integer' || part.type === 'fraction') {
      digitGroups.push(part.value.length);
    }
  }
  const resolved = formatter.resolvedOptions() as Intl.ResolvedNumberFormatOptions & {
    primaryGroupingDigits?: number;
  };
  const primary = resolved.primaryGroupingDigits ?? 3;
  let secondary = primary;
  if (digitGroups.length >= 2) {
    // The sample's left-most group is truncated, so read the group that sits
    // immediately left of the right-most one.
    secondary = digitGroups[digitGroups.length - 2];
  }

  const result: CurrencyFormatParts = {
    currency: currencyText,
    group,
    decimal,
    prefix,
    suffix,
    primary,
    secondary,
  };
  formatCache.set(key, result);
  return result;
}

/** Group an integer digit string using the locale's grouping cycle. */
function groupInteger(digits: string, parts: CurrencyFormatParts): string {
  const { primary, secondary, group } = parts;
  if (digits.length <= primary) return digits;

  const chunks: string[] = [];
  let cursor = digits.length;
  chunks.push(digits.slice(cursor - primary));
  cursor -= primary;
  while (cursor > 0) {
    const take = Math.min(secondary, cursor);
    chunks.unshift(digits.slice(cursor - take, cursor));
    cursor -= take;
  }
  return chunks.join(group);
}

export interface FormatMoneyOptions {
  exponent: number;
  currency?: string;
  locale?: string;
  /** Show a leading "+" for positive values. */
  showSign?: boolean;
  /** Return an empty string for zero amounts. */
  hideZero?: boolean;
}

/**
 * Format minor units for display. The number is rendered from its exact
 * integer digits, so no precision is lost to floating point conversion.
 */
export function formatMoney(minor: Minor, options: FormatMoneyOptions): string {
  const locale = options.locale ?? 'en-US';
  const parts = getFormatParts(locale, options.currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const exponent = options.exponent;

  if (options.hideZero && minor === 0n) return '';

  const scale = pow10(exponent);
  const whole = (abs / scale).toString();
  const fraction = (abs % scale).toString().padStart(exponent, '0');
  const groupedWhole = groupInteger(whole, parts);

  const numberText = exponent > 0 ? `${groupedWhole}${parts.decimal}${fraction}` : groupedWhole;
  const sign = negative ? '-' : options.showSign && minor > 0n ? '+' : '';

  return `${sign}${parts.prefix}${numberText}${parts.suffix}`;
}

/** Format a scaled bigint rate as a human readable decimal. */
export function formatScaledRate(scaled: bigint, locale = 'en-US', maxDecimals = 6): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = (abs / RATE_SCALE).toString();
  const fraction = (abs % RATE_SCALE).toString().padStart(RATE_SCALE_DECIMALS, '0');
  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '');
  const parts = getFormatParts(locale);
  const grouped = groupInteger(whole, parts);
  const text = trimmed.length > 0 ? `${grouped}${parts.decimal}${trimmed}` : grouped;
  return `${negative ? '-' : ''}${text}`;
}

/** Format a decimal rate string ("1.0892") for display. */
export function formatRateString(rate: string, locale = 'en-US', maxDecimals = 6): string {
  const scaled = parseRateStringToScaled(rate);
  if (scaled === null) return rate;
  return formatScaledRate(scaled, locale, maxDecimals);
}

/** Parse a decimal rate string into a scaled bigint (RATE_SCALE = 1e12). */
export function parseRateStringToScaled(rate: string): bigint | null {
  const trimmed = rate.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const keep = fraction.slice(0, RATE_SCALE_DECIMALS).padEnd(RATE_SCALE_DECIMALS, '0');
  const dropped = fraction.slice(RATE_SCALE_DECIMALS);
  let value = BigInt((whole === '' ? '0' : whole) + keep);
  if (dropped.length > 0 && dropped[0] >= '5') value += 1n;
  return negative ? -value : value;
}

/** Convert a scaled rate back into its canonical decimal string. */
export function scaledToRateString(scaled: bigint): string {
  return minorToDecimalString(scaled, RATE_SCALE_DECIMALS).replace(/0+$/, '').replace(/\.$/, '');
}
