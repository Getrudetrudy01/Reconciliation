"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SettingsForm({
  feeAmount,
  tolerance,
}: {
  feeAmount: number;
  tolerance: number;
}) {
  const router = useRouter();
  const [fee, setFee] = useState(String(feeAmount));
  const [tol, setTol] = useState(String(tolerance));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setMessage("");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeAmount: Number(fee), tolerance: Number(tol) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status}).`);
      }
      setState("saved");
      setMessage("Defaults saved.");
      router.refresh();
    } catch (err) {
      setState("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">Default fee amount</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tnum focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700">Default tolerance</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={tol}
          onChange={(e) => setTol(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tnum focus:border-slate-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">
          Absolute currency tolerance when comparing bank debit to ledger amount + fee.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state === "saving"}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-slate-300"
        >
          {state === "saving" ? "Saving…" : "Save defaults"}
        </button>
        {message ? (
          <span className={`text-sm ${state === "error" ? "text-red-600" : "text-emerald-600"}`}>
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
