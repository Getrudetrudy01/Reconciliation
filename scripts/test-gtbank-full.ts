import * as XLSX from "xlsx";
import { parseBankRows, parseLedgerRows } from "../src/lib/csv";
import { reconcile } from "../src/lib/reconcile";

function allSheetRows(path: string): unknown[][][] {
  const wb = XLSX.readFile(path, { cellDates: true });
  return wb.SheetNames.map((name) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null }),
  );
}

const LEDGER = process.argv[2];
const BANK = process.argv[3];

let ledger: ReturnType<typeof parseLedgerRows> = [];
for (const r of allSheetRows(LEDGER)) {
  const a = parseLedgerRows(r);
  if (a.length) {
    ledger = a;
    break;
  }
}

let bank: ReturnType<typeof parseBankRows> | null = null;
for (const r of allSheetRows(BANK)) {
  const a = parseBankRows(r);
  if (a.headerFound) {
    bank = a;
    break;
  }
}

console.log("ledger rows:", ledger.length, "| bank rows:", bank!.rows.length);
const out = reconcile(ledger, bank!.rows, 0.5, 0.02);
console.log("bucket counts:", out.summary.bucketCounts);
console.log("summary:", {
  matchedCount: out.summary.matchedCount,
  flaggedCount: out.summary.flaggedCount,
  mismatchValue: out.summary.mismatchValue,
});
