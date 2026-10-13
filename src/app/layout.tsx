import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "ZiggoPay Reconciliation",
  description: "Reconcile the internal MTO ledger against the GTBank customer statement.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Nav />
          <main className="min-w-0 flex-1">
            <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
