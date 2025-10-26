"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import api from "@/lib/api";
import { currentMonthRange } from "@/lib/date";
import Sidebar from "@/components/Sidebar";
import DateRangePicker, { type Range } from "@/components/DateRangePicker";
import ClosersRevenueBar from "@/components/charts/ClosersRevenueBar";
import SettersLeadsBar from "@/components/charts/SettersLeadsBar";
import RankingTable from "@/components/RankingTable";
import { motion, AnimatePresence } from "framer-motion";
import { getAccessToken } from "@/lib/auth";
import Clock from "@/components/Clock";
import PdfExports from "@/components/PdfExports";
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";

// ——— KPI Ratio chip (premium) ———
const KpiRatio = ({
  label,
  num = 0,
  den = 0,
  inverse = false, // pour les no-show (plus c'est bas, mieux c'est)
}: { label: string; num?: number; den?: number; inverse?: boolean }) => {
  const pct = den ? Math.round((num / den) * 100) : 0;
  // simple “health” color: vert si bon, rose si mauvais (inverse pour no-show)
  const good =
    den === 0 ? false :
    inverse ? pct <= 20 : pct >= 50;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[--muted]">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <div className={`text-lg font-semibold ${good ? 'text-emerald-300' : 'text-rose-300'}`}>
          {pct}%
        </div>
        <div className="text-xs text-[--muted]">
          {(num || 0).toLocaleString('fr-FR')} / {(den || 0).toLocaleString('fr-FR')}
        </div>
      </div>
    </div>
  );
};

/* ---------- Types alignés backend ---------- */
type SetterRow = {
  userId: string; name: string; email: string;
  leadsReceived: number; rv0Count: number; rv1FromHisLeads: number;
  ttfcAvgMinutes: number | null; revenueFromHisLeads: number;
  spendShare?: number | null;
  cpl: number | null; cpRv0: number | null; cpRv1: number | null; roas: number | null;
  salesFromHisLeads: number; // <<<<<< nouveau

};

type CloserRow = {
  userId: string; name: string; email: string;
  rv1Planned: number; rv1Honored: number; rv1NoShow: number;
  rv2Planned: number; rv2Honored: number; salesClosed: number;
  revenueTotal: number; roasPlanned: number | null; roasHonored: number | null;
};

type DuoRow = {
  setterId: string; setterName: string; setterEmail: string;
  closerId: string; closerName: string; closerEmail: string;
  salesCount: number; revenue: number; avgDeal: number;
  rv1Planned: number; rv1Honored: number; rv1HonorRate: number | null;
};

type LeadsReceivedOut = { total: number; byDay?: Array<{ day: string; count: number }>; };

/** Séries par jour génériques (même forme que leads-received) */
type MetricSeriesOut = { total: number; byDay?: Array<{ day: string; count: number }> };

type SalesWeeklyItem = { weekStart: string; weekEnd: string; revenue: number; count: number };
type SummaryOut = {
  period: { from?: string; to?: string };
  totals: {
    leads: number; revenue: number; salesCount: number; spend: number; roas: number | null;
    settersCount: number; closersCount: number; rv1Honored: number;
  };
};

type WeeklyOpsRow = {
  weekStart: string; weekEnd: string;
  rv0Planned: number; rv0Honored: number; rv0NoShow?: number;
  rv1Planned: number; rv1Honored: number; rv1NoShow: number; rv1Postponed?: number;
  rv2Planned: number; rv2Honored: number; rv2Postponed?: number;
  notQualified?: number; lost?: number;
};

type FunnelTotals = {
  leads: number; callRequests: number; callsTotal: number; callsAnswered: number; setterNoShow: number;
  rv0Planned: number; rv0Honored: number; rv0NoShow: number;
  rv1Planned: number; rv1Honored: number; rv1NoShow: number; rv1Postponed?: number;
  rv2Planned: number; rv2Honored: number; rv2Postponed?: number;
  notQualified?: number; lost?: number;
  wonCount: number;
};
type FunnelWeeklyRow = { weekStart: string; weekEnd: string } & FunnelTotals;
type FunnelOut = { period: { from?: string; to?: string }; totals: Partial<FunnelTotals>; weekly: FunnelWeeklyRow[] };

