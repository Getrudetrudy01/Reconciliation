import { readFileSync } from "node:fs";
import { parseBankCsv, parseLedgerCsv } from "../src/lib/csv";
import { reconcile } from "../src/lib/reconcile";

const BASE = process.env.BASE ?? "http://localhost:3111";

async function main() {
  const ledgerText = readFileSync(new URL("../samples/ledger.csv", import.meta.url), "utf8");
  const bankText = readFileSync(new URL("../samples/bank.csv", import.meta.url), "utf8");
  const bank = parseBankCsv(bankText);

  // Five runs with a drifting fee so mismatch value has shape (and rises at the end).
  const variants = [
    { name: "week-31", fee: 0.5 },
    { name: "week-32", fee: 0.5 },
    { name: "week-33", fee: 0.9 },
    { name: "week-34", fee: 2.5 },
    { name: "week-35", fee: 6.0 },
  ];

  for (const v of variants) {
    const ledger = parseLedgerCsv(ledgerText);
    const out = reconcile(ledger, bank.rows, v.fee, 0.02);

    const res = await fetch(`${BASE}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ledgerFileName: `MTO_${v.name}.csv`,
        bankFileName: `GTBank_${v.name}.csv`,
        statementPeriod: bank.statementPeriod,
        feeAmount: v.fee,
        tolerance: 0.02,
        totalLedgerRows: out.summary.totalLedgerRows,
        runBy: "Seed",
        rows: out.rows,
      }),
    });
    const body = await res.json();
    console.log(v.name, "->", res.status, body.id, "| mismatchValue", out.summary.mismatchValue);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
