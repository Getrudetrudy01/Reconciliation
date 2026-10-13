import { readFileSync } from "node:fs";
import { parseBankCsv, parseLedgerCsv } from "../src/lib/csv";
import { reconcile } from "../src/lib/reconcile";

const ledger = parseLedgerCsv(readFileSync(new URL("../samples/ledger.csv", import.meta.url), "utf8"));
const bank = parseBankCsv(readFileSync(new URL("../samples/bank.csv", import.meta.url), "utf8"));

console.log("ledger rows:", ledger.length);
console.log("bank rows:", bank.rows.length, "| header found:", bank.headerFound);
console.log("statement period:", bank.statementPeriod);

const out = reconcile(ledger, bank.rows, 0.5, 0.02);
console.log("\nbucket counts:", out.summary.bucketCounts);
console.log("summary:", {
  totalLedgerRows: out.summary.totalLedgerRows,
  matchedCount: out.summary.matchedCount,
  mismatchedCount: out.summary.mismatchedCount,
  flaggedCount: out.summary.flaggedCount,
  mismatchValue: out.summary.mismatchValue,
});
console.log("\nrows:");
for (const r of out.rows) {
  console.log(
    [r.bucket.padEnd(16), (r.transactionId ?? "").padEnd(6), String(r.ledgerAmount ?? "").padEnd(9), String(r.bankDebit ?? "").padEnd(9), String(r.diff ?? "").padEnd(7), r.reason].join(" | "),
  );
}

const expected: Record<string, string> = {
  T001: "Matched",
  T002: "Mismatched",
  T003: "ReversedExpected",
  T004: "Mismatched",
  T005: "FailedExcluded",
  T006: "LedgerOnly",
  T007: "ReversedFlagged",
};
let ok = true;
for (const [txn, want] of Object.entries(expected)) {
  const got = out.rows.find((r) => r.transactionId === txn && r.bucket !== "BankOnly")?.bucket;
  if (got !== want) {
    ok = false;
    console.error(`MISMATCH ${txn}: expected ${want}, got ${got}`);
  }
}
const bankOnly = out.rows.filter((r) => r.bucket === "BankOnly").map((r) => r.transactionId);
const bankCharges = out.rows.filter((r) => r.bucket === "BankCharges").length;
if (JSON.stringify(bankOnly) !== JSON.stringify(["T900"])) {
  ok = false;
  console.error("BankOnly expected [T900], got", bankOnly);
}
if (bankCharges !== 2) {
  ok = false;
  console.error("BankCharges expected 2, got", bankCharges);
}
console.log("\n" + (ok ? "ALL ASSERTIONS PASSED" : "ASSERTIONS FAILED"));
process.exit(ok ? 0 : 1);
