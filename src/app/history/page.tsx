import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { dateTime, pct } from "@/lib/format";
import { reconKindLabel } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const { from, to } = searchParams;

  const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) where.createdAt = { ...where.createdAt, gte: d };
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      where.createdAt = { ...where.createdAt, lte: d };
    }
  }

  const runs = await prisma.reconciliationRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <PageHeader
        title="History"
        subtitle="Every saved reconciliation run."
        action={
          <Link
            href="/reconcile"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            New reconciliation
          </Link>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="block text-xs font-medium text-slate-600">From</label>
          <input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">To</label>
          <input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
          Filter
        </button>
        {(from || to) && (
          <Link href="/history" className="text-sm text-slate-500 hover:text-slate-800 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          No runs match. {from || to ? "Try widening the date range." : "Save a reconciliation to see it here."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Date run</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Ledger file</th>
                <th className="px-3 py-2 font-medium">Bank file</th>
                <th className="px-3 py-2 font-medium">Statement period</th>
                <th className="px-3 py-2 text-right font-medium">Txns</th>
                <th className="px-3 py-2 text-right font-medium">Matched</th>
                <th className="px-3 py-2 text-right font-medium">Flagged</th>
                <th className="px-3 py-2 font-medium">Run by</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    <Link href={`/history/${r.id}`} className="font-medium text-slate-800 hover:underline">
                      {dateTime(r.createdAt)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                      {reconKindLabel(r.kind)}
                    </span>
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-slate-600" title={r.ledgerFileName}>
                    {r.ledgerFileName}
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-slate-600" title={r.bankFileName}>
                    {r.bankFileName}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{r.statementPeriod ?? "—"}</td>
                  <td className="px-3 py-2 text-right tnum text-slate-700">{r.totalLedgerRows}</td>
                  <td className="px-3 py-2 text-right tnum text-slate-700">
                    {r.matchedCount}
                    <span className="ml-1 text-xs text-slate-400">
                      ({pct(r.matchedCount, r.totalLedgerRows)})
                    </span>
                  </td>
                  <td
                    className={`px-3 py-2 text-right tnum ${
                      r.flaggedCount > 0 ? "font-medium text-red-600" : "text-slate-400"
                    }`}
                  >
                    {r.flaggedCount}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.runBy ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Link
                      href={`/history/${r.id}`}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
                    >
                      Open
                    </Link>
                    <a
                      href={`/api/runs/${r.id}/export`}
                      className="ml-3 text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline"
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
