"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { clearAccessToken } from "@/lib/auth";
import ThemeToggle from "@/components/ThemeToggle";
import * as React from "react";

type Role = "ADMIN" | "SETTER" | "CLOSER";
type Me = { id: string; email: string; role: Role; firstName?: string | null };

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="currentColor" d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>
    </svg>
  );
}
function IconProspects() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="currentColor" d="M12 12a5 5 0 1 0-5-5a5 5 0 0 0 5 5m-7 9a7 7 0 0 1 14 0z"/>
    </svg>
  );
}
function IconBudget() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="currentColor" d="M3 6h18v12H3zM6 9h3v6H6zM11 9h7v2h-7zM11 13h7v2h-7z"/>
    </svg>
  );
}
function IconZap() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="currentColor" d="M13 2L3 14h7l-1 8l11-14h-7z"/>
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="currentColor" d="M16 13a4 4 0 1 0-4-4a4 4 0 0 0 4 4m-8 0a4 4 0 1 0-4-4a4 4 0 0 0 4 4m0 2c-3.31 0-6 2.69-6 6h4a6 6 0 0 1 6-6zm8 0c-1.5 0-2.87.56-3.9 1.48A7.96 7.96 0 0 1 18 23h4c0-3.31-2.69-6-6-6"/>
    </svg>
  );
}

function RolePill({ role }: { role?: Role }) {
  if (!role) return null;
  const map: Record<Role, string> = {
    ADMIN: "bg-indigo-400/15 border-indigo-400/30 text-indigo-200",
    CLOSER: "bg-emerald-400/15 border-emerald-400/30 text-emerald-200",
    SETTER: "bg-sky-400/15 border-sky-400/30 text-sky-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] tracking-wide uppercase ${map[role]}`}>
      {role}
    </span>
  );
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const safeSearchParams = useMemo(
    () => searchParams ?? new URLSearchParams(),
    [searchParams]
  );
  const safePathname = pathname ?? "/";
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get("/auth/me")
      .then((r) => { if (!cancelled) setMe(r.data as Me); })
      .catch(() => { if (!cancelled) setMe(null); });
    return () => { cancelled = true; };
  }, []);

  const NAV = useMemo(() => {
    const role = me?.role as Role | undefined;
type NavItem = { label: string; href: string; icon: React.ReactNode };
const items: NavItem[] = [
      { label: "Prospects", href: "/prospects", icon: <IconProspects /> },
    ];
    if (role === "ADMIN") {
      items.unshift({ label: "Dashboard", href: "/dashboard", icon: <IconDashboard /> });
      items.push(
        { label: "Budgets", href: "/budgets", icon: <IconBudget /> },
        { label: "Webhooks (GHL)", href: "/integrations/automatisations", icon: <IconZap /> },
        { label: "Utilisateurs", href: "/users", icon: <IconUsers /> },
      );
      return items;
    }
    return items;
  }, [me?.role]);

  const isActive = (href: string) => {
    const url = new URL(href, "http://x");
    const hrefPath = url.pathname;
    const hrefView = url.searchParams.get("view");
    if (hrefPath === "/dashboard") {
      if (hrefView) {
        return (
          safePathname === "/dashboard" &&
          safeSearchParams.get("view") === hrefView
        );
      }
      return safePathname === "/dashboard" && !safeSearchParams.get("view");
    }
    return (
      safePathname === hrefPath || safePathname.startsWith(hrefPath + "/")
    );
  };

  const who = me?.firstName?.trim() || (me?.email ? me.email.split("@")[0] : "—");

  return (
    // FIXED, full height, collée à gauche (comme GHL)
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 overflow-hidden border-r border-white/10 bg-white/[0.03] backdrop-blur-xl shadow-[0_10px_50px_rgba(0,0,0,0.35)] sm:block">
      {/* Décor doux */}
      <div className="pointer-events-none absolute -top-10 -right-16 h-56 w-56 rounded-full bg-indigo-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />

      {/* Header (fixe) */}
      <div className="relative border-b border-white/10 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 border border-white/10">
            <IconDashboard />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm tracking-widest text-white/60 uppercase">Capability</div>
            <div className="flex items-center gap-2">
              <div className="truncate font-semibold">Capability Dashboard</div>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-white/[0.04] border border-white/10 p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white/80 truncate">{who}</span>
            <RolePill role={me?.role} />
          </div>
          <div className="text-[11px] text-white/50 truncate">{me?.email || " "}</div>
        </div>
      </div>

      {/* NAV (SEULE ZONE QUI SCROLLE) */}
      <div className="flex h-[calc(100dvh-164px)] flex-col">
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-1">
            {NAV.map((it) => {
              const active = isActive(it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition
                      ${active
                        ? "bg-white/12 border border-white/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                        : "hover:bg-white/8 border border-transparent"
                      }`}
                    title={it.label}
                  >
                    <span className={`grid h-8 w-8 place-items-center rounded-lg border 
                      ${active ? "bg-white/10 border-white/20" : "bg-white/5 border-white/10 group-hover:bg-white/8"}`}>
                      <span className="opacity-90">{it.icon}</span>
                    </span>
                    <span className="truncate">{it.label}</span>
                    <span className={`ml-auto h-5 w-1 rounded-full transition 
                      ${active ? "bg-indigo-400/80" : "bg-transparent group-hover:bg-white/20"}`} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer (fixe en bas de la sidebar) */}
        <div className="border-t border-white/10 bg-white/[0.02] px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-white/60">Préférences</div>
            <ThemeToggle />
          </div>

          <button
            onClick={() => { clearAccessToken(); router.replace("/login"); }}
            className="mt-3 w-full rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/[0.15] transition"
            title="Se déconnecter"
          >
            Déconnexion
          </button>

          <div className="mt-3 text-center text-[10px] text-white/40">
            © {new Date().getFullYear()} — Capability Dashboard
          </div>
        </div>
      </div>
    </aside>
  );
  
}
