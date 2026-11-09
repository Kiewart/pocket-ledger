/** CSV generation and download helpers. */

export type CsvCell = string | number | boolean | null | undefined;

/**
 * Escape one CSV cell for the given delimiter.
 *
 * A value is quoted when it contains the delimiter, a double quote, or a line
 * break. Embedded double quotes are doubled. Quoting is otherwise avoided so
 * the output stays readable and diff-friendly.
 */
export function escapeCsvValue(value: CsvCell, delimiter = ','): string {
  if (value === null || value === undefined) return '';
  const text = String(value);

  const needsQuoting =
    text.includes(delimiter) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r');

  if (!needsQuoting) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: CsvCell[][], delimiter = ','): string {
  return rows
    .map((row) => row.map((cell) => escapeCsvValue(cell, delimiter)).join(delimiter))
    .join('\r\n');
}

/** Trigger a browser download for generated text content. */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = 'text/csv;charset=utf-8',
): void {
  // A BOM keeps Excel from mangling non-ASCII payee names.
  const prefix = mime.startsWith('text/csv') ? '\uFEFF' : '';
  const blob = new Blob([prefix, content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
