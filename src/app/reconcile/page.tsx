"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseBankRows, parseLedgerRows } from "@/lib/csv";
import { reconcile } from "@/lib/reconcile";
import { reconcileImto } from "@/lib/reconcile-imto";
import { downloadCsv, rowsToCsv } from "@/lib/export";
import {
  classifySheet,
  extractImtoPeriod,
  extractImtoRows,
  extractZiggoRows,
  readWorkbookSheets,
  type SheetKind,
} from "@/lib/xlsx";
import {
  RECON_KINDS,
  type BankRow,
  type ImtoRow,
  type LedgerRow,
  type ReconcileOutput,
  type ReconKind,
  type ZiggoRow,
} from "@/lib/types";
import { PageHeader } from "@/components/ui";
import ResultsView from "@/components/ResultsView";

interface LedgerState {
  fileName: string;
  rows: LedgerRow[];
}
interface BankState {
  fileName: string;
  rows: BankRow[];
  statementPeriod: string | null;
  headerFound: boolean;
}
interface ZiggoState {
  source: string;
  rows: ZiggoRow[];
}
interface ImtoState {
  source: string;
  rows: ImtoRow[];
  period: string | null;
}
interface SheetReportRow {
  fileName: string;
  sheetName: string;
  kind: SheetKind;
  rowCount: number;
}

