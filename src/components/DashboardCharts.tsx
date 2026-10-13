"use client";

import { useState } from "react";
import { money } from "@/lib/format";

// Single-hue, monochrome-slate charts to match the app chrome. Magnitude is
// carried by mark length, never by colour; the lone emphasis colour (risk red)
// is a reserved status cue, always sitting under the "increasing" label.
const INK = "#0f172a"; // slate-900  – primary ink
const SUB = "#475569"; // slate-600  – secondary ink
const MUTED = "#64748b"; // slate-500 – axis / labels
const GRID = "#e2e8f0"; // slate-200  – hairline gridlines
const AXIS = "#cbd5e1"; // slate-300  – baseline
const MARK = "#334155"; // slate-700  – data marks (~9:1 on white)
const RISK = "#dc2626"; // red-600    – emphasis: mismatch value rising

export interface RunPoint {
  id: string;
  dateLabel: string;
  fullDate: string;
  txns: number;
  matchedPct: number;
  flagged: number;
  mismatchValue: number;
}

export interface BucketDatum {
  label: string;
  count: number;
  tone: "critical" | "warn" | "ok" | "neutral";
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * p;
}

const comma = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Rounded top corners, square at the baseline. */
function barTop(x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** Rounded right end, square at the baseline (horizontal bar). */
function barRight(x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, h / 2, w));
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}

