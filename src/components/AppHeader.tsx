"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { post } from "./client-api";

const NAV = [
  { href: "/court-day", label: "Court day" },
  { href: "/cases", label: "Cases" },
  { href: "/upload", label: "Upload" },
  { href: "/phones", label: "Phones" },
  { href: "/reminders", label: "Reminders" },
  { href: "/audit", label: "Audit log" },
  { href: "/billing", label: "Billing", admin: true },
  { href: "/settings", label: "Settings", admin: true },
];

export function AppHeader({ firmName, userName, role, reminderCount }: { firmName: string; userName: string; role: string; reminderCount: number }) {
  const path = usePathname();
  return (
    <header className="bg-plum-900 text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-3">
        <div className="flex items-baseline gap-3">
          <Link href="/court-day" className="font-serif text-xl">Docketlight</Link>
          <span data-testid="firm-name" className="text-sm text-plum-100">{firmName}</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-plum-100">
          <span>{userName}, {role === "admin" ? "Firm Admin" : "Team Member"}</span>
          <button
            className="underline underline-offset-2 hover:text-white"
            onClick={async () => { await post("/api/auth/logout"); window.location.href = "/"; }}
          >
            Switch login
          </button>
        </div>
      </div>
      <nav aria-label="Main" className="mx-auto mt-2 flex max-w-7xl gap-1 overflow-x-auto px-3">
        {NAV.filter((n) => !n.admin || role === "admin").map((n) => {
          const active = path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-semibold ${active ? "bg-paper text-plum-900" : "text-plum-100 hover:bg-plum-800"}`}>
              {n.label}
              {n.href === "/reminders" && reminderCount > 0 && (
                <span className="ml-1.5 rounded-full bg-action px-1.5 py-0.5 text-xs text-white">{reminderCount}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
