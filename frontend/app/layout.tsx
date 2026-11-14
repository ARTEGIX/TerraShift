import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "TerraShift — Field Shift: Adapting Farms with NASA Data",
  description: "Climate-smart 3-season crop rotation optimizer powered by NASA POWER agroclimatology & Gemini.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-soil-100 bg-white/90 backdrop-blur sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="font-bold text-lg text-leaf-700 flex items-center gap-2">
              <span>🌱</span>
              <span>TerraShift</span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-leaf-50 text-leaf-700 border border-leaf-100">
                NASA Space Apps 2026
              </span>
            </Link>
            <nav className="flex items-center gap-5 text-sm font-medium text-slate-700">
              <Link href="/farm" className="hover:text-leaf-700">
                Analyze Field
              </Link>
              <Link href="/results/demo" className="hover:text-leaf-700">
                Sample Report
              </Link>
              <Link
                href="/login"
                className="px-3 py-1.5 rounded-lg bg-leaf-600 text-white hover:bg-leaf-700 transition"
              >
                Sign In
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">{children}</main>
        <footer className="border-t border-soil-100 bg-white py-4 text-center text-xs text-slate-500">
          TerraShift · Powered by NASA POWER MERRA-2 Agroclimatology, Genetic Rotation Optimization &amp; Google Gemini
        </footer>
      </body>
    </html>
  );
}