interface Tip {
  left: number;
  top: number;
  title: string;
  lines: string[];
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-sm"
      style={{ left: tip.left, top: tip.top - 8 }}
    >
      <div className="font-medium text-slate-500">{tip.title}</div>
      {tip.lines.map((l, i) => (
        <div key={i} className="tnum font-semibold text-slate-900">
          {l}
        </div>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  wide,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Mismatch value by run — columns
// ---------------------------------------------------------------------------

function MismatchByRun({ runs, increasing }: { runs: RunPoint[]; increasing: boolean }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const VBW = 1120;
  const VBH = 240;
  const padL = 64;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const plotW = VBW - padL - padR;
  const plotH = VBH - padT - padB;
  const n = runs.length;
  const band = plotW / Math.max(n, 1);
  const barW = Math.min(24, band - 6);
  const max = niceMax(Math.max(1, ...runs.map((r) => r.mismatchValue)));
  const ticks = [0, max / 2, max];
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  // Label every column when they are few; otherwise only the last.
  const labelEvery = n <= 8;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const vx = (px / rect.width) * VBW;
    const i = Math.max(0, Math.min(n - 1, Math.floor((vx - padL) / band)));
    const r = runs[i];
    if (!r) return;
    setTip({
      left: px,
      top: e.clientY - rect.top,
      title: `${r.fullDate}`,
      lines: [`${money(r.mismatchValue)} at risk`],
    });
  }

  return (
    <div className="relative" onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} width="100%" role="img" onPointerMove={onMove}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={VBW - padR} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED} className="tnum">
              {comma(t)}
            </text>
          </g>
        ))}
        <line x1={padL} x2={VBW - padR} y1={y(0)} y2={y(0)} stroke={AXIS} strokeWidth={1} />

        {runs.map((r, i) => {
          const bx = padL + i * band + (band - barW) / 2;
          const h = y(0) - y(r.mismatchValue);
          const isLast = i === n - 1;
          const fill = isLast && increasing ? RISK : MARK;
          return (
            <g key={r.id}>
              <path d={barTop(bx, y(r.mismatchValue), barW, Math.max(h, 0), 4)} fill={fill} />
              {(labelEvery || isLast) && r.mismatchValue > 0 && (
                <text
                  x={bx + barW / 2}
                  y={y(r.mismatchValue) - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill={isLast && increasing ? RISK : SUB}
                  className="tnum"
                >
                  {comma(r.mismatchValue)}
                </text>
              )}
              <text x={bx + barW / 2} y={VBH - 10} textAnchor="middle" fontSize={11} fill={MUTED}>
                {r.dateLabel}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Match rate by run — line + wash
// ---------------------------------------------------------------------------

function MatchRateByRun({ runs }: { runs: RunPoint[] }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const VBW = 536;
  const VBH = 220;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const plotW = VBW - padL - padR;
  const plotH = VBH - padT - padB;
  const n = runs.length;
  const band = n > 1 ? plotW / (n - 1) : plotW;
  const x = (i: number) => (n > 1 ? padL + i * band : padL + plotW / 2);
  const y = (v: number) => padT + plotH - (v / 100) * plotH;
  const ticks = [0, 50, 100];

  const pts = runs.map((r, i) => [x(i), y(r.matchedPct)] as const);
  const linePath = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const areaPath =
    pts.length > 0
      ? `${linePath} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z`
      : "";
  const last = runs[n - 1];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const vx = (px / rect.width) * VBW;
    const i = Math.max(0, Math.min(n - 1, n > 1 ? Math.round((vx - padL) / band) : 0));
    const r = runs[i];
    if (!r) return;
    setTip({
      left: px,
      top: e.clientY - rect.top,
      title: r.fullDate,
      lines: [`${r.matchedPct.toFixed(1)}% matched`],
    });
  }

  return (
    <div className="relative" onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} width="100%" role="img" onPointerMove={onMove}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={VBW - padR} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED} className="tnum">
              {t}%
            </text>
          </g>
        ))}
        <line x1={padL} x2={VBW - padR} y1={y(0)} y2={y(0)} stroke={AXIS} strokeWidth={1} />

        {areaPath && <path d={areaPath} fill={MARK} fillOpacity={0.1} />}
        {pts.length > 1 && (
          <path d={linePath} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === n - 1 ? 4 : 3} fill={MARK} stroke="#fff" strokeWidth={2} />
        ))}

        {last && (
          <text
            x={x(n - 1)}
            y={y(last.matchedPct) - 10}
            textAnchor="end"
            fontSize={11}
            fill={SUB}
            className="tnum"
          >
            {last.matchedPct.toFixed(1)}%
          </text>
        )}

        {runs.map((r, i) => (
          <text key={r.id} x={x(i)} y={VBH - 10} textAnchor="middle" fontSize={11} fill={MUTED}>
            {r.dateLabel}
          </text>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Latest run by bucket — horizontal bars
// ---------------------------------------------------------------------------

function LatestByBucket({ data, runLabel }: { data: BucketDatum[]; runLabel: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const rows = [...data].filter((d) => d.count > 0).sort((a, b) => b.count - a.count);
  const VBW = 536;
  const rowH = 30;
  const padT = 8;
  const padB = 8;
  const labelW = 150;
  const valueW = 44;
  const VBH = padT + padB + rows.length * rowH;
  const plotW = VBW - labelW - valueW;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const barH = Math.min(18, rowH - 8);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const i = Math.floor(((py / rect.height) * VBH - padT) / rowH);
    const r = rows[i];
    if (!r) return;
    setTip({ left: px, top: py, title: r.label, lines: [`${r.count} row${r.count === 1 ? "" : "s"}`] });
  }

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">No rows in the latest run.</p>;
  }

  return (
    <div className="relative" onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} width="100%" role="img" onPointerMove={onMove}>
        {rows.map((r, i) => {
          const cy = padT + i * rowH + rowH / 2;
          const w = (r.count / max) * plotW;
          return (
            <g key={r.label}>
              <text x={labelW - 10} y={cy + 4} textAnchor="end" fontSize={11} fill={SUB}>
                {r.label}
              </text>
              <path d={barRight(labelW, cy - barH / 2, Math.max(w, 2), barH, 4)} fill={MARK} />
              <text x={labelW + Math.max(w, 2) + 6} y={cy + 4} fontSize={11} fill={INK} className="tnum">
                {r.count}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
      <p className="mt-2 text-[11px] text-slate-400">Latest run · {runLabel}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function DashboardCharts({
  runs,
  latestBuckets,
  latestRunLabel,
  increasing,
}: {
  runs: RunPoint[];
  latestBuckets: BucketDatum[];
  latestRunLabel: string;
  increasing: boolean;
}) {
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Mismatch value by run"
        subtitle={
          increasing
            ? "▲ Value at risk rose on the most recent run (shown in red)."
            : "Total value flagged as mismatched, per saved run."
        }
        wide
      >
        <MismatchByRun runs={runs} increasing={increasing} />
      </ChartCard>

      <ChartCard title="Match rate by run" subtitle="Matched rows as a share of the ledger.">
        <MatchRateByRun runs={runs} />
      </ChartCard>

      <ChartCard title="Latest run by bucket" subtitle="Where the most recent run's rows landed.">
        <LatestByBucket data={latestBuckets} runLabel={latestRunLabel} />
      </ChartCard>
    </div>
  );
}
