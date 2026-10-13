"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard", exact: true },
  { href: "/reconcile", label: "Reconcile" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="text-sm font-semibold tracking-tight text-slate-900">ZiggoPay / EziPay</div>
        <div className="text-xs text-slate-500">Reconciliation</div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {LINKS.map((l) => {
          const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 px-5 py-3 text-[11px] leading-tight text-slate-400">
        Internal finance ops tool · v1 · no auth
      </div>
    </aside>
  );
}
