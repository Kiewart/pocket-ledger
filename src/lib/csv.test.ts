import { describe, expect, it } from 'vitest';
import { escapeCsvValue, toCsv } from './csv';

describe('escapeCsvValue', () => {
  it('leaves plain values alone', () => {
    expect(escapeCsvValue('hello')).toBe('hello');
    expect(escapeCsvValue(42)).toBe('42');
    expect(escapeCsvValue(0)).toBe('0');
  });

  it('renders null and undefined as empty', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
  });

  it('quotes values containing a comma', () => {
    expect(escapeCsvValue('Greenfield, Market')).toBe('"Greenfield, Market"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    expect(escapeCsvValue('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes values containing newlines', () => {
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvValue('line1\rline2')).toBe('"line1\rline2"');
  });

  it('preserves leading zeros and negative numbers as text', () => {
    expect(escapeCsvValue('007')).toBe('007');
    expect(escapeCsvValue('-12.34')).toBe('-12.34');
  });
});

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF', () => {
    const csv = toCsv([
      ['Date', 'Payee', 'Amount'],
      ['2026-01-15', 'Market', '12.34'],
    ]);
    expect(csv).toBe('Date,Payee,Amount\r\n2026-01-15,Market,12.34');
  });

  it('produces rows that parse back to the original cell count', () => {
    const rows = [
      ['Date', 'Payee', 'Amount', 'Currency'],
      ['2026-01-15', 'Greenfield, Market', '12.34', 'USD'],
      ['2026-01-16', 'Cafe "Nue"', '-5.00', 'EUR'],
      ['2026-01-17', 'Multi\nline', '9.99', 'GBP'],
    ];
    const csv = toCsv(rows);

    // Minimal RFC 4180 parser: enough to prove quoting round-trips.
    const parsed: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let index = 0; index < csv.length; index += 1) {
      const char = csv[index]!;
      if (inQuotes) {
        if (char === '"') {
          if (csv[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\r' && csv[index + 1] === '\n') {
        row.push(field);
        parsed.push(row);
        row = [];
        field = '';
        index += 1;
      } else {
        field += char;
      }
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      parsed.push(row);
    }

    expect(parsed).toEqual(rows);
  });

  it('supports a custom delimiter and escapes it', () => {
    const csv = toCsv(
      [
        ['a,b', 'c'],
        ['1', '2'],
      ],
      ';',
    );
    // The comma is not the delimiter here, so it needs no quoting.
    expect(csv).toBe('a,b;c\r\n1;2');
  });
});
