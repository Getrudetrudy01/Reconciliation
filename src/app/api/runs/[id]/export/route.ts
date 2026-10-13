import { prisma } from "@/lib/prisma";
import { rowsToCsv } from "@/lib/export";
import type { ResultRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const run = await prisma.reconciliationRun.findUnique({
    where: { id: params.id },
    include: { rows: true },
  });

  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  const rows: ResultRow[] = run.rows.map((r) => ({
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
  }));

  const stamp = run.createdAt.toISOString().slice(0, 10);
  const csv = rowsToCsv(rows);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reconciliation-${stamp}-${run.id.slice(0, 8)}.csv"`,
    },
  });
}
