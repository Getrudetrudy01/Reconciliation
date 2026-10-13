import type {
  Bucket,
  BankRow,
  LedgerRow,
  ReconcileOutput,
  ReconcileSummary,
  ResultRow,
} from "./types";
import { BUCKET_ORDER } from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Marker prefix on the `reason` of rows where the whole bank debit is at risk. */
export const CRITICAL_PREFIX = "CRITICAL:";

/**
 * Money exposed by a single Mismatched row.
 * - Critical rows (bank moved funds for a FAILED transaction): the full debit.
 * - Ordinary amount discrepancies: how far off the debit was.
 * Works from a stored row too — no fee or ledger status needed.
 */
export function mismatchExposure(r: {
  reason?: string | null;
  diff?: number | null;
  bankDebit?: number | null;
  ledgerAmount?: number | null;
}): number {
  if (r.reason?.startsWith(CRITICAL_PREFIX)) {
    return Math.abs(r.bankDebit ?? r.ledgerAmount ?? 0);
  }
  return Math.abs(r.diff ?? 0);
}

function emptyCounts(): Record<Bucket, number> {
  return BUCKET_ORDER.reduce(
    (acc, b) => ((acc[b] = 0), acc),
    {} as Record<Bucket, number>,
  );
}

export function summarizeRows(rows: ResultRow[], totalLedgerRows: number): ReconcileSummary {
  const bucketCounts = emptyCounts();
  for (const r of rows) bucketCounts[r.bucket]++;

  const mismatchValue = round2(
    rows.filter((r) => r.bucket === "Mismatched").reduce((s, r) => s + mismatchExposure(r), 0),
  );

  return {
    totalLedgerRows,
    matchedCount: bucketCounts.Matched,
    mismatchedCount: bucketCounts.Mismatched,
    flaggedCount: bucketCounts.Mismatched + bucketCounts.ReversedFlagged,
    mismatchValue,
    bucketCounts,
  };
}

/**
 * Reconcile an internal ledger against a parsed GTBank statement.
 * Join is on TransactionId; expected bank debit = ledger TotalAmount + fee,
 * matched within an absolute currency tolerance.
 */
export function reconcile(
  ledger: LedgerRow[],
  bank: BankRow[],
  feeAmount: number,
  tolerance: number,
): ReconcileOutput {
  const rows: ResultRow[] = [];

  const bankOther = bank.filter((b) => b.hasOther && b.transactionId);
  const bankChargeRows = bank.filter((b) => !b.hasOther || !b.transactionId);

  const bankByTxn = new Map<string, BankRow[]>();
  for (const b of bankOther) {
    const key = b.transactionId!;
    const arr = bankByTxn.get(key) ?? [];
    arr.push(b);
    bankByTxn.set(key, arr);
  }

  const claimed = new Set<string>();

  // ---- Ledger-driven pass -------------------------------------------------
  for (const l of ledger) {
    const txnId = l.transactionId;
    const group = txnId ? bankByTxn.get(txnId) ?? [] : [];
    if (txnId && group.length) claimed.add(txnId);

    const debitEntries = group.filter((b) => !b.isReversal && b.debit > 0);
    const reversalEntries = group.filter((b) => b.isReversal);
    const bankDebit = round2(debitEntries.reduce((s, b) => s + b.debit, 0));
    const hasBankDebit = debitEntries.length > 0;
    const hasReversal = reversalEntries.length > 0;
    const reversalOnly = !hasBankDebit && hasReversal;

    const expected = round2(l.totalAmount + feeAmount);
    const diff = round2(bankDebit - expected);
    const within = Math.abs(diff) <= tolerance;
    const status = l.transactionStatus;

    let bucket: Bucket;
    let reason: string;

    if (status === "FAILED") {
      if (hasBankDebit && hasReversal) {
        bucket = "ReversedExpected";
        reason = "FAILED transaction was debited then reversed — nets to zero, no action needed.";
      } else if (hasBankDebit) {
        bucket = "Mismatched";
        reason =
          "CRITICAL: bank debited for a FAILED transaction with no reversal — funds left the bank and were never clawed back.";
      } else {
        bucket = "FailedExcluded";
        reason = "FAILED and correctly never sent to the bank.";
      }
    } else {
      if (!hasBankDebit) {
        bucket = "LedgerOnly";
        reason = reversalOnly
          ? "Ledger shows a deposit but the bank has only a reversal entry, no matching debit."
          : "Ledger shows a deposit but no matching bank debit was found (possible ledger logging gap).";
      } else if (hasReversal) {
        bucket = "ReversedFlagged";
        reason =
          "CRITICAL: ledger shows success but the bank reversed the payout — the customer may not have been paid.";
      } else if (within) {
        bucket = "Matched";
        reason = "Bank debit matches ledger amount + fee within tolerance.";
      } else {
        bucket = "Mismatched";
        reason = `Bank debit ${bankDebit.toFixed(2)} is off by ${diff.toFixed(2)} vs expected ${expected.toFixed(
          2,
        )} (tolerance ${tolerance}).`;
      }
    }

    rows.push({
      bucket,
      date: l.date || null,
      walletTransactionId: l.walletTransactionId || null,
      transactionId: l.transactionId || null,
      customerName: l.name || null,
      ledgerAmount: l.totalAmount,
      bankDebit: hasBankDebit ? bankDebit : reversalOnly ? 0 : null,
      diff: hasBankDebit ? diff : null,
      reason,
      status: "Open",
    });
  }

  // ---- Bank-only pass ---------------------------------------------------
  for (const [txnId, group] of bankByTxn) {
    if (claimed.has(txnId)) continue;
    const debitEntries = group.filter((b) => !b.isReversal && b.debit > 0);
    const reversalEntries = group.filter((b) => b.isReversal);
    const bankDebit = round2(debitEntries.reduce((s, b) => s + b.debit, 0));
    const g0 = group[0];

    rows.push({
      bucket: "BankOnly",
      date: g0.transDate || null,
      walletTransactionId: g0.walletTransactionId || null,
      transactionId: txnId,
      customerName: null,
      ledgerAmount: null,
      bankDebit: debitEntries.length ? bankDebit : reversalEntries.length ? 0 : null,
      diff: null,
      reason:
        reversalEntries.length && !debitEntries.length
          ? "Bank has a reversal for this TransactionId with no matching ledger row."
          : "Bank debit with an EZIPAY2/OTHER reference that no ledger row claims (unreconciled bank movement).",
      status: "Open",
    });
  }

  // ---- Bank charges / other ------------------------------------------------
  for (const b of bankChargeRows) {
    if (b.debit === 0 && b.credit === 0) continue;
    rows.push({
      bucket: "BankCharges",
      date: b.transDate || null,
      walletTransactionId: null,
      transactionId: b.reference || null,
      customerName: null,
      ledgerAmount: null,
      bankDebit: b.debit || (b.credit ? -b.credit : null),
      diff: null,
      reason: b.remarks || "Bank charge / non-transaction movement.",
    });
  }

  return { rows, summary: summarizeRows(rows, ledger.length) };
}
