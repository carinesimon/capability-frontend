"use client";

import axios from "axios";
import type { AxiosRequestConfig } from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { useGlobalFilters } from "@/components/GlobalFiltersProvider";
import {
  buildReportingFilterParams,
  parseReportingFiltersFromSearchParams,
  updateSearchParamsWithReportingFilters,
} from "@/lib/reportingFilters";
import type {
  ReportingFilterParams,
  ReportingFilterState,
} from "@/lib/reportingFilters";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { useFunnelMetrics } from "@/hooks/useFunnelMetrics";

const TIMEZONES = [
  "Europe/Paris",
  "Europe/Amsterdam",
  "Africa/Abidjan",
  "Africa/Dakar",
  "Africa/Casablanca",
  "America/Toronto",
  "America/New_York",
];

const MAX_RANGE_START = new Date(2023, 0, 1);

const STAGE_SERIES_MAP = {
  callRequests: ["CALL_REQUESTED"],
  callsTotal: ["CALL_ATTEMPT"],
  callsAnswered: ["CALL_ANSWERED"],
  rv0NoShow: ["RV0_NO_SHOW"],
  rv0Honored: ["RV0_HONORED"],
  rv1Honored: ["RV1_HONORED"],
  rv1Canceled: ["RV1_CANCELED"],
  rv1Postponed: ["RV1_POSTPONED"],
  rv2Canceled: ["RV2_CANCELED"],
  rv2Postponed: ["RV2_POSTPONED"],
} as const;
type StageSeriesKey = keyof typeof STAGE_SERIES_MAP;

