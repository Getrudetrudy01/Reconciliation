import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { summarizeByKind } from "@/lib/summarize";
import { RECON_KINDS, TAXONOMIES, type ReconKind, type ResultRow } from "@/lib/types";

export const dynamic = "force-dynamic";

interface SavePayload {
  kind?: ReconKind;
  ledgerFileName: string;
  bankFileName: string;
  statementPeriod?: string | null;
  feeAmount: number;
  tolerance: number;
  totalLedgerRows: number;
  runBy?: string | null;
  rows: ResultRow[];
}

export async function POST(req: Request) {
  let body: SavePayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body?.ledgerFileName || !body?.bankFileName || !Array.isArray(body.rows)) {
    return NextResponse.json(
      { error: "ledgerFileName, bankFileName and rows are required." },
      { status: 400 },
    );
  }

  const kind: ReconKind = RECON_KINDS.some((k) => k.value === body.kind) ? body.kind! : "GTBANK";
  const actionableBuckets = TAXONOMIES[kind].actionable;
  const summary = summarizeByKind(kind, body.rows, body.totalLedgerRows ?? 0);

  // Carry exception status forward: if an earlier run flagged the same
  // TransactionId (and it's still open/under investigation), keep its
  // status/note/owner instead of resetting to "Open" — so re-running a
  // reconciliation doesn't lose investigation context.
  const actionableTxnIds = [
    ...new Set(
      body.rows
        .filter((r) => actionableBuckets.includes(r.bucket) && r.transactionId)
        .map((r) => r.transactionId as string),
    ),
  ];

  const priorRows = actionableTxnIds.length
    ? await prisma.reconciliationRow.findMany({
        where: { transactionId: { in: actionableTxnIds } },
        select: {
          transactionId: true,
          status: true,
          resolutionNote: true,
          resolvedBy: true,
          resolvedAt: true,
          run: { select: { createdAt: true } },
        },
      })
    : [];

  // Keep only the most recent prior row per TransactionId.
  const priorByTxn = new Map<string, (typeof priorRows)[number]>();
  for (const p of priorRows) {
    if (!p.transactionId) continue;
    const existing = priorByTxn.get(p.transactionId);
    if (!existing || p.run.createdAt > existing.run.createdAt) {
      priorByTxn.set(p.transactionId, p);
    }
  }

  const run = await prisma.reconciliationRun.create({
    data: {
      kind,
      ledgerFileName: body.ledgerFileName,
      bankFileName: body.bankFileName,
      statementPeriod: body.statementPeriod || null,
      feeAmount: body.feeAmount,
      tolerance: body.tolerance,
      totalLedgerRows: summary.totalLedgerRows,
      matchedCount: summary.matchedCount,
      mismatchedCount: summary.mismatchedCount,
      flaggedCount: summary.flaggedCount,
      runBy: body.runBy?.trim() || null,
      rows: {
        create: body.rows.map((r) => {
          const carried =
            actionableBuckets.includes(r.bucket) && r.transactionId
              ? priorByTxn.get(r.transactionId)
              : undefined;
          return {
            bucket: r.bucket,
            date: r.date,
            walletTransactionId: r.walletTransactionId,
            transactionId: r.transactionId,
            customerName: r.customerName,
            ledgerAmount: r.ledgerAmount,
            bankDebit: r.bankDebit,
            diff: r.diff,
            reason: r.reason,
            status: carried?.status ?? "Open",
            resolutionNote: carried?.resolutionNote ?? null,
            resolvedBy: carried?.resolvedBy ?? null,
            resolvedAt: carried?.resolvedAt ?? null,
          };
        }),
      },
    },
    select: { id: true },
  });

  return NextResponse.json({ id: run.id }, { status: 201 });
}

export async function GET() {
  const runs = await prisma.reconciliationRun.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(runs);
}
