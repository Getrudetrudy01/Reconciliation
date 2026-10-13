import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { summarizeByKind } from "@/lib/summarize";
import { RECON_KINDS, type ReconKind, type ResultRow } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import ResultsView from "@/components/ResultsView";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const run = await prisma.reconciliationRun.findUnique({
    where: { id: params.id },
    include: { rows: true },
  });

  if (!run) notFound();

  const kind: ReconKind = RECON_KINDS.some((k) => k.value === run.kind) ? (run.kind as ReconKind) : "GTBANK";

  const rows: ResultRow[] = run.rows.map((r) => ({
    id: r.id,
    bucket: r.bucket as ResultRow["bucket"],
    date: r.date,
    walletTransactionId: r.walletTransactionId,
    transactionId: r.transactionId,
    customerName: r.customerName,
    ledgerAmount: r.ledgerAmount,
    bankDebit: r.bankDebit,
    diff: r.diff,
    reason: r.reason,
    status: r.status as ResultRow["status"],
    resolutionNote: r.resolutionNote,
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));

  const summary = summarizeByKind(kind, rows, run.totalLedgerRows);

  return (
    <div>
      <PageHeader
        title={`Run · ${dateTime(run.createdAt)}`}
        subtitle="Reconstructed from saved row-level data. Exceptions below are editable — the match itself isn't."
        action={
          <div className="flex gap-2">
            <a
              href={`/api/runs/${run.id}/export`}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download CSV
            </a>
            <Link
              href="/history"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to history
            </Link>
          </div>
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3">
        <Meta label="Type" value={RECON_KINDS.find((k) => k.value === kind)?.label ?? kind} />
        <Meta label={kind === "ZIGGOPAY_IMTO" ? "ZiggoPay file" : "Ledger file"} value={run.ledgerFileName} mono />
        <Meta label={kind === "ZIGGOPAY_IMTO" ? "IMTO file" : "Bank file"} value={run.bankFileName} mono />
        <Meta label="Statement period" value={run.statementPeriod ?? "—"} />
        {kind === "ZIGGOPAY_IMTO" ? null : <Meta label="Fee amount" value={run.feeAmount.toFixed(2)} />}
        <Meta label="Tolerance" value={run.tolerance.toString()} />
        <Meta label="Run by" value={run.runBy ?? "—"} />
      </dl>

      <ResultsView rows={rows} summary={summary} editable runCreatedAt={run.createdAt.toISOString()} kind={kind} />
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-slate-800 ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
