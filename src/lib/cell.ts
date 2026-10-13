/**
 * Shared cell-to-text coercion for row-array-based parsing (csv.ts and
 * xlsx.ts both work on `unknown[][]` grids, whether the source was an Excel
 * sheet — where a date cell arrives as a JS `Date` — or CSV text, where
 * everything is already a string).
 */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}
