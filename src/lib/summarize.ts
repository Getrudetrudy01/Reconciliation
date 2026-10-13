import { summarizeRows } from "./reconcile";
import { summarizeImtoRows } from "./reconcile-imto";
import type { ReconcileSummary, ReconKind, ResultRow } from "./types";

/** Dispatch to the right engine's summarizer based on which produced the run. */
export function summarizeByKind(
  kind: ReconKind,
  rows: ResultRow[],
  totalLedgerRows: number,
): ReconcileSummary {
  return kind === "ZIGGOPAY_IMTO" ? summarizeImtoRows(rows, totalLedgerRows) : summarizeRows(rows, totalLedgerRows);
}
