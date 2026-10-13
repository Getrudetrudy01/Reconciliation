import Papa from "papaparse";
import * as XLSX from "xlsx";
import { cellText } from "./cell";
import { parseNumber } from "./csv";
import type { ImtoRow, ZiggoRow } from "./types";

export interface SheetGrid {
  /** Originating file name — shown in parse feedback. */
  fileName: string;
  sheetName: string;
  rows: unknown[][];
}

/** True for a filename/type that looks like a binary spreadsheet (not CSV/text). */
export function isSpreadsheetFile(file: File): boolean {
  if (/\.xlsx?$/i.test(file.name)) return true;
  if (/\.csv$/i.test(file.name)) return false;
  if (/spreadsheet|ms-excel/i.test(file.type)) return true;
  // Unknown extension/type — default to CSV/text rather than guess binary.
  return false;
}

/**
 * Read every "sheet" of an uploaded file into a plain row-major grid.
 * Accepts a real workbook (.xlsx/.xls, every sheet) or a CSV file (a single
 * pseudo-sheet) — callers don't need to care which one they got.
 */
export async function readWorkbookSheets(file: File): Promise<SheetGrid[]> {
  if (!isSpreadsheetFile(file)) {
    const text = await file.text();
    const res = Papa.parse<unknown[]>(text, { header: false, skipEmptyLines: false });
    return [{ fileName: file.name, sheetName: file.name, rows: res.data as unknown[][] }];
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return wb.SheetNames.map((sheetName) => ({
    fileName: file.name,
    sheetName,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: null,
    }),
  }));
}

export type SheetKind = "ziggopay" | "imto" | "unknown";

/**
 * Identify a sheet by its header row rather than its name or position —
 * works whether both datasets arrive as two sheets in one workbook or as
 * the first sheet of two separate workbooks.
 */
export function classifySheet(rows: unknown[][]): { kind: SheetKind; headerIdx: number } {
  const scanLimit = Math.min(rows.length, 15);
  for (let i = 0; i < scanLimit; i++) {
    const header = (rows[i] ?? []).map((c) => cellText(c).toLowerCase());
    if (!header.some(Boolean)) continue;

    const looksZiggo =
      header.some((h) => h.startsWith("trans. id") || h.startsWith("trans id") || h === "trans.id") &&
      header.some((h) => h.includes("amt sent") || h.includes("amount"));
    if (looksZiggo) return { kind: "ziggopay", headerIdx: i };

    const looksImto =
      header.some((h) => h === "debit" || h.startsWith("debit")) &&
      header.some((h) => h === "credit" || h.startsWith("credit")) &&
      header.some((h) => h.includes("description") || h.includes("remarks"));
    if (looksImto) return { kind: "imto", headerIdx: i };
  }
  return { kind: "unknown", headerIdx: -1 };
}

/** Scan the letterhead above the header row for a "For the period X to Y" line. */
export function extractImtoPeriod(rows: unknown[][], headerIdx: number): string | null {
  const scanLimit = headerIdx >= 0 ? headerIdx : Math.min(rows.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const line = (rows[i] ?? []).map(cellText).join(" ");
    const m = line.match(/for the period\s+(.+?)\s+to\s+(.+?)\s*$/i);
    if (m) return `${m[1].trim()} to ${m[2].trim()}`;
  }
  return null;
}

function colIndex(header: string[], ...starts: string[]): number {
  for (const s of starts) {
    const i = header.findIndex((h) => h.startsWith(s));
    if (i >= 0) return i;
  }
  return -1;
}

export function extractZiggoRows(rows: unknown[][], headerIdx: number): ZiggoRow[] {
  const header = (rows[headerIdx] ?? []).map((c) => cellText(c).toLowerCase());
  const ci = {
    date: colIndex(header, "date"),
    status: colIndex(header, "status"),
    transId: colIndex(header, "trans. id", "trans id", "trans.id"),
    depositId: colIndex(header, "deposit"),
    amount: colIndex(header, "amt sent", "amount"),
  };

  const out: ZiggoRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const transId = ci.transId >= 0 ? cellText(r[ci.transId]) : "";
    // Skip footer/summary rows ("Grand Total", blank separators, etc.) —
    // a real Trans. ID is purely numeric.
    if (!transId || !/^\d+$/.test(transId)) continue;
    out.push({
      date: ci.date >= 0 ? cellText(r[ci.date]) : "",
      status: (ci.status >= 0 ? cellText(r[ci.status]) : "").toUpperCase(),
      transId,
      depositId: ci.depositId >= 0 ? cellText(r[ci.depositId]) : "",
      amount: ci.amount >= 0 ? parseNumber(r[ci.amount] as string | number) : 0,
    });
  }
  return out;
}

/**
 * A transaction identifier embedded in IMTO's free-text description.
 * ZiggoPay Trans. IDs are a timestamp: YYYY(20xx) MM DD + 10 more digits,
 * 18 characters. Matching that shape (not just "any long digit run") matters
 * because some reference codes (e.g. "PTNRMC2608181347250070C/...") place an
 * unrelated digit run *before* the real ID with no separator, and a plain
 * `\d{16,20}` greedily grabs the wrong one. Falls back to the loose pattern
 * for the rare row that doesn't fit the timestamp shape.
 */
const TRANS_ID_RE = /20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{10}/;
const TRANS_ID_FALLBACK_RE = /\d{16,20}/;

export function extractImtoRows(rows: unknown[][], headerIdx: number): ImtoRow[] {
  const header = (rows[headerIdx] ?? []).map((c) => cellText(c).toLowerCase());
  const ci = {
    date: colIndex(header, "date"),
    description: colIndex(header, "description", "remarks"),
    debit: colIndex(header, "debit"),
    credit: colIndex(header, "credit"),
  };

  const out: ImtoRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const description = ci.description >= 0 ? cellText(r[ci.description]) : "";
    const debit = ci.debit >= 0 ? parseNumber(r[ci.debit] as string | number) : 0;
    const credit = ci.credit >= 0 ? parseNumber(r[ci.credit] as string | number) : 0;
    if (!description && !debit && !credit) continue;

    const match = description.match(TRANS_ID_RE) ?? description.match(TRANS_ID_FALLBACK_RE);
    // NB: "COMM:" in this statement labels a transaction *category*, not a
    // bank fee — 66 of 67 COMM: debits exactly equal a real ZiggoPay amount
    // (confirmed against the live file), so it must go through normal
    // matching rather than being excluded. Only bulk settlement transfers
    // and the opening balance line are genuinely non-transaction rows.
    const isCharge = !match || /\bTRF\b/i.test(description) || /opening balance/i.test(description);

    out.push({
      date: ci.date >= 0 ? cellText(r[ci.date]) : "",
      description,
      debit,
      credit,
      transId: match ? match[0] : null,
      isCharge,
    });
  }
  return out;
}
