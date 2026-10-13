# ZiggoPay / EziPay — Reconciliation App

Internal tool with **two reconciliation flows**, picked at the top of `/reconcile`:

1. **Internal ledger ↔ GTBank statement** (CSV) — the original flow.
2. **ZiggoPay ↔ IMTO** (Excel) — ZiggoPay's transaction list vs. the IMTO (Unity
   Link) account statement.

Both share the same shell — upload, match, tabbed results, exception workflow,
save, History, export — with a different parser + matching engine underneath.
Every run can be saved and re-opened later.

## Stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS**
- **papaparse** — client-side CSV parsing
- **xlsx (SheetJS)** — client-side Excel parsing (ZiggoPay ↔ IMTO flow)
- **Prisma + Postgres** (Prisma Postgres, via Vercel Marketplace) — see
  [Hosting](#hosting) below. Started as SQLite for zero-setup local dev; now
  live, so local dev points at the same hosted database (see note below).

## Getting started

```bash
npm install
npm run db:migrate   # applies prisma/migrations/ to DATABASE_URL
npm run dev          # http://localhost:3000
```

`npm install` runs `prisma generate` automatically. `DATABASE_URL` lives in
`.env` (git-ignored) — currently the hosted Prisma Postgres instance, so
**local dev writes to the same database as production** until a separate
dev database is set up (Prisma Postgres/Neon-style branching, or a second
instance). Fine for now at this scale; worth revisiting before real usage grows.

## Hosting

Deployed on Vercel (`vercel deploy --prod`), project `ziggopay-recon` under
the `getty-s-projects` team. Database is **Prisma Postgres**, provisioned via
the Vercel Marketplace (`vercel integration add prisma-postgres`) — this
auto-wired `DATABASE_URL` (+ `POSTGRES_URL` / `PRISMA_DATABASE_URL`) into the
Vercel project's environment variables for all environments. Source lives at
[github.com/Getrudetrudy01/Reconciliation](https://github.com/Getrudetrudy01/Reconciliation),
connected to the Vercel project — pushing to `main` deploys to production
automatically; other branches/PRs get their own preview deployment.

`npm run build` runs `prisma migrate deploy` before `next build`, so every
deploy applies any pending migrations in `prisma/migrations/` automatically —
commit new migrations (`npm run db:migrate` locally, which also updates this
folder) rather than hand-editing the schema and `db push`-ing to production.

Optional: `npm run seed:demo` (with `npm run dev` running) posts five sample runs
so the dashboard and its charts have something to show. `npm run test:recon`
runs the GTBank matching engine against `samples/` and asserts every bucket.
For the ZiggoPay ↔ IMTO engine, point `scripts/test-imto.ts` at a real workbook
(not checked in): `FILE="C:\path\to\workbook.xlsx" npx tsx scripts/test-imto.ts`.

### Exception workflow

Rows in an actionable bucket (**Mismatched**, **Reversed – needs check**,
**Ledger only**, **Bank only**) on a *saved* run's detail page get a status
button in an "Exception" column: **Open → Investigating → Resolved**, with an
optional note and an owner (`resolvedBy`). Click it to expand an inline editor;
`PATCH /api/rows/[id]` persists the change. The Needs Review tab shows an aging
banner ("Flagged N days ago", amber past 7 days, red past 30) based on the
run's `createdAt`.

Saving a **new** run looks up the most recent prior row with the same
TransactionId and carries its status/note/owner forward automatically — so
re-running reconciliation against an updated bank export doesn't reset
investigation context to "Open". See
`docs/reconciliation-platforms-research.md` for the reasoning (this is the
"Now" phase of that roadmap). The match itself (bucket/amounts) is never
editable — only the human workflow layered on top of it.

### Dashboard charts

Monochrome-slate, dependency-free inline SVG (no chart library), rendered
server-side with a client hover layer for tooltips. Magnitude is carried by mark
length, not colour; the one accent (risk red) marks the latest column when
mismatch value rose versus the previous run. Light-only, matching the app chrome.

## Pages

| Route            | Purpose                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------- |
| `/`              | Dashboard — totals across all saved runs (both flows), all-time mismatch value (flagged if rising), three charts (mismatch value by run, match rate by run, latest run by bucket), last 5 runs |
| `/reconcile`     | Pick a source (GTBank CSV or ZiggoPay ↔ IMTO Excel), upload, set tolerance, run the match, export or save the run |
| `/history`       | All saved runs, filterable by date range; row → read-only detail; per-run CSV download  |
| `/history/[id]`  | Read-only results view rebuilt from saved row-level data                                |
| `/settings`      | Default fee amount and tolerance (pre-fill `/reconcile`)                                 |

## File formats

### Internal ledger CSV

Standard header row:

```
WalletTransactionId, TransactionId, InvoiceNo, External Reference, Date, Time,
TotalAmount, TransactionType, name, AccountNo, TransactionStatus, Comments
```

`TransactionStatus` is `DEPOSITED` or `FAILED`.

### GTBank statement CSV

~15 letterhead lines precede the real header. The parser finds the row whose
first cell starts with `Trans Date` and treats everything from there as the data
table:

```
Trans Date, Reference, Value Date, Debit, Credit, Balance, Remarks
```

- `Debit` / `Credit` are quoted with comma thousands separators (`"7,480.50"`) —
  commas are stripped before parsing.
- A `Period: X To Y` line in the letterhead, if present, is captured as the
  statement period.
- `Remarks` embeds ledger identifiers:
  `CREDITWALLET/EZIPAY2/OTHER/{WalletTransactionId}/{TransactionId}/**{timestamp}`,
  or `REV-CREDITWALLET/...` for a reversal. IDs are read from the two `/`
  segments after the literal `OTHER` segment.
- Rows with **no `OTHER` segment** (bank fees, `SI-`, `COMM:`, `TRF B/O`, MPGS
  charges) are not transactions → **Bank charges / other**.

## Matching logic

Join on **TransactionId**. Expected bank debit = ledger `TotalAmount` + fee,
matched within an absolute currency tolerance.

| Ledger status | Bank debit | Reversal | Bucket                     | Notes |
| ------------- | ---------- | -------- | -------------------------- | ----- |
| FAILED        | yes        | yes      | Reversed – expected        | Net zero, not a problem |
| FAILED        | yes        | no       | **Mismatched**             | Critical: money left the bank for a failed txn, never clawed back |
| FAILED        | no         | —        | Failed – excluded          | Correctly never sent |
| DEPOSITED     | no         | —        | Ledger only                | Notes if a reversal-only entry exists |
| DEPOSITED     | yes        | yes      | **Reversed – needs check** | Critical: ledger success but bank reversed the payout |
| DEPOSITED     | yes        | no, within tolerance | Matched          | |
| DEPOSITED     | yes        | no, outside tolerance | **Mismatched**  | |
| —             | bank `OTHER` entry, no ledger row | | Bank only  | Unreconciled bank movement |

**Ledger only** and **Bank only** are kept distinct — they point at different
root causes (ledger logging gap vs. unreconciled bank movement).

The **Needs review** tab is the union of *Mismatched* + *Reversed – needs check*.

## ZiggoPay ↔ IMTO (Excel)

Upload **one Excel file with both sheets, or two separate files** — sheets are
identified by their columns, not their name or position, so either arrangement
works.

- **ZiggoPay sheet**: header row 1, columns `Date, Status, Trans. ID, Deposit.
  ID, Amt Sent, Payout, Transaction Type, PartnerRefID, PartnerTransID`.
  Detected by a header containing `Trans. ID` + `Amt Sent`. A trailing
  `Grand Total` footer row is dropped (a real `Trans. ID` is purely numeric).
- **IMTO sheet**: a GTBank-style export — letterhead rows, then a header
  containing `Debit` + `Credit` + `Description`. A `For the period X to Y`
  letterhead line, if present, is captured as the statement period.
- **Matching key**: ZiggoPay's `Trans. ID` is an 18-digit timestamp
  (`20YYMMDDHHMMSS` + 4 more digits) embedded in IMTO's `Description`, e.g.
  `...EZIPMC37514339274/202602121032515703/**12/02/2026 10:32:56` or
  `...PTNRMC2608181347250070C/202608181345368152/**...`. IDs are extracted by
  that **timestamp shape**, not just "any long digit run" — some reference
  codes place an unrelated digit run immediately before the real ID with no
  separator, and a naive `\d{16,20}` grabs the wrong one.
- **Reversal is amount-based, not text-based**: a debit and a same-amount
  credit under the same Trans. ID is a reversal, whether or not the
  description says `REV-`. Several real reversals in this dataset weren't
  text-marked at all.
- **Date+amount fallback for truncated IDs**: a small, recurring batch of
  ZiggoPay Trans. ID values lose their last 3-4 digits upstream (consistent
  with an 18-digit integer having passed through a floating-point
  representation before landing in the sheet as text — confirmed against a
  real export). When the exact Trans. ID isn't found anywhere in IMTO, and
  exactly one unclaimed IMTO debit shares the same date-to-the-second prefix
  *and* the same amount, that counts as a match — clearly labeled "Matched
  via date+amount fallback" in the reason (and the export), never silent.
  Ambiguous (more than one candidate) or partial-prefix cases are left for
  Investigate rather than guessed.
- **Matching is per-entry, not per-key-sum**: more than one IMTO row can
  extract to the same Trans. ID (garbled or duplicated reference text — seen
  in the real export). Summing every debit under a shared key manufactures a
  fake mismatch when only one of them is actually this transaction, so the
  engine picks the specific entry whose amount agrees with the ZiggoPay
  row and reports any leftover entry under that key as its own item instead
  of folding it into the comparison.
- **"Excluded" (non-transaction) lines**: bulk settlement transfers
  (`TRF B/O...`, `TRFMBGH...`) and the opening/closing balance lines. Note
  `COMM:`-prefixed lines are **not** excluded here — in this statement they
  label a transaction category, not a bank fee (confirmed: their debit amount
  matches a real ZiggoPay amount in all but one case) — so they go through
  normal matching like any other debit.

| Rule | Bucket | Condition |
|---|---|---|
| 1 & 2 | **Matched** | ZiggoPay Trans. ID found as an IMTO debit, amount agrees within tolerance |
| 2 | **Investigate** | Not found in IMTO at all, *or* found with a different amount |
| 4 | **Reversed** | A debit (ZiggoPay-matched or not) has a same-amount credit under the same Trans. ID |
| 5 | **Investigate** | IMTO debit/credit claimed by no ZiggoPay row, and no reversal |
| — | **Excluded** | Bulk settlement transfers, opening/closing balance |

No fee is added (IMTO debits equal the ZiggoPay amount directly); only a
tolerance applies.

## Persistence

Row-level results are stored (`ReconciliationRow`), not just summary counts, so
history detail pages and per-run CSV downloads are rebuilt from the database.
`ReconciliationRun.kind` (`GTBANK` or `ZIGGOPAY_IMTO`) records which engine
produced the run; `ReconciliationRow.bucket` is a plain string either way, so
both taxonomies share one schema (see `TAXONOMIES` in `src/lib/types.ts`).

This already happened — see [Hosting](#hosting). `datasource db` in
`prisma/schema.prisma` is `postgresql`; the swap needed no model, relation, or
application code changes (`onDelete: Cascade` and every field type here were
already Postgres-portable).

## Notes / v1 scope

- **No auth.** Single internal team. `runBy` is a free-text field on each run;
  add a login gate later if needed.
- Settings has exactly two fields (fee, tolerance) by design.
