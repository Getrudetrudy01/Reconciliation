import * as XLSX from "xlsx";
import {
  classifySheet,
  extractImtoPeriod,
  extractImtoRows,
  extractZiggoRows,
} from "../src/lib/xlsx";
import { reconcileImto } from "../src/lib/reconcile-imto";

// Points at a real ZiggoPay/IMTO workbook, not checked into the repo. Run as:
//   FILE="C:\path\to\workbook.xlsx" npx tsx scripts/test-imto.ts
const FILE = process.env.FILE;
if (!FILE) {
  console.error('Set FILE to the path of a ZiggoPay/IMTO workbook, e.g.\n  FILE="C:\\path\\to\\workbook.xlsx" npx tsx scripts/test-imto.ts');
  process.exit(1);
}

function sheetsOf(path: string) {
  const wb = XLSX.readFile(path, { cellDates: true });
  return wb.SheetNames.map((name) => ({
    sheetName: name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null }),
  }));
}

const sheets = sheetsOf(FILE);
console.log("sheets found:", sheets.map((s) => s.sheetName));

let ziggo: ReturnType<typeof extractZiggoRows> | null = null;
let imto: ReturnType<typeof extractImtoRows> | null = null;
let period: string | null = null;

for (const s of sheets) {
  const { kind, headerIdx } = classifySheet(s.rows);
  console.log(`sheet "${s.sheetName}" -> ${kind} (header row ${headerIdx})`);
  if (kind === "ziggopay") ziggo = extractZiggoRows(s.rows, headerIdx);
  if (kind === "imto") {
    imto = extractImtoRows(s.rows, headerIdx);
    period = extractImtoPeriod(s.rows, headerIdx);
  }
}

if (!ziggo || !imto) throw new Error("Could not classify both sheets.");
console.log("\nziggo rows:", ziggo.length, "| imto rows:", imto.length, "| period:", period);

const out = reconcileImto(ziggo, imto, 0.01);
console.log("\nbucket counts:", out.summary.bucketCounts);
console.log("summary:", {
  totalLedgerRows: out.summary.totalLedgerRows,
  matchedCount: out.summary.matchedCount,
  mismatchedCount: out.summary.mismatchedCount,
  flaggedCount: out.summary.flaggedCount,
  mismatchValue: out.summary.mismatchValue,
});

console.log("\nsample Investigate rows:");
for (const r of out.rows.filter((r) => r.bucket === "Investigate").slice(0, 8)) {
  console.log(" ", r.transactionId, r.ledgerAmount, r.bankDebit, r.diff, "|", r.reason);
}
console.log("\nsample Reversed rows:");
for (const r of out.rows.filter((r) => r.bucket === "Reversed").slice(0, 8)) {
  console.log(" ", r.transactionId, r.ledgerAmount, r.bankDebit, r.diff, "|", r.reason);
}
console.log("\nsample Excluded rows:");
for (const r of out.rows.filter((r) => r.bucket === "Excluded").slice(0, 5)) {
  console.log(" ", r.bankDebit, "|", r.reason);
}

// Cross-check against the earlier manual analysis:
// 2248 ziggo rows, 67 with zero IMTO reference, ~2115 exact matches.
const neverReferenced = out.rows.filter(
  (r) => r.bucket === "Investigate" && r.reason?.includes("not found anywhere"),
).length;
console.log("\nZiggoPay rows never referenced in IMTO (expect 67):", neverReferenced);

const invRows = out.rows.filter((r) => r.bucket === "Investigate");
const exposure = (r: (typeof invRows)[number]) => Math.abs(r.diff ?? r.bankDebit ?? r.ledgerAmount ?? 0);
const sorted = [...invRows].sort((a, b) => exposure(b) - exposure(a));
console.log("\ntop 10 Investigate by exposure:");
for (const r of sorted.slice(0, 10)) {
  console.log(" ", r.transactionId, "ledger:", r.ledgerAmount, "bankDebit:", r.bankDebit, "diff:", r.diff, "|", r.reason);
}
console.log(
  "\nsum check:",
  invRows.reduce((s, r) => s + exposure(r), 0),
);
