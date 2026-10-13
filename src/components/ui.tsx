import type { ReactNode } from "react";
import { BUCKET_META, type Bucket } from "@/lib/types";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "critical";
}) {
  const toneCls = {
    neutral: "text-slate-900",
    ok: "text-emerald-700",
    warn: "text-amber-700",
    critical: "text-red-700",
  }[tone];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tnum ${toneCls}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

const TONE_BADGE: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warn: "bg-amber-50 text-amber-800 ring-amber-600/20",
  critical: "bg-red-50 text-red-700 ring-red-600/20",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function BucketBadge({ bucket }: { bucket: Bucket }) {
  const meta = BUCKET_META[bucket];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
        TONE_BADGE[meta.tone]
      }`}
    >
      {meta.label}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
