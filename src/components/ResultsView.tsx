"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  BUCKET_META,
  EXCEPTION_STATUSES,
  TAXONOMIES,
  type Bucket,
  type ExceptionStatus,
  type ReconcileSummary,
  type ReconKind,
  type ResultRow,
} from "@/lib/types";
import { money, pct } from "@/lib/format";
import { BucketBadge, StatCard } from "@/components/ui";

type TabKey = "NeedsReview" | Bucket;

const STATUS_STYLE: Record<ExceptionStatus, string> = {
  Open: "bg-amber-50 text-amber-800 ring-amber-600/20",
  Investigating: "bg-blue-50 text-blue-700 ring-blue-600/20",
  Resolved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};

const NEEDS_REVIEW_BLURB: Record<ReconKind, string> = {
  GTBANK:
    "Every row that needs a human decision: amounts outside tolerance, money moved for failed transactions, and payouts the bank reversed.",
  ZIGGOPAY_IMTO:
    "Every ZiggoPay transaction missing from IMTO, found with a different amount, or an IMTO movement no ZiggoPay transaction claims (and no reversal found).",
};

function ageInDays(since: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000));
}

export default function ResultsView({
  rows,
  summary,
  toolbar,
  editable = false,
  runCreatedAt,
  kind = "GTBANK",
}: {
  rows: ResultRow[];
  summary: ReconcileSummary;
  toolbar?: ReactNode;
  /** Allow editing exception status/note/owner — only true for saved runs. */
  editable?: boolean;
  /** ISO date the run was created; drives the aging banner. */
  runCreatedAt?: string;
  /** Which engine produced these rows — picks the bucket taxonomy. */
  kind?: ReconKind;
}) {
  const taxonomy = TAXONOMIES[kind];
  const tabOrder = useMemo<TabKey[]>(() => ["NeedsReview", ...taxonomy.order], [taxonomy]);
  const tabLabel = useMemo<Record<TabKey, string>>(
    () => ({
      NeedsReview: "Needs review",
      ...(Object.fromEntries(taxonomy.order.map((b) => [b, BUCKET_META[b].label])) as Record<Bucket, string>),
    }),
    [taxonomy],
  );

  const [tab, setTab] = useState<TabKey>("NeedsReview");
  const [localRows, setLocalRows] = useState(rows);

  const byTab = useMemo(() => {
    const map = {} as Record<TabKey, ResultRow[]>;
    for (const key of tabOrder) map[key] = [];
    for (const r of localRows) {
      (map[r.bucket] ??= []).push(r);
      if (taxonomy.needsReview.includes(r.bucket)) map.NeedsReview.push(r);
    }
    return map;
  }, [localRows, tabOrder, taxonomy]);

  const visible = byTab[tab] ?? [];
  const matchRate = pct(summary.matchedCount, summary.totalLedgerRows);

  function patchRow(id: string, patch: Partial<ResultRow>) {
    setLocalRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const needsReviewOpen = byTab.NeedsReview.filter((r) => r.status !== "Resolved");
  const age = runCreatedAt ? ageInDays(runCreatedAt) : null;
  const needsReviewHint = taxonomy.needsReview.map((b) => BUCKET_META[b].label.toLowerCase()).join(" + ");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label={kind === "ZIGGOPAY_IMTO" ? "ZiggoPay rows" : "Ledger rows"} value={summary.totalLedgerRows} />
        <StatCard label="Matched" value={summary.matchedCount} hint={`${matchRate} of ledger`} tone="ok" />
        <StatCard
          label="Needs review"
          value={summary.flaggedCount}
          hint={needsReviewHint}
          tone={summary.flaggedCount > 0 ? "critical" : "neutral"}
        />
        <StatCard
          label={kind === "ZIGGOPAY_IMTO" ? "Investigate value" : "Mismatch value"}
          value={money(summary.mismatchValue)}
          tone={summary.mismatchValue > 0 ? "critical" : "neutral"}
        />
        {kind === "ZIGGOPAY_IMTO" ? (
          <StatCard
            label="Reversed"
            value={summary.bucketCounts.Reversed ?? 0}
            tone={(summary.bucketCounts.Reversed ?? 0) > 0 ? "warn" : "neutral"}
          />
        ) : (
          <StatCard
            label="Ledger / Bank only"
            value={`${summary.bucketCounts.LedgerOnly ?? 0} / ${summary.bucketCounts.BankOnly ?? 0}`}
            tone={
              (summary.bucketCounts.LedgerOnly ?? 0) + (summary.bucketCounts.BankOnly ?? 0) > 0
                ? "warn"
                : "neutral"
            }
          />
        )}
      </div>

      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}

      <div>
        <div className="flex flex-wrap gap-1 border-b border-slate-200">
          {tabOrder.map((key) => {
            const count = byTab[key]?.length ?? 0;
            const active = tab === key;
            const critical = key === "NeedsReview" || taxonomy.needsReview.includes(key as Bucket);
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {tabLabel[key]}
                <span
                  className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] tnum ${
                    count > 0 && critical
                      ? "bg-red-100 text-red-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {tab !== "NeedsReview" ? (
          <p className="px-1 pt-3 text-xs text-slate-500">{BUCKET_META[tab as Bucket].blurb}</p>
        ) : (
          <>
            <p className="px-1 pt-3 text-xs text-slate-500">{NEEDS_REVIEW_BLURB[kind]}</p>
            {age !== null && byTab.NeedsReview.length > 0 ? (
              <AgeBanner age={age} open={needsReviewOpen.length} total={byTab.NeedsReview.length} />
            ) : null}
          </>
        )}

        <ResultTable
          rows={visible}
          editable={editable}
          runCreatedAt={runCreatedAt}
          onPatched={patchRow}
          actionableBuckets={taxonomy.actionable}
        />
      </div>
    </div>
  );
}

