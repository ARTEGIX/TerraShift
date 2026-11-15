import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Navbar from "@/components/Navbar";
import "./globals.css";

// tailwind.config.ts maps `font-sans` to this variable.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "TerraShift — Field Shift: Adapting Farms with NASA Data",
  description: "Climate-smart 3-season crop rotation planner powered by NASA POWER agroclimatology and Gemini.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#237032",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col font-sans">
        <Navbar />
        {/* Each page sets its own width: the map step is full-bleed, forms are narrow. */}
        <main className="w-full flex-1">{children}</main>
        <footer className="no-print border-t border-black/[0.06] px-4 py-5 text-center text-[12px] leading-relaxed text-ink-4">
          TerraShift · NASA Space Apps 2026 · Climate data: NASA POWER · Map layers: NASA GIBS · Plans support your own
          judgement and local advice; they don&apos;t replace them.
        </footer>
      </body>
    </html>
  );
}
