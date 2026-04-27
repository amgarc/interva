import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interva — IR Physician Funnel",
  description: "National outreach funnel for Interventional Radiology physicians",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-black/10 dark:border-white/10">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
            <Link href="/" className="font-semibold">
              Interva
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="opacity-70 hover:opacity-100">
                Directory
              </Link>
              <Link href="/outreach" className="opacity-70 hover:opacity-100">
                Outreach
              </Link>
            </nav>
            <span className="text-sm opacity-60 ml-auto">IR Physician Funnel</span>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