/* ---------- KPI Ratio chip ---------- */
const KpiRatio = ({
  label,
  num = 0,
  den = 0,
  inverse = false,
}: {
  label: string;
  num?: number;
  den?: number;
  inverse?: boolean;
}) => {
  const pct = den ? Math.round((num / den) * 100) : 0;
  const good =
    den === 0 ? false : inverse ? pct <= 20 : pct >= 50;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[--muted]">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <div
          className={`text-lg font-semibold ${
            good ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {pct}%
        </div>
        <div className="text-xs text-[--muted]">
          {(num || 0).toLocaleString("fr-FR")} /{" "}
          {(den || 0).toLocaleString("fr-FR")}
        </div>
      </div>
    </div>
  );
};

/* ---------- Types alignés backend (spotlight) ---------- */
type SetterRow = {
  userId: string;
  name: string;
  email: string;

  // Leads & RV
  leadsReceived: number;
  rv1PlannedOnHisLeads?: number;   // ✅ nouveau
  rv1HonoredOnHisLeads?: number;   // ✅ nouveau
  rv1CanceledOnHisLeads?: number;  // ✅ nouveau
  rv1DoneOnHisLeads?:number;
  rv1NoShowOnHisLeads?: number;          // ✅ pour la colonne "RV1 no-show"

  settingRate?:number;
  // Déjà présents dans ton code (on les garde)
  rv0Count?: number;
  ttfcAvgMinutes?: number | null;

  // Business depuis ses leads
  salesFromHisLeads?: number;      // ✅ nouveau
  revenueFromHisLeads?: number;    // ✅ nouveau

  // Métriques média (si dispo)
  spendShare?: number | null;
  cpl?: number | null;
  cpRv0?: number | null;
  cpRv1?: number | null;
  roas?: number | null;

  // Dérivés côté front
  qualificationRate?: number | null; // rv1HonoredOnHisLeads / leadsReceived
  rv1CancelRateOnHisLeads?: number | null; // rv1CanceledOnHisLeads / rv1PlannedOnHisLeads
  rv1NoShowRate?: number | null;            // ✅ pour "% no-show RV1"
  rv1CancelRate?: number | null;             // ✅ alias pour le front (évite l’erreur TS)

};

type CloserRow = {
  userId: string;
  name: string;
  email: string;

  // RV1
  rv1Planned: number;
  rv1Honored: number;
  rv1Canceled?: number;    
  rv1NoShow?: number;                // ✅ nouveau
       // ✅ nouveau
  rv1CancelRate?: number | null;  // ✅ nouveau
  
  rv1NoShowRate?: number | null;     // ✅ (utile si tu veux l'afficher plus tard)
  rv1Postponed?: number;   

  rv1NotQualified?:number | null;
  // RV2
  rv2Planned: number;
  rv2Honored?: number;
  rv2Canceled?: number;   
  rv2Postponed?: number;   
  rv2NoShow?: number;     
         // ✅ important
  rv2CancelRate?: number | null;  // ✅ nouveau
  rv2NoShowRate?: number | null;     // ✅

  // ✅ nouveaux dérivés
  rv1HonorRate?: number | null;          // RV1 faits / RV1 planifiés
  rv2HonorRate?: number | null;          // RV2 faits / RV2 planifiés
  closingOnRv1Planned?: number | null;   // ventes / RV1 planifiés
  
  // Business
  salesClosed: number;
  revenueTotal: number;
  contractsSigned: number;


  // Optionnels existants
  roasPlanned?: number | null;
  roasHonored?: number | null;

  // Dérivé côté front
  closingRate?: number | null;    // salesClosed / rv1Honored
};


type DuoRow = {
  setterId: string;
  setterName: string;
  setterEmail: string;
  closerId: string;
  closerName: string;
  closerEmail: string;
  salesCount: number;
  revenue: number;
  avgDeal: number;
  rv1Planned: number;
  rv1Honored: number;
  rv1HonorRate: number | null;
};

type LeadsReceivedOut = {
  total: number;
  byDay?: Array<{ day: string; count: number }>;
};
type MetricSeriesOut = {
  total: number;
  byDay?: Array<{ day: string; count: number }>;
};

type FilterOptionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
};

type FilterOptions = {
  sources: string[];
  setters: FilterOptionUser[];
  closers: FilterOptionUser[];
  tags: string[];
};

type SourceOptionPayload = string | { source?: string };
type TagOptionPayload = string | { tag?: string };

type SalesWeeklyItem = {
  weekStart: string;
  weekEnd: string;
  revenue: number;
  count: number;
};
type SummaryOut = {
  period: { from?: string; to?: string };
  totals: {
    leads: number;
    revenue: number;
    salesCount: number;
    spend: number;
    roas: number | null;
    settersCount: number;
    closersCount: number;
    rv1Honored: number;
  };
};

type WeeklyOpsRow = {
  weekStart: string;
  weekEnd: string;
  rv0Planned: number;
  rv0Honored: number;
  rv0NoShow?: number;
  rv1Planned: number;
  rv1Honored: number;
  rv1NoShow: number;
  rv1Postponed?: number;
  rv2Planned: number;
  rv2Honored: number;
  rv2NoShow: number;
  rv2Postponed?: number;
  notQualified?: number;
  lost?: number;
};

/* ---------- UI tokens ---------- */
const COLORS = {
  axis: "rgba(255,255,255,0.7)",
  grid: "rgba(255,255,255,0.08)",
  tooltipBg: "rgba(17,24,39,0.9)",
  tooltipBorder: "rgba(255,255,255,0.08)",
  revenue: "#6366F1",
  revenueDark: "#4F46E5",
  leads: "#22C55E",
  leadsDark: "#16A34A",
  count: "#F59E0B",
  countDark: "#D97706",
};

/* ---------- Utils ---------- */
function asDate(x?: Date | string | null): Date | null {
  if (!x) return null;
  const d = x instanceof Date ? x : new Date(x as any);
  return isNaN(d.getTime()) ? null : d;
}
function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function normalizeFilterValues(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
function toISODate(d: Date | string) {
  const dd = d instanceof Date ? d : new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function deriveLeadCreatedMode(
  from?: string,
  to?: string
): "none" | "exact" | "range" {
  if (!from && !to) return "none";
  if (from && to && from === to) return "exact";
  return "range";
}
const fmtInt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const fmtEUR = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;
const fmtPct = (num?: number | null, den?: number | null) =>
  den && den > 0 ? `${Math.round(((num || 0) / den) * 100)}%` : "—";

const EMPTY_METRIC_SERIES: MetricSeriesOut = {
  total: 0,
  byDay: [],
};

const mergeMetricSeries = (seriesList: MetricSeriesOut[]) => {
  const map = new Map<string, number>();
  for (const series of seriesList) {
    const rows = series?.byDay ?? [];
    for (const row of rows) {
      const key =
        row?.day?.slice?.(0, 10) ||
        new Date(row.day).toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + Number(row.count || 0));
    }
  }
  const byDay = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));
  const total = byDay.reduce((sum, row) => sum + row.count, 0);
  return { total, byDay } as MetricSeriesOut;
};

const extractErrorMessage = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      if (typeof (data as { message?: unknown }).message === "string") {
        return (data as { message: string }).message;
      }
      if (typeof (data as { error?: unknown }).error === "string") {
        return (data as { error: string }).error;
      }
    }
  }
  if (error instanceof Error) return error.message;
  return "";
};

const isTagsUnsupportedError = (error: unknown) => {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status ?? 0;
  if (status !== 400 && status !== 422) return false;
  const message = extractErrorMessage(error).toLowerCase();
  return message.includes("tag") || message.includes("tagscsv");
};

const isStageSeriesInvalidError = (error: unknown, url?: string) => {
  if (!url?.includes("/metrics/stage-series")) return false;
  if (!axios.isAxiosError(error)) return false;
  if (error.response?.status !== 400) return false;
  const message = extractErrorMessage(error).toLowerCase();
  return message.includes("stage invalide") || message.includes("stage est requis");
};

/* ---------- Tooltip (Recharts) ---------- */
function ProTooltip({
  active,
  payload,
  label,
  valueFormatters,
  title,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  valueFormatters?: Record<string, (v: number) => string>;
  title?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2 text-sm shadow-xl"
      style={{
        background: COLORS.tooltipBg,
        border: `1px solid ${COLORS.tooltipBorder}`,
      }}
    >
      {title && (
        <div className="text-[10px] uppercase tracking-wide opacity-70">
          {title}
        </div>
      )}
      {label && <div className="font-medium mb-1">{label}</div>}
      <div className="space-y-0.5">
        {payload.map((entry, i) => {
          const key = entry.dataKey as string;
          const v = Number(entry.value ?? 0);
          const fmt = valueFormatters?.[key];
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className="inline-flex h-2 w-2 rounded-full"
                style={{ background: entry.color || "#fff" }}
              />
              <span className="text-[11px] opacity-70">{entry.name}</span>
              <span className="text-[11px]">
                {fmt ? fmt(v) : v.toLocaleString("fr-FR")}
              </span>
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
  email?: string | null;
  phone?: string | null;
  setter?: { id: string; name: string; email: string } | null;
  closer?: { id: string; name: string; email: string } | null;
  appointment?: {
    type: string;
    status?: string;
    scheduledAt: string;
  } | null;
  saleValue?: number | null;
  stage?: string;
  createdAt?: string;
  stageUpdatedAt?: string;
};
type DrillResponse = {
  items?: DrillItem[];
  __error?: string;
};
function DrillModal({
  title,
  open,
  onClose,
  rows,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  rows: DrillItem[];
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        className="w-full max-w-5xl max-h-[80vh] overflow-auto rounded-2xl border border-white/10 bg-[rgba(16,22,33,.98)] p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">{title}</div>
          <button className="btn btn-ghost" onClick={onClose}>
            Fermer
          </button>
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
              {rows.length ? (
                rows.map((r) => (
                  <tr
                    key={r.leadId + Math.random()}
                    className="border-t border-white/10"
                  >
                    <td className="py-2 pr-2">
                      <div className="font-medium">{r.leadName}</div>
                      <div className="text-xs text-[--muted]">
                        {r.email ?? "—"} • {r.phone ?? "—"}
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      {r.setter?.name ?? "—"}
                    </td>
                    <td className="py-2 pr-2">
                      {r.closer?.name ?? "—"}
                    </td>
                    <td className="py-2 pr-2">
                      {r.appointment ? (
                        <>
                          <div className="text-xs">
                            {r.appointment.type}
                            {r.appointment.status
                              ? ` (${r.appointment.status})`
                              : ""}
                          </div>
                          <div className="text-xs text-[--muted]">
                            {new Date(
                              r.appointment.scheduledAt
                            ).toLocaleString()}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      {r.saleValue
                        ? `${Math.round(
                            r.saleValue
                          ).toLocaleString("fr-FR")} €`
                        : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="py-6 text-[--muted]"
                    colSpan={5}
                  >
                    Aucune ligne
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

/* ---------- Funnel (cards cliquables) ---------- */
type FunnelKey =
  // Top funnel
  | "leads"
  | "callRequests"
  // Call → RV0
  | "rv0Honored"
  | "rv0NoShow"
  | "rv0NotQualified"
  | "rv0Nurturing"
  | "rv0Canceled"
  // RV0 → RV1
  | "rv1Planned"
  | "rv1Honored"
  | "rv1Postponed"
  | "rv1NoShow" 
  | "rv1NotQualified"
  | "rv1FollowupCloser"
  | "rv1Canceled" 
  // RV2
  | "rv2Planned"
  | "rv2Honored"
  | "rv2Postponed"
  | "rv2NoShow"
  | "rv2Canceled"
  // Sales
  | "wonCount";


type FunnelProps = {
  data: {
    leads: number;
    callRequests: number;
    callsTotal: number;
    callsAnswered: number;
    setterNoShow: number;

    rv0P: number;
    rv0H: number;
    rv0NS: number;
    rv0C: number;
    rv0NQ: number;
    rv0Nurturing: number;

    rv1P: number;
    rv1H: number;
    rv1NS: number;
    rv1Postponed: number;
    rv1FollowupCloser: number;
    rv1C: number;
    rv1NQ: number;

    rv2P: number;
    rv2H: number;
    rv2NS: number;
    rv2C: number;
    rv2Postponed: number;

    won: number;
  };
  onCardClick?: (key: FunnelKey) => void | Promise<void>;
};


function Funnel({ data, onCardClick }: FunnelProps) {
  // ✅ Groupes utilisés pour les cards ET pour la timeline
  type CardGroup = "top" | "callToRv0" | "rv0ToRv1" | "rv2" | "sales";

  type Card = {
    key: FunnelKey;
    label: string;
    value: number;
    hint?: string;
    group: CardGroup;
    // si tu as rajouté numForRate/denForRate, garde-les ici :
    numForRate?: number;
    denForRate?: number;
  };

  const groups: {
    id: CardGroup;
    title: string;
    subtitle: string;
    stepLabel: string;
    tone: "indigo" | "cyan" | "amber" | "violet" | "rose" | "emerald";
  }[] = [
    {
      id: "top",
      title: "Vue globale du pipeline",
      subtitle: "Leads → demandes d’appel → RV0 faits.",
      stepLabel: "Étape 1",
      tone: "indigo",
    },
    {
      id: "callToRv0",
      title: "Demandes d’appel → RV0",
      subtitle: "Comment les demandes d’appel se transforment en RV0.",
      stepLabel: "Étape 2",
      tone: "cyan",
    },
    {
      id: "rv0ToRv1",
      title: "RV0 → RV1",
      subtitle: "Qualité des RV0 et passage vers les closings.",
      stepLabel: "Étape 3",
      tone: "amber",
    },
    {
      id: "rv2",
      title: "RV2 & suivis",
      subtitle: "Deuxièmes RDV et stabilité des deals.",
      stepLabel: "Étape 4",
      tone: "violet",
    },
    {
      id: "sales",
      title: "Ventes",
      subtitle: "Nombre total de ventes signées.",
      stepLabel: "Étape 5",
      tone: "emerald",
    },
  ];

  const cards: Card[] = [
    // ------- VUE GLOBALE TOP FUNNEL -------
    {
      key: "leads",
      label: "Leads reçus",
      value: data.leads,
      hint: "Leads froids entrés dans le système.",
      group: "top",
    },
    {
      key: "callRequests",
      label: "Demandes d’appel",
      value: data.callRequests,
      hint: "Prospects qui demandent un échange.",
      group: "top",
    },
    {
      key: "rv0Honored",
      label: "RV0 faits",
      value: data.rv0H,
      hint: "RV0 réellement tenus avec le prospect.",
      group: "top",
    },

        // ------- VENTES -------
    {
      key: "wonCount",
      label: "Ventes (WON)",
      value: data.won,
      hint: "Dossiers passés en client (nombre de ventes).",
      group: "top",
    },

    // ------- DEMANDES D’APPEL → RV0 -------
    {
      key: "rv0Honored",
      label: "RV0 faits",
      value: data.rv0H,
      hint: "RV0 tenus avec le prospect.",
      group: "callToRv0",
    },
    {
      key: "rv0NoShow",
      label: "RV0 no-show",
      value: data.rv0NS,
      hint: "Prospects absents au RV0.",
      group: "callToRv0",
    },
    {
      key: "rv0NotQualified",
      label: "RV0 non qualifiés",
      value: data.rv0NQ,
      hint: "Prospects jugés non qualifiés dès le RV0.",
      group: "callToRv0",
    },
    {
      key: "rv0Nurturing",
      label: "RV0 nurturing / à relancer",
      value: data.rv0Nurturing,
      hint: "Prospects mis en nurturing après RV0.",
      group: "callToRv0",
    },

    // ------- RV0 → RV1 -------
    {
      key: "rv1Planned",
      label: "RV1 planifiés",
      value: data.rv1P,
      hint: "Closings programmés.",
      group: "rv0ToRv1",
    },
    {
      key: "rv1Honored",
      label: "RV1 faits",
      value: data.rv1H,
      hint: "Closings réellement tenus.",
      group: "rv0ToRv1",
    },
    {
      key: "rv1Postponed",
      label: "RV1 reportés",
      value: data.rv1Postponed,
      hint: "RV1 reprogrammés à une autre date.",
      group: "rv0ToRv1",
    },
    {
      key: "rv1NoShow",
      label: "RV1 no-show",
      value: data.rv1NS,
      hint: "Absences au RV1.",
      group: "rv0ToRv1",
    },
    {
      key: "rv1NotQualified",
      label: "RV1 non qualifiés",
      value: data.rv1NQ,
      hint: "Prospects sortis du pipe après RV1.",
      group: "rv0ToRv1",
    },
    {
      key: "rv1FollowupCloser",
      label: "RV1 follow-up closer",
      value: data.rv1FollowupCloser,
      hint: "Dossiers en suivi par le closer après RV1.",
      group: "rv0ToRv1",
    },

    // ------- RV2 -------
    {
      key: "rv2Planned",
      label: "RV2 planifiés",
      value: data.rv2P,
      hint: "Deuxièmes RDV programmés.",
      group: "rv2",
    },
    {
      key: "rv2Honored",
      label: "RV2 faits",
      value: data.rv2H,
      hint: "Deuxièmes RDV tenus.",
      group: "rv2",
    },
    {
      key: "rv2Postponed",
      label: "RV2 reportés",
      value: data.rv2Postponed,
      hint: "RV2 reprogrammés à une autre date.",
      group: "rv2",
    },
    {
      key: "rv2NoShow",
      label: "RV2 no-show",
      value: data.rv2NS,
      hint: "Absences au RV2.",
      group: "rv2",
    },
    {
      key: "rv2Canceled",
      label: "RV2 annulés",
      value: data.rv2C,
      hint: "RV2 annulés avant d’avoir lieu.",
      group: "rv2",
    },
  ];

  const toneClasses = (tone: (typeof groups)[number]["tone"]) => {
    switch (tone) {
      case "indigo":
        return "border-indigo-400/40 hover:border-indigo-200/90 bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.35),rgba(15,23,42,0.98))]";
      case "cyan":
        return "border-cyan-400/40 hover:border-cyan-200/90 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.30),rgba(15,23,42,0.98))]";
      case "amber":
        return "border-amber-400/40 hover:border-amber-200/90 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.30),rgba(15,23,42,0.98))]";
      case "violet":
        return "border-violet-400/40 hover:border-violet-200/90 bg-[radial-gradient(circle_at_top,_rgba(167,139,250,0.32),rgba(15,23,42,0.98))]";
      case "rose":
        return "border-rose-400/40 hover:border-rose-200/90 bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.30),rgba(15,23,42,0.98))]";
      case "emerald":
      default:
        return "border-emerald-400/40 hover:border-emerald-200/90 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.30),rgba(15,23,42,0.98))]";
    }
  };

  const grouped = groups
    .map((g) => ({
      ...g,
      items: cards.filter((c) => c.group === g.id),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {/* Timeline horizontale du funnel (au-dessus, très lisible) */}
      <div className="hidden lg:flex items-center justify-between gap-3 text-[11px] text-[--muted]">
        {grouped.map((g) => (
          <div key={g.id} className="flex-1 flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <div className="h-px w-6 bg-gradient-to-r from-white/0 via-white/40 to-white/0" />
              <div className="rounded-full border border-white/15 bg-black/40 px-3 py-0.5">
                <span className="text-[9px] uppercase tracking-wide opacity-70">
                  {g.stepLabel}
                </span>
              </div>
              <div className="h-px w-6 bg-gradient-to-r from-white/0 via-white/40 to-white/0" />
            </div>
            <div className="text-[11px] font-medium text-white/85">
              {g.title}
            </div>
          </div>
        ))}
      </div>

      {/* Groupes de tuiles cliquables (chiffres uniquement) */}
      <div className="space-y-3">
        {grouped.map((g) => (
          <div
            key={g.id}
            className="rounded-2xl border border-white/5 bg-[rgba(8,12,20,.9)] px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                  {g.stepLabel} · {g.title}
                </div>
                <div className="text-[11px] text-[--muted]">
                  {g.subtitle}
                </div>
              </div>
              <div className="hidden sm:block text-[10px] text-[--muted]">
                Clique une tuile pour voir les leads correspondants.
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2">
              {g.items.map((c) => (
                <motion.button
                  key={c.key ?? c.label}
                  type="button"
                  whileHover={{ y: -2, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={!onCardClick || !c.key}
                  onClick={() => c.key && onCardClick?.(c.key)}
                  className={[
                    "group relative min-w-[190px] max-w-xs flex-1 rounded-2xl px-3 py-2.5 text-left",
                    "shadow-[0_18px_40px_rgba(0,0,0,0.9)]",
                    "transition-all duration-200",
                    toneClasses(g.tone),
                    !onCardClick || !c.key ? "opacity-70 cursor-default" : "cursor-pointer",
                  ].join(" ")}
                >
                  {/* Label */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-wide text-white/80">
                      {c.label}
                    </div>
                  </div>

                  {/* Chiffre principal */}
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-semibold">
                      {fmtInt(c.value)}
                    </span>
                  </div>

                  {/* Hint */}
                  {c.hint && (
                    <div className="mt-1 text-[11px] leading-snug text-[--muted]">
                      {c.hint}
                    </div>
                  )}

                  {/* Effet hover subtil */}
                  <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute inset-x-0 -bottom-6 h-16 bg-gradient-to-t from-black/60 via-black/30 to-transparent" />
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
/* ---------- Trend badge ---------- */
function Trend({
  curr,
  prev,
  compact,
}: {
  curr: number;
  prev: number;
  compact?: boolean;
}) {
  const diff = curr - (prev || 0);
  const pct = prev ? (diff / prev) * 100 : curr ? 100 : 0;
  const up = diff >= 0;
  return (
    <span
      className={`ml-2 ${
        compact ? "text-[10px]" : "text-xs"
      } ${up ? "text-emerald-300" : "text-rose-300"}`}
      title={`${
        up ? "Hausse" : "Baisse"
      } de ${Math.abs(diff).toLocaleString("fr-FR")} (${Math.abs(
        pct
      ).toFixed(1)}%) vs période précédente`}
    >
      {up ? "↑" : "↓"} {Math.abs(diff).toLocaleString("fr-FR")} (
      {Math.abs(pct).toFixed(1)}%)
    </span>
  );
}

/* ============================= NORMALIZER FUNNEL ============================= */
/** Normalise les totaux d’événements pour accepter FR/EN et variantes */
function normalizeTotals(
  raw: Record<string, number | undefined> | undefined
) {
  const T = raw || {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (T[k] != null) return Number(T[k]);
    }
    return 0;
  };

  return {
    // -------- Entrées de pipeline --------
    LEADS_RECEIVED: pick(
      "LEADS_RECEIVED",
      "LEAD_RECEIVED",
      "LEAD_RECU",
      "LEAD_REÇU",
      "LEADS"
    ),

    CALL_REQUESTED: pick(
      "CALL_REQUESTED",
      "DEMANDE_APPEL",
      "CALL_REQUEST",
      "APPOINTMENT_REQUEST"
    ),

    CALL_ATTEMPT: pick(
      "CALL_ATTEMPT",
      "APPEL_PASSE",
      "APPEL_PASSÉ",
      "CALLS_TOTAL",
      "CALL_MADE"
    ),

    CALL_ANSWERED: pick(
      "CALL_ANSWERED",
      "APPEL_REPONDU",
      "APPEL_RÉPONDU",
      "CALL_ANSWER"
    ),

    SETTER_NO_SHOW: pick("SETTER_NO_SHOW", "NO_SHOW_SETTER"),

    // -------- RV0 (diagnostic) --------
    RV0_PLANNED: pick("RV0_PLANNED", "RV0_PLANIFIE", "RV0_PLANIFIÉ"),
    RV0_HONORED: pick("RV0_HONORED", "RV0_HONORE", "RV0_HONORÉ"),
    RV0_NO_SHOW: pick("RV0_NO_SHOW"),

    // Nouveaux : RV0 non qualifiés & nurturing (follow-up setter)
    RV0_NOT_QUALIFIED_1: pick(
      "RV0_NOT_QUALIFIED_1",
      "RV0_NOT_QUALIFIE_1",
      "RV0_NOT_QUALIFIÉ_1"
    ),
    RV0_NOT_QUALIFIED_2: pick(
      "RV0_NOT_QUALIFIED_2",
      "RV0_NOT_QUALIFIE_2",
      "RV0_NOT_QUALIFIÉ_2"
    ),
    RV0_NURTURING: pick(
      "RV0_NURTURING",
      "NURTURING_RV0",
      "FOLLOW_UP",
      "FOLLOW_UP_SETTER"
    ),

    // -------- RV1 (closing) --------
    RV1_PLANNED: pick("RV1_PLANNED", "RV1_PLANIFIE", "RV1_PLANIFIÉ"),
    RV1_HONORED: pick("RV1_HONORED", "RV1_HONORE", "RV1_HONORÉ"),
    RV1_NO_SHOW: pick("RV1_NO_SHOW"),

    // Non qualifiés RV1 (exigence Cyrille)
    RV1_NOT_QUALIFIED: pick(
      "RV1_NOT_QUALIFIED",
      "NOT_QUALIFIED_RV1",
      "RV1_NON_QUALIFIE",
      "RV1_NON_QUALIFIÉ"
    ),

    // Follow up côté closer (exigence : Follow up Closer séparé)
    RV1_FOLLOWUP: pick(
      "FOLLOW_UP_CLOSER",
      "RV1_FOLLOW_UP",
      "FOLLOW_UP_RV1",
      "FOLLOWUP_CLOSER"
    ),

    // -------- RV2 (suivi / relance) --------
    RV2_PLANNED: pick("RV2_PLANNED", "RV2_PLANIFIE", "RV2_PLANIFIÉ"),
    RV2_HONORED: pick("RV2_HONORED", "RV2_HONORE", "RV2_HONORÉ"),
    RV2_NO_SHOW: pick("RV2_NO_SHOW"),

    // --- RDV annulés par type (on garde pour backend / graph) ---
    RV0_CANCELED: pick("RV0_CANCELED", "RV0_ANNULÉ", "RV0_ANNULE"),
    RV1_CANCELED: pick("RV1_CANCELED", "RV1_ANNULÉ", "RV1_ANNULE"),
    RV2_CANCELED: pick("RV2_CANCELED", "RV2_ANNULÉ", "RV2_ANNULE"),

    // --- RDV reportés (POSTPONED = reporté) ---
    RV1_POSTPONED: pick(
      "RV1_POSTPONED",
      "RV1_RESCHEDULED",
      "RV1_REPORTÉ",
      "RV1_REPORTE"
    ),
    RV2_POSTPONED: pick(
      "RV2_POSTPONED",
      "RV2_RESCHEDULED",
      "RV2_REPORTÉ",
      "RV2_REPORTE"
    ),

    // -------- Sorties de pipeline --------
    WON: pick("WON"),

    LOST: pick("LOST"),

    NOT_QUALIFIED: pick(
      "NOT_QUALIFIED",
      "NON_QUALIFIE",
      "NON_QUALIFIÉ"
    ),

    APPOINTMENT_CANCELED: pick(
      "APPOINTMENT_CANCELED",
      "APPOINTMENT_CANCELLED",
      "RDV_ANNULE",
      "RDV_ANNULÉ",
      "appointmentCanceled"
    ),
  };
}

type PipelineTotals = ReturnType<typeof normalizeTotals>;

/* ============================= PAGE ============================= */
export default function DashboardPage() {
  const debugFilters =
    process.env.NEXT_PUBLIC_DEBUG_FILTERS === "true" &&
    process.env.NODE_ENV !== "production";
  const router = useRouter();
  const pathname = usePathname();
  const safePathname = pathname ?? "/";
  const search = useSearchParams();
  const safeSearch = useMemo(
    () => search ?? new URLSearchParams(),
    [search]
  );
  const { sources, excludeSources, setSources, setExcludeSources } =
    useGlobalFilters();
  const view = (safeSearch.get("view") || "home") as
    | "home"
    | "closers"
    | "setters"
    | "duos"
    | "teams"
    | "ops";

  const initialFilters = useMemo(
    () => parseReportingFiltersFromSearchParams(safeSearch),
    [safeSearch]
  );

  const { from: defaultFrom, to: defaultTo } =
    currentMonthRange();
  const [range, setRange] = useState<Range>(() => ({
    from: initialFilters.from
      ? asDate(initialFilters.from) ?? defaultFrom
      : defaultFrom,
    to: initialFilters.to
      ? asDate(initialFilters.to) ?? defaultTo
      : defaultTo,
  }));
  const [draftRange, setDraftRange] = useState<Range>(() => ({
    from: initialFilters.from
      ? asDate(initialFilters.from) ?? defaultFrom
      : defaultFrom,
    to: initialFilters.to
      ? asDate(initialFilters.to) ?? defaultTo
      : defaultTo,
  }));
  const [tz, setTz] = useState<string>(
    () => initialFilters.tz ?? "Europe/Paris"
  );
  const [draftTz, setDraftTz] = useState<string>(
    () => initialFilters.tz ?? "Europe/Paris"
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [comparePrev, setComparePrev] = useState(false);

  const [setterIds, setSetterIds] = useState<string[]>(
    () => initialFilters.setterIds ?? []
  );
  const [closerIds, setCloserIds] = useState<string[]>(
    () => initialFilters.closerIds ?? []
  );
  const [tags, setTags] = useState<string[]>(() => initialFilters.tags ?? []);
  const [leadCreatedFrom, setLeadCreatedFrom] = useState<
    string | undefined
  >(() => initialFilters.leadCreatedFrom);
  const [leadCreatedTo, setLeadCreatedTo] = useState<
    string | undefined
  >(() => initialFilters.leadCreatedTo);
  const [draftSetterIds, setDraftSetterIds] = useState<string[]>(
    () => initialFilters.setterIds ?? []
  );
  const [draftCloserIds, setDraftCloserIds] = useState<string[]>(
    () => initialFilters.closerIds ?? []
  );
  const [draftTags, setDraftTags] = useState<string[]>(
    () => initialFilters.tags ?? []
  );
  const [draftLeadCreatedFrom, setDraftLeadCreatedFrom] = useState<
    string | undefined
  >(() => initialFilters.leadCreatedFrom);
  const [draftLeadCreatedTo, setDraftLeadCreatedTo] = useState<
    string | undefined
  >(() => initialFilters.leadCreatedTo);
  const [draftLeadCreatedMode, setDraftLeadCreatedMode] = useState<
    "none" | "exact" | "range"
  >(() =>
    deriveLeadCreatedMode(
      initialFilters.leadCreatedFrom,
      initialFilters.leadCreatedTo
    )
  );

  const buildFilterState = (
    stateRange: Range,
    overrides: Partial<{
      tz: string;
      setterIds: string[];
      closerIds: string[];
      tags: string[];
      leadCreatedFrom?: string;
      leadCreatedTo?: string;
    }> = {}
  ) => ({
    from: stateRange.from ? toISODate(stateRange.from) : undefined,
    to: stateRange.to ? toISODate(stateRange.to) : undefined,
    tz: overrides.tz ?? tz,
    setterIds: overrides.setterIds ?? setterIds,
    closerIds: overrides.closerIds ?? closerIds,
    tags: overrides.tags ?? tags,
    leadCreatedFrom:
      overrides.leadCreatedFrom ?? leadCreatedFrom,
    leadCreatedTo: overrides.leadCreatedTo ?? leadCreatedTo,
  });

  const fromISO = range.from ? toISODate(range.from) : undefined;
  const toISO = range.to ? toISODate(range.to) : undefined;
  const fromDate = useMemo(
    () => asDate(range.from) ?? new Date(),
    [range.from]
  );
  const toDate = useMemo(
    () => asDate(range.to) ?? new Date(),
    [range.to]
  );
  const normalizedSetterIds = useMemo(
    () => normalizeFilterValues(setterIds),
    [setterIds]
  );
  const normalizedCloserIds = useMemo(
    () => normalizeFilterValues(closerIds),
    [closerIds]
  );
  const normalizedTags = useMemo(
    () => normalizeFilterValues(tags),
    [tags]
  );
  const normalizedSources = useMemo(
    () => normalizeFilterValues(sources),
    [sources]
  );
  const normalizedExcludeSources = useMemo(
    () => normalizeFilterValues(excludeSources),
    [excludeSources]
  );
  const normalizedSetterIdsKey = useMemo(
    () => normalizedSetterIds.join(","),
    [normalizedSetterIds]
  );
  const normalizedCloserIdsKey = useMemo(
    () => normalizedCloserIds.join(","),
    [normalizedCloserIds]
  );
  const normalizedTagsKey = useMemo(
    () => normalizedTags.join(","),
    [normalizedTags]
  );
  const appliedFilterState = useMemo<ReportingFilterState>(
    () => ({
      from: fromISO,
      to: toISO,
      tz,
      setterIds: normalizedSetterIds,
      closerIds: normalizedCloserIds,
      tags: normalizedTags,
      leadCreatedFrom,
      leadCreatedTo,
    }),
    [
      fromISO,
      toISO,
      tz,
      normalizedSetterIds,
      normalizedCloserIds,
      normalizedTags,
      leadCreatedFrom,
      leadCreatedTo,
    ]
  );
  const buildParams = useCallback(
    (
      overrides: Partial<ReportingFilterState> = {},
      options: { includeTags?: boolean } = {}
    ): ReportingFilterParams => {
      const nextFilters = {
        ...appliedFilterState,
        ...overrides,
      };
      if (options.includeTags === false) {
        nextFilters.tags = [];
      }
      const { sourcesCsv, sourcesExcludeCsv, ...rest } =
        buildReportingFilterParams(nextFilters);
      void sourcesCsv;
      void sourcesExcludeCsv;
      return rest;
    },
    [appliedFilterState]
  );
  const filterParamsKey = useMemo(
    () =>
      JSON.stringify({
        from: fromISO,
        to: toISO,
        tz,
        setterIds: normalizedSetterIdsKey,
        closerIds: normalizedCloserIdsKey,
        tags: normalizedTagsKey,
        leadCreatedFrom,
        leadCreatedTo,
      }),
    [
      fromISO,
      toISO,
      tz,
      normalizedSetterIdsKey,
      normalizedCloserIdsKey,
      normalizedTagsKey,
      leadCreatedFrom,
      leadCreatedTo,
    ]
  );
  const filterOptionsParams = useMemo(
    () => buildParams(),
    [buildParams]
  );
  const filterOptionsParamsKey = useMemo(
    () => JSON.stringify(filterOptionsParams),
    [filterOptionsParams]
  );
  const filterParamsWithoutDates = useMemo(
    () =>
      buildParams({
        from: undefined,
        to: undefined,
      }),
    [buildParams]
  );
  const appliedParams = useMemo(
    () => buildParams(),
    [buildParams]
  );
  const appliedParamsKey = useMemo(
    () => JSON.stringify(appliedParams),
    [appliedParams]
  );
  const filteredMode = useMemo(
    () =>
      Boolean(
        appliedParams.setterIdsCsv ||
          appliedParams.closerIdsCsv ||
          appliedParams.tagsCsv
      ),
    [appliedParams]
  );
  const filteredModeWithTags = Boolean(
    filteredMode && appliedParams.tagsCsv
  );

  const isSameRange = (a: Range, b: Range) => {
    const aFrom = asDate(a.from)?.getTime() ?? null;
    const aTo = asDate(a.to)?.getTime() ?? null;
    const bFrom = asDate(b.from)?.getTime() ?? null;
    const bTo = asDate(b.to)?.getTime() ?? null;
    return aFrom === bFrom && aTo === bTo;
  };

  useEffect(() => {
    const nextRange: Range = {
      from: initialFilters.from
        ? asDate(initialFilters.from) ?? defaultFrom
        : defaultFrom,
      to: initialFilters.to
        ? asDate(initialFilters.to) ?? defaultTo
        : defaultTo,
    };

    if (!isSameRange(range, nextRange)) {
      setRange(nextRange);
    }
    if (initialFilters.tz && initialFilters.tz !== tz) {
      setTz(initialFilters.tz);
      if (!filtersOpen) {
        setDraftTz(initialFilters.tz);
      }
    }
    if (!arraysEqual(setterIds, initialFilters.setterIds ?? [])) {
      setSetterIds(initialFilters.setterIds ?? []);
    }
    if (!arraysEqual(closerIds, initialFilters.closerIds ?? [])) {
      setCloserIds(initialFilters.closerIds ?? []);
    }
    if (!arraysEqual(tags, initialFilters.tags ?? [])) {
      setTags(initialFilters.tags ?? []);
    }
    if (initialFilters.leadCreatedFrom !== leadCreatedFrom) {
      setLeadCreatedFrom(initialFilters.leadCreatedFrom);
    }
    if (initialFilters.leadCreatedTo !== leadCreatedTo) {
      setLeadCreatedTo(initialFilters.leadCreatedTo);
    }
  }, [
    initialFilters,
    defaultFrom,
    defaultTo,
    filtersOpen,
    range,
    setterIds,
    closerIds,
    tags,
    leadCreatedFrom,
    leadCreatedTo,
    tz,
  ]);

  const syncFiltersToUrl = (nextFilters: {
    from?: string;
    to?: string;
    tz?: string;
    setterIds?: string[];
    closerIds?: string[];
    tags?: string[];
    leadCreatedFrom?: string;
    leadCreatedTo?: string;
  }) => {
    const nextParams = updateSearchParamsWithReportingFilters(
      new URLSearchParams(safeSearch.toString()),
      nextFilters,
      { includeSources: false }
    );
    const nextQuery = nextParams.toString();
    const currentQuery = safeSearch.toString();
    if (nextQuery === currentQuery) return;
    const url = nextQuery ? `${safePathname}?${nextQuery}` : safePathname;
    router.replace(url, { scroll: false });
  };

  // ========= FUNNEL METRICS (pour les tuiles + Funnel) =========
  const {
    data: funnelRaw = {},
    loading: funnelLoading,
    error: funnelError,
  } = useFunnelMetrics(
    filteredMode ? null : fromDate,
    filteredMode ? null : toDate,
    tz,
    filterParamsWithoutDates
  );

  const funnelTotals = useMemo(
    () =>
      normalizeTotals(
        funnelRaw as Record<string, number | undefined>
      ),
    [funnelRaw]
  );
  const emptyPipelineTotals = useMemo(
    () => normalizeTotals({}),
    []
  );
  const [filteredPipelineTotals, setFilteredPipelineTotals] =
    useState<PipelineTotals | null>(null);
  const [filteredPipelineLoading, setFilteredPipelineLoading] =
    useState(false);
  const [filteredPipelineError, setFilteredPipelineError] =
    useState<string | null>(null);
  const [filteredLeadsSeries, setFilteredLeadsSeries] =
    useState<MetricSeriesOut | null>(null);

  
  // Période précédente (même durée)
  const { prevFromISO, prevToISO } = useMemo(() => {
    if (!range.from || !range.to)
      return { prevFromISO: undefined, prevToISO: undefined };
    const from = asDate(range.from)!;
    const to = asDate(range.to)!;
    const span = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 24 * 3600 * 1000);
    const prevFrom = new Date(prevTo.getTime() - span);
    return {
      prevFromISO: toISODate(prevFrom),
      prevToISO: toISODate(prevTo),
    };
  }, [range.from, range.to]);

  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [setters, setSetters] = useState<SetterRow[]>([]);
  const [closers, setClosers] = useState<CloserRow[]>([]);
  //const [rv0Daily, setRv0Daily] = useState<MetricSeriesOut | null>(null);
  const [summary, setSummary] =
    useState<SummaryOut | null>(null);
  const [leadsRcv, setLeadsRcv] =
    useState<LeadsReceivedOut | null>(null);
  const [salesWeekly, setSalesWeekly] = useState<
    SalesWeeklyItem[]
  >([]);
  const [ops, setOps] = useState<WeeklyOpsRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [stageSeriesWarning, setStageSeriesWarning] = useState<string | null>(null);
  const [duos, setDuos] = useState<DuoRow[]>([]);

  // Séries par jour : call requests / calls total / calls answered
  const [mCallReq, setMCallReq] =
    useState<MetricSeriesOut | null>(null);
  const [mCallsTotal, setMCallsTotal] =
    useState<MetricSeriesOut | null>(null);
  const [mCallsAnswered, setMCallsAnswered] =
    useState<MetricSeriesOut | null>(null);
  const [rv1HonoredSeries, setRv1HonoredSeries] =
    useState<MetricSeriesOut | null>(null);

  // RV0 no-show par semaine
  type Rv0NsWeek = {
    weekStart: string;
    weekEnd: string;
    label: string;
    count: number;
  };
  const [rv0NsWeekly, setRv0NsWeekly] = useState<Rv0NsWeek[]>(
    []
  );
  const [filterOptions, setFilterOptions] =
    useState<FilterOptions | null>(null);
  const [tagsOptions, setTagsOptions] = useState<string[]>([]);
  const [availableStages, setAvailableStages] = useState<Set<string> | null>(
    null
  );
  const [filterOptionsLoading, setFilterOptionsLoading] =
    useState(false);
  const [filterOptionsError, setFilterOptionsError] =
    useState<string | null>(null);


  // Drill modal
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState("");
  const [drillRows, setDrillRows] = useState<DrillItem[]>([]);

  const pipelineTotals = useMemo<PipelineTotals>(
    () =>
      filteredMode
        ? filteredPipelineTotals ?? emptyPipelineTotals
        : funnelTotals,
    [
      emptyPipelineTotals,
      filteredMode,
      filteredPipelineTotals,
      funnelTotals,
    ]
  );
  const pipelineLoading = filteredMode
    ? filteredPipelineLoading
    : funnelLoading;
  const pipelineError = filteredMode
    ? filteredPipelineError
    : funnelError;
  const funnelData: FunnelProps["data"] = useMemo(
    () => ({
      // Top funnel
      leads: pipelineTotals.LEADS_RECEIVED,
      callRequests: pipelineTotals.CALL_REQUESTED,
      callsTotal: pipelineTotals.CALL_ATTEMPT,
      callsAnswered: pipelineTotals.CALL_ANSWERED,
      setterNoShow: pipelineTotals.SETTER_NO_SHOW,

      // RV0
      rv0P: pipelineTotals.RV0_PLANNED,
      rv0H: pipelineTotals.RV0_HONORED,
      rv0NS: pipelineTotals.RV0_NO_SHOW,
      rv0C: pipelineTotals.RV0_CANCELED,
      rv0NQ:
        (pipelineTotals.RV0_NOT_QUALIFIED_1 || 0) +
        (pipelineTotals.RV0_NOT_QUALIFIED_2 || 0),
      rv0Nurturing: pipelineTotals.RV0_NURTURING || 0,

      // RV1
      rv1P: pipelineTotals.RV1_PLANNED,
      rv1H: pipelineTotals.RV1_HONORED,
      rv1NS: pipelineTotals.RV1_NO_SHOW,
      rv1Postponed: pipelineTotals.RV1_POSTPONED ?? 0,
      rv1FollowupCloser: pipelineTotals.RV1_FOLLOWUP || 0,
      rv1C: pipelineTotals.RV1_CANCELED,
      rv1NQ: pipelineTotals.RV1_NOT_QUALIFIED ?? 0,

      // RV2
      rv2P: pipelineTotals.RV2_PLANNED,
      rv2H: pipelineTotals.RV2_HONORED,
      rv2NS: pipelineTotals.RV2_NO_SHOW,
      rv2C: pipelineTotals.RV2_CANCELED,
      rv2Postponed: pipelineTotals.RV2_POSTPONED ?? 0,

      // Ventes
      won: pipelineTotals.WON,
    }),
    [pipelineTotals]
  );

  const cancelRateBadgeClass = (rate?: number | null) => {
    const base =
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums";

    if (rate == null || Number.isNaN(rate)) {
      return base + " bg-white/5 text-[--muted]";
    }

    // Annulation : rouge = mauvais, vert = bon
    if (rate >= 0.3) {
      return base + " bg-red-500/15 text-red-300 ring-1 ring-red-500/40";
    }
    if (rate >= 0.15) {
      return base + " bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/40";
    }
    return base + " bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/40";
  };

  const positiveRateBadgeClass = (rate?: number | null) => {
    const base =
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums";

    if (rate == null || Number.isNaN(rate)) {
      return base + " bg-white/5 text-[--muted]";
    }

    // KPI positif (closing, setting) : plus c’est haut, plus c’est vert
    if (rate >= 0.4) {
      return base + " bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-500/40";
    }
    if (rate >= 0.25) {
      return base + " bg-sky-500/20 text-sky-100 ring-1 ring-sky-500/40";
    }
    if (rate >= 0.15) {
      return base + " bg-amber-500/15 text-amber-100 ring-1 ring-amber-500/40";
    }
    return base + " bg-red-500/15 text-red-200 ring-1 ring-red-500/40";
  };

  const neutralKpiCell =
    "py-2.5 px-3 text-right tabular-nums text-sm text-slate-100/90";

  const toggleFilterValue = (
    value: string,
    current: string[],
    setValue: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setValue((prev) =>
      prev.includes(value)
        ? prev.filter((entry) => entry !== value)
        : [...prev, value]
    );
  };
  const formatFilterUser = (user: FilterOptionUser) =>
    user.name?.trim() || user.email?.trim() || user.id;

  const normalizeSourceOptions = (
    payload: SourceOptionPayload[] | { sources?: SourceOptionPayload[] } | null | undefined
  ) => {
    const list = Array.isArray(payload) ? payload : payload?.sources ?? [];
    const sources = list
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object") return entry.source?.trim() || "";
        return "";
      })
      .filter(Boolean);
    return Array.from(new Set(sources));
  };

  const normalizeTagOptions = (
    payload: TagOptionPayload[] | { tags?: TagOptionPayload[] } | null | undefined
  ) => {
    const list = Array.isArray(payload) ? payload : payload?.tags ?? [];
    const tags = list
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object") return entry.tag?.trim() || "";
        return "";
      })
      .filter(Boolean);
    return Array.from(new Set(tags));
  };

  const availableTags = useMemo(
    () =>
      normalizeFilterValues([
        ...(filterOptions?.tags ?? []),
        ...tagsOptions,
      ]),
    [filterOptions?.tags, tagsOptions]
  );
  const setterNameMap = useMemo(
    () =>
      new Map(
        (filterOptions?.setters ?? []).map((setter) => [
          setter.id,
          formatFilterUser(setter),
        ])
      ),
    [filterOptions?.setters]
  );
  const closerNameMap = useMemo(
    () =>
      new Map(
        (filterOptions?.closers ?? []).map((closer) => [
          closer.id,
          formatFilterUser(closer),
        ])
      ),
    [filterOptions?.closers]
  );
  const isCloserFocus = normalizedCloserIds.length > 0;
  const isSetterFocus = !isCloserFocus && normalizedSetterIds.length > 0;
  const focusedCloserNames = useMemo(
    () =>
      normalizedCloserIds.map(
        (id) => closerNameMap.get(id) ?? id
      ),
    [normalizedCloserIds, closerNameMap]
  );
  const focusedSetterNames = useMemo(
    () =>
      normalizedSetterIds.map(
        (id) => setterNameMap.get(id) ?? id
      ),
    [normalizedSetterIds, setterNameMap]
  );
  const sourcesLabel = useMemo(() => {
    const parts: string[] = [];
    if (normalizedSources.length > 0) {
      parts.push(`Sources: ${normalizedSources.join(", ")}`);
    }
    if (normalizedExcludeSources.length > 0) {
      parts.push(
        `Sources exclues: ${normalizedExcludeSources.join(", ")}`
      );
    }
    return parts.join(" · ");
  }, [normalizedSources, normalizedExcludeSources]);
  const tagsLabel = useMemo(() => {
    if (!normalizedTags.length) return "";
    return `Tags: ${normalizedTags.join(", ")}`;
  }, [normalizedTags]);
  const leadCreatedLabel = useMemo(() => {
    if (!leadCreatedFrom && !leadCreatedTo) return "";
    if (leadCreatedFrom && leadCreatedTo && leadCreatedFrom === leadCreatedTo) {
      return `Création: ${leadCreatedFrom}`;
    }
    if (leadCreatedFrom && leadCreatedTo) {
      return `Création: ${leadCreatedFrom} → ${leadCreatedTo}`;
    }
    if (leadCreatedFrom) return `Création ≥ ${leadCreatedFrom}`;
    return `Création ≤ ${leadCreatedTo}`;
  }, [leadCreatedFrom, leadCreatedTo]);
  const focusLabel = useMemo(() => {
    if (isCloserFocus && focusedCloserNames.length > 0) {
      return `Closer: ${focusedCloserNames.join(", ")}`;
    }
    if (isSetterFocus && focusedSetterNames.length > 0) {
      return `Setter: ${focusedSetterNames.join(", ")}`;
    }
    return "";
  }, [
    focusedCloserNames,
    focusedSetterNames,
    isCloserFocus,
    isSetterFocus,
  ]);
  const focusScopeSuffix = focusLabel ? ` · ${focusLabel}` : "";
  const focusScopeHint = useMemo(() => {
    const parts: string[] = [];
    if (focusLabel) parts.push(focusLabel);
    if (sourcesLabel) parts.push(sourcesLabel);
    if (tagsLabel) parts.push(tagsLabel);
    if (leadCreatedLabel) parts.push(leadCreatedLabel);
    return parts.length > 0 ? parts.join(" • ") : "";
  }, [focusLabel, sourcesLabel, tagsLabel, leadCreatedLabel]);

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    if (isCloserFocus) {
      chips.push({
        key: "closer",
        label: `Closer: ${focusedCloserNames.join(", ")}`,
      });
    } else if (isSetterFocus) {
      chips.push({
        key: "setter",
        label: `Setter: ${focusedSetterNames.join(", ")}`,
      });
    }
    if (sourcesLabel) {
      chips.push({ key: "sources", label: sourcesLabel });
    }
    if (tagsLabel) {
      chips.push({ key: "tags", label: tagsLabel });
    }
    if (leadCreatedLabel) {
      chips.push({
        key: "leadCreated",
        label: leadCreatedLabel,
      });
    }
    return chips;
  }, [
    focusedCloserNames,
    focusedSetterNames,
    isCloserFocus,
    isSetterFocus,
    leadCreatedLabel,
    sourcesLabel,
    tagsLabel,
  ]);

  const stageSeriesWarningSent = useRef(false);
  const tagsUnsupportedEndpointsRef = useRef<Set<string>>(new Set());
  const clearFilters = useCallback(() => {
    setSetterIds([]);
    setCloserIds([]);
    setTags([]);
    setLeadCreatedFrom(undefined);
    setLeadCreatedTo(undefined);
    setDraftSetterIds([]);
    setDraftCloserIds([]);
    setDraftTags([]);
    setDraftLeadCreatedFrom(undefined);
    setDraftLeadCreatedTo(undefined);
    setDraftLeadCreatedMode("none");
    setSources([]);
    setExcludeSources([]);
    syncFiltersToUrl({
      from: range.from ? toISODate(range.from) : undefined,
      to: range.to ? toISODate(range.to) : undefined,
      tz,
      setterIds: [],
      closerIds: [],
      tags: [],
      leadCreatedFrom: undefined,
      leadCreatedTo: undefined,
    });
  }, [
    range.from,
    range.to,
    setExcludeSources,
    setSources,
    syncFiltersToUrl,
    tz,
  ]);

  const handleStageSeriesInvalid = useCallback(() => {
    if (!stageSeriesWarningSent.current) {
      stageSeriesWarningSent.current = true;
      setStageSeriesWarning(
        "Certaines séries par stage sont indisponibles (stage invalide). Les graphiques restent stables."
      );
    }
    return { data: EMPTY_METRIC_SERIES } as {
      data: MetricSeriesOut;
    };
  }, []);

  const getWithFilters = useCallback(
    async <T,>(url: string, options: {
      overrides?: Partial<ReportingFilterState>;
      extraParams?: Record<string, unknown>;
      config?: AxiosRequestConfig;
      allowTagFallback?: boolean;
    } = {}) => {
      const allowTagFallback =
        options.allowTagFallback ?? !filteredModeWithTags;
      const allowTags = filteredModeWithTags
        ? true
        : !tagsUnsupportedEndpointsRef.current.has(url);
      const params = {
        ...buildParams(options.overrides, { includeTags: allowTags }),
        ...(options.extraParams ?? {}),
      };

      if (debugFilters) {
        console.info("[Filters] request", { url, params });
      }

      try {
        return await api.get<T>(url, {
          ...(options.config ?? {}),
          params,
        });
      } catch (error) {
        if (allowTags && allowTagFallback && isTagsUnsupportedError(error)) {
          tagsUnsupportedEndpointsRef.current.add(url);
          if (debugFilters) {
            console.info("[Filters] tags unsupported, retrying without tags", {
              url,
            });
          }
          const retryParams = {
            ...buildParams(options.overrides, { includeTags: false }),
            ...(options.extraParams ?? {}),
          };
          return await api.get<T>(url, {
            ...(options.config ?? {}),
            params: retryParams,
          });
        }
        throw error;
      }
    },
    [buildParams, debugFilters, filteredModeWithTags]
  );

  const areStagesSupported = useCallback(
    (stages: readonly string[]) => {
      if (!availableStages || availableStages.size === 0) {
        return true;
      }
      const missing = stages.filter((stage) => !availableStages.has(stage));
      if (missing.length === 0) return true;
      if (debugFilters) {
        console.info("[Filters] unsupported stages skipped", {
          missing,
        });
      }
      return false;
    },
    [availableStages, debugFilters]
  );

  const fetchStageSeries = useCallback(
    async (
      stages: readonly string[],
      overrides: Partial<ReportingFilterState> = {}
    ) => {
      if (!areStagesSupported(stages)) {
        return EMPTY_METRIC_SERIES;
      }

      const results = await Promise.all(
        stages.map(async (stage) => {
          try {
            const res = await getWithFilters<MetricSeriesOut>(
              "/metrics/stage-series",
              {
                overrides,
                extraParams: { stage },
              }
            );
            return res?.data ?? EMPTY_METRIC_SERIES;
          } catch (error) {
            if (
              filteredModeWithTags &&
              isTagsUnsupportedError(error)
            ) {
              throw error;
            }
            if (
              isStageSeriesInvalidError(
                error,
                "/metrics/stage-series"
              )
            ) {
              handleStageSeriesInvalid();
              return EMPTY_METRIC_SERIES;
            }
            return EMPTY_METRIC_SERIES;
          }
        })
      );
      return mergeMetricSeries(results);
    },
    [
      areStagesSupported,
      getWithFilters,
      handleStageSeriesInvalid,
      filteredModeWithTags,
    ]
  );

  const fetchStageSeriesForKey = useCallback(
    (key: StageSeriesKey, overrides: Partial<ReportingFilterState> = {}) =>
      fetchStageSeries(STAGE_SERIES_MAP[key], overrides),
    [fetchStageSeries]
  );

  useEffect(() => {
    if (!filteredMode) {
      setFilteredPipelineTotals(null);
      setFilteredPipelineLoading(false);
      setFilteredPipelineError(null);
      setFilteredLeadsSeries(null);
      return;
    }

    let cancelled = false;
    const stages = [
      "LEADS_RECEIVED",
      "CALL_REQUESTED",
      "CALL_ATTEMPT",
      "CALL_ANSWERED",
      "SETTER_NO_SHOW",
      "RV0_PLANNED",
      "RV0_HONORED",
      "RV0_NO_SHOW",
      "RV0_CANCELED",
      "RV0_NOT_QUALIFIED_1",
      "RV0_NOT_QUALIFIED_2",
      "RV0_NURTURING",
      "RV1_PLANNED",
      "RV1_HONORED",
      "RV1_NO_SHOW",
      "RV1_POSTPONED",
      "RV1_CANCELED",
      "RV1_NOT_QUALIFIED",
      "RV1_FOLLOWUP",
      "RV2_PLANNED",
      "RV2_HONORED",
      "RV2_NO_SHOW",
      "RV2_POSTPONED",
      "RV2_CANCELED",
      "NOT_QUALIFIED",
      "APPOINTMENT_CANCELED",
      "WON",
      "LOST",
    ] as const;

    async function loadFilteredPipeline() {
      try {
        setFilteredPipelineLoading(true);
        setFilteredPipelineError(null);
        const results = await Promise.all(
          stages.map(async (stage) => {
            if (!areStagesSupported([stage])) {
              return { stage, data: EMPTY_METRIC_SERIES };
            }
            const res = await getWithFilters<MetricSeriesOut>(
              "/metrics/stage-series",
              {
                extraParams: { stage },
                allowTagFallback: !filteredModeWithTags,
              }
            );
            return {
              stage,
              data: res?.data ?? EMPTY_METRIC_SERIES,
            };
          })
        );

        if (cancelled) return;
        const totals: Record<string, number> = {};
        let leadsSeries: MetricSeriesOut | null = null;
        for (const result of results) {
          totals[result.stage] = result.data?.total ?? 0;
          if (result.stage === "LEADS_RECEIVED") {
            leadsSeries = result.data ?? EMPTY_METRIC_SERIES;
          }
        }

        setFilteredPipelineTotals({
          LEADS_RECEIVED: totals.LEADS_RECEIVED ?? 0,
          CALL_REQUESTED: totals.CALL_REQUESTED ?? 0,
          CALL_ATTEMPT: totals.CALL_ATTEMPT ?? 0,
          CALL_ANSWERED: totals.CALL_ANSWERED ?? 0,
          SETTER_NO_SHOW: totals.SETTER_NO_SHOW ?? 0,

          RV0_PLANNED: totals.RV0_PLANNED ?? 0,
          RV0_HONORED: totals.RV0_HONORED ?? 0,
          RV0_NO_SHOW: totals.RV0_NO_SHOW ?? 0,
          RV0_CANCELED: totals.RV0_CANCELED ?? 0,
          RV0_NOT_QUALIFIED_1: totals.RV0_NOT_QUALIFIED_1 ?? 0,
          RV0_NOT_QUALIFIED_2: totals.RV0_NOT_QUALIFIED_2 ?? 0,
          RV0_NURTURING: totals.RV0_NURTURING ?? 0,

          RV1_PLANNED: totals.RV1_PLANNED ?? 0,
          RV1_HONORED: totals.RV1_HONORED ?? 0,
          RV1_NO_SHOW: totals.RV1_NO_SHOW ?? 0,
          RV1_POSTPONED: totals.RV1_POSTPONED ?? 0,
          RV1_CANCELED: totals.RV1_CANCELED ?? 0,
          RV1_NOT_QUALIFIED: totals.RV1_NOT_QUALIFIED ?? 0,
          RV1_FOLLOWUP: totals.RV1_FOLLOWUP ?? 0,

          RV2_PLANNED: totals.RV2_PLANNED ?? 0,
          RV2_HONORED: totals.RV2_HONORED ?? 0,
          RV2_NO_SHOW: totals.RV2_NO_SHOW ?? 0,
          RV2_POSTPONED: totals.RV2_POSTPONED ?? 0,
          RV2_CANCELED: totals.RV2_CANCELED ?? 0,

          NOT_QUALIFIED: totals.NOT_QUALIFIED ?? 0,
          APPOINTMENT_CANCELED: totals.APPOINTMENT_CANCELED ?? 0,
          WON: totals.WON ?? 0,
          LOST: totals.LOST ?? 0,
        });
        setFilteredLeadsSeries(leadsSeries);
      } catch (error) {
        if (cancelled) return;
        setFilteredPipelineError(
          extractErrorMessage(error) ||
            "Erreur de chargement des métriques filtrées."
        );
        setFilteredPipelineTotals(null);
        setFilteredLeadsSeries(null);
      } finally {
        if (!cancelled) {
          setFilteredPipelineLoading(false);
        }
      }
    }

    loadFilteredPipeline();
    return () => {
      cancelled = true;
    };
  }, [
    areStagesSupported,
    filteredMode,
    filteredModeWithTags,
    getWithFilters,
    appliedParamsKey,
  ]);

  // Auth
  useEffect(() => {
    let cancelled = false;
    async function verify() {
      const token = getAccessToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      try {
        await api.get("/auth/me");
        if (!cancelled) {
          setAuthChecked(true);
          setAuthError(null);
        }
      } catch {
        if (!cancelled) {
          setAuthChecked(true);
          setAuthError(
            "Non autorisé. Veuillez vous reconnecter."
          );
        }
      }
    }
    verify();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!authChecked || authError) return;
    let cancelled = false;

    async function loadFilterOptions() {
      try {
        setFilterOptionsLoading(true);
        setFilterOptionsError(null);
        const res = await getWithFilters<FilterOptions>(
          "/reporting/filter-options"
        );
        if (cancelled) return;
        const data = res.data || {
          sources: [],
          setters: [],
          closers: [],
          tags: [],
        };
        setFilterOptions({
          sources: Array.isArray(data.sources)
            ? normalizeSourceOptions(data.sources)
            : [],
          setters: Array.isArray(data.setters) ? data.setters : [],
          closers: Array.isArray(data.closers) ? data.closers : [],
          tags: Array.isArray(data.tags)
            ? normalizeTagOptions(data.tags)
            : [],
        });
      } catch (error) {
        if (cancelled) return;
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          try {
            const sourcesRes = await getWithFilters<
              SourceOptionPayload[] | { sources?: SourceOptionPayload[] }
            >("/reporting/sources", {
              extraParams: {
                withCounts: true,
                withLastSeen: true,
                includeUnknown: true,
              },
            });
            if (cancelled) return;
            setFilterOptions((prev) => ({
              sources: normalizeSourceOptions(sourcesRes.data),
              setters: prev?.setters ?? [],
              closers: prev?.closers ?? [],
              tags: prev?.tags ?? [],
            }));
            return;
          } catch {
            if (!cancelled) {
              setFilterOptionsError(
                "Impossible de charger les options de filtre pour le moment."
              );
            }
            return;
          }
        }
        setFilterOptionsError(
          "Impossible de charger les options de filtre pour le moment."
        );
      } finally {
        if (!cancelled) setFilterOptionsLoading(false);
      }
    }

    loadFilterOptions();
    return () => {
      cancelled = true;
    };
  }, [authChecked, authError, filterOptionsParamsKey, getWithFilters]);

  useEffect(() => {
    if (!authChecked || authError) return;
    let cancelled = false;

    async function loadTags() {
      try {
        const res = await getWithFilters<
          TagOptionPayload[] | { tags?: TagOptionPayload[] }
        >("/reporting/tags");
        if (cancelled) return;
        setTagsOptions(normalizeTagOptions(res.data));
      } catch {
        if (!cancelled) {
          setTagsOptions([]);
        }
      }
    }

    loadTags();
    return () => {
      cancelled = true;
    };
  }, [authChecked, authError, getWithFilters]);

  useEffect(() => {
    if (!authChecked || authError) return;
    let cancelled = false;

    async function loadStages() {
      try {
        const res = await getWithFilters<string[]>(
          "/metrics/stages"
        );
        if (cancelled) return;
        const stages = Array.isArray(res.data)
          ? res.data.filter((stage) => typeof stage === "string")
          : [];
        setAvailableStages(new Set(stages));
      } catch {
        if (!cancelled) {
          setAvailableStages(null);
        }
      }
    }

    loadStages();
    return () => {
      cancelled = true;
    };
  }, [authChecked, authError, getWithFilters]);
  // Data (courant)
  useEffect(() => {
    if (!authChecked || authError) return;
    let cancelled = false;

    async function loadReporting() {
      try {
        setErr(null);
        setLoading(true);

        // 1) Résumés & séries hebdo
        const [sumRes, leadsRes, weeklyRes, opsRes] = await Promise.all([
          getWithFilters<SummaryOut>("/reporting/summary"),
          filteredMode
            ? Promise.resolve({ data: null } as { data: LeadsReceivedOut | null })
            : getWithFilters<LeadsReceivedOut>("/metrics/leads-by-day"),
          getWithFilters<SalesWeeklyItem[]>("/reporting/sales-weekly"),
          getWithFilters<{ ok: true; rows: WeeklyOpsRow[] }>(
            "/reporting/weekly-ops"
          ),
        ]);

        if (cancelled) return;

        // Résumé global
        setSummary(sumRes.data || null);
        setLeadsRcv(leadsRes.data || null);

        let weeklyRows = (weeklyRes.data || []).sort((a, b) =>
          a.weekStart.localeCompare(b.weekStart)
        );
        if (filteredMode) {
          const summaryRevenue = sumRes.data?.totals?.revenue ?? 0;
          const summaryCount = sumRes.data?.totals?.salesCount ?? 0;
          const weeklyRevenue = weeklyRows.reduce(
            (s, w) => s + (w.revenue || 0),
            0
          );
          const weeklyCount = weeklyRows.reduce(
            (s, w) => s + (w.count || 0),
            0
          );
          const needsFallback =
            (summaryRevenue > 0 || summaryCount > 0) &&
            (Math.abs(weeklyRevenue - summaryRevenue) > 1 ||
              weeklyCount !== summaryCount);

          if (needsFallback) {
            const wonRes = await getWithFilters<DrillResponse>(
              "/reporting/drill/won",
              {
                extraParams: { limit: 5000 },
                allowTagFallback: !filteredModeWithTags,
              }
            );
            const items = wonRes.data?.items ?? [];
            const bucketMap = new Map<
              string,
              { weekStart: Date; weekEnd: Date; revenue: number; count: number }
            >();
            const mondayLocal = (d: Date) => {
              const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
              const dow = (dd.getDay() + 6) % 7;
              dd.setDate(dd.getDate() - dow);
              return dd;
            };
            const sundayLocal = (d: Date) => {
              const m = mondayLocal(d);
              const s = new Date(m);
              s.setDate(s.getDate() + 6);
              s.setHours(23, 59, 59, 999);
              return s;
            };

            for (const item of items) {
              const dateValue = item.stageUpdatedAt ?? item.createdAt;
              if (!dateValue) continue;
              const when = new Date(dateValue);
              if (isNaN(when.getTime())) continue;
              const ws = mondayLocal(when);
              const we = sundayLocal(when);
              const key = ws.toISOString();
              const row = bucketMap.get(key) ?? {
                weekStart: ws,
                weekEnd: we,
                revenue: 0,
                count: 0,
              };
              row.revenue += Number(item.saleValue || 0);
              row.count += 1;
              bucketMap.set(key, row);
            }

            weeklyRows = Array.from(bucketMap.values())
              .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
              .map((row) => ({
                weekStart: row.weekStart.toISOString(),
                weekEnd: row.weekEnd.toISOString(),
                revenue: row.revenue,
                count: row.count,
              }));
          }
        }

        setSalesWeekly(weeklyRows);
        const opsSorted = (opsRes.data?.rows || []).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
        setOps(opsSorted);

        // 2) Séries journalières basées sur StageEvent (mêmes métriques que le funnel /metrics/funnel)
        const [m1, m2, m3] = await Promise.all([
          fetchStageSeriesForKey("callRequests"),
          fetchStageSeriesForKey("callsTotal"),
          fetchStageSeriesForKey("callsAnswered"),
        ]);

        if (!cancelled) {
          setMCallReq(m1 || null);
          setMCallsTotal(m2 || null);
          setMCallsAnswered(m3 || null);
        }

        // 3) RV0 no-show par semaine, à partir de StageEvent(RV0_NO_SHOW) → /metrics/stage-series
        const rv0SeriesRes = await fetchStageSeriesForKey("rv0NoShow");
        const series = rv0SeriesRes?.byDay || [];

        // Helpers semaine (UTC, lundi → dimanche)
        function mondayLocal(d: Date) {
          const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          const dow = (dd.getDay() + 6) % 7; // Lundi = 0
          dd.setDate(dd.getDate() - dow);
          return dd;
        }
        function sundayLocal(d: Date) {
          const m = mondayLocal(d);
          const s = new Date(m);
          s.setDate(s.getDate() + 6);
          s.setHours(23, 59, 59, 999);
          return s;
        }

        // Regroupe par semaine (clé = lundi de la semaine)
        const map = new Map<string, { start: Date; end: Date; count: number }>();

        for (const entry of series) {
          const when = new Date(entry.day);
          if (isNaN(when.getTime())) continue;

          const ws = mondayLocal(when);
          const we = sundayLocal(when);
          const key = ws.toISOString();

          const row = map.get(key) ?? { start: ws, end: we, count: 0 };
          row.count += entry.count;
          map.set(key, row);
        }

        // Construit les semaines continues pour la période demandée
        const weeks: Rv0NsWeek[] = [];
        if (fromISO && toISO) {
          const start = mondayLocal(new Date(fromISO));
          const end = sundayLocal(new Date(toISO));
          for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
            const ws = new Date(d);
            const we = sundayLocal(ws);
            const key = ws.toISOString();
            const bucket = map.get(key);

            weeks.push({
              weekStart: ws.toISOString(),
              weekEnd: we.toISOString(),
              label:
                ws.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) +
                " → " +
                we.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
              count: bucket?.count ?? 0,
            });
          }
        }

        if (!cancelled) {
          setRv0NsWeekly(weeks);
        }
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.response?.data?.message || "Erreur de chargement (reporting)");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadReporting();
    return () => {
      cancelled = true;
    };
  }, [
    authChecked,
    authError,
    filterParamsKey,
    fetchStageSeriesForKey,
    filteredMode,
    filteredModeWithTags,
    fromISO,
    getWithFilters,
    toISO,
  ]);
  // Classements (setters / closers)
  // Spotlight (Setters / Closers) — avec fallback si l'API n'a pas encore les endpoints spotlight
  // Spotlight (Setters / Closers) — avec fallback si l'API n'a pas encore les endpoints spotlight
  useEffect(() => {
    if (!authChecked || authError) return;
    let cancelled = false;

    async function loadSpotlight() {
      try {
        // 1) Tentative endpoints spotlight
        const [sRes, cRes] = await Promise.all([
          getWithFilters<SetterRow[]>("/reporting/spotlight-setters"),
          getWithFilters<CloserRow[]>("/reporting/spotlight-closers"),
        ]);
        if (cancelled) return;

        const settersRaw = sRes.data || [];
        const closersRaw = cRes.data || [];

        // Dérivés (on calcule les taux ici)
        const settersDer = settersRaw.map((s) => {
          const qualificationRate =
            (s.rv1PlannedOnHisLeads || 0) /
            Math.max(1, s.leadsReceived || 0);

          const rv1CancelRate =
            (s.rv1CanceledOnHisLeads || 0) /
            Math.max(1, s.rv1PlannedOnHisLeads || 0);

          const rv1NoShowRate =
            (s.rv1NoShowOnHisLeads || 0) /
            Math.max(1, s.rv1PlannedOnHisLeads || 0);

          return {
            ...s,
            qualificationRate,
            rv1CancelRateOnHisLeads: rv1CancelRate,
            rv1NoShowRate,
            rv1CancelRate, // alias pour compat
          };
        });

        const closersDer = closersRaw.map((c) => {
          const rv1Planned = c.rv1Planned || 0;
          const rv1Honored = c.rv1Honored || 0;
          const rv1Canceled = c.rv1Canceled || 0;
          const rv1NoShow = c.rv1NoShow || 0;
          const rv2Planned = c.rv2Planned || 0;
          const rv2Honored = c.rv2Honored || 0;
          const rv2Canceled = c.rv2Canceled || 0;
          const rv2NoShow = c.rv2NoShow || 0;
          const salesClosed = c.salesClosed || 0;

          const closingRate = rv1Honored
            ? salesClosed / rv1Honored
            : 0;
          const rv1CancelRate = rv1Planned
            ? rv1Canceled / rv1Planned
            : null;
          const rv1NoShowRate = rv1Planned
            ? rv1NoShow / rv1Planned
            : null;
          const rv1HonorRate = rv1Planned
            ? rv1Honored / rv1Planned
            : null;
          const rv2HonorRate = rv2Planned
            ? (rv2Honored || 0) / rv2Planned
            : null;
          const rv2CancelRate = rv2Planned
            ? rv2Canceled / rv2Planned
            : null;
          const rv2NoShowRate = rv2Planned
            ? rv2NoShow / rv2Planned
            : null;
          const closingOnRv1Planned = rv1Planned
            ? salesClosed / rv1Planned
            : null;

          return {
            ...c,
            rv1CancelRate,
            rv1NoShowRate,
            rv1HonorRate,
            rv2HonorRate,
            rv2CancelRate,
            rv2NoShowRate,
            closingRate,
            closingOnRv1Planned,
          };
        });

        if (!cancelled) {
          setSetters(settersDer);
          setClosers(closersDer);
        }
      } catch (e: any) {
        if (cancelled) return;

        // 2) Fallback global /reporting/setters + /reporting/closers
        try {
          const [sRes, cRes] = await Promise.all([
            getWithFilters<any[]>("/reporting/setters"),
            getWithFilters<any[]>("/reporting/closers"),
          ]);
          if (cancelled) return;

          // Mapping minimal pour le front
          const settersFallback = (sRes.data || []).map(
            (s) => ({
              userId: s.userId ?? s.id ?? "",
              name: s.name ?? s.email ?? "Setter",
              email: s.email ?? "",
              leadsReceived: s.leadsReceived || 0,
              rv1PlannedOnHisLeads: s.rv1PlannedOnHisLeads || 0,
              rv1HonoredOnHisLeads: s.rv1HonoredOnHisLeads || 0,
              rv1CanceledOnHisLeads: s.rv1CanceledOnHisLeads || 0,
              rv1NoShowOnHisLeads: s.rv1NoShowOnHisLeads || 0,
              settingRate:
                (s.rv1HonoredOnHisLeads || 0) /
                Math.max(1, s.leadsReceived || 0),
              rv0Count: s.rv0Count || 0,
              ttfcAvgMinutes: s.ttfcAvgMinutes ?? null,

              salesFromHisLeads: s.salesFromHisLeads || 0,
              revenueFromHisLeads: s.revenueFromHisLeads || 0,
              spendShare: s.spendShare ?? null,
              cpl: s.cpl ?? null,
              cpRv0: s.cpRv0 ?? null,
              cpRv1: s.cpRv1 ?? null,
              roas: s.roas ?? null,

              qualificationRate:
                (s.rv1PlannedOnHisLeads || 0) /
                Math.max(1, s.leadsReceived || 0),
              rv1CancelRateOnHisLeads:
                (s.rv1CanceledOnHisLeads || 0) /
                Math.max(1, s.rv1PlannedOnHisLeads || 0),
              rv1NoShowRate:
                (s.rv1NoShowOnHisLeads || 0) /
                Math.max(1, s.rv1PlannedOnHisLeads || 0),
              rv1CancelRate:
                (s.rv1CanceledOnHisLeads || 0) /
                Math.max(1, s.rv1PlannedOnHisLeads || 0),
            })
          );

          const closersFallback = (cRes.data || []).map(
            (c) => {
              const rv1Planned = c.rv1Planned || 0;
              const rv1Honored = c.rv1Honored || 0;
              const rv1Canceled = c.rv1Canceled || 0;
              const rv1NoShow = c.rv1NoShow || 0;
              const rv1Postponed = c.rv1Postponed || 0;
              const rv1NotQualified = c.rv1NotQualified || 0;

              const rv2Planned = c.rv2Planned || 0;
              const rv2Honored = c.rv2Honored || 0;
              const rv2Canceled = c.rv2Canceled || 0;
              const rv2NoShow = c.rv2NoShow || 0;
              const rv2Postponed = c.rv2Postponed || 0;

              const salesClosed = c.salesClosed || 0;
              const revenueTotal = c.revenueTotal || 0;
              const contractsSigned = c.contractsSigned || 0;

              return {
                userId: c.userId ?? c.id ?? "",
                name: c.name ?? c.email ?? "Closer",
                email: c.email ?? "",
                rv1Planned,
                rv1Honored,
                rv1Canceled,
                rv1NoShow,
                rv1Postponed,
                rv1NotQualified,

                rv2Planned,
                rv2Honored,
                rv2Canceled,
                rv2NoShow,
                rv2Postponed,

                salesClosed,
                revenueTotal,
                contractsSigned,
                roasPlanned: c.roasPlanned ?? null,
                roasHonored: c.roasHonored ?? null,

                rv1CancelRate: rv1Planned
                  ? rv1Canceled / rv1Planned
                  : null,
                rv1NoShowRate: rv1Planned
                  ? rv1NoShow / rv1Planned
                  : null,
                rv1HonorRate: rv1Planned
                  ? rv1Honored / rv1Planned
                  : null,

                rv2HonorRate: rv2Planned
                  ? rv2Honored / rv2Planned
                  : null,
                rv2CancelRate: rv2Planned
                  ? rv2Canceled / rv2Planned
                  : null,
                rv2NoShowRate: rv2Planned
                  ? rv2NoShow / rv2Planned
                  : null,

                closingOnRv1Planned: rv1Planned
                  ? salesClosed / rv1Planned
                  : null,

                closingRate: rv1Honored
                  ? salesClosed / rv1Honored
                  : 0,
              };
            }
          );

          setSetters(settersFallback);
          setClosers(closersFallback);
        } catch (e: any) {
          if (!cancelled) {
            setErr(
              e?.response?.data?.message ||
                "Erreur de chargement (classements)"
            );
          }
        }
      }
    }

    loadSpotlight();
    return () => {
      cancelled = true;
    };
  }, [authChecked, authError, filterParamsKey, getWithFilters]);
  // (NOUVEAU) Annulés par jour via historisation (StageEvent)
  /*
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1) On récupère les 3 séries historiques (par jour) côté StageEvent
        const [rv0, rv1, rv2] = await Promise.all([
          fetchSafeMetric("/metrics/stage-series", { from: fromISO, to: toISO, stage: "RV0_CANCELED", tz }),
          fetchSafeMetric("/metrics/stage-series", { from: fromISO, to: toISO, stage: "RV1_CANCELED", tz }),
          fetchSafeMetric("/metrics/stage-series", { from: fromISO, to: toISO, stage: "RV2_CANCELED", tz }),
        ]);

        const by0 = rv0?.data?.byDay ?? [];
        const by1 = rv1?.data?.byDay ?? [];
        const by2 = rv2?.data?.byDay ?? [];

        // 2) Fusion par jour (clé = YYYY-MM-DD)
        const map = new Map<string, { r0: number; r1: number; r2: number }>();

        const add = (arr: Array<{ day: string; count: number }>, key: "r0" | "r1" | "r2") => {
          for (const x of arr) {
            const d = x?.day;
            if (!d) continue;
            const isoDay = d.length >= 10
              ? d.slice(0, 10)
              : (() => {
                  const tmp = new Date(d);
                  const y = tmp.getFullYear();
                  const m = String(tmp.getMonth() + 1).padStart(2, "0");
                  const dd = String(tmp.getDate()).padStart(2, "0");
                  return `${y}-${m}-${dd}`;
                })();
            const row = map.get(isoDay) ?? { r0: 0, r1: 0, r2: 0 };
            row[key] += Number(x.count || 0);
            map.set(isoDay, row);
          }
        };

        add(by0, "r0");
        add(by1, "r1");
        add(by2, "r2");

        // 3) Range “continu” jour par jour (pour éviter les trous)
        const out: CanceledDailyRow[] = [];
        if (fromISO && toISO) {
          const start = new Date(fromISO);
          const end = new Date(toISO);
          // normalise à minuit
          start.setHours(0, 0, 0, 0);
          end.setHours(0, 0, 0, 0);

          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            // ⚠️ Pas de toISOString() ici : on fabrique le AAAA-MM-JJ en local
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            const key = `${y}-${m}-${dd}`;
            const bucket = map.get(key) ?? { r0: 0, r1: 0, r2: 0 };
            out.push({
              day: key,
              RV0_CANCELED: bucket.r0,
              RV1_CANCELED: bucket.r1,
              RV2_CANCELED: bucket.r2,
              total: bucket.r0 + bucket.r1 + bucket.r2,
            });
          }
        }

        // 4) Total global
        const total = out.reduce((s, x) => s + (x.total || 0), 0);

        if (!cancelled) setCanceledDaily({ total, byDay: out });
      } catch (e) {
        if (!cancelled) setCanceledDaily({ total: 0, byDay: [] });
      }
    })();

    return () => { cancelled = true; };
  }, [fromISO, toISO, tz]);*/

  // 💎 Duos (équipe de choc) — chargement manquant avant
  // Duos (Setter × Closer)
  useEffect(() => {
    if (!authChecked || authError) return;
    let cancelled = false;

    async function loadDuos() {
      try {
        const res = await getWithFilters<{
          ok?: boolean;
          rows?: DuoRow[];
        }>("/reporting/duos");
        if (cancelled) return;

        const rows =
          (res.data?.rows as DuoRow[] | undefined) ||
          // au cas où le backend renvoie directement un array
          ((res.data as unknown as DuoRow[]) ?? []);

        setDuos(rows || []);
      } catch (e: any) {
        if (cancelled) return;

        // 404 = endpoint pas encore implémenté → on considère juste qu’il n’y a pas de duos
        if (e?.response?.status === 404) {
          setDuos([]);
          return;
        }

        // autres erreurs : on ne remonte pas dans `err`, on laisse l’intercepteur log en console
        setDuos([]);
      }
    }

    loadDuos();
    return () => { cancelled = true; };
  }, [authChecked, authError, filterParamsKey, getWithFilters]);
  // Enrichissements (taux) — pas de hooks conditionnels
  const settersWithRates = useMemo(() => {
    return setters.map((s) => {
      const qualDen = s.leadsReceived || 0;
      const qualNum = s.rv1PlannedOnHisLeads || 0;
      const qualificationRate = qualDen
        ? qualNum / qualDen
        : 0; // 0..1
      return { ...s, qualificationRate };
    });
  }, [setters]);

  const closersWithRates = useMemo(() => {
    return closers.map((c) => {
      const rv1Planned = c.rv1Planned || 0;
      const rv1Honored = c.rv1Honored || 0;
      const rv2Planned = c.rv2Planned || 0;
      const rv2Honored = c.rv2Honored || 0;
      const salesClosed = c.salesClosed || 0;

      const closingRate = rv1Honored
        ? salesClosed / rv1Honored
        : 0;

      return {
        ...c,
        closingRate,
      };
    });
  }, [closers]);

  const sortedSetters = useMemo(() => {
    return [...settersWithRates].sort((a, b) => {
      // Desc tri par revenue + sales
      const revA = a.revenueFromHisLeads || 0;
      const revB = b.revenueFromHisLeads || 0;
      if (revB !== revA) return revB - revA;
      const salesA = a.salesFromHisLeads || 0;
      const salesB = b.salesFromHisLeads || 0;
      return salesB - salesA;
    });
  }, [settersWithRates]);

  const sortedClosers = useMemo(() => {
    return [...closersWithRates].sort((a, b) => {
      const revA = a.revenueTotal || 0;
      const revB = b.revenueTotal || 0;
      if (revB !== revA) return revB - revA;
      const salesA = a.salesClosed || 0;
      const salesB = b.salesClosed || 0;
      return salesB - salesA;
    });
  }, [closersWithRates]);

  const visibleSetters = useMemo(
    () => sortedSetters.slice(0, 8),
    [sortedSetters]
  );
  const visibleClosers = useMemo(
    () => sortedClosers.slice(0, 8),
    [sortedClosers]
  );

  const focusedSetterTotals = useMemo(() => {
    if (!isSetterFocus) return null;
    return visibleSetters.reduce(
      (acc, setter) => ({
        revenue:
          acc.revenue + Number(setter.revenueFromHisLeads || 0),
        sales: acc.sales + Number(setter.salesFromHisLeads || 0),
      }),
      { revenue: 0, sales: 0 }
    );
  }, [isSetterFocus, visibleSetters]);
  const focusedCloserTotals = useMemo(() => {
    if (!isCloserFocus) return null;
    return visibleClosers.reduce(
      (acc, closer) => ({
        revenue: acc.revenue + Number(closer.revenueTotal || 0),
        sales: acc.sales + Number(closer.salesClosed || 0),
      }),
      { revenue: 0, sales: 0 }
    );
  }, [isCloserFocus, visibleClosers]);
  const topCloser = sortedClosers[0];
  const topSetter = sortedSetters[0];
  const topDuo = duos[0];
  const isFocusedCloserTop =
    isCloserFocus &&
    topCloser &&
    normalizedCloserIds.includes(topCloser.userId);
  const isFocusedSetterTop =
    isSetterFocus &&
    topSetter &&
    normalizedSetterIds.includes(topSetter.userId);
  const isFocusedDuoTop = useMemo(() => {
    if (!topDuo) return false;
    if (isCloserFocus) {
      return normalizedCloserIds.includes(topDuo.closerId);
    }
    if (isSetterFocus) {
      return normalizedSetterIds.includes(topDuo.setterId);
    }
    return false;
  }, [
    isCloserFocus,
    isSetterFocus,
    normalizedCloserIds,
    normalizedSetterIds,
    topDuo,
  ]);

  // ================== KPIs (avec fallback robuste) ==================
  // KPI business: fallback vers spotlight pour garantir la cohérence en vue filtrée.
  const kpiRevenue = isCloserFocus
    ? focusedCloserTotals?.revenue ?? 0
    : isSetterFocus
    ? focusedSetterTotals?.revenue ?? 0
    : summary?.totals?.revenue ?? 0;
  // Leads: endpoint dédié (ou stage series en vue filtrée)
  const kpiLeads = filteredMode
    ? filteredLeadsSeries?.total ?? 0
    : (leadsRcv?.total ?? 0) ||
      (summary?.totals?.leads ?? 0);

  const kpiRv1Honored =
    rv1HonoredSeries?.total ??
    funnelData.rv1H ??
    0;
  // ➕ Nombre total de ventes (deals WON)
  const kpiSales = isCloserFocus
    ? focusedCloserTotals?.sales ?? 0
    : isSetterFocus
    ? focusedSetterTotals?.sales ?? 0
    : summary?.totals?.salesCount ?? 0;
  const leadsByDaySeries = filteredMode
    ? filteredLeadsSeries
    : leadsRcv;
  // Global rates (affichage)
  const globalSetterQual = useMemo(() => {
    const num = settersWithRates.reduce(
      (s, r) => s + (r.rv1PlannedOnHisLeads || 0),
      0
    );
    const den = settersWithRates.reduce(
      (s, r) => s + (r.leadsReceived || 0),
      0
    );
    return { num, den };
  }, [settersWithRates]);

  const globalCloserClosing = useMemo(() => {
    const num = closersWithRates.reduce(
      (s, r) => s + (r.salesClosed || 0),
      0
    );
    const den = closersWithRates.reduce(
      (s, r) => s + (r.rv1Honored || 0),
      0
    );
    return { num, den };
  }, [closersWithRates]);

  // Prev (pour Trend)
  const [summaryPrev, setSummaryPrev] =
    useState<SummaryOut | null>(null);
  const [leadsPrev, setLeadsPrev] =
    useState<LeadsReceivedOut | null>(null);
  useEffect(() => {
    if (!comparePrev || !fromISO || !toISO) {
      setSummaryPrev(null);
      setLeadsPrev(null);
      return;
    }
    (async () => {
      try {
        const span =
          new Date(toISO).getTime() -
          new Date(fromISO).getTime();
        const prevTo = new Date(
          new Date(fromISO).getTime() -
            24 * 3600 * 1000
        );
        const prevFrom = new Date(
          prevTo.getTime() - span
        );
        const prevOverrides = {
          from: toISODate(prevFrom),
          to: toISODate(prevTo),
        };
        const [sum, leads] = await Promise.all([
          getWithFilters<SummaryOut>("/reporting/summary", {
            overrides: prevOverrides,
          }),
          getWithFilters<LeadsReceivedOut>(
            "/reporting/leads-received",
            {
              overrides: prevOverrides,
            }
          ),
        ]);
        setSummaryPrev(sum.data || null);
        setLeadsPrev(leads.data || null);
      } catch {
        setSummaryPrev(null);
        setLeadsPrev(null);
      }
    })();
  }, [comparePrev, fromISO, toISO, filterParamsKey, getWithFilters]);
  const kpiRevenuePrev = summaryPrev?.totals?.revenue ?? 0;
  const kpiLeadsPrev = leadsPrev?.total ?? 0;
  const kpiRv1HonoredPrev =
    summaryPrev?.totals?.rv1Honored ?? 0;

  const kpiSalesPrev = summaryPrev?.totals?.salesCount ?? 0;

  type AnnulPostDailyRow = {
    day: string;
    rv1CanceledPostponed: number;
    rv2CanceledPostponed: number;
    total: number;
  };

  /*const [canceledDaily, setCanceledDaily] = useState<{ total: number; byDay: Array<{
    day: string; RV0_CANCELED: number; RV1_CANCELED: number; RV2_CANCELED: number; total: number;
  }>}>({ total: 0, byDay: [] });*/

  // déjà ton canceledDaily plus bas, on le garde mais on va le modifier après
  const [canceledDaily, setCanceledDaily] = useState<{
    total: number;
    byDay: AnnulPostDailyRow[];
  }>({ total: 0, byDay: [] });

  // ➕ Nouveau : série quotidienne RV0 honorés
  const [rv0Daily, setRv0Daily] = useState<MetricSeriesOut | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!fromISO || !toISO) {
        if (!cancelled) setRv0Daily(null);
        return;
      }

      try {
        const res = await fetchStageSeriesForKey("rv0Honored");
        if (!cancelled) setRv0Daily(res);
      } catch {
        if (!cancelled) setRv0Daily(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromISO, toISO, fetchStageSeriesForKey]);

  /* ---------- Drill open helpers ---------- */
  async function openAppointmentsDrill(params: {
    title: string;
    type: "RV0" | "RV1" | "RV2";
    status?: "HONORED" | "NO_SHOW" | "CANCELED";
  }) {
    const res = await getWithFilters<DrillResponse>(
      "/reporting/drill/appointments",
      {
        extraParams: {
          appointmentType: params.type,
          appointmentStatus: params.status,
          limit: 2000,
        },
      }
    );
    setDrillTitle(params.title);
    setDrillRows(res.data?.items || []);
    setDrillOpen(true);
  }

  async function openCallRequestsDrill() {
    const res = await getWithFilters<DrillResponse>(
      "/reporting/drill/call-requests",
      {
        extraParams: { limit: 2000 },
      }
    );
    setDrillTitle("Demandes d’appel – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error)
      items.unshift({
        leadId: "error",
        leadName: res.data.__error,
      });
    setDrillRows(items);
    setDrillOpen(true);
  }

  async function openCallsDrill() {
    const res = await getWithFilters<DrillResponse>(
      "/reporting/drill/calls",
      {
        extraParams: { status: "MADE", limit: 2000 },
      }
    );
    setDrillTitle("Appels passés – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error)
      items.unshift({
        leadId: "error",
        leadName: res.data.__error,
      });
    setDrillRows(items);
    setDrillOpen(true);
  }

  async function openCallsAnsweredDrill() {
    const res = await getWithFilters<DrillResponse>(
      "/reporting/drill/calls",
      {
        extraParams: { status: "ANSWERED", limit: 2000 },
      }
    );
    setDrillTitle("Appels répondus – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error)
      items.unshift({
        leadId: "error",
        leadName: res.data.__error,
      });
    setDrillRows(items);
    setDrillOpen(true);
  }

  async function openSetterNoShowDrill() {
    const res = await getWithFilters<DrillResponse>(
      "/reporting/drill/calls",
      {
        extraParams: { status: "SETTER_NO_SHOW", limit: 2000 },
      }
    );
    setDrillTitle("No-show Setter – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error)
      items.unshift({
        leadId: "error",
        leadName: res.data.__error,
      });
    setDrillRows(items);
    setDrillOpen(true);
  }

  const onFunnelCardClick = async (key: FunnelKey): Promise<void> => {
    switch (key) {
      case "leads": {
        const res = await getWithFilters<DrillResponse>(
          "/reporting/drill/leads-received",
          {
            extraParams: {
              limit: 2000,
            },
          }
        );
        setDrillTitle("Leads reçus – détail");
        setDrillRows(res.data?.items || []);
        setDrillOpen(true);
        return;
      }

      case "callRequests":
        return openCallRequestsDrill();

      case "rv0NoShow":
        return openSetterNoShowDrill();

      case "rv0Honored":
        return openAppointmentsDrill({
          title: "RV0 honorés (détail)",
          type: "RV0",
          status: "HONORED",
        });

      case "rv0NoShow":
        return openAppointmentsDrill({
          title: "RV0 no-show (détail)",
          type: "RV0",
          status: "NO_SHOW",
        });

      case "rv1Planned":
        return openAppointmentsDrill({
          title: "RV1 planifiés (détail)",
          type: "RV1",
        });

      case "rv1Honored":
        return openAppointmentsDrill({
          title: "RV1 Fait (détail)",
          type: "RV1",
          status: "HONORED",
        });

      case "rv1NoShow":
        return openAppointmentsDrill({
          title: "RV1 no-show (détail)",
          type: "RV1",
          status: "NO_SHOW",
        });

      case "rv2Planned":
        return openAppointmentsDrill({
          title: "RV2 planifiés (détail)",
          type: "RV2",
        });

      case "rv2Honored":
        return openAppointmentsDrill({
          title: "RV2 honorés (détail)",
          type: "RV2",
          status: "HONORED",
        });

      case "rv2NoShow":
        return openAppointmentsDrill({
          title: "RV2 no-show (détail)",
          type: "RV2",
          status: "NO_SHOW",
        });

      case "wonCount": {
        const res = await getWithFilters<DrillResponse>(
          "/reporting/drill/won",
          {
            extraParams: {
              limit: 2000,
            },
          }
        );
        setDrillTitle("Ventes (WON) – détail");
        setDrillRows(res.data?.items || []);
        setDrillOpen(true);
        return;
      }

      case "rv0Canceled":
        return openAppointmentsDrill({
          title: "RV0 annulés (détail)",
          type: "RV0",
          status: "CANCELED",
        });

      case "rv1Canceled":
        return openAppointmentsDrill({
          title: "RV1 annulés (détail)",
          type: "RV1",
          status: "CANCELED",
        });

      case "rv2Canceled":
        return openAppointmentsDrill({
          title: "RV2 annulés (détail)",
          type: "RV2",
          status: "CANCELED",
        });

      // 🔹 Tous les autres FunnelKey que tu as (rv0NotQualified, rv0Nurturing, etc.)
      // tomberont ici et ne feront rien (ce qui est correct)
      default:
        return;
    }
  };
  // KPI charts
  const cancelRateBadgeClass = (rate?: number | null) => {
    const base =
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums";

    if (rate == null || Number.isNaN(rate)) {
      return base + " bg-white/5 text-[--muted]";
    }

    // Annulation : rouge = mauvais, vert = bon
    if (rate >= 0.3) {
      return base + " bg-red-500/15 text-red-300 ring-1 ring-red-500/40";
    }
    if (rate >= 0.15) {
      return base + " bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/40";
    }
    return base + " bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/40";
  };

  const positiveRateBadgeClass = (rate?: number | null) => {
    const base =
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums";

    if (rate == null || Number.isNaN(rate)) {
      return base + " bg-white/5 text-[--muted]";
    }

    // KPI positif (closing, setting) : plus c’est haut, plus c’est vert
    if (rate >= 0.4) {
      return base + " bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-500/40";
    }
    if (rate >= 0.25) {
      return base + " bg-sky-500/20 text-sky-100 ring-1 ring-sky-500/40";
    }
    if (rate >= 0.15) {
      return base + " bg-amber-500/15 text-amber-100 ring-1 ring-amber-500/40";
    }
    return base + " bg-red-500/15 text-red-200 ring-1 ring-red-500/40";
  };

  // ... (contenu intermédiaire inchangé)

  return (
    <div className="page">
      {/* === HEADER === */}
      <div className="header">
        {/* ... */}
      </div>

      {/* === CONTENT === */}
      <div className="mt-4 flex gap-4">
        <Sidebar />
        <div className="flex-1 space-y-6">
          {err && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {err}
            </div>
          )}
          {stageSeriesWarning && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
              {stageSeriesWarning}
            </div>
          )}

          {/* KPI principaux */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="card"
            >
              <div className="text-xs uppercase tracking-wide text-[--muted]">
                Chiffre d’affaires gagné{focusScopeSuffix}
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {fmtEUR(kpiRevenue)}{" "}
                {comparePrev && (
                  <Trend
                    curr={kpiRevenue}
                    prev={kpiRevenuePrev}
                  />
                )}
              </div>
              <div className="text-xs text-[--muted] mt-1">
                Basé sur les dossiers passés en{" "}
                <b>client (WON)</b>.
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="card cursor-pointer"
              onClick={() => onFunnelCardClick("wonCount")}
            >
              <div className="text-xs uppercase tracking-wide text-[--muted]">
                Ventes gagnées{focusScopeSuffix}
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {fmtInt(kpiSales)}{" "}
                {comparePrev && (
                  <Trend curr={kpiSales} prev={kpiSalesPrev} />
                )}
              </div>
              <div className="text-[10px] text-[--muted] mt-1">
                Clique pour voir le détail.
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="card cursor-pointer"
              onClick={() =>
                onFunnelCardClick("rv1Honored" as any)
              }
            >
              <div className="text-xs uppercase tracking-wide text-[--muted]">
                RV1 faits{focusScopeSuffix}
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {fmtInt(kpiRv1Honored) } 
              </div>
              <div className="text-[10px] text-[--muted] mt-1">
                Clique pour détails par lead
              </div>
            </motion.div>
          </div>
          
          {/* ===== Pipeline insights ===== */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-0 -z-10">
              <div
                className="absolute left-1/2 -translate-x-1/2 -top-24 h-64 w-[70vw] rounded-full blur-3xl opacity-25"
                style={{
                  background:
                    "radial-gradient(60% 60% at 50% 50%, rgba(99,102,241,.28), rgba(14,165,233,.15), transparent 70%)",
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-[--muted]">
                  Pipeline insights
                </div>
                <div className="text-[13px] text-[--muted]">
                  Vue synthétique des opérations — leads → appels
                  → RDV → ventes
                </div>
              </div>

              <div className="relative">
                <div className="flex items-center rounded-full border border-white/10 bg-[rgba(18,24,38,.6)] backdrop-blur-xl p-1">
                  <button
                    type="button"
                    onClick={() => setFunnelOpen(false)}
                    className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                      !funnelOpen
                        ? "bg-white/[0.08] border border-white/10"
                        : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    Aperçu
                  </button>
                  <button
                    type="button"
                    onClick={() => setFunnelOpen(true)}
                    className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                      funnelOpen
                        ? "bg-white/[0.08] border border-white/10"
                        : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    Détails
                  </button>
                </div>
              </div>
            </div>

            {/* Aperçu */}
            {(() => {
              const N = pipelineTotals;
              const chip = (
                label: string,
                value: number | string,
                hint?: string
              ) => (
                <div className="group rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                    {label}
                  </div>
                  <div className="mt-0.5 text-lg font-semibold">
                    {typeof value === "number"
                      ? value.toLocaleString("fr-FR")
                      : value}
                  </div>
                  {hint && (
                    <div className="text-[10px] text-[--muted]">
                      {hint}
                    </div>
                  )}
                </div>
              );
              if (pipelineLoading) {
                return (
                  <div className="mt-3 text-[--muted] text-sm">
                    Chargement des métriques du funnel…
                  </div>
                );
              }
              if (pipelineError) {
                return (
                  <div className="mt-3 text-rose-300 text-sm">
                    Erreur funnel: {String(pipelineError)}
                  </div>
                );
              }
              return (() => {
                const N = pipelineTotals;

                const chip = (
                  label: string,
                  value: number | string,
                  hint?: string
                ) => (
                  <div className="group rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-colors px-4 py-3">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      {label}
                    </div>
                    <div className="mt-1 text-xl font-semibold">
                      {typeof value === "number"
                        ? value.toLocaleString("fr-FR")
                        : value}
                    </div>
                    {hint && (
                      <div className="text-[10px] text-[--muted] mt-0.5">
                        {hint}
                      </div>
                    )}
                  </div>
                );

                if (pipelineLoading) {
                  return (
                    <div className="mt-3 text-[--muted] text-sm">
                      Chargement des métriques du funnel…
                    </div>
                  );
                }

                if (pipelineError) {
                  return (
                    <div className="mt-3 text-rose-300 text-sm">
                      Erreur funnel: {String(pipelineError)}
                    </div>
                  );
                }

                const leadsTotal = filteredMode
                  ? N.LEADS_RECEIVED
                  : leadsRcv?.total ?? 0;
                const callReq = N.CALL_REQUESTED;
                const rv0Done = N.RV0_HONORED;

                return (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {chip(
                      `Leads reçus${focusScopeSuffix}`,
                      leadsTotal,
                      "Base 100 % – tous les leads froids"
                    )}

                    {chip(
                      "Demandes d’appel",
                      callReq,
                      leadsTotal
                        ? `${Math.round(
                            (callReq / Math.max(1, leadsTotal)) * 100
                          )}% des leads`
                        : undefined
                    )}

                    {chip(
                      "RV0 faits",
                      rv0Done,
                      callReq
                        ? `${Math.round(
                            (rv0Done / Math.max(1, callReq)) * 100
                          )}% des demandes d’appel`
                        : undefined
                    )}
                  </div>
                );
              })();
            })
            ()}

            {/* Détails du funnel */}
            <AnimatePresence>
              {funnelOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="mt-3 rounded-3xl border border-white/10 bg-[rgba(18,24,38,.55)] backdrop-blur-xl p-4 overflow-hidden"
                >
                  <div className="text-xs text-[--muted] mb-3 flex items-center gap-2">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                    Détail du funnel — clique une carte pour le
                    drill
                  </div>
                  {(() => {
                    const N = pipelineTotals;
                    return (
                      <Funnel
                        data={funnelData}
                        onCardClick={onFunnelCardClick}
                      />
                    );
                  })()}

                  {/* Ratios avancés */}
                  {(() => {
                    const N = pipelineTotals;

                    const leadsTotal = filteredMode
                      ? N.LEADS_RECEIVED
                      : leadsRcv?.total ?? 0;
                    const callReq = N.CALL_REQUESTED;
                    const rv0Planned = N.RV0_PLANNED ?? 0;
                    const rv0Done = N.RV0_HONORED;
                    const rv0NoShow = N.RV0_NO_SHOW;
                    const nonQual = N.NOT_QUALIFIED || 0;
                    const rv0NonQual = N.RV0_NOT_QUALIFIED_1 ?? 0;

                    const rv1Planned = N.RV1_PLANNED ?? 0;
                    const rv1Honored = N.RV1_HONORED ?? 0;
                    const rv1Postponed = N.RV1_POSTPONED ?? 0;
                    const rv1NoShow = N.RV1_NO_SHOW ?? 0;
                    const rv1NonQual = N.RV1_NOT_QUALIFIED ?? 0;
                    const rv1Canceled = N.RV1_CANCELED ?? 0; // ✅ NOUVEAU

                    const rv2Planned = N.RV2_PLANNED ?? 0;
                    const rv2Honored = N.RV2_HONORED ?? 0;
                    const rv2NoShow = N.RV2_NO_SHOW ?? 0;
                    const rv2Canceled = N.RV2_CANCELED ?? 0;
                    const rv2Postponed = N.RV2_POSTPONED ?? 0;

                    const ventes = N.WON ?? 0;

                    // Approche pragmatique : ce qui reste sur les demandes d’appel
                    const nurturing = Math.max(
                      0,
                      callReq - (rv0Done + rv0NoShow + nonQual)
                    );

                    return (
                      <div className="mt-4 space-y-4">
                        {/* 🧊 BLOC 1 — Demandes d’appel → RV0 */}
                        <div className="rounded-3xl border border-white/12 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.12),rgba(9,12,19,0.96))] px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,.55)]">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <div className="h-6 w-0.5 rounded-full bg-gradient-to-b from-sky-400/80 via-sky-300/40 to-transparent" />
                                <div className="text-[11px] uppercase tracking-wide text-slate-100/90">
                                  Bloc 1 · Demandes d’appel → RV0
                                </div>
                              </div>
                              <div className="text-[11px] text-[--muted]">
                                Comment les demandes d’appel se convertissent en premiers RDV (RV0) puis en RV1.
                              </div>
                            </div>
                            <div className="hidden md:block text-[10px] text-[--muted]">
                              Objectif : maximiser les RV0 faits et préparer les RV1.
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                            {/* RV0 faits / demandes d’appel */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV0 faits / demandes d’appel"
                                num={rv0Done}
                                den={callReq}
                              />
                            </KpiBox>

                            {/* RV0 no-show / demandes d’appel */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV0 no-show / demandes d’appel"
                                num={rv0NoShow}
                                den={callReq}
                                inverse
                              />
                            </KpiBox>

                            {/* RV0 non qualifiés / demandes d’appel */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV0 non qualifiés / demandes d’appel"
                                num={rv0NonQual}
                                den={callReq}
                                inverse
                              />
                            </KpiBox>

                            {/* RV0 nurturing / demandes d’appel */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV0 nurturing / demandes d’appel"
                                num={N.RV0_NURTURING}
                                den={N.CALL_REQUESTED}
                              />
                            </KpiBox>

                            {/* ✅ NOUVEAUX KPI RV1 */}

                            {/* RV1 planifiés / demandes d’appel */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV1 planifiés / demandes d’appel"
                                num={rv1Planned}
                                den={callReq}
                              />
                            </KpiBox>

                            {/* RV1 faits / RV0 planifiés */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV1 faits / RV0 planifiés"
                                num={rv1Honored}
                                den={rv0Planned}
                              />
                            </KpiBox>

                            {/* RV1 faits / demandes d’appel (vue early sur le pipe) */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV1 faits / demandes d’appel"
                                num={rv1Honored}
                                den={callReq}
                              />
                            </KpiBox>
                          </div>
                        </div>

                        {/* 🛰️ BLOC 2 — RV0 → RV1 → RV2 */}
                        <div className="rounded-3xl border border-white/12 bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.10),rgba(8,11,20,0.98))] px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,.55)]">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <div className="h-6 w-0.5 rounded-full bg-gradient-to-b from-indigo-400/80 via-indigo-300/40 to-transparent" />
                                <div className="text-[11px] uppercase tracking-wide text-slate-100/90">
                                  Bloc 2 · RV0 → RV1 → RV2
                                </div>
                              </div>
                              <div className="text-[11px] text-[--muted]">
                                Qualité et stabilité des RDV jusqu’aux seconds RDV (RV2).
                              </div>
                            </div>
                            <div className="hidden md:block text-[10px] text-[--muted]">
                              Objectif : limiter annulations, no-show et pertes au milieu du pipe.
                            </div>
                          </div>

                          {/* RV1 */}
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 mb-3">
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV1 faits / RV1 planifiés"
                                num={rv1Honored}
                                den={rv1Planned}
                              />
                            </KpiBox>

                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV1 reportés / RV1 planifiés"
                                num={rv1Postponed}
                                den={rv1Planned}
                              />
                            </KpiBox>

                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV1 annulés / RV1 planifiés"
                                num={rv1Canceled}
                                den={rv1Planned}
                                inverse
                              />
                            </KpiBox>

                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV1 no-show / RV1 planifiés"
                                num={rv1NoShow}
                                den={rv1Planned}
                                inverse
                              />
                            </KpiBox>

                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV1 non qualifiés / RV1 planifiés"
                                num={rv1NonQual}
                                den={rv1Planned}
                                inverse
                              />
                            </KpiBox>

                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV1 follow-up closer / RV1 faits"
                                num={N.RV1_FOLLOWUP}
                                den={rv1Honored}
                              />
                            </KpiBox>
                          </div>

                          {/* RV2 */}
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV2 planifiés / RV1 faits"
                                num={rv2Planned}
                                den={rv1Honored}
                              />
                            </KpiBox>

                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV2 faits / RV2 planifiés"
                                num={rv2Honored}
                                den={rv2Planned}
                              />
                            </KpiBox>

                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV2 no-show / RV2 planifiés"
                                num={rv2NoShow}
                                den={rv2Planned}
                                inverse
                              />
                            </KpiBox>

                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV2 annulés / RV2 planifiés"
                                num={rv2Canceled}
                                den={rv2Planned}
                                inverse
                              />
                            </KpiBox>

                            <KpiBox tone="muted">
                              <KpiRatio
                                label="RV2 reportés / RV2 planifiés"
                                num={rv2Postponed}
                                den={rv2Planned}
                              />
                            </KpiBox>
                          </div>
                        </div>

                        {/* 💸 BLOC 3 — Ventes (WON) */}
                        <div className="rounded-3xl border border-white/14 bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.10),rgba(7,11,18,0.98))] px-4 py-3 shadow-[0_20px_55px_rgba(0,0,0,.65)]">
                          <div className="flex items-start justify-between mb-3 gap-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <div className="h-6 w-0.5 rounded-full bg-gradient-to-b from-emerald-400/85 via-emerald-300/40 to-transparent" />
                                <div className="text-[11px] uppercase tracking-wide text-slate-100/90">
                                  Bloc 3 · Ventes
                                </div>
                              </div>
                              <div className="text-[11px] text-[--muted]">
                                Vue orientée business : combien de ventes sortent réellement du pipeline.
                              </div>
                            </div>
                            <div className="hidden md:block text-[10px] text-[--muted]">
                              Objectif : suivre la performance commerciale finale.
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                            {/* Ventes / demandes d’appel */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="Ventes / demandes d’appel"
                                num={ventes}
                                den={callReq}
                              />
                            </KpiBox>

                            {/* Ventes / RV0 faits */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="Ventes / RV0 faits"
                                num={ventes}
                                den={rv0Done}
                              />
                            </KpiBox>

                            {/* Ventes / RV1 planifiés */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="Ventes / RV1 planifiés"
                                num={ventes}
                                den={rv1Planned}
                              />
                            </KpiBox>

                            {/* Ventes / RV1 faits */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="Ventes / RV1 faits"
                                num={ventes}
                                den={rv1Honored}
                              />
                            </KpiBox>

                            {/* Ventes / RV2 planifiés */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="Ventes / RV2 planifiés"
                                num={ventes}
                                den={rv2Planned}
                              />
                            </KpiBox>

                            {/* Ventes / RV2 faits */}
                            <KpiBox tone="muted">
                              <KpiRatio
                                label="Ventes / RV2 faits"
                                num={ventes}
                                den={rv2Honored}
                              />
                            </KpiBox>
                          </div>
                        </div>
                      </div>
                    
                    );
                  })()}

                </motion.div>
              )}
            </AnimatePresence>

            {/* Cartes globales des taux demandés */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              <KpiRatio
                label="Taux qualification (global setting)"
                num={globalSetterQual.num}
                den={globalSetterQual.den}
              />
              <KpiRatio
                label="Taux closing (global closers)"
                num={globalCloserClosing.num}
                den={globalCloserClosing.den}
              />
            </div>
          </div>

          {/* ===== Charts Deck ===== */}
          
          <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Leads reçus */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4">
              <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-white/[0.04] blur-3xl" />
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  Leads reçus par jour{focusScopeSuffix}
                </div>
                <div className="text-xs text-[--muted]">
                  {(leadsByDaySeries?.total ?? 0).toLocaleString(
                    "fr-FR"
                  )}{" "}
                  au total
                </div>
              </div>
              <div className="h-64 mt-2">
                {leadsByDaySeries?.byDay?.length ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <BarChart
                      data={leadsByDaySeries.byDay.map((d) => ({
                        day: new Date(
                          d.day
                        ).toLocaleDateString("fr-FR"),
                        count: d.count,
                      }))}
                      margin={{
                        left: 8,
                        right: 8,
                        top: 10,
                        bottom: 0,
                      }}
                    >
                      <defs>
                        <linearGradient
                          id="gradLeads"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={COLORS.leads}
                            stopOpacity={0.95}
                          />
                          <stop
                            offset="100%"
                            stopColor={COLORS.leadsDark}
                            stopOpacity={0.7}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={COLORS.grid}
                      />
                      <XAxis
                        dataKey="day"
                        tick={{
                          fill: COLORS.axis,
                          fontSize: 12,
                        }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{
                          fill: COLORS.axis,
                          fontSize: 12,
                        }}
                      />
                      <Tooltip
                        content={
                          <ProTooltip
                            title="Leads"
                            valueFormatters={{
                              count: (v) =>
                                fmtInt(v),
                            }}
                          />
                        }
                      />
                      <Legend
                        wrapperStyle={{
                          color: "#fff",
                          opacity: 0.8,
                        }}
                      />
                      <Bar
                        name="Leads"
                        dataKey="count"
                        fill="url(#gradLeads)"
                        radius={[8, 8, 0, 0]}
                        maxBarSize={38}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[--muted] text-sm">
                    Pas de données.
                  </div>
                )}
              </div>
              <div className="text-[11px] text-[--muted] mt-2">
                Basé sur la <b>date de création</b> du contact
                {focusScopeSuffix || ""}.
              </div>
            </div>
            {/* CA hebdo (WON) */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4">
              <div className="absolute -left-16 -top-10 w-56 h-56 rounded-full bg-white/[0.04] blur-3xl" />
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  Production hebdomadaire (ventes gagnées)
                </div>
                <div className="text-xs text-[--muted]">
                  {(
                    salesWeekly.reduce(
                      (s, w) => s + (w.revenue || 0),
                      0
                    ) || 0
                  ).toLocaleString("fr-FR")}{" "}
                  €
                </div>
              </div>
              <div className="h-64 mt-2">
                {salesWeekly.length ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <BarChart
                      data={salesWeekly.map((w) => ({
                        label:
                          new Date(
                            w.weekStart
                          ).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                          }) +
                          " → " +
                          new Date(
                            w.weekEnd
                          ).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                          }),
                        revenue: Math.round(
                          w.revenue
                        ),
                        count: w.count,
                      }))}
                      margin={{
                        left: 8,
                        right: 8,
                        top: 10,
                        bottom: 0,
                      }}
                    >
                      <defs>
                        <linearGradient
                          id="gradRevenue"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={COLORS.revenue}
                            stopOpacity={0.95}
                          />
                          <stop
                            offset="100%"
                            stopColor={COLORS.revenueDark}
                            stopOpacity={0.7}
                          />
                        </linearGradient>
                        <linearGradient
                          id="gradCount"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor={COLORS.count}
                            stopOpacity={0.95}
                          />
                          <stop
                            offset="100%"
                            stopColor={COLORS.countDark}
                            stopOpacity={0.7}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={COLORS.grid}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{
                          fill: COLORS.axis,
                          fontSize: 12,
                        }}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{
                          fill: COLORS.axis,
                          fontSize: 12,
                        }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{
                          fill: COLORS.axis,
                          fontSize: 12,
                        }}
                      />
                      <Tooltip
                        content={
                          <ProTooltip
                            title="Hebdo"
                            valueFormatters={{
                              revenue: (v) =>
                                fmtEUR(v),
                              count: (v) =>
                                fmtInt(v),
                            }}
                          />
                        }
                      />
                      <Legend
                        wrapperStyle={{
                          color: "#fff",
                          opacity: 0.8,
                        }}
                      />
                      <Bar
                        yAxisId="left"
                        name="CA (WON)"
                        dataKey="revenue"
                        fill="url(#gradRevenue)"
                        radius={[8, 8, 0, 0]}
                        maxBarSize={44}
                      />
                      <Bar
                        yAxisId="right"
                        name="Ventes"
                        dataKey="count"
                        fill="url(#gradCount)"
                        radius={[8, 8, 0, 0]}
                        maxBarSize={44}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[--muted] text-sm">
                    Aucune production hebdo.
                  </div>
                )}
              </div>
              <div className="text-[11px] text-[--muted] mt-2">
                Basé sur la{" "}
                <b>date de passage en WON</b>.
              </div>
            </div>

            {/* Call requests */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">Demandes d’appel / jour</div>
                <div className="text-xs text-[--muted]">
                  {(mCallReq?.total ?? 0).toLocaleString("fr-FR")} au total
                </div>
              </div>
              <div className="h-64 mt-2">
                {mCallReq?.byDay?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={mCallReq.byDay.map((d) => ({
                        day: new Date(d.day).toLocaleDateString("fr-FR"),
                        count: d.count,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                      <XAxis dataKey="day" tick={{ fill: COLORS.axis, fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fill: COLORS.axis, fontSize: 12 }} />
                      <Tooltip content={<ProTooltip title="Demandes d’appel" valueFormatters={{ count: (v) => fmtInt(v) }} />} />
                      <Legend wrapperStyle={{ color: "#fff", opacity: 0.8 }} />
                      <Bar name="Demandes d’appel" dataKey="count" fill={COLORS.count} radius={[8, 8, 0, 0]} maxBarSize={38} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[--muted] text-sm">
                    Pas de données.
                  </div>
                )}
              </div>
            </div>

            {/* RV0 no-show weekly */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">RV0 no-show / semaine</div>
                <div className="text-xs text-[--muted]">
                  {rv0NsWeekly.reduce((s, w) => s + (w.count || 0), 0).toLocaleString("fr-FR")} au total
                </div>
              </div>
              <div className="h-64 mt-2">
                {rv0NsWeekly.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={rv0NsWeekly.map((w) => ({
                        label: w.label,
                        count: w.count,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                      <XAxis dataKey="label" tick={{ fill: COLORS.axis, fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fill: COLORS.axis, fontSize: 12 }} />
                      <Tooltip content={<ProTooltip title="RV0 no-show" valueFormatters={{ count: (v) => fmtInt(v) }} />} />
                      <Legend wrapperStyle={{ color: "#fff", opacity: 0.8 }} />
                      <Bar name="RV0 no-show" dataKey="count" fill={COLORS.revenueDark} radius={[8, 8, 0, 0]} maxBarSize={38} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[--muted] text-sm">
                    Pas de données.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ... autres sections UI ... */}

        </div>
      </div>

      {/* Drawer filtres */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <motion.div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[rgba(16,21,32,.95)] p-5 shadow-2xl">
              {/* ... contenu drawer ... */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setFiltersOpen(false)}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={() => {
                    if (loading) return;
                    if (debugFilters) {
                      console.info("[Filters] apply", {
                        previousAppliedState: buildFilterState(range),
                        nextAppliedState: buildFilterState(draftRange, {
                          tz: draftTz,
                          setterIds: draftSetterIds,
                          closerIds: draftCloserIds,
                          tags: draftTags,
                          leadCreatedFrom: draftLeadCreatedFrom,
                          leadCreatedTo: draftLeadCreatedTo,
                        }),
                      });
                    }
                    setRange(draftRange);
                    setTz(draftTz);
                    setSetterIds(draftSetterIds);
                    setCloserIds(draftCloserIds);
                    setTags(draftTags);
                    setLeadCreatedFrom(draftLeadCreatedFrom);
                    setLeadCreatedTo(draftLeadCreatedTo);
                    syncFiltersToUrl({
                      from: draftRange.from
                        ? toISODate(draftRange.from)
                          : undefined,
                        to: draftRange.to
                          ? toISODate(draftRange.to)
                          : undefined,
                        tz: draftTz,
                      setterIds: draftSetterIds,
                      closerIds: draftCloserIds,
                      tags: draftTags,
                      leadCreatedFrom: draftLeadCreatedFrom,
                      leadCreatedTo: draftLeadCreatedTo,
                    });
                    setFiltersOpen(false);
                    if (debugFilters && typeof window !== "undefined") {
                      setTimeout(() => {
                        console.info("[Filters] url after sync", {
                          search: window.location.search,
                          href: window.location.href,
                        });
                      }, 0);
                    }
                  }}
                >
                  Appliquer
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drill modal */}
      <AnimatePresence>
        {drillOpen && (
          <DrillModal
            title={drillTitle}
            open={drillOpen}
            onClose={() => setDrillOpen(false)}
            rows={drillRows}
          />
        )}
      </AnimatePresence>
    </div>
  );
  
}
