# How reconciliation platforms work — and where our app stands

Research pass across enterprise reconciliation platforms (BlackLine, Trintech
Cadency/Adra/ReconNET, ReconArt, SmartStream/NeoXam) and PSP/fintech-specific
reconciliation practice, done to decide what to build next on top of the
current ZiggoPay/EziPay recon app. Sources at the bottom.

## 1. How the mature platforms are actually built

They all converge on the same five-stage pipeline, regardless of vendor:

1. **Ingestion & normalization** — automated connectors (API, SFTP, bank
   feeds) pull source files on a schedule; every source format (Stripe CSV,
   Adyen proprietary export, GTBank statement, internal ledger, …) is
   translated into one canonical internal shape *before* anything is matched.
   "Normalize before you match" is the recurring principle across every PSP
   write-up. [[Formance](https://www.formance.com/blog/financial-operations/account-reconciliation-patterns-for-high-volume-fintech)]
2. **Matching engine** — deterministic rule-based matching first (amount +
   date + reference, with configurable tolerance windows for processing
   delays), then fuzzy/AI matching for the messy remainder (partial payments,
   missing references, near-duplicate names). Confidence thresholds
   auto-clear high-confidence matches; mid-market teams land 80–95% auto-match
   rates once rules are tuned. [[Maxima](https://www.maxima.ai/articles/payment-reconciliation-software), [HighRadius](https://www.highradius.com/resources/Blog/best-bank-reconciliation-tools/)]
3. **Exception workflow** — the unmatched ~5–20% get case-managed: assigned
   to an owner, tagged with a reason code, aged in buckets (0–7 / 8–30 /
   31–60 / 60+ days), commented on, and tracked against an SLA so nothing
   silently ages past month-end. [[du.co](https://support.du.co/hc/en-us/articles/31857114694045-Best-practice-exception-management), [Ledgerise](https://blog.ledgerise.dev/exception-management-payment-reconciliation/)]
4. **Controls: review, sign-off, audit trail** — segregation of duties is
   structural (preparer configures and attaches evidence; reviewer approves;
   admin owns rule changes under change control). Every match — auto or
   manual — is timestamped, attributed, and reproducible. Low-risk accounts
   can auto-certify within a configured threshold; everything else needs a
   human sign-off before a period closes. [[Equility](https://www.equilityhq.com/blog/month-end-bank-reconciliation-control-driven-workflow), [BlackLine](https://www.blackline.com/blog/3-audit-benefits/)]
5. **Reporting & drill-down** — a live dashboard of match-rate, exception
   count/age, and $ exposure, plus the ability to drill from a summary number
   back to the originating source rows. This is the layer finance leadership
   actually looks at daily. [[NeoXam](https://www.neoxam.com/aro/reconciliation-dashboards-reporting-audit-trails/)]

PSP-specific nuance that's directly relevant to us: a reconcilable payment
stack has **four distinct layers** — payment events, internal ledger, PSP/bank
settlement batch, and the bank statement itself — and good platforms keep
them as separate, cross-referenced records rather than collapsing straight to
a single ledger-vs-bank diff. [[Payrails/Optimus](https://optimus.tech/blog/payment-reconciliation-for-psps-a-practitioners-handbook)]

## 2. Gap analysis — platform norm vs. our app today

| Capability | Industry norm | Our app today | Gap |
|---|---|---|---|
| **Ingestion** | Scheduled API/SFTP pull, multi-source adapters, auto-normalize | Manual CSV upload, one file per source, one run at a time | **High** — every run is a human remembering to export + upload two files |
| **Matching engine** | Deterministic rules + tolerance windows, *configurable without code*, fuzzy/AI fallback | Deterministic rules, hardcoded in `reconcile.ts` (fee + tolerance only configurable) | **Medium** — logic is correct and documented, but ops can't tune match keys/tolerance windows per bucket without a code change |
| **Exception workflow** | Assign owner, reason code, comment thread, aging buckets, SLA/reminders | Read-only tabs; a `reason` string is generated but nothing is actionable | **High** — "Needs review" rows have nowhere to go; no way to mark one resolved, note what happened, or see how old it is |
| **Review & sign-off** | Preparer/reviewer roles, explicit approval before a run is considered closed | No auth, no roles, no approval state — a run is just "saved" | **High (by design for v1)** — acceptable for a single-team MVP, but there's no record of *who* accepted a flagged run |
| **Audit trail** | Every match timestamped, attributed, immutable | `createdAt` on the run only; rows have no edit history, no "who touched this" | **Medium** — fine while the tool is read-only, becomes a real gap the moment exceptions become editable |
| **Multi-run / cross-source matching** | Separate ledger / settlement-batch / bank-statement layers, cross-referenced | Two layers only (ledger vs. one bank statement) | **Low for us today** — we only have one bank (GTBank) and one ledger, so this matches our real scope |
| **Dashboards & KPIs** | Match-rate, exception age, $ exposure trend, drill-down | 3 charts + stat cards, shipped this session | **Low** — reasonably caught up for an MVP; missing exception *aging* specifically |
| **Bulk actions** | Bulk-accept/bulk-assign/bulk-export a filtered set | None — per-run export only | **Medium** |
| **Multi-currency / multi-entity** | Standard in enterprise tools | Not supported (single currency assumed) | **Low for us today** — GHS only, not currently a real requirement |
| **Alerting** | Email/Slack on new high-value exceptions, SLA breach | None — you have to open the app | **Medium** |
| **Access control** | RBAC, segregation of duties | None (explicit v1 decision) | **High, deferred intentionally** |

## 3. What this means for us specifically

We're not trying to out-build BlackLine. As a single-team internal tool for
one ledger and one bank, the two gaps that actually bite are:

1. **"Needs review" is a dead end.** The app is excellent at *finding*
   problems and useless at *closing* them — there's no way to mark a
   mismatch investigated, note the outcome, or stop seeing it every time you
   open the run.
2. **Everything is a fresh manual upload.** No history of "we always rename
   the export this way," no re-run of last week's settings, no reminder that
   this week's file hasn't shown up yet.

Multi-source ingestion, RBAC, and AI fuzzy matching are real gaps against
BlackLine/Trintech, but they're not worth building for a two-source, one-team
MVP — they're the right things to defer, not things we're "failing" at.

## 4. Proposed roadmap (ordered by value for this tool, not platform parity)

**Now — closes the biggest real gap (exception lifecycle)**
- Add a `status` (open / investigating / resolved) + free-text `resolutionNote`
  + `resolvedBy` to `ReconciliationRow`, editable from the results view.
- Aging: show "flagged N days ago" using the row's run `createdAt` vs. today,
  with a visual bucket (0–7 / 8–30 / 30+) on the Needs Review tab.
- Carry *unresolved* exceptions forward into the next run's view (same
  TransactionId still unmatched) so nothing silently drops off between runs.

**Next — reduces manual toil**
- Configurable matching rules from Settings: per-bucket tolerance, and a
  short list of tolerance "reason" presets (e.g. FX rounding) instead of one
  global number.
- Bulk actions on the results table: select rows → bulk-resolve / bulk-export.
- "Re-run with last run's settings" shortcut from History.

**Later — only if volume/headcount grows**
- Scheduled ingestion (SFTP/email-drop for the GTBank export) instead of
  manual upload.
- Basic auth + two roles (preparer / reviewer) with a sign-off state on a run.
- Email/Slack alert when a saved run's flagged $ exceeds a threshold.

## Sources

- [Maxima — Payment Reconciliation Software](https://www.maxima.ai/articles/payment-reconciliation-software)
- [HighRadius — Best Bank Reconciliation Tools 2026](https://www.highradius.com/resources/Blog/best-bank-reconciliation-tools/)
- [BlueCopa — Best Account Reconciliation Tools 2026](https://www.bluecopa.com/blog/account-reconciliation-tools)
- [Osfin — Trintech vs BlackLine](https://www.osfin.ai/blog/trintech-vs-blackline)
- [BlackLine — Audit benefits of reconciliation](https://www.blackline.com/blog/3-audit-benefits/)
- [NeoXam — Reconciliation Dashboards, Reporting & Audit Trails](https://www.neoxam.com/aro/reconciliation-dashboards-reporting-audit-trails/)
- [Formance — Account Reconciliation Patterns for High-Volume Fintech](https://www.formance.com/blog/financial-operations/account-reconciliation-patterns-for-high-volume-fintech)
- [Optimus — Payment Reconciliation for PSPs: A Practitioner's Handbook](https://optimus.tech/blog/payment-reconciliation-for-psps-a-practitioners-handbook)
- [du.co — Best practice: exception management](https://support.du.co/hc/en-us/articles/31857114694045-Best-practice-exception-management)
- [Ledgerise — Exception Management in Payment Reconciliation](https://blog.ledgerise.dev/exception-management-payment-reconciliation/)
- [Equility HQ — Control-Driven Workflow for Month-End Bank Reconciliation](https://www.equilityhq.com/blog/month-end-bank-reconciliation-control-driven-workflow)
