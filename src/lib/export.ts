import { BUCKET_META, type ResultRow } from "./types";

const HEADERS = [
  "Bucket",
  "Date",
  "WalletTransactionId",
  "TransactionId",
  "CustomerName",
  "LedgerAmount",
  "BankDebit",
  "Diff",
  "Reason",
  "ExceptionStatus",
  "ResolutionNote",
  "ResolvedBy",
];

function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: ResultRow[]): string {
  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        BUCKET_META[r.bucket].label,
        r.date,
        r.walletTransactionId,
        r.transactionId,
        r.customerName,
        r.ledgerAmount,
        r.bankDebit,
        r.diff,
        r.reason,
        r.status ?? "",
        r.resolutionNote ?? "",
        r.resolvedBy ?? "",
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
