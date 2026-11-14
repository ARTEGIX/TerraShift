"use client";

import { LogOut, Menu, Sprout, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getStoredUser, getToken, logout, onAuthChange } from "@/lib/api";
import type { UserProfile } from "@/lib/types";

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const sync = () => setUser(getToken() ? getStoredUser() : null);
    sync();
    return onAuthChange(sync);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  const links = [
    { href: "/farm", label: "New plan" },
    ...(user ? [{ href: "/farms", label: "My fields" }] : []),
    { href: "/results/demo", label: "Sample report" },
  ];
  const linkCls = (href: string) =>
    `rounded-lg px-3 py-2 hover:bg-leaf-50 hover:text-leaf-700 ${pathname?.startsWith(href) ? "text-leaf-700" : ""}`;

  async function signOut() {
    await logout();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-[1500] border-b border-soil-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-leaf-700">
          <Sprout className="size-6" aria-hidden />
          TerraShift
        </Link>

        <nav className="hidden items-center gap-1 text-sm font-medium text-slate-700 md:flex" aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={linkCls(l.href)}>
              {l.label}
            </Link>
          ))}
          {user ? (
            <span className="ml-2 flex items-center gap-2">
              <span className="max-w-[10rem] truncate text-slate-500">{user.name}</span>
              <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 hover:bg-slate-100">
                <LogOut className="size-4" aria-hidden /> Sign out
              </button>
            </span>
          ) : (
            <Link href="/login" className="ml-2 rounded-lg bg-leaf-600 px-4 py-2 text-white hover:bg-leaf-700">
              Sign in
            </Link>
          )}
        </nav>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="grid size-11 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 md:hidden"
        >
          {open ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
        </button>
      </div>

      {open && (
        <nav className="border-t border-soil-100 bg-white px-4 py-2 text-base font-medium text-slate-800 md:hidden" aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="block rounded-lg px-3 py-3 hover:bg-leaf-50">
              {l.label}
            </Link>
          ))}
          {user ? (
            <button type="button" onClick={signOut} className="block w-full rounded-lg px-3 py-3 text-left hover:bg-slate-100">
              Sign out ({user.name})
            </button>
          ) : (
            <Link href="/login" className="block rounded-lg px-3 py-3 text-leaf-700 hover:bg-leaf-50">
              Sign in
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