export default function ReconcilePage() {
  const router = useRouter();
  const [kind, setKind] = useState<ReconKind>("GTBANK");

  // --- GTBank (CSV) state --------------------------------------------------
  const [ledger, setLedger] = useState<LedgerState | null>(null);
  const [bank, setBank] = useState<BankState | null>(null);
  const [feeAmount, setFeeAmount] = useState("0.50");
  const [tolerance, setTolerance] = useState("0.02");
  const settingsLoaded = useRef(false);

  useEffect(() => {
    if (settingsLoaded.current) return;
    settingsLoaded.current = true;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        if (typeof s.feeAmount === "number") setFeeAmount(String(s.feeAmount));
        if (typeof s.tolerance === "number") setTolerance(String(s.tolerance));
      })
      .catch(() => {});
  }, []);

  // --- ZiggoPay ↔ IMTO (Excel) state --------------------------------------
  const [ziggo, setZiggo] = useState<ZiggoState | null>(null);
  const [imto, setImto] = useState<ImtoState | null>(null);
  const [imtoTolerance, setImtoTolerance] = useState("0.01");
  const [sheetReport, setSheetReport] = useState<SheetReportRow[]>([]);
  const [imtoError, setImtoError] = useState<string | null>(null);

  // --- shared ---------------------------------------------------------------
  const [runBy, setRunBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<ReconcileOutput | null>(null);
  const [saving, setSaving] = useState(false);

  function switchKind(next: ReconKind) {
    setKind(next);
    setOutput(null);
    setError(null);
  }

  async function onLedgerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setOutput(null);
    try {
      // Some exports (notably GTBank's HTML-flavored .xls) split into
      // several sheets with the real table not first — try each sheet.
      const sheets = await readWorkbookSheets(file);
      let rows: LedgerRow[] = [];
      for (const s of sheets) {
        const attempt = parseLedgerRows(s.rows);
        if (attempt.length > 0) {
          rows = attempt;
          break;
        }
      }
      if (rows.length === 0) {
        setError(`No ledger rows parsed from ${file.name}. Check the header row.`);
        setLedger(null);
        return;
      }
      setLedger({ fileName: file.name, rows });
    } catch (err) {
      setError(`Could not read ${file.name}: ${(err as Error).message}`);
    }
  }

  async function onBankChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setOutput(null);
    try {
      // Some exports (notably GTBank's HTML-flavored .xls) split into
      // several sheets with the real table not first — try each sheet.
      const sheets = await readWorkbookSheets(file);
      let parsed = null as ReturnType<typeof parseBankRows> | null;
      for (const s of sheets) {
        const attempt = parseBankRows(s.rows);
        if (attempt.headerFound) {
          parsed = attempt;
          break;
        }
      }
      if (!parsed) {
        setError(
          `Could not find a "Trans Date" header row in ${file.name}${
            sheets.length > 1 ? ` (checked ${sheets.length} sheets)` : ""
          }.`,
        );
        setBank(null);
        return;
      }
      setBank({
        fileName: file.name,
        rows: parsed.rows,
        statementPeriod: parsed.statementPeriod,
        headerFound: parsed.headerFound,
      });
    } catch (err) {
      setError(`Could not read ${file.name}: ${(err as Error).message}`);
    }
  }

  async function onImtoFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setError(null);
    setImtoError(null);
    setOutput(null);
    setZiggo(null);
    setImto(null);

    try {
      const sheets = (await Promise.all(files.map(readWorkbookSheets))).flat();
      const classified = sheets.map((s) => ({ ...s, ...classifySheet(s.rows) }));
      setSheetReport(classified.map((s) => ({ fileName: s.fileName, sheetName: s.sheetName, kind: s.kind, rowCount: s.rows.length })));

      const ziggoSheets = classified.filter((s) => s.kind === "ziggopay");
      const imtoSheets = classified.filter((s) => s.kind === "imto");

      if (ziggoSheets.length !== 1 || imtoSheets.length !== 1) {
        setImtoError(
          `Need exactly one ZiggoPay-shaped sheet and one IMTO-shaped sheet, across one or two files. Found ${ziggoSheets.length} ZiggoPay-shaped and ${imtoSheets.length} IMTO-shaped — see the sheet list below.`,
        );
        return;
      }

      const z = ziggoSheets[0];
      const i = imtoSheets[0];
      const zRows = extractZiggoRows(z.rows, z.headerIdx);
      const iRows = extractImtoRows(i.rows, i.headerIdx);
      const period = extractImtoPeriod(i.rows, i.headerIdx);

      if (!zRows.length) {
        setImtoError(`No rows parsed from the ZiggoPay sheet ("${z.sheetName}" in ${z.fileName}).`);
        return;
      }
      if (!iRows.length) {
        setImtoError(`No rows parsed from the IMTO sheet ("${i.sheetName}" in ${i.fileName}).`);
        return;
      }

      setZiggo({ source: `${z.fileName} — ${z.sheetName}`, rows: zRows });
      setImto({ source: `${i.fileName} — ${i.sheetName}`, rows: iRows, period });
    } catch (err) {
      setImtoError(`Could not read the uploaded file(s): ${(err as Error).message}`);
    }
  }

  function runReconciliation() {
    setError(null);
    if (kind === "GTBANK") {
      if (!ledger || !bank) return;
      const fee = Number(feeAmount);
      const tol = Number(tolerance);
      if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(tol) || tol < 0) {
        setError("Fee and tolerance must be non-negative numbers.");
        return;
      }
      setOutput(reconcile(ledger.rows, bank.rows, fee, tol));
    } else {
      if (!ziggo || !imto) return;
      const tol = Number(imtoTolerance);
      if (!Number.isFinite(tol) || tol < 0) {
        setError("Tolerance must be a non-negative number.");
        return;
      }
      setOutput(reconcileImto(ziggo.rows, imto.rows, tol));
    }
  }

  function exportCsv() {
    if (!output) return;
    downloadCsv(`reconciliation-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(output.rows));
  }

  async function save() {
    if (!output) return;
    if (kind === "GTBANK" && (!ledger || !bank)) return;
    if (kind === "ZIGGOPAY_IMTO" && (!ziggo || !imto)) return;

    setSaving(true);
    setError(null);
    try {
      const payload =
        kind === "GTBANK"
          ? {
              kind,
              ledgerFileName: ledger!.fileName,
              bankFileName: bank!.fileName,
              statementPeriod: bank!.statementPeriod,
              feeAmount: Number(feeAmount),
              tolerance: Number(tolerance),
              totalLedgerRows: output.summary.totalLedgerRows,
              runBy,
              rows: output.rows,
            }
          : {
              kind,
              ledgerFileName: ziggo!.source,
              bankFileName: imto!.source,
              statementPeriod: imto!.period,
              feeAmount: 0,
              tolerance: Number(imtoTolerance),
              totalLedgerRows: output.summary.totalLedgerRows,
              runBy,
              rows: output.rows,
            };

      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status}).`);
      }
      const { id } = await res.json();
      router.push(`/history/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const canRun = kind === "GTBANK" ? !!ledger && !!bank : !!ziggo && !!imto;

  return (
    <div>
      <PageHeader
        title="New reconciliation"
        subtitle="Pick a source, upload the files, then run the match."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {RECON_KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => switchKind(k.value)}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              kind === k.value
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        {kind === "GTBANK" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FileField
              label="Internal ledger (CSV or Excel)"
              hint="MTO transactions report — standard header row."
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple={false}
              onChange={onLedgerChange}
              status={ledger ? `${ledger.fileName} · ${ledger.rows.length} rows` : "No file selected"}
              ok={!!ledger}
            />
            <FileField
              label="GTBank statement (CSV or Excel)"
              hint="Letterhead lines are skipped automatically."
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple={false}
              onChange={onBankChange}
              status={
                bank
                  ? `${bank.fileName} · ${bank.rows.length} rows${
                      bank.statementPeriod ? ` · ${bank.statementPeriod}` : " · no period line"
                    }`
                  : "No file selected"
              }
              ok={!!bank}
            />
          </div>
        ) : (
          <div>
            <FileField
              label="ZiggoPay + IMTO file(s) (CSV or Excel)"
              hint="Upload one Excel file with both a ZiggoPay sheet and an IMTO sheet, or two separate CSV/Excel files — either way, sheets are identified by their columns, not their name, format, or position."
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              onChange={onImtoFilesChange}
              status={
                ziggo && imto
                  ? `${ziggo.source} (${ziggo.rows.length} rows) · ${imto.source} (${imto.rows.length} rows)${
                      imto.period ? ` · ${imto.period}` : ""
                    }`
                  : "No file selected"
              }
              ok={!!ziggo && !!imto}
            />
            {imtoError ? (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {imtoError}
              </div>
            ) : null}
            {sheetReport.length > 0 ? (
              <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-2 py-1.5 font-medium">File</th>
                      <th className="px-2 py-1.5 font-medium">Sheet</th>
                      <th className="px-2 py-1.5 font-medium">Detected as</th>
                      <th className="px-2 py-1.5 text-right font-medium">Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetReport.map((s, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-1.5 font-mono text-slate-600">{s.fileName}</td>
                        <td className="px-2 py-1.5 text-slate-600">{s.sheetName}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 font-medium ${
                              s.kind === "unknown"
                                ? "bg-slate-100 text-slate-500"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {s.kind}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right tnum text-slate-600">{s.rowCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          {kind === "GTBANK" ? (
            <>
              <NumberField
                label="Fee amount"
                value={feeAmount}
                onChange={setFeeAmount}
                hint="Added to ledger amount for the expected bank debit."
              />
              <NumberField
                label="Tolerance"
                value={tolerance}
                onChange={setTolerance}
                hint="Absolute currency tolerance for a match."
              />
            </>
          ) : (
            <NumberField
              label="Tolerance"
              value={imtoTolerance}
              onChange={setImtoTolerance}
              hint="Absolute currency tolerance between ZiggoPay amount and IMTO debit."
            />
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700">Run by</label>
            <input
              type="text"
              value={runBy}
              onChange={(e) => setRunBy(e.target.value)}
              placeholder="e.g. A. Mensah"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">Stored with the saved run.</p>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div>
          <button
            onClick={runReconciliation}
            disabled={!canRun}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Run reconciliation
          </button>
        </div>
      </div>

      {output ? (
        <div className="mt-8">
          <ResultsView
            rows={output.rows}
            summary={output.summary}
            kind={kind}
            toolbar={
              <>
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-slate-300"
                >
                  {saving ? "Saving…" : "Save this reconciliation"}
                </button>
                <button
                  onClick={exportCsv}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Export CSV
                </button>
                <span className="text-xs text-slate-400">
                  Export is available before saving; saving commits the run to History.
                </span>
              </>
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function FileField({
  label,
  hint,
  accept,
  multiple,
  onChange,
  status,
  ok,
}: {
  label: string;
  hint: string;
  accept: string;
  multiple: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  status: string;
  ok: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={onChange}
        className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
      />
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
      <p className={`mt-1 text-xs font-medium ${ok ? "text-emerald-600" : "text-slate-400"}`}>
        {status}
      </p>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tnum focus:border-slate-500 focus:outline-none"
      />
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  );
}
