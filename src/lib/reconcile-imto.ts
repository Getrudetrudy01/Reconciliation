import {
  IMTO_BUCKET_ORDER,
  type Bucket,
  type ImtoRow,
  type ReconcileOutput,
  type ReconcileSummary,
  type ResultRow,
  type ZiggoRow,
} from "./types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A full ZiggoPay Trans. ID is a timestamp (YYYYMMDDHHMMSS) + 4 more digits. */
const FULL_ID_LEN = 18;
const TIMESTAMP_LEN = 14;

/** Pick the first not-yet-used debit entry whose amount agrees within tolerance. */
function pickDebit(group: ImtoRow[], amount: number, tolerance: number, used: Set<ImtoRow>) {
  return group.find((g) => g.debit > 0 && !used.has(g) && Math.abs(g.debit - amount) <= tolerance);
}

/** Pick the first not-yet-used credit entry that reverses a given debit amount. */
function pickReversingCredit(group: ImtoRow[], debitAmount: number, tolerance: number, used: Set<ImtoRow>) {
  return group.find((g) => g.credit > 0 && !used.has(g) && Math.abs(g.credit - debitAmount) <= tolerance);
}

/**
 * Fallback for when the exact Trans. ID isn't found anywhere in IMTO.
 * Some ZiggoPay Trans. ID values have lost their trailing 3-4 digits
 * upstream (confirmed against a real export: the corrupted ID always
 * shares the full date-to-the-second prefix and exact amount with a real,
 * otherwise-orphaned IMTO debit — consistent with a large integer having
 * passed through a floating-point representation before landing as text).
 * Only fires on an *unambiguous* single candidate — same 14-digit
 * timestamp prefix, an individual unused debit entry matching the amount,
 * not already fully claimed.
 */
function findFallbackMatch(
  z: ZiggoRow,
  byTid: Map<string, ImtoRow[]>,
  used: Set<ImtoRow>,
  tolerance: number,
): { tid: string; group: ImtoRow[]; debitRow: ImtoRow } | null {
  if (z.transId.length !== FULL_ID_LEN) return null;
  const prefix = z.transId.slice(0, TIMESTAMP_LEN);

  const candidates: { tid: string; group: ImtoRow[]; debitRow: ImtoRow }[] = [];
  for (const [tid, group] of byTid) {
    if (tid === z.transId || !tid.startsWith(prefix)) continue;
    const debitRow = pickDebit(group, z.amount, tolerance, used);
    if (debitRow) candidates.push({ tid, group, debitRow });
  }
  return candidates.length === 1 ? candidates[0] : null;
}

export function summarizeImtoRows(rows: ResultRow[], totalZiggoRows: number): ReconcileSummary {
  const bucketCounts = IMTO_BUCKET_ORDER.reduce(
    (acc, b) => ((acc[b] = 0), acc),
    {} as Record<Bucket, number>,
  );
  for (const r of rows) bucketCounts[r.bucket] = (bucketCounts[r.bucket] ?? 0) + 1;

  const investigateValue = round2(
    rows
      .filter((r) => r.bucket === "Investigate")
      .reduce((s, r) => s + Math.abs(r.diff ?? r.bankDebit ?? r.ledgerAmount ?? 0), 0),
  );

  return {
    totalLedgerRows: totalZiggoRows,
    matchedCount: bucketCounts.Matched ?? 0,
    mismatchedCount: bucketCounts.Investigate ?? 0,
    flaggedCount: bucketCounts.Investigate ?? 0,
    mismatchValue: investigateValue,
    bucketCounts,
  };
}

