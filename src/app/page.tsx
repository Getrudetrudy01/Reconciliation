import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader, StatCard } from "@/components/ui";
import { dateOnly, dateTime, money, pct } from "@/lib/format";
import { BUCKET_META, RECON_KINDS, TAXONOMIES, reconKindLabel, type Bucket, type ReconKind } from "@/lib/types";
import { mismatchExposure } from "@/lib/reconcile";
import DashboardCharts, { type RunPoint } from "@/components/DashboardCharts";

export const dynamic = "force-dynamic";

// The "needs serious attention, $ at risk" bucket, one per taxonomy.
const RISK_BUCKETS = ["Mismatched", "Investigate"];

export default async function DashboardPage() {
  const runs = await prisma.reconciliationRun.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      createdAt: true,
      totalLedgerRows: true,
      matchedCount: true,
      flaggedCount: true,
      rows: {
        where: { bucket: { in: RISK_BUCKETS } },
        select: { diff: true, bankDebit: true, ledgerAmount: true, reason: true },
      },
    },
  });

  const totalRuns = runs.length;
  const totalTransactions = runs.reduce((s, r) => s + r.totalLedgerRows, 0);

  const perRunMismatchValue = runs.map((r) =>
    r.rows.reduce((s, row) => s + mismatchExposure(row), 0),
  );
  const allTimeMismatchValue = perRunMismatchValue.reduce((s, v) => s + v, 0);

  const last = perRunMismatchValue[perRunMismatchValue.length - 1] ?? 0;
  const prev = perRunMismatchValue[perRunMismatchValue.length - 2] ?? 0;
  const increasing = totalRuns >= 2 ? last > prev + 0.001 : last > 0.001;

  const lastFive = [...runs].reverse().slice(0, 5);

  // --- chart series (most recent 12 runs, oldest → newest) -------------------
  const chartSource = runs.slice(-12);
  const runPoints: RunPoint[] = chartSource.map((r, i) => ({
    id: r.id,
    dateLabel: r.createdAt.toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
    fullDate: dateTime(r.createdAt),
    txns: r.totalLedgerRows,
    matchedPct: r.totalLedgerRows ? (r.matchedCount / r.totalLedgerRows) * 100 : 0,
    flagged: r.flaggedCount,
    mismatchValue: perRunMismatchValue[runs.length - chartSource.length + i] ?? 0,
  }));

  const latestRun = runs[runs.length - 1];
  const grouped = latestRun
    ? await prisma.reconciliationRow.groupBy({
        by: ["bucket"],
        where: { runId: latestRun.id },
        _count: { _all: true },
      })
    : [];
  const countByBucket = new Map(grouped.map((g) => [g.bucket as Bucket, g._count._all]));
  const latestKind: ReconKind = latestRun && RECON_KINDS.some((k) => k.value === latestRun.kind)
    ? (latestRun.kind as ReconKind)
    : "GTBANK";
  const latestBuckets = TAXONOMIES[latestKind].order.map((b) => ({
    label: BUCKET_META[b].label,
    count: countByBucket.get(b) ?? 0,
    tone: BUCKET_META[b].tone,
  }));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Reconciliation health across every saved run."
        action={
          <Link
            href="/reconcile"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            New reconciliation
          </Link>
        }
      />

      {totalRuns === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-sm text-slate-500">
            No reconciliation runs saved yet. Run your first one to populate the dashboard.
          </p>
          <Link
            href="/reconcile"
            className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            New reconciliation
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Saved runs" value={totalRuns} />
            <StatCard label="Transactions reconciled (all-time)" value={totalTransactions} />
            <StatCard
              label="Mismatch value (all-time)"
              value={money(allTimeMismatchValue)}
              tone={allTimeMismatchValue > 0 ? "critical" : "neutral"}
              hint={
                increasing ? (
                  <span className="font-medium text-red-600">▲ increasing — last run added {money(last)}</span>
                ) : (
                  <span className="text-slate-500">not increasing on the last run</span>
                )
              }
            />
            <StatCard
              label="Latest match rate"
              value={pct(lastFive[0].matchedCount, lastFive[0].totalLedgerRows)}
            />
          </div>

          <DashboardCharts
            runs={runPoints}
            latestBuckets={latestBuckets}
            latestRunLabel={dateTime(latestRun.createdAt)}
            increasing={increasing}
          />

          <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-700">Last 5 runs</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Transactions</th>
                  <th className="px-3 py-2 text-right font-medium">Matched %</th>
                  <th className="px-3 py-2 text-right font-medium">Flagged</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {lastFive.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600">{dateOnly(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                        {reconKindLabel(r.kind)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tnum text-slate-700">{r.totalLedgerRows}</td>
                    <td className="px-3 py-2 text-right tnum text-slate-700">
                      {pct(r.matchedCount, r.totalLedgerRows)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tnum ${
                        r.flaggedCount > 0 ? "font-medium text-red-600" : "text-slate-400"
                      }`}
                    >
                      {r.flaggedCount}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/history/${r.id}`} className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