function AgeBanner({ age, open, total }: { age: number; open: number; total: number }) {
  const style =
    age <= 7
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : age <= 30
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-red-200 bg-red-50 text-red-700";
  const word = age <= 7 ? "Flagged" : age <= 30 ? "Flagged — aging" : "Flagged — overdue";

  return (
    <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${style}`}>
      <span className="font-medium">
        {word} {age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}.
      </span>{" "}
      {open} of {total} still unresolved.
    </div>
  );
}

function ResultTable({
  rows,
  editable,
  runCreatedAt,
  onPatched,
  actionableBuckets,
}: {
  rows: ResultRow[];
  editable: boolean;
  runCreatedAt?: string;
  onPatched: (id: string, patch: Partial<ResultRow>) => void;
  actionableBuckets: Bucket[];
}) {
  const [openEditor, setOpenEditor] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
        No rows in this bucket.
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2 font-medium">Bucket</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Wallet Txn</th>
            <th className="px-3 py-2 font-medium">Transaction Id</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 text-right font-medium">Ledger</th>
            <th className="px-3 py-2 text-right font-medium">Bank debit</th>
            <th className="px-3 py-2 text-right font-medium">Diff</th>
            <th className="px-3 py-2 font-medium">Reason</th>
            {editable ? <th className="px-3 py-2 font-medium">Exception</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const actionable = editable && r.id && actionableBuckets.includes(r.bucket);
            const expanded = openEditor === r.id;
            return (
              <FragmentRow key={r.id ?? i}>
                <tr className="border-b border-slate-100 last:border-0 align-top hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <BucketBadge bucket={r.bucket} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.date ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">
                    {r.walletTransactionId ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.transactionId ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{r.customerName ?? "—"}</td>
                  <td className="px-3 py-2 text-right tnum text-slate-700">{money(r.ledgerAmount)}</td>
                  <td className="px-3 py-2 text-right tnum text-slate-700">{money(r.bankDebit)}</td>
                  <td
                    className={`px-3 py-2 text-right tnum ${
                      r.diff && Math.abs(r.diff) > 0.001 ? "font-medium text-red-600" : "text-slate-400"
                    }`}
                  >
                    {r.diff === null || r.diff === undefined ? "—" : money(r.diff)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.reason ?? "—"}</td>
                  {editable ? (
                    <td className="px-3 py-2">
                      {actionable ? (
                        <button
                          onClick={() => setOpenEditor(expanded ? null : r.id!)}
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                            STATUS_STYLE[r.status ?? "Open"]
                          }`}
                        >
                          {r.status ?? "Open"}
                          {r.resolutionNote ? " · note" : ""}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
                {expanded && r.id ? (
                  <tr className="border-b border-slate-100 bg-slate-50/60 last:border-0">
                    <td colSpan={editable ? 10 : 9} className="px-3 py-3">
                      <ExceptionEditor row={r} runCreatedAt={runCreatedAt} onSaved={(patch) => {
                        onPatched(r.id!, patch);
                        setOpenEditor(null);
                      }} onCancel={() => setOpenEditor(null)} />
                    </td>
                  </tr>
                ) : null}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// tbody can't nest a real <> around two <tr>s without this helper reading oddly —
// kept as a thin pass-through so each result row + its editor row stay paired.
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function ExceptionEditor({
  row,
  runCreatedAt,
  onSaved,
  onCancel,
}: {
  row: ResultRow;
  runCreatedAt?: string;
  onSaved: (patch: Partial<ResultRow>) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<ExceptionStatus>(row.status ?? "Open");
  const [note, setNote] = useState(row.resolutionNote ?? "");
  const [owner, setOwner] = useState(row.resolvedBy ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/rows/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolutionNote: note, resolvedBy: owner }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status}).`);
      }
      const saved = await res.json();
      onSaved({
        status: saved.status,
        resolutionNote: saved.resolutionNote,
        resolvedBy: saved.resolvedBy,
        resolvedAt: saved.resolvedAt,
      });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div>
        <label className="block text-xs font-medium text-slate-600">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ExceptionStatus)}
          className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {EXCEPTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {runCreatedAt ? (
          <p className="mt-1 text-[11px] text-slate-400">Flagged {ageInDays(runCreatedAt)}d ago</p>
        ) : null}
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">Resolved by</label>
        <input
          type="text"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="e.g. A. Mensah"
          className="mt-1 w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="min-w-[240px] flex-1">
        <label className="block text-xs font-medium text-slate-600">Note</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What did you find? What's the resolution?"
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col items-start gap-1 pt-5">
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:bg-slate-300"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
