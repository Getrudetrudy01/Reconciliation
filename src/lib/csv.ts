import Papa from "papaparse";
import { cellText } from "./cell";
import type { BankRow, LedgerRow } from "./types";

/** Strip thousands separators / currency noise and parse to a float. */
export function parseNumber(v: string | number | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  const cleaned = String(v).replace(/,/g, "").replace(/[^0-9.\-]/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function colIndex(header: string[], ...starts: string[]): number {
  for (const s of starts) {
    const i = header.findIndex((h) => h.startsWith(s));
    if (i >= 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Internal ledger
// ---------------------------------------------------------------------------

/** Parse ledger rows already read into a grid (CSV text or an Excel sheet — see xlsx.ts). */
export function parseLedgerRows(rows: unknown[][]): LedgerRow[] {
  const header = (rows[0] ?? []).map((c) => cellText(c).toLowerCase());
  const ci = {
    walletTransactionId: colIndex(header, "wallettransactionid"),
    transactionId: colIndex(header, "transactionid"),
    invoiceNo: colIndex(header, "invoiceno"),
    externalReference: colIndex(header, "external reference", "externalreference"),
    date: colIndex(header, "date"),
    time: colIndex(header, "time"),
    totalAmount: colIndex(header, "totalamount"),
    transactionType: colIndex(header, "transactiontype"),
    name: colIndex(header, "name", "customername"),
    accountNo: colIndex(header, "accountno"),
    transactionStatus: colIndex(header, "transactionstatus"),
    comments: colIndex(header, "comments"),
  };

  const get = (r: unknown[], idx: number) => (idx >= 0 ? cellText(r[idx]) : "");

  const out: LedgerRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const walletTransactionId = get(r, ci.walletTransactionId);
    const transactionId = get(r, ci.transactionId);
    if (!transactionId && !walletTransactionId) continue;
    out.push({
      walletTransactionId,
      transactionId,
      invoiceNo: get(r, ci.invoiceNo),
      externalReference: get(r, ci.externalReference),
      date: get(r, ci.date),
      time: get(r, ci.time),
      totalAmount: parseNumber(get(r, ci.totalAmount)),
      transactionType: get(r, ci.transactionType),
      name: get(r, ci.name),
      accountNo: get(r, ci.accountNo),
      transactionStatus: get(r, ci.transactionStatus).toUpperCase(),
      comments: get(r, ci.comments),
    });
  }
  return out;
}

/** CSV-text entry point (used by scripts that read a sample file directly). */
export function parseLedgerCsv(text: string): LedgerRow[] {
  const res = Papa.parse<unknown[]>(text, { header: false, skipEmptyLines: "greedy" });
  return parseLedgerRows(res.data as unknown[][]);
}

// ---------------------------------------------------------------------------
// GTBank statement
// ---------------------------------------------------------------------------

export interface BankParseResult {
  rows: BankRow[];
  statementPeriod: string | null;
  headerFound: boolean;
}

/** Parse bank-statement rows already read into a grid (CSV text or an Excel sheet). */
export function parseBankRows(raw: unknown[][]): BankParseResult {
  let headerIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    const first = cellText(raw[i]?.[0]).toLowerCase();
    if (first.startsWith("trans date")) {
      headerIdx = i;
      break;
    }
  }

  // Look for a "Period: X To Y" line in the letterhead block.
  let statementPeriod: string | null = null;
  const scanLimit = headerIdx >= 0 ? headerIdx : Math.min(raw.length, 40);
  for (let i = 0; i < scanLimit; i++) {
    const line = (raw[i] ?? []).map(cellText).join(" ");
    const m = line.match(/Period:\s*(.+?)\s+To\s+(.+?)\s*$/i);
    if (m) {
      statementPeriod = `${m[1].trim()} to ${m[2].trim()}`;
      break;
    }
  }

  if (headerIdx < 0) return { rows: [], statementPeriod, headerFound: false };

  const header = (raw[headerIdx] ?? []).map((h) => cellText(h).toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const ci = {
    transDate: col("trans date"),
    reference: col("reference"),
    valueDate: col("value date"),
    debit: col("debit"),
    credit: col("credit"),
    balance: col("balance"),
    remarks: col("remarks"),
  };

  const rows: BankRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.every((c) => cellText(c) === "")) continue;
    const remarks = ci.remarks >= 0 ? cellText(r[ci.remarks]) : "";
    const ids = parseRemarks(remarks);
    rows.push({
      transDate: ci.transDate >= 0 ? cellText(r[ci.transDate]) : "",
      reference: ci.reference >= 0 ? cellText(r[ci.reference]) : "",
      valueDate: ci.valueDate >= 0 ? cellText(r[ci.valueDate]) : "",
      debit: ci.debit >= 0 ? parseNumber(r[ci.debit] as string | number) : 0,
      credit: ci.credit >= 0 ? parseNumber(r[ci.credit] as string | number) : 0,
      balance: ci.balance >= 0 ? parseNumber(r[ci.balance] as string | number) : 0,
      remarks,
      ...ids,
    });
  }

  return { rows, statementPeriod, headerFound: true };
}

/** CSV-text entry point (used by scripts that read a sample file directly). */
export function parseBankCsv(text: string): BankParseResult {
  const res = Papa.parse<unknown[]>(text, { header: false, skipEmptyLines: false });
  return parseBankRows(res.data as unknown[][]);
}

/**
 * Remarks embed ledger identifiers:
 *   CREDITWALLET/EZIPAY2/OTHER/{WalletTransactionId}/{TransactionId}/**{timestamp}
 *   REV-CREDITWALLET/EZIPAY2/OTHER/...   (reversal)
 * Rows with no "OTHER" segment are not transactions (bank fees, SI-, COMM:, etc.).
 */
function parseRemarks(remarks: string): {
  isReversal: boolean;
  hasOther: boolean;
  walletTransactionId?: string;
  transactionId?: string;
} {
  const isReversal = /(^|\b)REV-?CREDITWALLET/i.test(remarks) || /^REV-/i.test(remarks.trim());
  const segments = remarks.split("/").map((s) => s.trim());
  const otherIdx = segments.findIndex((s) => s.toUpperCase() === "OTHER");
  const hasOther = otherIdx >= 0 && segments.length > otherIdx + 2;

  if (!hasOther) return { isReversal, hasOther: false };

  const clean = (s: string | undefined) =>
    (s ?? "").replace(/\*+.*$/, "").replace(/\*+/g, "").trim() || undefined;

  return {
    isReversal,
    hasOther: true,
    walletTransactionId: clean(segments[otherIdx + 1]),
    transactionId: clean(segments[otherIdx + 2]),
  };
}
