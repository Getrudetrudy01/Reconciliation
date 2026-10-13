/**
 * Which reconciliation engine produced a run. Each kind has its own upload
 * format, matching rules, and bucket taxonomy — but shares the app shell
 * (upload → match → ResultsView → save → History → export → exceptions).
 */
export type ReconKind = "GTBANK" | "ZIGGOPAY_IMTO";
export const RECON_KINDS: { value: ReconKind; label: string; short: string }[] = [
  { value: "GTBANK", label: "Internal ledger ↔ GTBank statement (CSV)", short: "GTBank" },
  { value: "ZIGGOPAY_IMTO", label: "ZiggoPay ↔ IMTO (Excel)", short: "ZiggoPay ↔ IMTO" },
];

export function reconKindLabel(kind: string): string {
  return RECON_KINDS.find((k) => k.value === kind)?.short ?? kind;
}

export type Bucket =
  // GTBANK taxonomy
  | "Matched"
  | "Mismatched"
  | "ReversedFlagged"
  | "ReversedExpected"
  | "LedgerOnly"
  | "BankOnly"
  | "FailedExcluded"
  | "BankCharges"
  // ZIGGOPAY_IMTO taxonomy
  | "Reversed"
  | "Investigate"
  | "Excluded";

export const BUCKET_ORDER: Bucket[] = [
  "Matched",
  "Mismatched",
  "ReversedFlagged",
  "ReversedExpected",
  "LedgerOnly",
  "BankOnly",
  "FailedExcluded",
  "BankCharges",
];

/** Buckets that a human needs to act on. */
export const NEEDS_REVIEW_BUCKETS: Bucket[] = ["Mismatched", "ReversedFlagged"];

/**
 * Buckets that carry an exception workflow (status / note / resolved-by).
 * A superset of NEEDS_REVIEW_BUCKETS — Ledger only / Bank only also need a
 * human decision, they just aren't "critical" enough for the Needs Review tab.
 */
export const ACTIONABLE_BUCKETS: Bucket[] = ["Mismatched", "ReversedFlagged", "LedgerOnly", "BankOnly"];

export const IMTO_BUCKET_ORDER: Bucket[] = ["Matched", "Investigate", "Reversed", "Excluded"];
export const IMTO_NEEDS_REVIEW_BUCKETS: Bucket[] = ["Investigate"];
export const IMTO_ACTIONABLE_BUCKETS: Bucket[] = ["Investigate"];

export interface BucketTaxonomy {
  order: Bucket[];
  needsReview: Bucket[];
  actionable: Bucket[];
}

/** Everything ResultsView needs to render a run, keyed by which engine produced it. */
export const TAXONOMIES: Record<ReconKind, BucketTaxonomy> = {
  GTBANK: { order: BUCKET_ORDER, needsReview: NEEDS_REVIEW_BUCKETS, actionable: ACTIONABLE_BUCKETS },
  ZIGGOPAY_IMTO: {
    order: IMTO_BUCKET_ORDER,
    needsReview: IMTO_NEEDS_REVIEW_BUCKETS,
    actionable: IMTO_ACTIONABLE_BUCKETS,
  },
};

export type ExceptionStatus = "Open" | "Investigating" | "Resolved";
export const EXCEPTION_STATUSES: ExceptionStatus[] = ["Open", "Investigating", "Resolved"];

type Tone = "critical" | "warn" | "ok" | "neutral";

export const BUCKET_META: Record<Bucket, { label: string; tone: Tone; blurb: string }> = {
  Matched: {
    label: "Matched",
    tone: "ok",
    blurb: "Bank debit equals ledger amount + fee, within tolerance.",
  },
  Mismatched: {
    label: "Mismatched",
    tone: "critical",
    blurb:
      "Amount outside tolerance, or the bank moved money for a FAILED transaction with no reversal.",
  },
  ReversedFlagged: {
    label: "Reversed – needs check",
    tone: "critical",
    blurb: "Ledger shows success but the bank reversed the payout.",
  },
  ReversedExpected: {
    label: "Reversed – expected",
    tone: "neutral",
    blurb: "Failed transaction was debited then reversed — nets to zero.",
  },
  LedgerOnly: {
    label: "Ledger only",
    tone: "warn",
    blurb: "Recorded as DEPOSITED in the ledger, no matching bank debit found.",
  },
  BankOnly: {
    label: "Bank only",
    tone: "warn",
    blurb: "An EZIPAY2/OTHER bank movement that no ledger row claims.",
  },
  FailedExcluded: {
    label: "Failed – excluded",
    tone: "neutral",
    blurb: "Failed and correctly never sent to the bank.",
  },
  BankCharges: {
    label: "Bank charges / other",
    tone: "neutral",
    blurb: "Fees, SI-, COMM:, TRF B/O, MPGS — non-transaction movements.",
  },
  Reversed: {
    label: "Reversed",
    tone: "neutral",
    blurb: "IMTO shows a debit matched by a same-amount credit — nets to zero.",
  },
  Investigate: {
    label: "Investigate",
    tone: "critical",
    blurb:
      "A ZiggoPay transaction missing from IMTO, found with a different amount, or an IMTO movement no ZiggoPay transaction claims (and no reversal found).",
  },
  Excluded: {
    label: "Excluded (non-transaction)",
    tone: "neutral",
    blurb: "Bulk settlement transfers or the opening balance line — not a per-transaction row.",
  },
};

export interface LedgerRow {
  walletTransactionId: string;
  transactionId: string;
  invoiceNo: string;
  externalReference: string;
  date: string;
  time: string;
  totalAmount: number;
  transactionType: string;
  name: string;
  accountNo: string;
  transactionStatus: string; // DEPOSITED | FAILED
  comments: string;
}

export interface BankRow {
  transDate: string;
  reference: string;
  valueDate: string;
  debit: number;
  credit: number;
  balance: number;
  remarks: string;
  isReversal: boolean;
  hasOther: boolean;
  walletTransactionId?: string;
  transactionId?: string;
}

export interface ZiggoRow {
  date: string;
  status: string;
  transId: string;
  depositId: string;
  amount: number;
}

export interface ImtoRow {
  date: string;
  description: string;
  debit: number;
  credit: number;
  transId: string | null;
  /** Bulk settlement transfer or opening balance — not a per-transaction line. */
  isCharge: boolean;
}

export interface ResultRow {
  /** Only present once the row has been persisted (saved run). */
  id?: string;
  bucket: Bucket;
  date: string | null;
  walletTransactionId: string | null;
  transactionId: string | null;
  customerName: string | null;
  ledgerAmount: number | null;
  bankDebit: number | null;
  diff: number | null;
  reason: string | null;
  status?: ExceptionStatus;
  resolutionNote?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
}

export interface ReconcileSummary {
  totalLedgerRows: number;
  matchedCount: number;
  mismatchedCount: number;
  flaggedCount: number;
  mismatchValue: number;
  bucketCounts: Record<Bucket, number>;
}

export interface ReconcileOutput {
  rows: ResultRow[];
  summary: ReconcileSummary;
}