/* ---------- UI tokens ---------- */
const COLORS = {
  axis: "rgba(255,255,255,0.7)",
  grid: "rgba(255,255,255,0.08)",
  tooltipBg: "rgba(17,24,39,0.9)",
  tooltipBorder: "rgba(255,255,255,0.08)",
  revenue: "#6366F1", revenueDark: "#4F46E5",
  leads: "#22C55E", leadsDark: "#16A34A",
  count: "#F59E0B", countDark: "#D97706",
};
/* ---------- Utils ---------- */
function asDate(x?: Date | string | null): Date | null { if (!x) return null; const d = x instanceof Date ? x : new Date(x as any); return isNaN(d.getTime()) ? null : d; }
function toISODate(d: Date | string) { const dd = d instanceof Date ? d : new Date(d); const y = dd.getFullYear(); const m = String(dd.getMonth() + 1).padStart(2, "0"); const day = String(dd.getDate()).padStart(2, "0"); return `${y}-${m}-${day}`; }
const fmtInt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const fmtEUR = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;
/* ---------- Tooltip (Recharts) ---------- */
function ProTooltip({ active, payload, label, valueFormatters, title }: { active?: boolean; payload?: any[]; label?: string; valueFormatters?: Record<string, (v: number) => string>; title?: string; }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-xl px-3 py-2 text-sm shadow-xl" style={{ background: COLORS.tooltipBg, border: `1px solid ${COLORS.tooltipBorder}` }}>
      {title && <div className="text-[10px] uppercase tracking-wide opacity-70">{title}</div>}
      {label && <div className="font-medium mb-1">{label}</div>}
      <div className="space-y-0.5">
        {payload.map((entry, i) => {
          const key = entry.dataKey as string; const v = Number(entry.value ?? 0); const fmt = valueFormatters?.[key];
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded" style={{ background: entry.color || entry.fill }} />
              <span className="opacity-80">{entry.name ?? key}</span>
              <span className="ml-auto font-semibold">{fmt ? fmt(v) : v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
/* ---------- Drill Modal ---------- */
type DrillItem = {
  leadId: string;
  leadName: string;
  email?: string | null; phone?: string | null;
  setter?: { id: string; name: string; email: string } | null;
  closer?: { id: string; name: string; email: string } | null;
  appointment?: { type: string; status?: string; scheduledAt: string } | null;
  saleValue?: number | null; stage?: string; createdAt?: string; stageUpdatedAt?: string;
};
function DrillModal({ title, open, onClose, rows }: { title: string; open: boolean; onClose: () => void; rows: DrillItem[]; }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        className="w-full max-w-5xl max-h-[80vh] overflow-auto rounded-2xl border border-white/10 bg-[rgba(16,22,33,.98)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">{title}</div>
          <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-left text-[--muted] sticky top-0 bg-[rgba(16,22,33,.98)]">
              <tr>
                <th className="py-2 pr-2">Lead</th>
                <th className="py-2 pr-2">Setter</th>
                <th className="py-2 pr-2">Closer</th>
                <th className="py-2 pr-2">RDV</th>
                <th className="py-2 pr-2">€</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map(r => (
                <tr key={r.leadId + Math.random()} className="border-t border-white/10">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{r.leadName}</div>
                    <div className="text-xs text-[--muted]">{r.email ?? "—"} • {r.phone ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-2">{r.setter?.name ?? "—"}</td>
                  <td className="py-2 pr-2">{r.closer?.name ?? "—"}</td>
                  <td className="py-2 pr-2">
                    {r.appointment ? (
                      <>
                        <div className="text-xs">{r.appointment.type}{r.appointment.status ? ` (${r.appointment.status})` : ""}</div>
                        <div className="text-xs text-[--muted]">{new Date(r.appointment.scheduledAt).toLocaleString()}</div>
                      </>
                    ) : "—"}
                  </td>
                  <td className="py-2 pr-2">{r.saleValue ? `${Math.round(r.saleValue).toLocaleString("fr-FR")} €` : "—"}</td>
                </tr>
              )) : (
                <tr><td className="py-6 text-[--muted]" colSpan={5}>Aucune ligne</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

/* ---------- Funnel (toutes cartes cliquables) ---------- */
function Funnel({
  data,
  onCardClick,
}: {
  data: {
    leads: number; callRequests: number; callsTotal: number; callsAnswered: number; setterNoShow: number;
    rv0P: number; rv0H: number; rv0NS: number; rv1P: number; rv1H: number; rv1NS: number; rv2P: number; rv2H: number; won: number;
  };
  onCardClick: (key:
    | "leads" | "callRequests" | "callsTotal" | "callsAnswered" | "setterNoShow"
    | "rv0Planned" | "rv0Honored" | "rv0NoShow"
    | "rv1Planned" | "rv1Honored" | "rv1NoShow"
    | "rv2Planned" | "rv2Honored"
    | "wonCount"
  ) => void;
}) {
  const cards = [
    { key: "leads", label: "Leads reçus", value: data.leads, hint: "Contacts créés durant la période." },
    { key: "callRequests", label: "Demandes d’appel", value: data.callRequests, hint: "Intentions de prise de RDV." },
    { key: "callsTotal", label: "Appels passés", value: data.callsTotal, hint: "Tentatives de contact." },
    { key: "callsAnswered", label: "Appels répondus", value: data.callsAnswered, hint: "Prospects joints." },
    { key: "setterNoShow", label: "No-show Setter", value: data.setterNoShow, hint: "Appelés mais jamais joints." },
    { key: "rv0Planned", label: "RV0 planifiés", value: data.rv0P, hint: "Premiers RDV programmés." },
    { key: "rv0Honored", label: "RV0 honorés", value: data.rv0H, hint: "Premiers RDV tenus." },
    { key: "rv0NoShow", label: "RV0 no-show", value: data.rv0NS, hint: "Absences au premier RDV." },
    { key: "rv1Planned", label: "RV1 planifiés", value: data.rv1P, hint: "Closings programmés." },
    { key: "rv1Honored", label: "RV1 honorés", value: data.rv1H, hint: "Closings tenus." },
    { key: "rv1NoShow", label: "RV1 no-show", value: data.rv1NS, hint: "Absences au closing." },
    { key: "rv2Planned", label: "RV2 planifiés", value: data.rv2P, hint: "Deuxièmes RDV." },
    { key: "rv2Honored", label: "RV2 honorés", value: data.rv2H, hint: "Deuxièmes RDV tenus." },
    { key: "wonCount", label: "Ventes (WON)", value: data.won, hint: "Passages en client." },
  ] as const;

  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <div className="rounded-2xl border border-white/10 p-4 bg-[rgba(12,17,26,.6)]">
      <div className="mb-3 font-medium">Funnel opérationnel</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-7 xl:grid-cols-14 gap-2">
        {cards.map((c) => (
          <button
            key={c.key}
            className="text-left rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            title={c.hint}
            onClick={() => onCardClick(c.key)}
          >
            <div className="text-[10px] uppercase tracking-wide text-[--muted]">{c.label}</div>
            <div className="mt-1 text-xl font-semibold">{fmtInt(c.value)}</div>
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs text-[--muted]">
        <div>Taux de contact : <b>{rate(data.callsAnswered, data.callsTotal)}</b></div>
        <div>Présence RV1 : <b>{rate(data.rv1H, data.rv1P)}</b></div>
        <div>No-show RV1 : <b>{rate(data.rv1NS, data.rv1P)}</b></div>
        <div>Conversion finale : <b>{rate(data.won, data.leads)}</b></div>
      </div>
    </div>
  );
}

/* ---------- Trend badge ---------- */
function Trend({ curr, prev, compact }: { curr: number; prev: number; compact?: boolean }) {
  const diff = curr - (prev || 0);
  const pct = prev ? (diff / prev) * 100 : (curr ? 100 : 0);
  const up = diff >= 0;
  return (
    <span className={`ml-2 ${compact ? "text-[10px]" : "text-xs"} ${up ? "text-emerald-300" : "text-rose-300"}`}
      title={`${up ? "Hausse" : "Baisse"} de ${Math.abs(diff).toLocaleString("fr-FR")} (${Math.abs(pct).toFixed(1)}%) vs période précédente`}>
      {up ? "↑" : "↓"} {Math.abs(diff).toLocaleString("fr-FR")} ({Math.abs(pct).toFixed(1)}%)
    </span>
  );
}

/* ============================= PAGE ============================= */
export default function DashboardPage() {
  const router = useRouter();
  const search = useSearchParams();
  const view = (search.get("view") || "home") as "home" | "closers" | "setters" | "contracts" | "users" | "exports";

  const { from: defaultFrom, to: defaultTo } = useMemo(() => currentMonthRange(), []);
  const [range, setRange] = useState<Range>({ from: defaultFrom, to: defaultTo });
  const [draftRange, setDraftRange] = useState<Range>({ from: defaultFrom, to: defaultTo });

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [comparePrev, setComparePrev] = useState<boolean>(true);

  const fromISO = range.from ? toISODate(range.from) : undefined;
  const toISO = range.to ? toISODate(range.to) : undefined;

  // Période précédente (même durée)
  const { prevFromISO, prevToISO } = useMemo(() => {
    if (!range.from || !range.to) return { prevFromISO: undefined, prevToISO: undefined };
    const from = asDate(range.from)!; const to = asDate(range.to)!;
    const span = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 24 * 3600 * 1000);
    const prevFrom = new Date(prevTo.getTime() - span); 
    return { prevFromISO: toISODate(prevFrom), prevToISO: toISODate(prevTo) };
  }, [range.from, range.to]);

  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [setters, setSetters] = useState<SetterRow[]>([]);
  const [closers, setClosers] = useState<CloserRow[]>([]);
  const [summary, setSummary] = useState<SummaryOut | null>(null);
  const [leadsRcv, setLeadsRcv] = useState<LeadsReceivedOut | null>(null);
  const [salesWeekly, setSalesWeekly] = useState<SalesWeeklyItem[]>([]);
  const [ops, setOps] = useState<WeeklyOpsRow[]>([]);
  const [funnel, setFunnel] = useState<FunnelOut | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [duos, setDuos] = useState<DuoRow[]>([]);

  // Séries par jour : call requests / calls total / calls answered
  const [mCallReq, setMCallReq] = useState<MetricSeriesOut | null>(null);
  const [mCallsTotal, setMCallsTotal] = useState<MetricSeriesOut | null>(null);
  const [mCallsAnswered, setMCallsAnswered] = useState<MetricSeriesOut | null>(null);

  // RV0 no-show par semaine
  type Rv0NsWeek = { weekStart: string; weekEnd: string; label: string; count: number };
  const [rv0NsWeekly, setRv0NsWeekly] = useState<Rv0NsWeek[]>([]);

  // Drill modal
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState("");
  const [drillRows, setDrillRows] = useState<DrillItem[]>([]);

  // Helper : funnel vide
  const EMPTY_FUNNEL: FunnelOut = {
    period: { from: fromISO, to: toISO },
    totals: {
      leads: 0, callRequests: 0, callsTotal: 0, callsAnswered: 0, setterNoShow: 0,
      rv0Planned: 0, rv0Honored: 0, rv0NoShow: 0,
      rv1Planned: 0, rv1Honored: 0, rv1NoShow: 0, rv1Postponed: 0,
      rv2Planned: 0, rv2Honored: 0, rv2Postponed: 0,
      notQualified: 0, lost: 0,
      wonCount: 0,
    },
    weekly: [],
  };

  // Helper fetch "metric/*" safe (retourne null si route absente)
  async function fetchSafeMetric(url: string, params: Record<string, any>) {
    try { return await api.get<MetricSeriesOut>(url, { params }); }
    catch { return { data: null } as any; }
  }

  // Auth
  useEffect(() => {
    let cancelled = false;
    async function verify() {
      const token = getAccessToken();
      if (!token) { router.replace("/login"); return; }
      try { await api.get("/auth/me"); if (!cancelled) { setAuthChecked(true); setAuthError(null); } }
      catch { if (!cancelled) { setAuthChecked(true); setAuthError("Non autorisé. Veuillez vous reconnecter."); } }
    }
    verify();
    return () => { cancelled = true; };
  }, [router]);

  // Data (courant)
  useEffect(() => {
    if (!authChecked || authError) return;
    let cancelled = false;
    async function loadReporting() {
      try {
        setErr(null); setLoading(true);
        const [sumRes, leadsRes, weeklyRes, opsRes, funnelRes, duosRes] = await Promise.all([
          api.get<SummaryOut>("/reporting/summary", { params: { from: fromISO, to: toISO } }),
          api.get<LeadsReceivedOut>("/reporting/leads-received", { params: { from: fromISO, to: toISO } }),
          api.get<SalesWeeklyItem[]>("/reporting/sales-weekly", { params: { from: fromISO, to: toISO } }),
          api.get<{ ok: true; rows: WeeklyOpsRow[] }>("/reporting/weekly-ops", { params: { from: fromISO, to: toISO } }),
          api.get<FunnelOut>("/reporting/funnel", { params: { from: fromISO, to: toISO } }),
          api.get<DuoRow[]>("/reporting/duos", { params: { from: fromISO, to: toISO, top: 8 } }), // << NEW
        ]);
        if (cancelled) return;
        setSummary(sumRes.data || null);
        setLeadsRcv(leadsRes.data || null);
        setSalesWeekly((weeklyRes.data || []).sort((a,b)=>a.weekStart.localeCompare(b.weekStart)));
        setOps((opsRes.data?.rows || []).sort((a,b)=>a.weekStart.localeCompare(b.weekStart)));
        setDuos(duosRes.data || []);

        const fdata = funnelRes.data as Partial<FunnelOut> | null | undefined;
        if (!fdata || typeof fdata !== "object") {
          setFunnel(EMPTY_FUNNEL);
        } else {
          const mergedTotals = { ...(EMPTY_FUNNEL.totals as any), ...(fdata.totals || {}) };
          setFunnel({
            period: fdata.period ?? { from: fromISO, to: toISO },
            totals: mergedTotals,
            weekly: Array.isArray(fdata.weekly) ? fdata.weekly : [],
          });
        }

        // ---- séries "par jour" (optionnelles, comme leads-received) ----
        const [m1, m2, m3] = await Promise.all([
          fetchSafeMetric("/reporting/metric/call-requests", { from: fromISO, to: toISO }),
          fetchSafeMetric("/reporting/metric/calls", { from: fromISO, to: toISO }),
          fetchSafeMetric("/reporting/metric/calls-answered", { from: fromISO, to: toISO }),
        ]);
        if (!cancelled) {
          setMCallReq(m1?.data || null);
          setMCallsTotal(m2?.data || null);
          setMCallsAnswered(m3?.data || null);
        }

        // RV0 no-show weekly (drill "appointments")
        const res = await api.get("/reporting/drill/appointments", {
          params: { type: "RV0", status: "NO_SHOW", from: fromISO, to: toISO, limit: 5000 },
        });
        const items: DrillItem[] = res.data?.items || [];

        function monday(d: Date) { const dd = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)); const dow = (dd.getUTCDay() + 6) % 7; dd.setUTCDate(dd.getUTCDate() - dow); return dd; }
        function sunday(d: Date) { const m = monday(d); const s = new Date(m); s.setUTCDate(s.getUTCDate() + 6); s.setUTCHours(23,59,59,999); return s; }

        const map = new Map<string, { start: Date; end: Date; count: number }>();
        for (const it of items) {
          const when = it.appointment?.scheduledAt ? new Date(it.appointment.scheduledAt) : null;
          if (!when || isNaN(when.getTime())) continue;
          const ws = monday(when); const we = sunday(when);
          const key = ws.toISOString();
          const row = map.get(key) ?? { start: ws, end: we, count: 0 };
          row.count += 1; map.set(key, row);
        }
        const weeks: Rv0NsWeek[] = [];
        if (fromISO && toISO) {
          const start = monday(new Date(fromISO));
          const end = sunday(new Date(toISO));
          for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
            const ws = new Date(d); const we = sunday(ws); const key = ws.toISOString();
            weeks.push({
              weekStart: ws.toISOString(),
              weekEnd: we.toISOString(),
              label: ws.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " → " + we.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
              count: map.get(key)?.count ?? 0,
            });
          }
        }
        setRv0NsWeekly(weeks);
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.response?.data?.message || "Erreur de chargement (reporting)");
        setFunnel(EMPTY_FUNNEL);
      } finally { if (!cancelled) setLoading(false); }
    }
    loadReporting();
    return () => { cancelled = true; };
  }, [authChecked, authError, fromISO, toISO]);

  // Classements
  useEffect(() => {
    if (!authChecked || authError) return;
    let cancelled = false;
    async function load() {
      const q = { from: fromISO, to: toISO };
      try {
        const [sRes, cRes] = await Promise.all([
          api.get<SetterRow[]>("/reporting/setters", { params: q }),
          api.get<CloserRow[]>("/reporting/closers", { params: q }),
        ]);
        if (cancelled) return;
        setSetters(sRes.data || []);
        setClosers(cRes.data || []);
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.response?.data?.message || "Erreur de chargement (classements)");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [authChecked, authError, fromISO, toISO]);

  // Graphs data
  const closersChart = useMemo(() => closers.map(c => ({ name: c.name, revenue: c.revenueTotal })), [closers]);
  const settersChart = useMemo(() => setters.map(s => ({ name: s.name, leads: s.leadsReceived })), [setters]);

  // Tri tableaux
  const [closerSortBy] = useState<keyof CloserRow>("revenueTotal");
  const [closerOrder] = useState<"asc" | "desc">("desc");
  const sortedClosers = useMemo(() => {
    const arr = [...closers];
    return arr.sort((a, b) => {
      const av = (a as any)[closerSortBy] ?? 0; const bv = (b as any)[closerSortBy] ?? 0;
      return closerOrder === "asc" ? av - bv : bv - av;
    });
  }, [closers, closerSortBy, closerOrder]);

  const [setterSortBy] = useState<keyof SetterRow>("rv1FromHisLeads");
  const [setterOrder] = useState<"asc" | "desc">("desc");
  const sortedSetters = useMemo(() => {
    const arr = [...setters];
    return arr.sort((a, b) => {
      const av = (a as any)[setterSortBy] ?? 0; const bv = (b as any)[setterSortBy] ?? 0;
      return setterOrder === "asc" ? av - bv : bv - av;
    });
  }, [setters, setterSortBy, setterOrder]);

  // KPIs
  const kpiRevenue = summary?.totals?.revenue ?? 0;
  const kpiLeads = summary?.totals?.leads ?? 0;
  const kpiRv1Honored = summary?.totals?.rv1Honored ?? 0;

  // Prev (pour Trend)
  const [summaryPrev, setSummaryPrev] = useState<SummaryOut | null>(null);
  const [leadsPrev, setLeadsPrev] = useState<LeadsReceivedOut | null>(null);
  useEffect(() => {
    if (!comparePrev || !fromISO || !toISO) { setSummaryPrev(null); setLeadsPrev(null); return; }
    (async () => {
      try {
        const span = new Date(toISO).getTime() - new Date(fromISO).getTime();
        const prevTo = new Date(new Date(fromISO).getTime() - 24 * 3600 * 1000);
        const prevFrom = new Date(prevTo.getTime() - span);
        const [sum, leads] = await Promise.all([
          api.get<SummaryOut>("/reporting/summary", { params: { from: toISODate(prevFrom), to: toISODate(prevTo) } }),
          api.get<LeadsReceivedOut>("/reporting/leads-received", { params: { from: toISODate(prevFrom), to: toISODate(prevTo) } }),
        ]);
        setSummaryPrev(sum.data || null);
        setLeadsPrev(leads.data || null);
      } catch { setSummaryPrev(null); setLeadsPrev(null); }
    })();
  }, [comparePrev, fromISO, toISO]);
  const kpiRevenuePrev = summaryPrev?.totals?.revenue ?? 0;
  const kpiLeadsPrev = leadsPrev?.total ?? 0;
  const kpiRv1HonoredPrev = summaryPrev?.totals?.rv1Honored ?? 0;

  // ======= DRILLS : helpers endpoints =======
  async function openAppointmentsDrill(params: { title: string; type?: "RV0"|"RV1"|"RV2"; status?: "HONORED"|"POSTPONED"|"CANCELED"|"NO_SHOW"|"NOT_QUALIFIED"; from?: string; to?: string; }) {
    const res = await api.get("/reporting/drill/appointments", {
      params: { type: params.type, status: params.status, from: params.from ?? fromISO, to: params.to ?? toISO, limit: 2000 }
    });
    setDrillTitle(params.title);
    setDrillRows(res.data?.items || []);
    setDrillOpen(true);
  }
  async function fetchSafe(url: string, params: Record<string, any>) {
    try { return await api.get(url, { params }); }
    catch (e: any) { return { data: { items: [], __error: e?.response?.data?.message || "Endpoint non disponible (à activer côté API)" } }; }
  }
  async function openCallRequestsDrill() {
    const res: any = await fetchSafe("/reporting/drill/call-requests", { from: fromISO, to: toISO, limit: 2000 });
    setDrillTitle("Demandes d’appel – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error) items.unshift({ leadId: "__msg__", leadName: res.data.__error } as any);
    setDrillRows(items);
    setDrillOpen(true);
  }
  async function openCallsDrill() {
    const res: any = await fetchSafe("/reporting/drill/calls", { from: fromISO, to: toISO, limit: 2000 });
    setDrillTitle("Appels passés – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error) items.unshift({ leadId: "__msg__", leadName: res.data.__error } as any);
    setDrillRows(items);
    setDrillOpen(true);
  }
  async function openCallsAnsweredDrill() {
    const res: any = await fetchSafe("/reporting/drill/calls", { from: fromISO, to: toISO, answered: 1, limit: 2000 });
    setDrillTitle("Appels répondus – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error) items.unshift({ leadId: "__msg__", leadName: res.data.__error } as any);
    setDrillRows(items);
    setDrillOpen(true);
  }
  async function openSetterNoShowDrill() {
    const res: any = await fetchSafe("/reporting/drill/calls", { from: fromISO, to: toISO, setterNoShow: 1, limit: 2000 });
    setDrillTitle("No-show Setter – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error) items.unshift({ leadId: "__msg__", leadName: res.data.__error } as any);
    setDrillRows(items);
    setDrillOpen(true);
  }

  const onFunnelCardClick = async (key:
    | "leads" | "callRequests" | "callsTotal" | "callsAnswered" | "setterNoShow"
    | "rv0Planned" | "rv0Honored" | "rv0NoShow"
    | "rv1Planned" | "rv1Honored" | "rv1NoShow"
    | "rv2Planned" | "rv2Honored"
    | "wonCount"
  ) => {
    switch (key) {
      case "leads": {
        const res = await api.get("/reporting/drill/leads-received", { params: { from: fromISO, to: toISO, limit: 2000 }});
        setDrillTitle("Leads reçus – détail"); setDrillRows(res.data?.items || []); setDrillOpen(true); return;
      }
      case "callRequests": return openCallRequestsDrill();
      case "callsTotal": return openCallsDrill();
      case "callsAnswered": return openCallsAnsweredDrill();
      case "setterNoShow": return openSetterNoShowDrill();

      case "rv0Planned": return openAppointmentsDrill({ title: "RV0 planifiés (détail)", type: "RV0" });
      case "rv0Honored": return openAppointmentsDrill({ title: "RV0 honorés (détail)", type: "RV0", status: "HONORED" });
      case "rv0NoShow": return openAppointmentsDrill({ title: "RV0 no-show (détail)", type: "RV0", status: "NO_SHOW" });

      case "rv1Planned": return openAppointmentsDrill({ title: "RV1 planifiés (détail)", type: "RV1" });
      case "rv1Honored": return openAppointmentsDrill({ title: "RV1 honorés (détail)", type: "RV1", status: "HONORED" });
      case "rv1NoShow": return openAppointmentsDrill({ title: "RV1 no-show (détail)", type: "RV1", status: "NO_SHOW" });

      case "rv2Planned": return openAppointmentsDrill({ title: "RV2 planifiés (détail)", type: "RV2" });
      case "rv2Honored": return openAppointmentsDrill({ title: "RV2 honorés (détail)", type: "RV2", status: "HONORED" });

      case "wonCount": {
        const res = await api.get("/reporting/drill/won", { params: { from: fromISO, to: toISO, limit: 2000 }});
        setDrillTitle("Ventes (WON) – détail"); setDrillRows(res.data?.items || []); setDrillOpen(true); return;
      }
      default: return;
    }
  };

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center text-[--muted]">Chargement…</div>;
  }
  if (authError) {
    return (
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 p-6"><div className="text-sm text-red-400">{authError}</div></main>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* ===== EN-TÊTE ===== */}
      <div className="rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(29,38,58,.9),rgba(13,18,29,.9))] px-5 py-5 relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-white/[0.04] blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row gap-5">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-white/10 flex items-center justify-center border border-white/10">
              <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/></svg>
            </div>
            <div>
              <div className="text-2xl font-semibold leading-tight">Tableau de Bord</div>
              <div className="text-xs text-[--muted]">
                Période : <b>{fromISO ?? "—"}</b> → <b>{toISO ?? "—"}</b>
              </div>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-3 text-xs text-[--muted]">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1a11 11 0 1 0 11 11A11.013 11.013 0 0 0 12 1m.75 11.44l3.9 2.34a1 1 0 0 1-1.05 1.72l-4.39-2.64a1.5 1.5 0 0 1-.71-1.29V6a1 1 0 0 1 2 0Z"/></svg>
                <Clock />
              </div>
            </div>
            <label className="hidden sm:flex items-center gap-2 text-xs">
              <input type="checkbox" checked={comparePrev} onChange={(e)=>setComparePrev(e.target.checked)} />
              Comparer période précédente
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => { setDraftRange(range); setFiltersOpen(true); }}>Filtres</button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-4">
        <Sidebar />
        <div className="flex-1 space-y-6">

          {err && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

          {/* KPI principaux */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card">
              <div className="text-xs uppercase tracking-wide text-[--muted]">Chiffre d’affaires gagné</div>
              <div className="mt-2 text-2xl font-semibold">
                {fmtEUR(kpiRevenue)} {comparePrev && <Trend curr={kpiRevenue} prev={summaryPrev?.totals?.revenue ?? 0} />}
              </div>
              <div className="text-xs text-[--muted] mt-1">Basé sur les dossiers passés en <b>client (WON)</b>.</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card">
              <div className="text-xs uppercase tracking-wide text-[--muted]">Leads reçus</div>
              <div className="mt-2 text-2xl font-semibold">
                {fmtInt(kpiLeads)} {comparePrev && <Trend curr={kpiLeads} prev={leadsPrev?.total ?? 0} />}
              </div>
              <div className="text-xs text-[--muted] mt-1">Basé sur les <b>créations de contacts</b>.</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card cursor-pointer"
              onClick={() => onFunnelCardClick("rv1Honored" as any)}>
              <div className="text-xs uppercase tracking-wide text-[--muted]">RV1 honorés</div>
              <div className="mt-2 text-2xl font-semibold">{fmtInt(kpiRv1Honored)}</div>
              <div className="text-[10px] text-[--muted] mt-1">Clique pour détails par lead</div>
            </motion.div>
          </div>
          
 {/* ======== PIPELINE INSIGHTS — Premium OpenAI-style ======== */}
<div className="relative">
  {/* Aurora background */}
  <div className="pointer-events-none absolute inset-0 -z-10">
    <div className="absolute left-1/2 -translate-x-1/2 -top-24 h-64 w-[70vw] rounded-full blur-3xl opacity-25"
         style={{ background:'radial-gradient(60% 60% at 50% 50%, rgba(99,102,241,.28), rgba(14,165,233,.15), transparent 70%)' }} />
  </div>

  {/* Header + Toggle */}
  <div className="flex items-center justify-between gap-3">
    <div>
      <div className="text-xs uppercase tracking-wider text-[--muted]">Pipeline insights</div>
      <div className="text-[13px] text-[--muted]">Vue synthétique des opérations — leads → appels → RDV → ventes</div>
    </div>

    {/* pill toggle */}
    <div className="relative">
      <div className="flex items-center rounded-full border border-white/10 bg-[rgba(18,24,38,.6)] backdrop-blur-xl p-1">
        <button
          type="button"
          onClick={() => setFunnelOpen(false)}
          className={`px-3 py-1.5 text-xs rounded-full transition-colors ${!funnelOpen ? 'bg-white/[0.08] border border-white/10' : 'opacity-70 hover:opacity-100'}`}
        >
          Aperçu
        </button>
        <button
          type="button"
          onClick={() => setFunnelOpen(true)}
          className={`px-3 py-1.5 text-xs rounded-full transition-colors ${funnelOpen ? 'bg-white/[0.08] border border-white/10' : 'opacity-70 hover:opacity-100'}`}
        >
          Détails
        </button>
      </div>
    </div>
  </div>

  {/* Overview strip — compacte quand Funnel est replié */}
  {(() => {
    const T = (funnel?.totals as any) ?? {};
    const chip = (label: string, value: number | string, hint?: string) => (
      <div className="group rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors px-3 py-2">
        <div className="text-[10px] uppercase tracking-wide text-[--muted]">{label}</div>
        <div className="mt-0.5 text-lg font-semibold">{typeof value === 'number' ? value.toLocaleString('fr-FR') : value}</div>
        {hint && <div className="text-[10px] text-[--muted]">{hint}</div>}
      </div>
    );
    return (
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {chip('Leads', T.leads ?? 0)}
        {chip('Demandes d’appel', T.callRequests ?? 0)}
        {chip('Appels passés', T.callsTotal ?? 0, T.callsAnswered ? `${Math.round((T.callsAnswered / Math.max(1,T.callsTotal))*100)}% répondus` : undefined)}
        {chip('RV1 planifiés', T.rv1Planned ?? 0)}
        {chip('RV1 honorés', T.rv1Honored ?? 0, T.rv1Planned ? `${Math.round((T.rv1Honored/Math.max(1,T.rv1Planned))*100)}% présence` : undefined)}
        {chip('WON', T.wonCount ?? 0)}
      </div>
    );
  })()}

  {/* Funnel — panneau déroulant “verre” */}
  <AnimatePresence>
    {funnelOpen && (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        className="mt-3 rounded-3xl border border-white/10 bg-[rgba(18,24,38,.55)] backdrop-blur-xl p-4 overflow-hidden"
      >
        {/* bandeau */}
        <div className="text-xs text-[--muted] mb-3 flex items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
          Détail du funnel — clique une carte pour le drill
        </div>
        {(() => {
          const T = (funnel?.totals as FunnelTotals) ?? (EMPTY_FUNNEL.totals as FunnelTotals);
          return (
            <Funnel
              data={{
                leads: T.leads ?? 0,
                callRequests: T.callRequests ?? 0,
                callsTotal: T.callsTotal ?? 0,
                callsAnswered: T.callsAnswered ?? 0,
                setterNoShow: T.setterNoShow ?? 0,
                rv0P: T.rv0Planned ?? 0,
                rv0H: T.rv0Honored ?? 0,
                rv0NS: T.rv0NoShow ?? 0,
                rv1P: T.rv1Planned ?? 0,
                rv1H: T.rv1Honored ?? 0,
                rv1NS: T.rv1NoShow ?? 0,
                rv2P: T.rv2Planned ?? 0,
                rv2H: T.rv2Honored ?? 0,
                won: T.wonCount ?? 0,
              }}
              onCardClick={onFunnelCardClick}
            />
          );
        })()}
        {/* Ratios avancés du funnel */}
{(() => {
  const T = (funnel?.totals as any) ?? {};
  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
      <KpiRatio label="Lead → Demande d’appel" num={T.callRequests ?? 0} den={T.leads ?? 0} />
      <KpiRatio label="Demande → Appel passé" num={T.callsTotal ?? 0} den={T.callRequests ?? 0} />
      <KpiRatio label="Appel → Contact (répondu)" num={T.callsAnswered ?? 0} den={T.callsTotal ?? 0} />
      <KpiRatio label="Contact → RV0 planifié" num={T.rv0Planned ?? 0} den={T.callsAnswered ?? 0} />

      <KpiRatio label="RV0 honoré / planifié" num={T.rv0Honored ?? 0} den={T.rv0Planned ?? 0} />
      <KpiRatio label="RV0 no-show / planifié" num={T.rv0NoShow ?? 0} den={T.rv0Planned ?? 0} inverse />

      <KpiRatio label="RV0 honoré → RV1 planifié" num={T.rv1Planned ?? 0} den={T.rv0Honored ?? 0} />
      <KpiRatio label="RV1 honoré / planifié" num={T.rv1Honored ?? 0} den={T.rv1Planned ?? 0} />
      <KpiRatio label="RV1 no-show / planifié" num={T.rv1NoShow ?? 0} den={T.rv1Planned ?? 0} inverse />

      <KpiRatio label="RV2 honoré / planifié" num={T.rv2Honored ?? 0} den={T.rv2Planned ?? 0} />
      <KpiRatio label="Conversion finale (WON / Leads)" num={T.wonCount ?? 0} den={T.leads ?? 0} />
    </div>
  );
})()}

      </motion.div>
    )}
  </AnimatePresence>

  {/* ===== Charts Deck (verre + halos) ===== */}
  <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
    {/* Leads reçus */}
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4">
      <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-white/[0.04] blur-3xl" />
      <div className="flex items-center justify-between">
        <div className="font-medium">Leads reçus par jour</div>
        <div className="text-xs text-[--muted]">{(leadsRcv?.total ?? 0).toLocaleString('fr-FR')} au total</div>
      </div>
      <div className="h-64 mt-2">
        {leadsRcv?.byDay?.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={leadsRcv.byDay.map(d => ({ day: new Date(d.day).toLocaleDateString("fr-FR"), count: d.count }))} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.leads} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={COLORS.leadsDark} stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="day" tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <Tooltip content={<ProTooltip title="Leads" valueFormatters={{ count: (v) => fmtInt(v) }} />} />
              <Legend wrapperStyle={{ color: "#fff", opacity: 0.8 }} />
              <Bar name="Leads" dataKey="count" fill="url(#gradLeads)" radius={[8,8,0,0]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="flex h-full items-center justify-center text-[--muted] text-sm">Pas de données.</div>}
      </div>
      <div className="text-[11px] text-[--muted] mt-2">Basé sur la <b>date de création</b> du contact.</div>
    </div>

    {/* CA hebdo (WON) */}
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4">
      <div className="absolute -left-16 -top-10 w-56 h-56 rounded-full bg-white/[0.04] blur-3xl" />
      <div className="flex items-center justify-between">
        <div className="font-medium">Production hebdomadaire (ventes gagnées)</div>
        <div className="text-xs text-[--muted]">
          {(salesWeekly.reduce((s, w) => s + (w.revenue || 0), 0) || 0).toLocaleString('fr-FR')} €
        </div>
      </div>
      <div className="h-64 mt-2">
        {salesWeekly.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={salesWeekly.map(w => ({
                label: new Date(w.weekStart).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) +
                       " → " + new Date(w.weekEnd).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
                revenue: Math.round(w.revenue), count: w.count,
              }))}
              margin={{ left: 8, right: 8, top: 10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.revenue} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={COLORS.revenueDark} stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id="gradCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.count} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={COLORS.countDark} stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="label" tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <Tooltip content={<ProTooltip title="Hebdo" valueFormatters={{ revenue: (v)=>fmtEUR(v), count: (v)=>fmtInt(v) }} />} />
              <Legend wrapperStyle={{ color: "#fff", opacity: 0.8 }} />
              <Bar yAxisId="left" name="CA (WON)" dataKey="revenue" fill="url(#gradRevenue)" radius={[8,8,0,0]} maxBarSize={44} />
              <Bar yAxisId="right" name="Ventes" dataKey="count" fill="url(#gradCount)" radius={[8,8,0,0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="flex h-full items-center justify-center text-[--muted] text-sm">Aucune production hebdo.</div>}
      </div>
      <div className="text-[11px] text-[--muted] mt-2">Basé sur la <b>date de passage en WON</b>.</div>
    </div>

    {/* Call requests */}
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4">
      <div className="flex items-center justify-between">
        <div className="font-medium">Demandes d’appel par jour</div>
        <div className="text-xs text-[--muted]">{(mCallReq?.total ?? 0).toLocaleString('fr-FR')}</div>
      </div>
      <div className="h-64 mt-2">
        {mCallReq?.byDay?.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={mCallReq.byDay.map(d => ({ day: new Date(d.day).toLocaleDateString("fr-FR"), count: d.count }))}
              margin={{ left: 8, right: 8, top: 10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradCallReq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#0e7490" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="day" tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <Tooltip content={<ProTooltip title="Demandes d’appel" valueFormatters={{ count: (v)=>fmtInt(v) }} />} />
              <Legend wrapperStyle={{ color: "#fff", opacity: 0.8 }} />
              <Bar name="Demandes" dataKey="count" fill="url(#gradCallReq)" radius={[8,8,0,0]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="flex h-full items-center justify-center text-[--muted] text-sm">Pas de données.</div>}
      </div>
      <div className="text-[11px] text-[--muted] mt-2">Basé sur <b>CallRequest.requestedAt</b>.</div>
    </div>

    {/* Calls total vs answered */}
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4">
      <div className="flex items-center justify-between">
        <div className="font-medium">Appels passés & répondus par jour</div>
        <div className="text-xs text-[--muted]">
          {(mCallsTotal?.total ?? 0).toLocaleString('fr-FR')} / {(mCallsAnswered?.total ?? 0).toLocaleString('fr-FR')}
        </div>
      </div>
      <div className="h-64 mt-2">
        {(mCallsTotal?.byDay?.length || mCallsAnswered?.byDay?.length) ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={(mCallsTotal?.byDay || []).map(d => {
                const label = new Date(d.day).toLocaleDateString("fr-FR");
                const answered = mCallsAnswered?.byDay?.find(x => new Date(x.day).toDateString() === new Date(d.day).toDateString())?.count ?? 0;
                return { day: label, total: d.count, answered };
              })}
              margin={{ left: 8, right: 8, top: 10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradCallsTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id="gradCallsAnswered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#059669" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="day" tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <Tooltip content={<ProTooltip title="Appels" valueFormatters={{ total: fmtInt, answered: fmtInt }} />} />
              <Legend wrapperStyle={{ color: "#fff", opacity: 0.8 }} />
              <Bar name="Passés" dataKey="total" fill="url(#gradCallsTotal)" radius={[8,8,0,0]} maxBarSize={40} />
              <Bar name="Répondus" dataKey="answered" fill="url(#gradCallsAnswered)" radius={[8,8,0,0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        ) : <div className="flex h-full items-center justify-center text-[--muted] text-sm">Pas de données.</div>}
      </div>
      <div className="text-[11px] text-[--muted] mt-2">Basé sur <b>CallAttempt.startedAt</b> et <b>CallOutcome=ANSWERED</b>.</div>
    </div>

    {/* RV0 no-show weekly */}
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4 xl:col-span-2">
      <div className="flex items-center justify-between">
        <div className="font-medium">RV0 no-show par semaine</div>
        <div className="text-xs text-[--muted]">{rv0NsWeekly.reduce((s,x)=>s+(x.count||0),0).toLocaleString('fr-FR')}</div>
      </div>
      <div className="h-64 mt-2">
        {rv0NsWeekly.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rv0NsWeekly} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRv0Ns" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#b91c1c" stopOpacity={0.7} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis dataKey="label" tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fill: COLORS.axis, fontSize: 12 }} />
              <Tooltip content={<ProTooltip title="RV0 no-show" valueFormatters={{ count: (v)=>fmtInt(v) }} />} />
              <Legend wrapperStyle={{ color: "#fff", opacity: 0.8 }} />
              <Bar
                name="RV0 no-show"
                dataKey="count"
                fill="url(#gradRv0Ns)"
                radius={[8,8,0,0]}
                maxBarSize={44}
                onClick={(d: any) => {
                  if (!d?.activeLabel) return;
                  const row = rv0NsWeekly.find(x => x.label === d.activeLabel);
                  if (!row) return;
                  openAppointmentsDrill({
                    title: `RV0 no-show – semaine ${row.label}`,
                    type: "RV0", status: "NO_SHOW",
                    from: row.weekStart.slice(0,10), to: row.weekEnd.slice(0,10),
                  });
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[--muted] text-sm">Aucun no-show RV0 sur la période.</div>
        )}
      </div>
      <div className="text-[11px] text-[--muted] mt-2">
        Compté sur la <b>date/heure du RDV</b> : chaque barre = lundi → dimanche.
      </div>
    </div>
  </div>
</div>

  {/* Classements */}
{/* ======== PREMIUM DISPOSITION (OpenAI-style) ======== */}
<div className="relative mt-6">
  {/* Aurora background */}
  <div className="absolute inset-0 -z-10">
    <div className="pointer-events-none absolute -top-24 left-1/3 h-72 w-[60vw] rounded-full blur-3xl opacity-25"
         style={{ background: 'radial-gradient(60% 60% at 50% 50%, rgba(99,102,241,.35), rgba(14,165,233,.15), transparent 70%)' }} />
    <div className="pointer-events-none absolute -bottom-16 -left-20 h-60 w-96 rounded-full blur-3xl opacity-20"
         style={{ background: 'radial-gradient(50% 50% at 50% 50%, rgba(56,189,248,.35), rgba(59,130,246,.15), transparent 70%)' }} />
  </div>

  {/* HALL OF FAME — Top cards */}
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
    {/* Top Closer */}
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(18,24,38,.65)] backdrop-blur-xl p-4">
      <div className="absolute right-0 top-0 w-40 h-40 rounded-full bg-white/[0.04] blur-2xl" />
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-emerald-400/10 border border-emerald-400/25 flex items-center justify-center">👑</div>
        <div>
          <div className="text-xs uppercase tracking-wider text-emerald-300/80">Hall of Fame</div>
          <div className="text-lg font-semibold">Top Closer</div>
        </div>
        <div className="ml-auto text-right text-xs text-[--muted]">CA (WON)</div>
      </div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
        {sortedClosers[0] ? (
          <div className="flex items-center gap-3">
            <div className="text-2xl leading-none">🥇</div>
            <div className="min-w-0">
              <div className="font-medium truncate">{sortedClosers[0].name}</div>
              <div className="text-xs text-[--muted] truncate">{sortedClosers[0].email}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-lg font-semibold">{(sortedClosers[0].revenueTotal || 0).toLocaleString('fr-FR')} €</div>
              <div className="text-[10px] text-[--muted]">{sortedClosers[0].salesClosed} ventes</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[--muted]">— Aucune donnée</div>
        )}
      </div>
    </div>

    {/* Top Setter */}
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(18,24,38,.65)] backdrop-blur-xl p-4">
      <div className="absolute -right-10 -top-8 w-40 h-40 rounded-full bg-indigo-400/10 blur-2xl" />
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-indigo-400/10 border border-indigo-400/25 flex items-center justify-center">⚡</div>
        <div>
          <div className="text-xs uppercase tracking-wider text-indigo-300/80">Hall of Fame</div>
          <div className="text-lg font-semibold">Top Setter</div>
        </div>
        <div className="ml-auto text-right text-xs text-[--muted]">TTFC & RV1</div>
      </div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
        {sortedSetters[0] ? (
          <div className="flex items-center gap-3">
            <div className="text-2xl leading-none">🥇</div>
            <div className="min-w-0">
              <div className="font-medium truncate">{sortedSetters[0].name}</div>
              <div className="text-xs text-[--muted] truncate">{sortedSetters[0].email}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-lg font-semibold">{sortedSetters[0].ttfcAvgMinutes ?? "—"} min</div>
              <div className="text-[10px] text-[--muted]">{sortedSetters[0].rv1FromHisLeads} RV1</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[--muted]">— Aucune donnée</div>
        )}
      </div>
    </div>

    {/* Top Duo */}
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(18,24,38,.65)] backdrop-blur-xl p-4">
      <div className="absolute right-0 bottom-0 w-40 h-40 rounded-full bg-amber-400/10 blur-2xl" />
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-amber-400/10 border border-amber-400/25 flex items-center justify-center">💎</div>
        <div>
          <div className="text-xs uppercase tracking-wider text-amber-300/80">Hall of Fame</div>
          <div className="text-lg font-semibold">Équipe de choc</div>
        </div>
        <div className="ml-auto text-right text-xs text-[--muted]">CA & Ventes</div>
      </div>
      <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
        {duos?.[0] ? (
          <div className="grid grid-cols-2 gap-3 items-center">
            <div className="min-w-0">
              <div className="text-xs text-[--muted]">Setter</div>
              <div className="font-medium truncate">{duos[0].setterName}</div>
              <div className="text-[10px] text-[--muted] truncate">{duos[0].setterEmail}</div>
            </div>
            <div className="min-w-0">
              <div className="text-xs text-[--muted]">Closer</div>
              <div className="font-medium truncate">{duos[0].closerName}</div>
              <div className="text-[10px] text-[--muted] truncate">{duos[0].closerEmail}</div>
            </div>
            <div className="col-span-2 flex items-center justify-between">
              <div className="text-lg font-semibold">{fmtEUR(duos[0].revenue)}</div>
              <div className="text-[10px] text-[--muted]">{duos[0].salesCount} ventes • RV1 {duos[0].rv1Honored}/{duos[0].rv1Planned}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[--muted]">— Aucune donnée</div>
        )}
      </div>
    </div>
  </div>

  {/* SPOTLIGHT LISTS — Closers & Setters */}
  <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
    {/* Spotlight Closers */}
    <div className="rounded-3xl border border-white/10 bg-[rgba(18,24,38,.6)] backdrop-blur-xl overflow-hidden">
      <div className="px-4 py-2 text-xs uppercase tracking-wider border-b border-white/10 bg-[linear-gradient(90deg,rgba(16,185,129,.15),transparent)]">
        👥 Spotlight Closers
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-left text-[--muted] text-xs sticky top-0 bg-[rgba(18,24,38,.8)] backdrop-blur-md">
            <tr>
              <th className="py-2.5 px-3">Closer</th>
              <th className="py-2.5 px-3">CA</th>
              <th className="py-2.5 px-3">Ventes</th>
              <th className="py-2.5 px-3">RV1 honorés</th>
              <th className="py-2.5 px-3">ROAS (honorés)</th>
            </tr>
          </thead>
          <tbody>
            {sortedClosers.slice(0, 8).map((c, i) => (
              <tr key={c.userId} className="border-t border-white/10 hover:bg-white/[0.04] transition-colors">
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[--muted] w-5">{i < 3 ? ['🥇','🥈','🥉'][i] : `#${i+1}`}</span>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-[10px] text-[--muted] truncate">{c.email}</div>
                    </div>
                  </div>
                </td>
                <td className="py-2.5 px-3 font-semibold">{(c.revenueTotal || 0).toLocaleString('fr-FR')} €</td>
                <td className="py-2.5 px-3">{c.salesClosed}</td>
                <td className="py-2.5 px-3">{c.rv1Honored}</td>
                <td className="py-2.5 px-3">{c.roasHonored ?? '—'}</td>
              </tr>
            ))}
            {!sortedClosers.length && (
              <tr><td className="py-6 px-3 text-[--muted]" colSpan={5}>Aucune donnée.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>

    {/* Spotlight Setters */}
    <div className="rounded-3xl border border-white/10 bg-[rgba(18,24,38,.6)] backdrop-blur-xl overflow-hidden">
      <div className="px-4 py-2 text-xs uppercase tracking-wider border-b border-white/10 bg-[linear-gradient(90deg,rgba(99,102,241,.18),transparent)]">
        ☎️ Spotlight Setters
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[780px]">
          <thead className="text-left text-[--muted] text-xs sticky top-0 bg-[rgba(18,24,38,.8)] backdrop-blur-md">
            <tr>
              <th className="py-2.5 px-3">Setter</th>
              <th className="py-2.5 px-3">Ventes (ses leads)</th>
              <th className="py-2.5 px-3">RV1 (ses leads)</th>
              <th className="py-2.5 px-3">Leads</th>
              <th className="py-2.5 px-3">RV0</th>
              <th className="py-2.5 px-3">TTFC</th>
            </tr>
          </thead>
          <tbody>
            {sortedSetters.slice(0, 8).map((s, i) => (
              <tr key={s.userId} className="border-t border-white/10 hover:bg-white/[0.04] transition-colors">
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[--muted] w-5">{i < 3 ? ['🥇','🥈','🥉'][i] : `#${i+1}`}</span>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.name}</div>
                      <div className="text-[10px] text-[--muted] truncate">{s.email}</div>
                    </div>
                  </div>
                </td>
                <td className="py-2.5 px-3">{s.salesFromHisLeads ?? 0}</td>
                <td className="py-2.5 px-3">{s.rv1FromHisLeads ?? 0}</td>
                <td className="py-2.5 px-3">{s.leadsReceived ?? 0}</td>
                <td className="py-2.5 px-3">{s.rv0Count ?? 0}</td>
                <td className="py-2.5 px-3">{s.ttfcAvgMinutes ?? '—'} min</td>
              </tr>
            ))}
            {!sortedSetters.length && (
              <tr><td className="py-6 px-3 text-[--muted]" colSpan={6}>Aucune donnée.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  {/* DUO STRIP — Marquee premium */}
  {duos.length > 0 && (
    <div className="mt-5 rounded-3xl border border-white/10 bg-[rgba(13,18,29,.7)] backdrop-blur-xl overflow-hidden">
      <div className="px-4 py-2 text-xs uppercase tracking-wider border-b border-white/10 bg-[linear-gradient(90deg,rgba(251,191,36,.18),transparent)]">
        💠 Équipe de choc — meilleurs duos
      </div>

      <div className="relative">
        <div className="flex gap-3 p-3 overflow-x-auto snap-x">
          {duos.map((d, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
            const tone =
              i === 0 ? 'border-emerald-400/30 bg-emerald-400/10'
              : i === 1 ? 'border-indigo-400/30 bg-indigo-400/10'
              : i === 2 ? 'border-amber-400/30 bg-amber-400/10'
              : 'border-white/10 bg-white/[0.04]';
            return (
              <div
                key={d.setterId + '_' + d.closerId}
                className={`snap-start shrink-0 min-w-[300px] rounded-2xl border ${tone} px-3 py-2`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{medal || '💎'}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{d.setterName} × {d.closerName}</div>
                    <div className="text-[10px] text-[--muted] truncate">{d.setterEmail} • {d.closerEmail}</div>
                  </div>
                  <div className="ml-auto text-right text-sm font-semibold">{fmtEUR(d.revenue)}</div>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[--muted]">
                  <span className="px-1.5 py-0.5 rounded border border-white/10 bg-black/20">{d.salesCount} ventes</span>
                  <span className="px-1.5 py-0.5 rounded border border-white/10 bg-black/20">RV1 {d.rv1Honored}/{d.rv1Planned}</span>
                  {d.rv1HonorRate != null && (
                    <span className="px-1.5 py-0.5 rounded border border-white/10 bg-black/20">{d.rv1HonorRate}%</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-2 text-[10px] text-[--muted] border-t border-white/10">
        Bandeau scrollable — passe ta souris/ton doigt pour parcourir. Les données sont calculées sur les <b>WON</b> de la période.
      </div>
    </div>
  )}
</div>

      {/* Vues additionnelles */}
          {view === "exports" && (
            <div className="space-y-4">
              <div className="card"><div className="text-sm text-[--muted] mb-2">Exports PDF</div>
                <p className="text-sm text-[--muted]">Télécharge les PDF “Setters” et “Closers” pour la plage de dates choisie ci-dessus.</p>
              </div>
                <PdfExports
                  from={typeof range.from === "string" ? range.from : range.from?.toISOString().slice(0, 10)}
                  to={typeof range.to === "string" ? range.to : range.to?.toISOString().slice(0, 10)}
                />            
            </div>
          )}
        </div>
      </div>

      {/* ===== PANNEAU FILTRES ===== */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-end"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="w-full max-w-xl h-full bg-[rgba(16,22,33,.98)] border-l border-white/10 p-5 overflow-auto"
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}>
              <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-semibold">Filtres</div>
                <button type="button" className="btn btn-ghost" onClick={() => setFiltersOpen(false)}>Fermer</button>
              </div>

              <div className="space-y-4">
                {/* Presets rapides */}
                <div>
                  <div className="label">Période rapide</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="tab" onClick={() => { const d = new Date(); setDraftRange({ from: d, to: d }); }}>Aujourd’hui</button>
                    <button type="button" className="tab" onClick={() => { const d = new Date(); const s = new Date(); s.setDate(d.getDate()-6); setDraftRange({ from: s, to: d }); }}>7 jours</button>
                    <button type="button" className="tab" onClick={() => { const d = new Date(); const s = new Date(); s.setDate(d.getDate()-29); setDraftRange({ from: s, to: d }); }}>30 jours</button>
                    <button type="button" className="tab" onClick={() => { const { from, to } = currentMonthRange(); setDraftRange({ from: asDate(from)!, to: asDate(to)! }); }}>Ce mois</button>
                  </div>
                </div>
                {/* Personnalisée */}
                <div>
                  <div className="label">Période personnalisée</div>
                     <DateRangePicker
                      value={draftRange}
                      onChange={(r) =>
                        setDraftRange({
                          from: asDate(r.from) ?? r.from, // jamais “undefined”
                          to:   asDate(r.to)   ?? r.to,   // jamais “undefined”
                        })
                      }
                    />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={comparePrev} onChange={(e)=>setComparePrev(e.target.checked)} />
                    Comparer à la période précédente
                  </label>
                  <div className="text-xs text-[--muted]">Clique <b>Appliquer</b> pour charger.</div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" className="btn btn-ghost" onClick={() => setFiltersOpen(false)}>Annuler</button>
                  <button type="button" className="btn btn-primary" onClick={() => { setRange(draftRange); setFiltersOpen(false); }}>
                    Appliquer
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drill modal */}
      <AnimatePresence>
        {drillOpen && <DrillModal title={drillTitle} open={drillOpen} onClose={()=>setDrillOpen(false)} rows={drillRows} />}
      </AnimatePresence>
    </div>
  );
}
