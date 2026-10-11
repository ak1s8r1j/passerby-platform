/**
 * One cell of a CSV file. Quotes are doubled, and a cell that starts with `=`, `+`, `-` or `@` (or a tab or
 * return) gets a `'` in front, because spreadsheet programs run such a cell as a formula, which someone
 * could use to attack whoever opens the export.
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (cells: (string | number)[]): string => cells.map(csvCell).join(",") + "\r\n";
