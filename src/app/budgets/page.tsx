"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import api from "@/lib/api";
import { currentMonthRange } from "@/lib/date";
import DateRangePicker, { type Range } from "@/components/DateRangePicker";
import { getAccessToken } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend,
  Line
} from "recharts";

/* =============================================================================
   Helpers GET/POST (silencieux) pour tester plusieurs routes sans polluer console
============================================================================= */
async function tryGet<T>(
  candidates: Array<{ url: string; params?: Record<string, any> }>,
  fallback: T
): Promise<{ data: T; hit: string | null }> {
  for (const c of candidates) {
    const qs = c.params
      ? `?${new URLSearchParams(
          Object.entries(c.params).filter(([, v]) => v != null) as any
        )}`
      : "";
    try {
      const res = await fetch(`${c.url}${qs}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        keepalive: true,
      });
      if (res.ok) {
        const txt = await res.text();
        const json = txt ? JSON.parse(txt) : null;
        return { data: (json ?? fallback) as T, hit: c.url };
      }
      if (res.status === 404) continue;
      // autres codes -> on tente le candidat suivant sans bruiter
    } catch {
      // réseau/parsing -> on tente le suivant
    }
  }
  return { data: fallback, hit: null };
}

async function tryPost(
  candidates: Array<{ url: string; body?: any }>
): Promise<{ ok: boolean; hit: string | null }> {
  for (const c of candidates) {
    try {
      const res = await fetch(c.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(c.body ?? {}),
        keepalive: true,
      });
      if (res.ok) return { ok: true, hit: c.url };
      if (res.status === 404) continue;
    } catch {
      // ignore et essaie le suivant
    }
  }
  return { ok: false, hit: null };
}

/** ---------- Types alignés backend (avec champs optionnels pour robustesse) ---------- */
type WeeklySnapshot = {
  weekStart: string;
  weekEnd: string;
  spend: number;
  leadsReceived: number;
  wonCount: number;
  revenue: number;
  cpl: number | null;
  roas: number | null;
};

type BudgetRow = {
  id: string;
  amount: number;
  weekStart: string | null;
  period: "WEEKLY" | "MONTHLY";
};

type WeeklyOpsRow = {
  weekStart: string;
  weekEnd: string;

  // RV0
  rv0Planned: number;
  rv0Honored: number;
  rv0NoShow?: number;
  rv0Postponed?: number;
  rv0Canceled?: number;
  rv0NotQualified?: number;

  // RV1
  rv1Planned: number;
  rv1Honored: number;
  rv1NoShow: number;
  rv1Postponed?: number;
  rv1Canceled?: number;

  // RV2
  rv2Planned: number;
  rv2Honored: number;
  rv2NoShow?: number;
  rv2Postponed?: number;
  rv2Canceled?: number;
};

type WeeklySales = { weekStart: string; weekEnd: string; revenue: number; count: number };

type DrillItem = {
  leadId: string;
  leadName: string;
  email?: string | null;
  phone?: string | null;
  setter?: { id: string; name: string; email: string } | null;
  closer?: { id: string; name: string; email: string } | null;
  appointment?: { type: string; status?: string; scheduledAt: string } | null;
  saleValue?: number | null;
  stage?: string;
  createdAt?: string;
  stageUpdatedAt?: string;
};

/** ---------- Utils ---------- */
const fmtInt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const fmtEUR = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;

function normalizeDate(d: unknown): Date | undefined {
  if (!d) return undefined;
  return d instanceof Date ? d : new Date(d as string);
}
function toISODate(d: Date | string) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
/** Lundi 00:00:00 UTC */
function mondayFloorUTCISO(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString();
}
function dateInputToMondayUTCISO(v: string) {
  if (!v) return mondayFloorUTCISO();
  const [yy, mm, dd] = v.split("-").map(Number);
  const local = new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0));
  return mondayFloorUTCISO(local);
}

/** Export CSV (en-têtes FR) */
function exportSeriesCSV(series: WeeklySnapshot[]) {
  const header = [
    "Semaine début", "Semaine fin", "Dépenses", "Leads", "CPL", "CA (Cohorte)", "Ventes (Cohorte)", "ROAS"
  ];
  const lines = series.map(s => [
    s.weekStart, s.weekEnd, s.spend, s.leadsReceived, s.cpl ?? "",
    s.revenue, s.wonCount, s.roas ?? ""
  ].join(","));
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "budget_series_fr.csv"; a.click();
  URL.revokeObjectURL(url);
}

/** --------- Modale Drill --------- */
function DrillModal({
  title, open, onClose, rows, extra,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  rows: DrillItem[];
  extra?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
      <div className="card w-full max-w-5xl max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">{title}</div>
          <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
        </div>

        {extra}

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="text-left text-[--muted] sticky top-0 bg-[rgba(16,22,33,.9)] backdrop-blur">
              <tr>
                <th className="py-2 pr-2">Lead</th>
                <th className="py-2 pr-2">Setter</th>
                <th className="py-2 pr-2">Closer</th>
                <th className="py-2 pr-2">RDV</th>
                <th className="py-2 pr-2">Sale €</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((r) => (
                <tr key={r.leadId} className="border-t border-white/10">
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
                <tr>
                  <td className="py-6 text-[--muted]" colSpan={5}>Aucune ligne</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}

export default function BudgetPage() {
  const router = useRouter();

  /** -------- Auth guard -------- */
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function verify() {
      const token = getAccessToken();
      if (!token) { router.replace("/login"); return; }
      try {
        await api.get("/auth/me");
        if (!cancelled) { setAuthChecked(true); setAuthError(null); }
      } catch {
        if (!cancelled) { setAuthChecked(true); setAuthError("Non autorisé"); }
      }
    }
    verify();
    return () => { cancelled = true; };
  }, [router]);

  /** -------- Filtres : brouillon vs appliqué -------- */
  const { from: cmFromRaw, to: cmToRaw } = useMemo(() => currentMonthRange(), []);
  const cmFrom = normalizeDate(cmFromRaw)!;
  const cmTo = normalizeDate(cmToRaw)!;

  // 🔹 uiRange = ce que l’utilisateur édite dans le panneau (non appliqué)
  const [uiRange, setUiRange] = useState<Range>({ from: cmFrom, to: cmTo });
  // 🔹 appliedRange = ce qui drive les requêtes
  const [appliedRange, setAppliedRange] = useState<Range>({ from: cmFrom, to: cmTo });

  const fromISO = appliedRange.from ? toISODate(appliedRange.from) : undefined;
  const toISO   = appliedRange.to   ? toISODate(appliedRange.to)   : undefined;

  const [filtersOpen, setFiltersOpen] = useState(false);

  const defaultRangeKey = `${cmFrom?.toDateString() ?? ""}|${cmTo?.toDateString() ?? ""}`;
  const currentRangeKey = `${normalizeDate(appliedRange.from)?.toDateString() ?? ""}|${normalizeDate(appliedRange.to)?.toDateString() ?? ""}`;
  const activeFiltersCount = currentRangeKey !== defaultRangeKey ? 1 : 0;

  /** -------- Data -------- */
  const [series, setSeries] = useState<WeeklySnapshot[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [ops, setOps] = useState<WeeklyOpsRow[]>([]);
  const [weeklySales, setWeeklySales] = useState<WeeklySales[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** -------- Drill UI -------- */
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState("");
  const [drillRows, setDrillRows] = useState<DrillItem[]>([]);
  const [drillExtra, setDrillExtra] = useState<React.ReactNode>(null);

  /** -------- Form budget -------- */
  const [weekStartInput, setWeekStartInput] = useState<string>(() => {
    const m = new Date(mondayFloorUTCISO());
    return `${m.getUTCFullYear()}-${String(m.getUTCMonth()+1).padStart(2,"0")}-${String(m.getUTCDate()).padStart(2,"0")}`;
  });
  const [amount, setAmount] = useState<string>("");
  const [supportsBudgetPost, setSupportsBudgetPost] = useState<boolean>(false);

  /** -------- Chargement -------- */
  useEffect(() => {
    if (!authChecked || authError) return;
    let cancelled = false;

    async function load() {
      setLoading(true); setErr(null);
      try {
        // ====== Budgets (GET) : /reporting/budget | /analytics/budget
        const budgetGet = await tryGet<any>(
          [
            { url: "/reporting/budget", params: { from: fromISO, to: toISO } },
            { url: "/analytics/budget", params: { from: fromISO, to: toISO } },
          ],
          []
        );
        const bData = (budgetGet.data ?? []) as any;
        setBudgets(Array.isArray(bData) ? bData : (bData.rows ?? []));

        // Si une route GET budget existe, on autorise l'affichage du formulaire POST
        setSupportsBudgetPost(Boolean(budgetGet.hit));

        // ====== Weekly series : /reporting/weekly-series | /analytics/weekly-series
        const seriesGet = await tryGet<any>(
          [
            { url: "/reporting/weekly-series", params: { from: fromISO, to: toISO } },
            { url: "/analytics/weekly-series", params: { from: fromISO, to: toISO } },
          ],
          []
        );
        const sData = seriesGet.data as any;
        setSeries(Array.isArray(sData) ? sData : (sData?.series ?? []));

        // ====== Weekly ops : /reporting/weekly-ops | /analytics/weekly-ops
        const opsGet = await tryGet<any>(
          [
            { url: "/reporting/weekly-ops", params: { from: fromISO, to: toISO } },
            { url: "/analytics/weekly-ops", params: { from: fromISO, to: toISO } },
          ],
          []
        );
        const oData = opsGet.data as any;
        const rows: WeeklyOpsRow[] = Array.isArray(oData) ? oData : (oData?.rows ?? []);
        setOps(rows.slice().sort((a,b)=>a.weekStart.localeCompare(b.weekStart)));

        // ====== Weekly sales : /reporting/sales-weekly | /analytics/sales-weekly
        const salesGet = await tryGet<WeeklySales[]>(
          [
            { url: "/reporting/sales-weekly", params: { from: fromISO, to: toISO } },
            { url: "/analytics/sales-weekly", params: { from: fromISO, to: toISO } },
          ],
          []
        );
        setWeeklySales((salesGet.data || []).slice().sort((a,b)=>a.weekStart.localeCompare(b.weekStart)));
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Erreur de chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [authChecked, authError, fromISO, toISO]);

  async function submitBudget(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) {
      setErr("Le montant doit être un nombre positif");
      return;
    }

    const body = { weekStartISO: dateInputToMondayUTCISO(weekStartInput), amount: n };

    // POST silencieux vers les 2 chemins potentiels
    const posted = await tryPost([
      { url: "/reporting/budget", body },
      { url: "/analytics/budget", body },
    ]);
    if (!posted.ok) {
      setErr("Échec enregistrement budget");
      return;
    }

    // Rechargement silencieux des datasets concernés
    try {
      const [seriesGet, budgetGet, opsGet, salesGet] = await Promise.all([
        tryGet<any>([
          { url: "/reporting/weekly-series", params: { from: fromISO, to: toISO } },
          { url: "/analytics/weekly-series", params: { from: fromISO, to: toISO } },
        ], []),
        tryGet<any>([
          { url: "/reporting/budget", params: { from: fromISO, to: toISO } },
          { url: "/analytics/budget", params: { from: fromISO, to: toISO } },
        ], []),
        tryGet<any>([
          { url: "/reporting/weekly-ops", params: { from: fromISO, to: toISO } },
          { url: "/analytics/weekly-ops", params: { from: fromISO, to: toISO } },
        ], []),
        tryGet<WeeklySales[]>([
          { url: "/reporting/sales-weekly", params: { from: fromISO, to: toISO } },
          { url: "/analytics/sales-weekly", params: { from: fromISO, to: toISO } },
        ], []),
      ]);

      const sData = seriesGet.data as any;
      setSeries(Array.isArray(sData) ? sData : (sData?.series ?? []));

      const bData = (budgetGet.data ?? []) as any;
      setBudgets(Array.isArray(bData) ? bData : (bData.rows ?? []));

      const oData = opsGet.data as any;
      const rows: WeeklyOpsRow[] = Array.isArray(oData) ? oData : (oData?.rows ?? []);
      setOps(rows.slice().sort((a,b)=>a.weekStart.localeCompare(b.weekStart)));

      setWeeklySales((salesGet.data || []).slice().sort((a,b)=>a.weekStart.localeCompare(b.weekStart)));
      setAmount("");
    } catch (e: any) {
      setErr(e?.message || "Erreur lors de l’enregistrement");
    }
  }

  /** -------- Datasets / KPI -------- */
  const chartData = series.map(s => ({
    label: new Date(s.weekStart).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
    spend: Math.round(s.spend),
    cohortCA: Math.round(s.revenue),
    roas: s.spend ? (s.revenue / s.spend) : 0,
    leads: s.leadsReceived,
    cpl: s.cpl ?? 0,
    _weekStart: s.weekStart,
    _weekEnd: s.weekEnd,
  }));

  const sumSpend  = series.reduce((n, x) => n + (x.spend || 0), 0);
  const sumCohCA  = series.reduce((n, x) => n + (x.revenue || 0), 0);
  const sumLeads  = series.reduce((n, x) => n + (x.leadsReceived || 0), 0);
  const sumSales  = series.reduce((n, x) => n + (x.wonCount || 0), 0);
  const roasCoh   = sumSpend ? Number((sumCohCA / sumSpend).toFixed(2)) : null;

  // Map ventes par semaine
  const weeklySalesMap = useMemo(() => {
    const m = new Map<string, WeeklySales>();
    for (const w of weeklySales) m.set(w.weekStart, w);
    return m;
  }, [weeklySales]);

  /** -------- Tooltip -------- */
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const map: Record<string, any> = {};
    payload.forEach((p: any) => { map[p.dataKey] = p.value; });
    return (
      <div className="rounded-xl border border-white/10 bg-[rgba(16,22,33,.95)] px-3 py-2 text-xs shadow-lg">
        <div className="font-medium mb-1">Semaine {label}</div>
        {"spend" in map && <div>Dépenses : <span className="font-semibold">{fmtEUR(Number(map.spend))}</span></div>}
        {"cohortCA" in map && <div>CA (Cohorte) : <span className="font-semibold">{fmtEUR(Number(map.cohortCA))}</span></div>}
        {"roas" in map && <div>ROAS : <span className="font-semibold">{Number(map.roas).toFixed(2)}</span></div>}
        {"leads" in map && <div>Leads : <span className="font-semibold">{fmtInt(Number(map.leads))}</span></div>}
        {"cpl" in map && <div>CPL : <span className="font-semibold">{fmtEUR(Number(map.cpl))}</span></div>}
      </div>
    );
  };

  /** -------- Drill helpers -------- */
  async function openAppointmentsDrill(params: {
    title: string;
    type?: "RV0"|"RV1"|"RV2";
    status?: "HONORED"|"POSTPONED"|"CANCELED"|"NO_SHOW"|"NOT_QUALIFIED";
    from?: string; to?: string;
  }) {
    const res = await api.get("/reporting/drill/appointments", {
      params: {
        type: params.type, status: params.status,
        from: params.from ?? fromISO, to: params.to ?? toISO,
        limit: 2000
      }
    });
    setDrillTitle(params.title);
    setDrillRows(res.data?.items || []);
    setDrillExtra(null);
    setDrillOpen(true);
  }

  async function openSalesWeekDrill(weekStartISO: string, weekEndISO: string) {
    const res = await api.get("/reporting/drill/won", {
      params: { from: weekStartISO.slice(0,10), to: weekEndISO.slice(0,10), limit: 2000 }
    });
    setDrillTitle(
      `Ventes (WON) – semaine ${new Date(weekStartISO).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} → ${new Date(weekEndISO).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`
    );
    setDrillExtra(<div className="mb-3 text-xs text-[--muted]">Fenêtre ventes (stageUpdatedAt/createdAt dans la semaine).</div>);
    setDrillRows(res.data?.items || []);
    setDrillOpen(true);
  }

  async function openLeadsDrill() {
    const res = await api.get("/reporting/drill/leads-received", { params: { from: fromISO, to: toISO, limit: 2000 } });
    setDrillTitle("Leads reçus (créés sur la période)");
    setDrillExtra(null);
    setDrillRows(res.data?.items || []);
    setDrillOpen(true);
  }
  async function openCohortSalesDrill() {
    const res = await api.get("/reporting/drill/won", { params: { cohortFrom: fromISO, cohortTo: toISO, limit: 2000 } });
    setDrillTitle("Ventes (Cohorte) – détail");
    setDrillExtra(<div className="mb-3 text-xs text-[--muted]">Cohorte = leads créés pendant la période (peu importe la date de passage en WON).</div>);
    setDrillRows(res.data?.items || []);
    setDrillOpen(true);
  }
  function onBarClick(_: any, index: number) {
    const point = chartData[index];
    if (!point) return;
    api.get("/reporting/drill/won", {
      params: { cohortFrom: point._weekStart.slice(0,10), cohortTo: point._weekEnd.slice(0,10), limit: 2000 }
    }).then(res => {
      setDrillTitle(
        `Cohorte semaine ${new Date(point._weekStart).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} → ${new Date(point._weekEnd).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`
      );
      setDrillExtra(<div className="mb-3 text-xs text-[--muted]">Leads créés sur cette semaine (en WON).</div>);
      setDrillRows(res.data?.items || []);
      setDrillOpen(true);
    });
  }

  /** -------- Helpers UI “board” -------- */
  const chip = (label: string, value: number, onClick?: () => void, tone: "muted"|"ok"|"warn"|"info" = "muted") => {
    const tones: Record<string,string> = {
      muted: "bg-white/10 hover:bg-white/15",
      ok: "bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25",
      warn: "bg-amber-500/15 text-amber-200 hover:bg-amber-500/25",
      info: "bg-sky-500/15 text-sky-200 hover:bg-sky-500/25",
    };
    return (
      <button
        onClick={onClick}
        className={`text-xs rounded-full px-2 py-1 ${tones[tone]} transition`}
        title={label}
      >
        {label}: <span className="font-semibold">{fmtInt(value)}</span>
      </button>
    );
  };

  function eqCheck(planned: number, parts: number[]) {
    const ok = planned === parts.reduce((s, v) => s + (v || 0), 0);
    return ok ? <span className="text-emerald-400">✓</span> : <span className="text-amber-400">⚠</span>;
  }

  function stackedBar(parts: Array<{ label:string; value:number; color:string; on?: () => void }>) {
    const total = parts.reduce((s,p)=>s+p.value,0) || 1;
    return (
      <div className="h-2 w-full rounded bg-white/10 overflow-hidden">
        <div className="flex h-full">
          {parts.map((p, i) => (
            <div
              key={i}
              style={{ width: `${(p.value/total)*100}%`, background: p.color }}
              className={`h-full ${p.on ? "cursor-pointer hover:opacity-80" : ""}`}
              onClick={p.on}
              title={`${p.label}: ${p.value}`}
            />
          ))}
        </div>
      </div>
    );
  }

  function WeekCard(w: WeeklyOpsRow) {
    const ws = w.weekStart.slice(0,10), we = w.weekEnd.slice(0,10);
    const sales = weeklySalesMap.get(w.weekStart);
    const headDates = `${new Date(w.weekStart).toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit" })} → ${new Date(w.weekEnd).toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit" })}`;

    const rv0NoShow = w.rv0NoShow || 0, rv0Post = w.rv0Postponed || 0, rv0Can = w.rv0Canceled || 0, rv0NQ = w.rv0NotQualified || 0;
    const rv2NoShow = w.rv2NoShow || 0, rv2Post = w.rv2Postponed || 0, rv2Can = w.rv2Canceled || 0;
    const rv1Post = w.rv1Postponed || 0, rv1Can = w.rv1Canceled || 0;

    return (
      <div className="rounded-2xl border border-white/10 p-4 bg-[rgba(16,22,33,.9)]">
        <div className="flex items-center gap-3">
          <div className="text-sm text-[--muted]">{headDates}</div>
          <div className="flex-1" />
          <div className="text-xs text-[--muted] flex items-center gap-2">
            Ventes: <button className="underline" onClick={()=>openSalesWeekDrill(w.weekStart, w.weekEnd)}>{fmtInt(sales?.count || 0)}</button>
            • CA: <button className="underline" onClick={()=>openSalesWeekDrill(w.weekStart, w.weekEnd)}>{fmtEUR(sales?.revenue || 0)}</button>
            • {eqCheck(w.rv0Planned, [w.rv0Honored, rv0NoShow, rv0Post, rv0Can, rv0NQ])}
            {eqCheck(w.rv1Planned, [w.rv1Honored, w.rv1NoShow, rv1Post, rv1Can])}
            {eqCheck(w.rv2Planned, [w.rv2Honored, rv2NoShow, rv2Post, rv2Can])}
          </div>
        </div>

        {/* RV0 */}
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium w-10">RV0</div>
            {stackedBar([
              { label: "Honorés", value: w.rv0Honored, color: "rgb(16 185 129)", on: ()=>openAppointmentsDrill({title:"RV0 honorés (semaine)", type:"RV0", status:"HONORED", from:ws, to:we}) },
              { label: "No-show", value: rv0NoShow, color: "rgb(245 158 11)", on: ()=>openAppointmentsDrill({title:"RV0 no-show (semaine)", type:"RV0", status:"NO_SHOW", from:ws, to:we}) },
              { label: "Reportés", value: rv0Post, color: "rgb(56 189 248)", on: ()=>openAppointmentsDrill({title:"RV0 reportés (semaine)", type:"RV0", status:"POSTPONED", from:ws, to:we}) },
              { label: "Annulés", value: rv0Can, color: "rgb(244 63 94)", on: ()=>openAppointmentsDrill({title:"RV0 annulés (semaine)", type:"RV0", status:"CANCELED", from:ws, to:we}) },
              { label: "Non qual.", value: rv0NQ, color: "rgb(148 163 184)", on: ()=>openAppointmentsDrill({title:"RV0 non qualifiés (semaine)", type:"RV0", status:"NOT_QUALIFIED", from:ws, to:we}) },
            ])}
            <div className="flex-1" />
            <div className="flex gap-2">
              {chip("P", w.rv0Planned, ()=>openAppointmentsDrill({title:"RV0 planifiés (semaine)", type:"RV0", from:ws, to:we}), "info")}
              {chip("H", w.rv0Honored, ()=>openAppointmentsDrill({title:"RV0 honorés (semaine)", type:"RV0", status:"HONORED", from:ws, to:we}), "ok")}
              {chip("NS", rv0NoShow, ()=>openAppointmentsDrill({title:"RV0 no-show (semaine)", type:"RV0", status:"NO_SHOW", from:ws, to:we}), "warn")}
              {chip("R", rv0Post, ()=>openAppointmentsDrill({title:"RV0 reportés (semaine)", type:"RV0", status:"POSTPONED", from:ws, to:we}))}
              {chip("A", rv0Can, ()=>openAppointmentsDrill({title:"RV0 annulés (semaine)", type:"RV0", status:"CANCELED", from:ws, to:we}))}
              {chip("NQ", rv0NQ, ()=>openAppointmentsDrill({title:"RV0 non qualifiés (semaine)", type:"RV0", status:"NOT_QUALIFIED", from:ws, to:we}))}
            </div>
          </div>

          {/* RV1 */}
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium w-10">RV1</div>
            {stackedBar([
              { label: "Honorés", value: w.rv1Honored, color: "rgb(16 185 129)", on: ()=>openAppointmentsDrill({title:"RV1 honorés (semaine)", type:"RV1", status:"HONORED", from:ws, to:we}) },
              { label: "No-show", value: w.rv1NoShow, color: "rgb(245 158 11)", on: ()=>openAppointmentsDrill({title:"RV1 no-show (semaine)", type:"RV1", status:"NO_SHOW", from:ws, to:we}) },
              { label: "Reportés", value: rv1Post, color: "rgb(56 189 248)", on: ()=>openAppointmentsDrill({title:"RV1 reportés (semaine)", type:"RV1", status:"POSTPONED", from:ws, to:we}) },
              { label: "Annulés", value: rv1Can, color: "rgb(244 63 94)", on: ()=>openAppointmentsDrill({title:"RV1 annulés (semaine)", type:"RV1", status:"CANCELED", from:ws, to:we}) },
            ])}
            <div className="flex-1" />
            <div className="flex gap-2">
              {chip("P", w.rv1Planned, ()=>openAppointmentsDrill({title:"RV1 planifiés (semaine)", type:"RV1", from:ws, to:we}), "info")}
              {chip("H", w.rv1Honored, ()=>openAppointmentsDrill({title:"RV1 honorés (semaine)", type:"RV1", status:"HONORED", from:ws, to:we}), "ok")}
              {chip("NS", w.rv1NoShow, ()=>openAppointmentsDrill({title:"RV1 no-show (semaine)", type:"RV1", status:"NO_SHOW", from:ws, to:we}), "warn")}
              {chip("R", rv1Post, ()=>openAppointmentsDrill({title:"RV1 reportés (semaine)", type:"RV1", status:"POSTPONED", from:ws, to:we}))}
              {chip("A", rv1Can, ()=>openAppointmentsDrill({title:"RV1 annulés (semaine)", type:"RV1", status:"CANCELED", from:ws, to:we}))}
            </div>
          </div>

          {/* RV2 */}
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium w-10">RV2</div>
            {stackedBar([
              { label: "Honorés", value: w.rv2Honored, color: "rgb(16 185 129)", on: ()=>openAppointmentsDrill({title:"RV2 honorés (semaine)", type:"RV2", status:"HONORED", from:ws, to:we}) },
              { label: "No-show", value: rv2NoShow, color: "rgb(245 158 11)", on: ()=>openAppointmentsDrill({title:"RV2 no-show (semaine)", type:"RV2", status:"NO_SHOW", from:ws, to:we}) },
              { label: "Reportés", value: rv2Post, color: "rgb(56 189 248)", on: ()=>openAppointmentsDrill({title:"RV2 reportés (semaine)", type:"RV2", status:"POSTPONED", from:ws, to:we}) },
              { label: "Annulés", value: rv2Can, color: "rgb(244 63 94)", on: ()=>openAppointmentsDrill({title:"RV2 annulés (semaine)", type:"RV2", status:"CANCELED", from:ws, to:we}) },
            ])}
            <div className="flex-1" />
            <div className="flex gap-2">
              {chip("P", w.rv2Planned, ()=>openAppointmentsDrill({title:"RV2 planifiés (semaine)", type:"RV2", from:ws, to:we}), "info")}
              {chip("H", w.rv2Honored, ()=>openAppointmentsDrill({title:"RV2 honorés (semaine)", type:"RV2", status:"HONORED", from:ws, to:we}), "ok")}
              {chip("NS", rv2NoShow, ()=>openAppointmentsDrill({title:"RV2 no-show (semaine)", type:"RV2", status:"NO_SHOW", from:ws, to:we}), "warn")}
              {chip("R", rv2Post, ()=>openAppointmentsDrill({title:"RV2 reportés (semaine)", type:"RV2", status:"POSTPONED", from:ws, to:we}))}
              {chip("A", rv2Can, ()=>openAppointmentsDrill({title:"RV2 annulés (semaine)", type:"RV2", status:"CANCELED", from:ws, to:we}))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /** -------- Loading skeleton -------- */
  const LoadingSkeleton = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card animate-pulse">
          <div className="h-5 w-40 bg-white/10 rounded mb-3" />
          <div className="h-7 w-24 bg-white/10 rounded" />
        </div>
      ))}
      <div className="card sm:col-span-2 h-72 animate-pulse" />
      <div className="card sm:col-span-2 h-64 animate-pulse" />
      <div className="card sm:col-span-2 h-40 animate-pulse" />
    </div>
  );

  if (!authChecked) {
    return <div className="min-h-screen flex items-center justify-center text-[--muted]">Chargement…</div>;
  }
  if (authError) {
    return (
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 p-6">
          <div className="text-sm text-red-400">{authError}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex gap-4">
        <Sidebar />

        <div className="flex-1 space-y-6">
          {/* ===== Header + Actions ===== */}
          <div className="rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(20,27,40,.9),rgba(12,17,26,.85))] px-4 py-5 relative overflow-hidden">
            <div className="absolute -right-24 -top-24 w-80 h-80 rounded-full bg-white/[0.03] blur-3xl pointer-events-none" />
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div>
                <div className="text-xl md:text-2xl font-semibold">Budgets, ROAS & Opérations</div>
                <div className="text-xs text-[--muted]">
                  Vue synthétique : budgets & CA de cohorte, plus un board visuel des RDV par semaine.
                </div>
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost relative" onClick={() => setFiltersOpen(true)} title="Filtres">
                  Filtres
                  {activeFiltersCount > 0 && (
                    <span className="absolute -right-2 -top-2 text-2xs px-1.5 py-0.5 rounded bg-white/20">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>
                <button className="btn btn-ghost" onClick={() => exportSeriesCSV(series)} title="Exporter en CSV">
                  Export CSV
                </button>
              </div>
            </div>
          </div>

          {/* ===== Error ===== */}
          <AnimatePresence>
            {err && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
              >
                {err}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ===== KPIs / Graphs / Board ===== */}
          {loading ? (
            LoadingSkeleton
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                <div className="card cursor-pointer"   onClick={() => { setDrillTitle(""); openLeadsDrill(); }}>
                  <div className="text-[10px] uppercase tracking-wide text-[--muted]">Leads (période)</div>
                  <div className="mt-1 text-2xl font-semibold">{fmtInt(sumLeads)}</div>
                </div>
                <div className="card">
                  <div className="text-[10px] uppercase tracking-wide text-[--muted]">Dépenses (total)</div>
                  <div className="mt-1 text-2xl font-semibold">{fmtEUR(sumSpend)}</div>
                </div>
                <div className="card cursor-pointer" onClick={()=>openCohortSalesDrill()}>
                  <div className="text-[10px] uppercase tracking-wide text-[--muted]">CA (Cohorte)</div>
                  <div className="mt-1 text-2xl font-semibold">{fmtEUR(sumCohCA)}</div>
                </div>
                <div className="card">
                  <div className="text-[10px] uppercase tracking-wide text-[--muted]">Ventes (Cohorte)</div>
                  <div className="mt-1 text-2xl font-semibold">{fmtInt(sumSales)}</div>
                </div>
                <div className="card">
                  <div className="text-[10px] uppercase tracking-wide text-[--muted]">ROAS (Cohorte)</div>
                  <div className="mt-1 text-2xl font-semibold">{roasCoh == null ? "—" : roasCoh}</div>
                </div>
              </div>

              {/* Graphs */}
              <div className="card">
                <div className="mb-3 font-medium">Dépenses vs CA (Cohorte) par semaine</div>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <defs>
                        <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgb(59,130,246)" stopOpacity={0.9}/>
                          <stop offset="100%" stopColor="rgb(59,130,246)" stopOpacity={0.4}/>
                        </linearGradient>
                        <linearGradient id="gCA" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity={0.95}/>
                          <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity={0.45}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2}/>
                      <XAxis dataKey="label" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar yAxisId="left" dataKey="spend" name="Dépenses" fill="url(#gSpend)" radius={[6,6,0,0]} onClick={onBarClick}/>
                      <Bar yAxisId="left" dataKey="cohortCA" name="CA (Cohorte)" fill="url(#gCA)" radius={[6,6,0,0]} onClick={onBarClick}/>
                      <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="rgba(255,255,255,.85)" dot={false} strokeWidth={2}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* ===== Weekly Ops Board (cartes) ===== */}
              <div className="space-y-3">
                <div className="text-sm font-medium">Opérations par semaine</div>
                {ops.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {ops.map((w) => <WeekCard key={w.weekStart} {...w} />)}
                  </div>
                ) : (
                  <div className="card text-[--muted]">Aucune donnée sur l’intervalle.</div>
                )}
              </div>

              {/* Formulaire budget hebdo (affiché seulement si une route GET budget existe) */}
              {supportsBudgetPost && (
                <div className="card">
                  <div className="mb-2 font-medium">Ajouter / Mettre à jour un budget hebdomadaire</div>
                  <form onSubmit={submitBudget} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-[--muted]">Semaine (sélectionne un jour)</label>
                      <input
                        type="date"
                        value={weekStartInput}
                        onChange={(e) => setWeekStartInput(e.target.value)}
                        className="w-full mt-1 rounded-lg bg-white/10 px-3 py-2"
                        required
                      />
                      <div className="text-[10px] text-[--muted] mt-1">
                        Lundi <b>00:00 UTC</b> sera enregistré automatiquement.
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[--muted]">Montant (Dépenses)</label>
                      <input
                        inputMode="decimal"
                        type="number"
                        min={0}
                        step="1"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        onKeyDown={(e)=>{ if (e.key === "e" || e.key === "-") e.preventDefault(); }}
                        className="w-full mt-1 rounded-lg bg-white/10 px-3 py-2"
                        required
                      />
                    </div>
                    <div className="flex items-end">
                      <button className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15">
                        Enregistrer
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Modale DRILL */}
              <DrillModal
                title={drillTitle}
                open={drillOpen}
                onClose={() => setDrillOpen(false)}
                rows={drillRows}
                extra={drillExtra}
              />
            </>
          )}

        </div>
      </div>

      {/* ====== PANNEAU DE FILTRES ====== */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-xl h-full bg-[rgba(16,22,33,.98)] border-l border-white/10 p-5 overflow-auto"
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-semibold">Filtres</div>
                <button className="btn btn-ghost" onClick={() => setFiltersOpen(false)}>Fermer</button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="label">Période rapide</div>
                  <div className="flex flex-wrap gap-2">
                    <button className="tab" onClick={() => { const d = new Date(); setUiRange({ from: d, to: d }); }}>Aujourd’hui</button>
                    <button className="tab" onClick={() => { const d = new Date(); const s = new Date(); s.setDate(d.getDate() - 6); setUiRange({ from: s, to: d }); }}>7 jours</button>
                    <button className="tab" onClick={() => { const d = new Date(); const s = new Date(); s.setDate(d.getDate() - 29); setUiRange({ from: s, to: d }); }}>30 jours</button>
                    <button className="tab" onClick={() => { const { from, to } = currentMonthRange(); setUiRange({ from: normalizeDate(from)!, to: normalizeDate(to)! }); }}>Ce mois</button>
                  </div>
                </div>

                <div>
                  <div className="label">Période personnalisée</div>
                  <DateRangePicker value={uiRange} onChange={setUiRange} />
                </div>

                <div className="flex items-center justify-between gap-2 pt-4">
                  <button
                    className="btn btn-ghost"
                    onClick={() => { const { from, to } = currentMonthRange(); setUiRange({ from: normalizeDate(from)!, to: normalizeDate(to)! }); }}
                  >
                    Réinitialiser
                  </button>
                  <div className="flex gap-2">
                    <button className="btn btn-ghost" onClick={() => setFiltersOpen(false)}>Annuler</button>
                    <button
                      className="btn btn-primary"
                      onClick={() => { setAppliedRange(uiRange); setFiltersOpen(false); }}
                    >
                      Appliquer
                    </button>
                  </div>
                </div>

                <div className="text-[10px] text-[--muted]">
                  Astuce : les filtres ne s’appliquent qu’au clic sur <b>Appliquer</b>.
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
