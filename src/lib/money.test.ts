import { describe, expect, it } from 'vitest';
import {
  RATE_SCALE,
  divRoundHalfUp,
  formatMoney,
  formatScaledRate,
  minorToDecimalString,
  parseAmountToMinor,
  parseRateStringToScaled,
  percentInBasisPoints,
  scaledToRateString,
  sumMinor,
  tryParseAmountToMinor,
} from './money';

describe('parseAmountToMinor', () => {
  it('parses whole and fractional amounts exactly', () => {
    expect(parseAmountToMinor('12.34', 2)).toBe(1234n);
    expect(parseAmountToMinor('1234', 2)).toBe(123400n);
    expect(parseAmountToMinor('0.05', 2)).toBe(5n);
    expect(parseAmountToMinor('0', 2)).toBe(0n);
  });

  it('handles zero-decimal currencies', () => {
    expect(parseAmountToMinor('1500', 0)).toBe(1500n);
    expect(parseAmountToMinor('1500.4', 0)).toBe(1500n);
    expect(parseAmountToMinor('1500.5', 0)).toBe(1501n);
  });

  it('handles three-decimal currencies', () => {
    expect(parseAmountToMinor('1.234', 3)).toBe(1234n);
    expect(parseAmountToMinor('1.2345', 3)).toBe(1235n);
    expect(parseAmountToMinor('1.2344', 3)).toBe(1234n);
  });

  it('rounds half away from zero', () => {
    expect(parseAmountToMinor('1.005', 2)).toBe(101n);
    expect(parseAmountToMinor('1.004', 2)).toBe(100n);
    expect(parseAmountToMinor('-1.005', 2)).toBe(-101n);
    expect(parseAmountToMinor('-1.004', 2)).toBe(-100n);
  });

  it('never loses precision on the classic float traps', () => {
    // 0.1 + 0.2 !== 0.3 in floating point.
    expect(parseAmountToMinor('0.1', 2) + parseAmountToMinor('0.2', 2)).toBe(
      parseAmountToMinor('0.3', 2),
    );
    // 1.005 * 100 is 100.49999999999999 as a float.
    expect(parseAmountToMinor('1.005', 2)).toBe(101n);
    // 4.35 * 100 is 434.99999999999994 as a float.
    expect(parseAmountToMinor('4.35', 2)).toBe(435n);
    expect(parseAmountToMinor('123456789.99', 2)).toBe(12345678999n);
  });

  it('accepts leading + and rejects junk', () => {
    expect(parseAmountToMinor('+5.50', 2)).toBe(550n);
    expect(tryParseAmountToMinor('abc', 2)).toBeNull();
    expect(tryParseAmountToMinor('', 2)).toBeNull();
    expect(tryParseAmountToMinor('1,000.00', 2)).toBeNull();
    expect(tryParseAmountToMinor('1.2.3', 2)).toBeNull();
    expect(() => parseAmountToMinor('', 2)).toThrow();
  });
});

describe('minorToDecimalString', () => {
  it('round-trips amounts', () => {
    expect(minorToDecimalString(1234n, 2)).toBe('12.34');
    expect(minorToDecimalString(-1234n, 2)).toBe('-12.34');
    expect(minorToDecimalString(5n, 2)).toBe('0.05');
    expect(minorToDecimalString(1500n, 0)).toBe('1500');
    expect(minorToDecimalString(1234n, 3)).toBe('1.234');
  });

  it('round-trips every amount through parse', () => {
    for (const amount of ['0.01', '99.99', '1000000.00', '-45.60', '7.00']) {
      const minor = parseAmountToMinor(amount, 2);
      expect(minorToDecimalString(minor, 2)).toBe(
        amount.startsWith('-') ? amount : amount.includes('.') ? amount : `${amount}.00`,
      );
    }
  });
});

describe('divRoundHalfUp', () => {
  it('rounds halves away from zero', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divRoundHalfUp(1n, 3n)).toBe(0n);
    expect(divRoundHalfUp(2n, 3n)).toBe(1n);
  });

  it('throws on division by zero', () => {
    expect(() => divRoundHalfUp(1n, 0n)).toThrow();
  });

  it('keeps large values exact beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    expect(divRoundHalfUp(huge * 2n, 2n)).toBe(huge);
  });
});

describe('sumMinor', () => {
  it('sums without floating point drift', () => {
    const values = Array.from({ length: 1000 }, () => parseAmountToMinor('0.01', 2));
    expect(sumMinor(values)).toBe(1000n); // exactly 10.00
    expect(minorToDecimalString(sumMinor(values), 2)).toBe('10.00');
  });
});

describe('rate string handling', () => {
  it('parses a decimal rate into the fixed scale', () => {
    expect(parseRateStringToScaled('1.0892')).toBe(1_089_200_000_000n);
    expect(parseRateStringToScaled('0.5')).toBe(500_000_000_000n);
    expect(parseRateStringToScaled('158.33')).toBe(158_330_000_000_000n);
  });

  it('round-trips rates', () => {
    for (const rate of ['1.0892', '0.85415', '158.46', '0.000001']) {
      const scaled = parseRateStringToScaled(rate);
      expect(scaled).not.toBeNull();
      expect(scaledToRateString(scaled!)).toBe(String(Number(rate)));
    }
  });

  it('formats scaled rates', () => {
    expect(formatScaledRate(RATE_SCALE)).toBe('1');
    expect(formatScaledRate(1_089_200_000_000n)).toBe('1.0892');
  });

  it('rejects invalid rate strings', () => {
    expect(parseRateStringToScaled('abc')).toBeNull();
    expect(parseRateStringToScaled('')).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats with the currency symbol and grouping', () => {
    expect(formatMoney(123_456_780n, { exponent: 2, currency: 'USD', locale: 'en-US' })).toBe(
      '$1,234,567.80',
    );
    expect(formatMoney(-1234_50n, { exponent: 2, currency: 'USD', locale: 'en-US' })).toBe(
      '-$1,234.50',
    );
  });

  it('respects zero-decimal currencies', () => {
    expect(formatMoney(158460n, { exponent: 0, currency: 'JPY', locale: 'en-US' })).toBe(
      '¥158,460',
    );
  });

  it('respects three-decimal currencies', () => {
    // Some locales separate the code from the digits with a non-breaking space.
    const normalize = (value: string) => value.replace(/\u00a0/g, ' ').replace(/\u202f/g, ' ');
    expect(
      normalize(formatMoney(1234n, { exponent: 3, currency: 'KWD', locale: 'en-US' })),
    ).toBe('KWD 1.234');
  });

  it('supports explicit signs', () => {
    expect(formatMoney(500n, { exponent: 2, currency: 'USD', showSign: true })).toBe('+$5.00');
    expect(formatMoney(-500n, { exponent: 2, currency: 'USD', showSign: true })).toBe('-$5.00');
  });

  it('formats very large amounts exactly', () => {
    const huge = 9_007_199_254_740_993_00n;
    expect(formatMoney(huge, { exponent: 2, locale: 'en-US' })).toBe('9,007,199,254,740,993.00');
  });
});

describe('percentInBasisPoints', () => {
  it('computes integer basis points', () => {
    expect(percentInBasisPoints(50n, 100n)).toBe(5000);
    expect(percentInBasisPoints(1n, 3n)).toBe(3333);
    expect(percentInBasisPoints(0n, 0n)).toBe(0);
  });
});