/**
 * Reconcile the ZiggoPay transaction list against the IMTO (Unity Link)
 * account statement. Rules, per the brief:
 *  1. Every ZiggoPay transaction must be found in IMTO.
 *  2. Found in IMTO -> Matched (amount must agree, within tolerance); not
 *     found, or found with a different amount -> Investigate. If the exact
 *     Trans. ID isn't found, try an unambiguous date+amount fallback first
 *     (see findFallbackMatch) before giving up as Investigate.
 *  3/5. An IMTO movement no ZiggoPay row claims -> Investigate...
 *  4. ...unless it has a same-amount reversing entry -> Reversed.
 * Non-transaction IMTO lines (bulk settlement transfers, opening balance)
 * are Excluded rather than flagged.
 *
 * Matching is per-*entry*, not per-key-sum: more than one IMTO row can
 * extract to the same Trans. ID (garbled/duplicate reference text), and
 * naively summing every debit under a shared key manufactures a fake
 * mismatch when only one of them is actually this transaction. Instead we
 * pick the specific entry whose amount agrees, and surface any leftover
 * entry under that same key as its own item rather than folding it in.
 */
export function reconcileImto(ziggo: ZiggoRow[], imto: ImtoRow[], tolerance: number): ReconcileOutput {
  const rows: ResultRow[] = [];

  const txnRows = imto.filter((r) => !r.isCharge && r.transId);
  const chargeRows = imto.filter((r) => r.isCharge);

  const byTid = new Map<string, ImtoRow[]>();
  for (const r of txnRows) {
    const arr = byTid.get(r.transId!) ?? [];
    arr.push(r);
    byTid.set(r.transId!, arr);
  }

  const used = new Set<ImtoRow>();

  // ---- ZiggoPay-driven pass (rules 1 & 2) --------------------------------
  for (const z of ziggo) {
    const group = byTid.get(z.transId) ?? [];

    let bucket: Bucket;
    let reason: string;
    let bankDebit: number | null = null;
    let diff: number | null = null;

    const matchedDebit = pickDebit(group, z.amount, tolerance, used);

    if (matchedDebit) {
      used.add(matchedDebit);
      const reversingCredit = pickReversingCredit(group, matchedDebit.debit, tolerance, used);
      bankDebit = matchedDebit.debit;
      if (reversingCredit) {
        used.add(reversingCredit);
        bucket = "Reversed";
        diff = round2(matchedDebit.debit - reversingCredit.credit);
        reason = `IMTO debited ${matchedDebit.debit.toFixed(2)} then credited back ${reversingCredit.credit.toFixed(2)} for this transaction — reversal.`;
      } else {
        bucket = "Matched";
        diff = round2(matchedDebit.debit - z.amount);
        reason = "ZiggoPay amount matches the IMTO debit.";
      }
    } else if (group.some((g) => !used.has(g))) {
      // This Trans. ID exists in IMTO, but no individual entry's amount
      // agrees with the ledger — a real discrepancy (or an unrelated entry
      // sharing a garbled key, reported rather than silently merged).
      const spareDebits = group.filter((g) => g.debit > 0 && !used.has(g));
      const spareCredits = group.filter((g) => g.credit > 0 && !used.has(g));
      if (spareDebits.length) {
        for (const d of spareDebits) used.add(d);
        const first = spareDebits[0];
        bankDebit = first.debit;
        diff = round2(first.debit - z.amount);
        bucket = "Investigate";
        reason =
          spareDebits.length === 1
            ? `Found in IMTO but the amount differs: IMTO debit ${first.debit.toFixed(2)} vs ZiggoPay amount ${z.amount.toFixed(2)}.`
            : `Found in IMTO under this Trans. ID, but ${spareDebits.length} separate debit entries exist (${spareDebits
                .map((d) => d.debit.toFixed(2))
                .join(", ")}) and none matches the ZiggoPay amount ${z.amount.toFixed(2)} — needs manual review.`;
      } else {
        for (const c of spareCredits) used.add(c);
        bankDebit = 0;
        bucket = "Investigate";
        reason = "Only a credit entry found in IMTO for this transaction — no debit.";
      }
    } else {
      const fallback = findFallbackMatch(z, byTid, used, tolerance);
      if (fallback) {
        used.add(fallback.debitRow);
        const reversingCredit = pickReversingCredit(fallback.group, fallback.debitRow.debit, tolerance, used);
        bankDebit = fallback.debitRow.debit;
        if (reversingCredit) {
          used.add(reversingCredit);
          bucket = "Reversed";
          diff = round2(fallback.debitRow.debit - reversingCredit.credit);
          reason = `Matched via date+amount fallback (ZiggoPay Trans. ID ${z.transId} vs IMTO ${fallback.tid} — exact ID likely truncated in the ZiggoPay export). IMTO debited ${fallback.debitRow.debit.toFixed(2)} then credited back ${reversingCredit.credit.toFixed(2)} — reversal.`;
        } else {
          bucket = "Matched";
          diff = round2(fallback.debitRow.debit - z.amount);
          reason = `Matched via date+amount fallback — exact Trans. ID differs (ZiggoPay: ${z.transId}, IMTO: ${fallback.tid}), likely truncated in the ZiggoPay export. Same second, same amount.`;
        }
      } else {
        bucket = "Investigate";
        reason = "ZiggoPay transaction not found anywhere in the IMTO statement.";
      }
    }

    rows.push({
      bucket,
      date: z.date || null,
      walletTransactionId: z.depositId || null,
      transactionId: z.transId || null,
      customerName: null,
      ledgerAmount: z.amount,
      bankDebit,
      diff,
      reason,
      status: "Open",
    });
  }

  // ---- IMTO-only pass (rules 3/4/5) --------------------------------------
  // Anything left over under a Trans. ID — whether that ID was never
  // referenced by a ZiggoPay row at all, or a ZiggoPay row claimed only
  // part of it (see the "spare" branch above).
  for (const [tid, group] of byTid) {
    const leftover = group.filter((g) => !used.has(g));
    if (leftover.length === 0) continue;
    const wasPartiallyClaimed = leftover.length < group.length;

    const debitEntries = leftover.filter((g) => g.debit > 0);
    const creditEntries = leftover.filter((g) => g.credit > 0);
    const debitSum = round2(debitEntries.reduce((s, g) => s + g.debit, 0));
    const creditSum = round2(creditEntries.reduce((s, g) => s + g.credit, 0));
    const g0 = leftover[0];

    let bucket: Bucket;
    let reason: string;
    const suffix = wasPartiallyClaimed
      ? " (a separate entry under a Trans. ID another ZiggoPay transaction already explained)"
      : "";
    if (debitEntries.length && creditEntries.length) {
      bucket = "Reversed";
      reason = `IMTO debited ${debitSum.toFixed(2)} then credited back ${creditSum.toFixed(2)} — reversal; no ZiggoPay row claims it${suffix}.`;
    } else {
      bucket = "Investigate";
      reason = `IMTO movement not claimed by any ZiggoPay transaction, and no reversing entry found${suffix}.`;
    }

    rows.push({
      bucket,
      date: g0.date || null,
      walletTransactionId: null,
      transactionId: tid,
      customerName: null,
      ledgerAmount: null,
      bankDebit: debitEntries.length ? debitSum : creditEntries.length ? -creditSum : null,
      diff: null,
      reason,
      status: "Open",
    });
  }

  // ---- Excluded (non-transaction lines) ----------------------------------
  for (const c of chargeRows) {
    if (!c.debit && !c.credit) continue;
    rows.push({
      bucket: "Excluded",
      date: c.date || null,
      walletTransactionId: null,
      transactionId: null,
      customerName: null,
      ledgerAmount: null,
      bankDebit: c.debit || (c.credit ? -c.credit : null),
      diff: null,
      reason: c.description || "Non-transaction IMTO line (bulk settlement transfer or opening balance).",
    });
  }

  return { rows, summary: summarizeImtoRows(rows, ziggo.length) };
}
