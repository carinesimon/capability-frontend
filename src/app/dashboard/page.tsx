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
import { reportingApi } from "@/lib/reporting";
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
function toISODate(d: Date | string) {
  const dd = d instanceof Date ? d : new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const fmtInt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const fmtEUR = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;
const fmtPct = (num?: number | null, den?: number | null) =>
  den && den > 0 ? `${Math.round(((num || 0) / den) * 100)}%` : "—";

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
                className="inline-block h-2 w-2 rounded"
                style={{ background: entry.color || entry.fill }}
              />
              <span className="opacity-80">{entry.name ?? key}</span>
              <span className="ml-auto font-semibold">
                {fmt ? fmt(v) : v}
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

/* ============================= PAGE ============================= */
export default function DashboardPage() {
  const router = useRouter();
  const search = useSearchParams();
  const view = (search.get("view") || "home") as
    | "home"
    | "closers"
    | "setters"
    | "contracts"
    | "users"
    | "exports";

  const { from: defaultFrom, to: defaultTo } = useMemo(
    () => currentMonthRange(),
    []
  );
  const [range, setRange] = useState<Range>({
    from: defaultFrom,
    to: defaultTo,
  });
  const [draftRange, setDraftRange] = useState<Range>({
    from: defaultFrom,
    to: defaultTo,
  });

    // Timezone sélectionné (affichage + agrégations serveur)
  const [tz, setTz] = useState<string>("Europe/Paris");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [comparePrev, setComparePrev] =
    useState<boolean>(true);

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

  // ========= FUNNEL METRICS (pour les tuiles + Funnel) =========
const { data: funnelRaw = {}, loading: funnelLoading, error: funnelError } =
  useFunnelMetrics(fromDate, toDate, tz);

const totals = normalizeTotals(
  funnelRaw as Record<string, number | undefined>
);

const funnelData: FunnelProps["data"] = {
  // Top funnel
  leads: totals.LEADS_RECEIVED,
  callRequests: totals.CALL_REQUESTED,
  callsTotal: totals.CALL_ATTEMPT,
  callsAnswered: totals.CALL_ANSWERED,
  setterNoShow: totals.SETTER_NO_SHOW,

  // RV0
  rv0P: totals.RV0_PLANNED,
  rv0H: totals.RV0_HONORED,
  rv0NS: totals.RV0_NO_SHOW,
  rv0C: totals.RV0_CANCELED,
  rv0NQ:
    ((totals as any).RV0_NOT_QUALIFIED_1 || 0) +
    ((totals as any).RV0_NOT_QUALIFIED_2 || 0),
  rv0Nurturing: (totals as any).RV0_NURTURING || 0,

  // RV1
  rv1P: totals.RV1_PLANNED,
  rv1H: totals.RV1_HONORED,
  rv1NS: totals.RV1_NO_SHOW,
  rv1Postponed: totals.RV1_POSTPONED ?? 0,
  rv1FollowupCloser: (totals as any).RV1_FOLLOWUP || 0,
  rv1C: totals.RV1_CANCELED,
  rv1NQ: totals.RV1_NOT_QUALIFIED ?? 0,

  // RV2
  rv2P: totals.RV2_PLANNED,
  rv2H: totals.RV2_HONORED,
  rv2NS: totals.RV2_NO_SHOW,
  rv2C: totals.RV2_CANCELED,
  rv2Postponed: totals.RV2_POSTPONED ?? 0,

  // Ventes
  won: totals.WON,
};

  
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
  const [duos, setDuos] = useState<DuoRow[]>([]);

  // Séries par jour : call requests / calls total / calls answered
  const [mCallReq, setMCallReq] =
    useState<MetricSeriesOut | null>(null);
  const [mCallsTotal, setMCallsTotal] =
    useState<MetricSeriesOut | null>(null);
  const [mCallsAnswered, setMCallsAnswered] =
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


  // Drill modal
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState("");
  const [drillRows, setDrillRows] = useState<DrillItem[]>([]);

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


  // Helper fetch "metric/*" safe
  async function fetchSafeMetric(
    url: string,
    params: Record<string, any>
  ) {
    try {
      return await api.get<MetricSeriesOut>(url, {
        params,
      });
    } catch {
      return { data: null } as any;
    }
  }

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
          api.get<SummaryOut>("/reporting/summary", { params: { from: fromISO, to: toISO, tz, } }),
          api.get<LeadsReceivedOut>("/metrics/leads-by-day", { params: { from: fromISO, to: toISO, tz, } }),
          api.get<SalesWeeklyItem[]>("/reporting/sales-weekly", { params: { from: fromISO, to: toISO, tz, } }),
          api.get<{ ok: true; rows: WeeklyOpsRow[] }>("/reporting/weekly-ops", { params: { from: fromISO, to: toISO, tz, } }),
        ]);

        if (cancelled) return;

        // Résumé global
        setSummary(sumRes.data || null);
        setLeadsRcv(leadsRes.data || null);
        setSalesWeekly((weeklyRes.data || []).sort((a, b) => a.weekStart.localeCompare(b.weekStart)));
        const opsSorted = (opsRes.data?.rows || []).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
        setOps(opsSorted);

        // 2) Séries journalières basées sur StageEvent (mêmes métriques que le funnel /metrics/funnel)
        const [m1, m2, m3] = await Promise.all([
          fetchSafeMetric("/metrics/stage-series", {
              from: fromISO, to: toISO, stage: "CALL_REQUESTED", tz,
            }),
          fetchSafeMetric("/metrics/stage-series", {
            from: fromISO,
            to: toISO,
            stage: "CALL_ATTEMPT", tz,     // Appels passés
          }),
          fetchSafeMetric("/metrics/stage-series", {
            from: fromISO,
            to: toISO,
            stage: "CALL_ANSWERED", tz,    // Appels répondus
          }),
        ]);

        if (!cancelled) {
          setMCallReq(m1?.data || null);
          setMCallsTotal(m2?.data || null);
          setMCallsAnswered(m3?.data || null);
        }

        // 3) RV0 no-show par semaine, à partir de StageEvent(RV0_NO_SHOW) → /metrics/stage-series
        const rv0SeriesRes = await api.get<MetricSeriesOut>("/metrics/stage-series", {
          params: { from: fromISO, to: toISO, stage: "RV0_NO_SHOW" },
        });
        const series = rv0SeriesRes.data?.byDay || [];

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
  }, [authChecked, authError, fromISO, toISO, tz]);

  
  // Classements (setters / closers)
  // Spotlight (Setters / Closers) — avec fallback si l'API n'a pas encore les endpoints spotlight
// Spotlight (Setters / Closers) — avec fallback si l'API n'a pas encore les endpoints spotlight
useEffect(() => {
  if (!authChecked || authError) return;
  let cancelled = false;

  async function loadSpotlight() {
    const params = { from: fromISO, to: toISO, tz };

    try {
      // 1) Tentative endpoints spotlight
      const [sRes, cRes] = await Promise.all([
        api.get<SetterRow[]>("/reporting/spotlight-setters", { params }),
        api.get<CloserRow[]>("/reporting/spotlight-closers", { params }),
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
        rv1CancelRate,        // ✅ alias pour usage front
        rv1NoShowRate,
      };
    });

      const closersDer = closersRaw.map((c) => ({
        ...c,
        closingRate:
          (c.salesClosed || 0) /
          Math.max(1, c.rv1Honored || 0),
        rv1CancelRate:
          (c.rv1Canceled || 0) /
          Math.max(1, c.rv1Planned || 0),
        rv2CancelRate:
          (c.rv2Canceled || 0) /
          Math.max(1, c.rv2Planned || 0),
        rv1NoShowRate:
          (c.rv1NoShow || 0) /
          Math.max(1, c.rv1Planned || 0),
        rv2NoShowRate:
          (c.rv2NoShow || 0) /
          Math.max(1, c.rv2Planned || 0),
      }));

      setSetters(settersDer as any);
      setClosers(closersDer as any);
      return;
    } catch (e: any) {
      // 404 -> fallback vers anciens endpoints
      if (e?.response?.status !== 404) {
        if (!cancelled)
          setErr(
            e?.response?.data?.message ||
              "Erreur de chargement (spotlight)"
          );
        return;
      }
    }

    // 2) Fallback anciens endpoints
    try {
      const [sRes2, cRes2] = await Promise.all([
        api.get<any[]>("/reporting/setters", { params }),
        api.get<any[]>("/reporting/closers", { params }),
      ]);
      if (cancelled) return;

      const settersFallback: SetterRow[] = (sRes2.data || []).map(
        (s) => {
          const leadsReceived = Number(s.leadsReceived || 0);

          const rv1HonoredOnHisLeads = Number(
            s.rv1FromHisLeads || 0
          );
          const rv1PlannedOnHisLeads = Number(
            s.rv1PlannedOnHisLeads || s.rv1FromHisLeads || 0
          );
          const rv1CanceledOnHisLeads = Number(
            s.rv1CanceledOnHisLeads || 0
          );
          const rv1NoShowOnHisLeads = Number(
            s.rv1NoShowOnHisLeads || 0
          );
          const rv1CancelRate = rv1PlannedOnHisLeads
          ? rv1CanceledOnHisLeads / rv1PlannedOnHisLeads
          : null;

        const rv1NoShowRate = rv1PlannedOnHisLeads
          ? rv1NoShowOnHisLeads / rv1PlannedOnHisLeads
          : null;

          return {
            userId: s.userId,
            name: s.name,
            email: s.email,

            leadsReceived,
            rv0Count: s.rv0Count ?? 0,
            ttfcAvgMinutes: s.ttfcAvgMinutes ?? null,

            rv1PlannedOnHisLeads,
            rv1HonoredOnHisLeads,
            rv1CanceledOnHisLeads,
            rv1NoShowOnHisLeads,

            salesFromHisLeads: Number(s.salesFromHisLeads || 0),
            revenueFromHisLeads: Number(s.revenueFromHisLeads || 0),

            qualificationRate: leadsReceived
              ? rv1PlannedOnHisLeads / leadsReceived
              : 0,
            rv1CancelRateOnHisLeads: rv1CancelRate,
            rv1CancelRate,         // ✅ alias
            rv1NoShowRate,

            spendShare: s.spendShare ?? null,
            cpl: s.cpl ?? null,
            cpRv0: s.cpRv0 ?? null,
            cpRv1: s.cpRv1 ?? null,
            roas: s.roas ?? null,
          };
        }
      );

      const closersFallback: CloserRow[] = (cRes2.data || []).map(
        (c) => {
          const rv1Planned = Number(c.rv1Planned || 0);
          const rv1Honored = Number(c.rv1Honored || 0);
          const rv1Canceled = Number(c.rv1Canceled || 0);
          const rv1NoShow = Number(c.rv1NoShow || 0);

          const rv2Planned = Number(c.rv2Planned || 0);
          const rv2Honored = Number(c.rv2Honored || 0);
          const rv2Canceled = Number(c.rv2Canceled || 0);
          const rv2NoShow = Number(c.rv2NoShow || 0);

          const salesClosed = Number(c.salesClosed || 0);
          const contractsSigned = Number(c.contractsSigned || 0);

          const revenueTotal = Number(c.revenueTotal || 0);

          return {
            userId: c.userId,
            name: c.name,
            email: c.email,

            rv1Planned,
            rv1Honored,
            rv1Canceled,
            rv1NoShow,
            rv1CancelRate: rv1Planned
              ? rv1Canceled / rv1Planned
              : null,
            rv1NoShowRate: rv1Planned
              ? rv1NoShow / rv1Planned
              : null,

            rv2Planned,
            rv2Honored,
            rv2Canceled,
            rv2NoShow,
            rv2CancelRate: rv2Planned
              ? rv2Canceled / rv2Planned
              : null,
            rv2NoShowRate: rv2Planned
              ? rv2NoShow / rv2Planned
              : null,

            salesClosed,
            revenueTotal,
            contractsSigned,
            roasPlanned: c.roasPlanned ?? null,
            roasHonored: c.roasHonored ?? null,
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

  loadSpotlight();
  return () => {
    cancelled = true;
  };
}, [authChecked, authError, fromISO, toISO, tz]);


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
        const res = await api.get<{ ok?: boolean; rows?: DuoRow[] }>(
          "/reporting/duos",
          { params: { from: fromISO, to: toISO, tz, } }
        );
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
  }, [authChecked, authError, fromISO, toISO, tz]);

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
      : 0; // ventes / RV1 faits

    const closingOnRv1Planned = rv1Planned
      ? salesClosed / rv1Planned
      : 0; // ventes / RV1 planifiés

    const rv1HonorRate = rv1Planned
      ? rv1Honored / rv1Planned
      : 0; // RV1 faits / RV1 planifiés

    const rv2HonorRate = rv2Planned
      ? rv2Honored / rv2Planned
      : 0; // RV2 faits / RV2 planifiés

    return {
      ...c,
      closingRate,
      closingOnRv1Planned,
      rv1HonorRate,
      rv2HonorRate,
    };
  });
}, [closers]);


  // Tri — règles demandées
  const sortedSetters = useMemo(() => {
    const arr = [...settersWithRates];
    return arr.sort((a, b) => {
      if (
        (b.rv1PlannedOnHisLeads || 0) !==
        (a.rv1PlannedOnHisLeads || 0)
      )
        return (
          (b.rv1PlannedOnHisLeads || 0) -
          (a.rv1PlannedOnHisLeads || 0)
        );
      if ((b.qualificationRate || 0) !== (a.qualificationRate || 0))
        return (
          (b.qualificationRate || 0) -
          (a.qualificationRate || 0)
        );
      return (
        (b.leadsReceived || 0) - (a.leadsReceived || 0)
      );
    });
  }, [settersWithRates]);

  const sortedClosers = useMemo(() => {
    const arr = [...closersWithRates];
    return arr.sort((a, b) => {
      if ((b.closingRate || 0) !== (a.closingRate || 0))
        return (
          (b.closingRate || 0) - (a.closingRate || 0)
        );
      if ((b.salesClosed || 0) !== (a.salesClosed || 0))
        return (
          (b.salesClosed || 0) - (a.salesClosed || 0)
        );
      return (
        (b.revenueTotal || 0) - (a.revenueTotal || 0)
      );
    });
  }, [closersWithRates]);

  // ================== KPIs (avec fallback robuste) ==================
  const normalizedTotals = useMemo(
    () => normalizeTotals(totals as any),
    [totals]
  );

  const kpiRevenue = summary?.totals?.revenue ?? 0;

  // Leads: d’abord l’endpoint dédié, sinon fallback sur le funnel normalisé
  const kpiLeads =
    (leadsRcv?.total ?? 0) ||
    normalizedTotals.LEADS_RECEIVED ||
    (summary?.totals?.leads ?? 0);

  const kpiRv1Honored = funnelData.rv1H ?? 0;

// ➕ Nombre total de ventes (deals WON)
const kpiSales = summary?.totals?.salesCount ?? 0;

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
        const [sum, leads] = await Promise.all([
          api.get<SummaryOut>("/reporting/summary", {
            params: {
              from: toISODate(prevFrom),
              to: toISODate(prevTo), tz,
            },
          }),
          api.get<LeadsReceivedOut>(
            "/reporting/leads-received",
            {
              params: {
                from: toISODate(prevFrom),
                to: toISODate(prevTo), tz,
              },
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
  }, [comparePrev, fromISO, toISO]);
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

  type MetricSeriesRow = { day: string; count: number };
  type MetricSeriesOut = {
    total: number;
    byDay: MetricSeriesRow[];
  };

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
        // on utilise ton helper robuste qui gère RV0_HONORED / RV0_HONOURED
        const res = await fetchStageSeriesAny("RV0_HONORED", {
          from: fromISO,
          to: toISO,
          tz,
        });
        if (!cancelled) setRv0Daily(res);
      } catch {
        if (!cancelled) setRv0Daily(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromISO, toISO, tz]);


useEffect(() => {
  let cancelled = false;

  (async () => {
    try {
      if (!fromISO || !toISO) {
        if (!cancelled) setCanceledDaily({ total: 0, byDay: [] });
        return;
      }

      // On récupère 4 séries : RV1 annulé / reporté, RV2 annulé / reporté
      const [rv1C, rv1P, rv2C, rv2P] = await Promise.all([
        fetchStageSeriesAny("RV1_CANCELED",  { from: fromISO, to: toISO, tz }),
        fetchStageSeriesAny("RV1_POSTPONED", { from: fromISO, to: toISO, tz }),
        fetchStageSeriesAny("RV2_CANCELED",  { from: fromISO, to: toISO, tz }),
        fetchStageSeriesAny("RV2_POSTPONED", { from: fromISO, to: toISO, tz }),
      ]);

      const map = new Map<string, { rv1: number; rv2: number }>();

      const add = (src: MetricSeriesOut | null | undefined, key: "rv1" | "rv2") => {
        const arr = src?.byDay ?? [];
        for (const it of arr) {
          if (!it?.day) continue;
          const dayKey =
            it.day.length >= 10
              ? it.day.slice(0, 10)
              : new Date(it.day).toISOString().slice(0, 10);
          const row = map.get(dayKey) ?? { rv1: 0, rv2: 0 };
          row[key] += Number(it.count || 0);
          map.set(dayKey, row);
        }
      };

      // RV1 = annulé + reporté
      add(rv1C, "rv1");
      add(rv1P, "rv1");
      // RV2 = annulé + reporté
      add(rv2C, "rv2");
      add(rv2P, "rv2");

      // Générer un range continu YYYY-MM-DD
      const out: AnnulPostDailyRow[] = [];
      const start = new Date(fromISO);
      const end = new Date(toISO);
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const key = `${y}-${m}-${dd}`;
        const bucket = map.get(key) ?? { rv1: 0, rv2: 0 };
        out.push({
          day: key,
          rv1CanceledPostponed: bucket.rv1,
          rv2CanceledPostponed: bucket.rv2,
          total: bucket.rv1 + bucket.rv2,
        });
      }

      const total = out.reduce((s, x) => s + (x.total || 0), 0);

      if (!cancelled) setCanceledDaily({ total, byDay: out });
    } catch {
      if (!cancelled) setCanceledDaily({ total: 0, byDay: [] });
    }
  })();

  return () => {
    cancelled = true;
  };
}, [fromISO, toISO, tz]);

  // ======= DRILLS : helpers endpoints =======
  async function openAppointmentsDrill(params: {
    title: string;
    type?: "RV0" | "RV1" | "RV2";
    status?:
      | "HONORED"
      | "POSTPONED"
      | "CANCELED"
      | "NO_SHOW"
      | "NOT_QUALIFIED";
    from?: string;
    to?: string;
  }) {
    const res = await api.get(
      "/reporting/drill/appointments",
      {
        params: {
          type: params.type,
          status: params.status,
          from: params.from ?? fromISO,
          to: params.to ?? toISO,
          limit: 2000, tz,
        },
      }
    );
    setDrillTitle(params.title);
    setDrillRows(res.data?.items || []);
    setDrillOpen(true);
  }

  async function fetchSafe(
    url: string,
    params: Record<string, any>
  ) {
    try {
      return await api.get(url, { params });
    } catch (e: any) {
      return {
        data: {
          items: [],
          __error:
            e?.response?.data?.message ||
            "Endpoint non disponible (à activer côté API)",
        },
      };
    }
  }
  async function openCallRequestsDrill() {
    const res: any = await fetchSafe(
      "/reporting/drill/call-requests",
      { from: fromISO, to: toISO, limit: 2000, tz, }
    );
    setDrillTitle("Demandes d’appel – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error)
      items.unshift({
        leadId: "**msg**",
        leadName: res.data.__error,
      } as any);
    setDrillRows(items);
    setDrillOpen(true);
  }
  async function openCallsDrill() {
    const res: any = await fetchSafe(
      "/reporting/drill/calls",
      { from: fromISO, to: toISO, limit: 2000, tz, }
    );
    setDrillTitle("Appels passés – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error)
      items.unshift({
        leadId: "**msg**",
        leadName: res.data.__error,
      } as any);
    setDrillRows(items);
    setDrillOpen(true);
  }
  async function openCallsAnsweredDrill() {
    const res: any = await fetchSafe(
      "/reporting/drill/calls",
      {
        from: fromISO,
        to: toISO,
        answered: 1,
        limit: 2000, tz,
      }
    );
    setDrillTitle("Appels répondus – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error)
      items.unshift({
        leadId: "**msg**",
        leadName: res.data.__error,
      } as any);
    setDrillRows(items);
    setDrillOpen(true);
  }
  async function openSetterNoShowDrill() {
    const res: any = await fetchSafe(
      "/reporting/drill/calls",
      {
        from: fromISO,
        to: toISO,
        setterNoShow: 1,
        limit: 2000, tz,
      }
    );
    setDrillTitle("No-show Setter – détail");
    const items: DrillItem[] = res?.data?.items || [];
    if (res?.data?.__error)
      items.unshift({
        leadId: "**msg**",
        leadName: res.data.__error,
      } as any);
    setDrillRows(items);
    setDrillOpen(true);
  }

  const STAGE_SYNONYMS: Record<string, string[]> = {
  RV0_CANCELED:  ["RV0_CANCELED",  "RV0_CANCELLED"],
  RV1_CANCELED:  ["RV1_CANCELED",  "RV1_CANCELLED"],
  RV2_CANCELED:  ["RV2_CANCELED",  "RV2_CANCELLED"],
  RV0_NO_SHOW:   ["RV0_NO_SHOW"],  
  RV1_NO_SHOW:   ["RV1_NO_SHOW"],   
  RV2_NO_SHOW:   ["RV2_NO_SHOW"],  


};

async function fetchStageSeriesAny(stage: string, params: any) {
  const list = STAGE_SYNONYMS[stage] ?? [stage];
  const results = await Promise.all(
    list.map(s => api.get<MetricSeriesOut>("/metrics/stage-series", {
      params: { ...params, stage: s },
    }).catch(() => ({ data: null } as any)))
  );
  // fusionne les byDay (clé = YYYY-MM-DD)
  const map = new Map<string, number>();
  for (const r of results) {
    const arr = r?.data?.byDay ?? [];
    for (const it of arr) {
      const k = (it?.day?.slice?.(0,10)) || new Date(it.day).toISOString().slice(0,10);
      map.set(k, (map.get(k) ?? 0) + Number(it.count || 0));
    }
  }
  const byDay = [...map.entries()].sort(([a],[b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));
  const total = byDay.reduce((s,x)=>s+x.count,0);
  return { total, byDay } as MetricSeriesOut;
}

type KpiTone = "primary" | "success" | "warning" | "danger" | "info" | "muted";

const kpiBoxToneClasses: Record<KpiTone, string> = {
  primary:
    "border-white/10 bg-[radial-gradient(circle_at_top,_rgba(129,140,248,.18),_transparent_55%),_rgba(15,23,42,.96)]",
  success:
    "border-emerald-400/40 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,.20),_transparent_55%),_rgba(9,18,32,.98)]",
  warning:
    "border-amber-400/40 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,.20),_transparent_55%),_rgba(15,23,42,.96)]",
  danger:
    "border-rose-500/45 bg-[radial-gradient(circle_at_top,_rgba(244,63,94,.22),_transparent_55%),_rgba(15,23,42,.96)]",
  info:
    "border-sky-400/40 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,.20),_transparent_55%),_rgba(15,23,42,.96)]",
  muted:
    "border-slate-400/25 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,.18),_transparent_55%),_rgba(15,23,42,.96)]",
};

function KpiBox({
  tone = "primary",
  children,
}: {
  tone?: KpiTone;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        "rounded-2xl px-3 py-2.5",
        "shadow-[0_18px_45px_rgba(0,0,0,.65)]",
        "backdrop-blur-xl border",
        "transition-transform duration-150 hover:-translate-y-[1px]",
        kpiBoxToneClasses[tone],
      ].join(" ")}
    >
      {children}
    </div>
  );
}

  const onFunnelCardClick = async (key: FunnelKey): Promise<void> => {
  switch (key) {
    case "leads": {
      const res = await api.get("/reporting/drill/leads-received", {
        params: {
          from: fromISO,
          to: toISO,
          limit: 2000,
          tz,
        },
      });
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
      const res = await api.get("/reporting/drill/won", {
        params: {
          from: fromISO,
          to: toISO,
          limit: 2000,
          tz,
        },
      });
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

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[--muted]">
        Chargement…
      </div>
    );
  }
  if (authError) {
    return (
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 p-6">
          <div className="text-sm text-red-400">
            {authError}
          </div>
        </main>
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
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
              >
                <path
                  fill="currentColor"
                  d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"
                />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-semibold leading-tight">
                Tableau de Bord
              </div>
              <div className="text-xs text-[--muted]">
                Période : <b>{fromISO ?? "—"}</b> →{" "}
                <b>{toISO ?? "—"}</b>
              </div>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-3 text-xs text-[--muted]">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M12 1a11 11 0 1 0 11 11A11.013 11.013 0 0 0 12 1m.75 11.44l3.9 2.34a1 1 0 0 1-1.05 1.72l-4.39-2.64a1.5 1.5 0 0 1-.71-1.29V6a1 1 0 0 1 2 0Z"/>
                </svg>
                <Clock />
              </div>
            </div>

            {/* Sélecteur de fuseau horaire */}
            <select
              className="text-xs rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1 focus:outline-none"
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              title="Fuseau horaire d’agrégation"
            >
              {TIMEZONES.map(z => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>

            <label className="hidden sm:flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={comparePrev}
                onChange={(e) => setComparePrev(e.target.checked)}
              />
              Comparer période précédente
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setDraftRange(range);
                setFiltersOpen(true);
              }}
            >
              Filtres
            </button>
          </div>

        </div>
      </div>

      <div className="mt-4 flex gap-4">
        <Sidebar />
        <div className="flex-1 space-y-6">
          {err && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {err}
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
                Chiffre d’affaires gagné
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

             {/*<motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="card"
            >
              <div className="text-xs uppercase tracking-wide text-[--muted]">
                Leads reçus
              </div>
              <div className="mt-2 text-2xl font-semibold">
                {fmtInt(kpiLeads)}{" "}
                {comparePrev && (
                  <Trend
                    curr={kpiLeads}
                    prev={kpiLeadsPrev}
                  />
                )}
              </div>
              <div className="text-xs text-[--muted] mt-1">
                Basé sur les{" "}
                <b>créations de contacts</b>.
              </div>
            </motion.div>*/}

             {/* ➕ KPI Ventes */}
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="card cursor-pointer"
                onClick={() => onFunnelCardClick("wonCount")}
              >
                <div className="text-xs uppercase tracking-wide text-[--muted]">
                  Ventes
                </div>
                <div className="mt-2 text-2xl font-semibold">
                  {fmtInt(kpiSales)}{" "}
                  {comparePrev && (
                    <Trend
                      curr={kpiSales}
                      prev={kpiSalesPrev}
                    />
                  )}
                </div>
                <div className="text-xs text-[--muted] mt-1">
                  Nombre total de deals passés en <b>WON</b>.
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
                RV1 Fait
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
              const N = normalizeTotals(totals as any);
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
              if (funnelLoading) {
                return (
                  <div className="mt-3 text-[--muted] text-sm">
                    Chargement des métriques du funnel…
                  </div>
                );
              }
              if (funnelError) {
                return (
                  <div className="mt-3 text-rose-300 text-sm">
                    Erreur funnel: {String(funnelError)}
                  </div>
                );
              }
              return (() => {
                const N = normalizeTotals(totals as any);

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

                if (funnelLoading) {
                  return (
                    <div className="mt-3 text-[--muted] text-sm">
                      Chargement des métriques du funnel…
                    </div>
                  );
                }

                if (funnelError) {
                  return (
                    <div className="mt-3 text-rose-300 text-sm">
                      Erreur funnel: {String(funnelError)}
                    </div>
                  );
                }

                const leadsTotal =
                  (leadsRcv?.total ?? 0) || N.LEADS_RECEIVED;
                const callReq = N.CALL_REQUESTED;
                const rv0Done = N.RV0_HONORED;

                return (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {chip(
                      "Leads reçus",
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
                    const N = normalizeTotals(totals as any);
                    return (
                      <Funnel
                        data={funnelData} /*{{
                          leads:
                            (leadsRcv?.total ?? 0) ||
                            N.LEADS_RECEIVED,
                          callRequests:
                            N.CALL_REQUESTED,
                          callsTotal: N.CALL_ATTEMPT,
                          callsAnswered:
                            N.CALL_ANSWERED,
                          setterNoShow:
                            N.SETTER_NO_SHOW,

                          rv0P: N.RV0_PLANNED,
                          rv0H: N.RV0_HONORED,
                          rv0NS: N.RV0_NO_SHOW,
                          rv0C: N.RV0_CANCELED,
                          rv0NQ: N.RV0_NOT_QUALIFIED_1,
                          rv0Nurturing: N.RV0_NURTURING,
                          rv1P: N.RV1_PLANNED,
                          rv1H: N.RV1_HONORED,
                          rv1NS: N.RV1_NO_SHOW,
                          rv1Postponed: N.RV1_POSTPONED,
                          rv1FollowupCloser: N.RV1_FOLLOWUP,

                          rv1C: N.RV1_CANCELED,
                          rv1NQ: N.RV1_NOT_QUALIFIED,
                          rv2P: N.RV2_PLANNED,
                          rv2H: N.RV2_HONORED,
                          rv2NS: N.RV2_NO_SHOW,
                          rv2C: N.RV2_CANCELED,
                          rv2Postponed: N.RV2_POSTPONED,

                          won: N.WON,
                          
                        }}*/
                        onCardClick={onFunnelCardClick}
                      />
                    );
                  })()}

                  {/* Ratios avancés */}
                  {(() => {
                    const N = normalizeTotals(totals as any);

                    const leadsTotal =
                      (leadsRcv?.total ?? 0) || N.LEADS_RECEIVED;
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
                  Leads reçus par jour
                </div>
                <div className="text-xs text-[--muted]">
                  {(leadsRcv?.total ?? 0).toLocaleString(
                    "fr-FR"
                  )}{" "}
                  au total
                </div>
              </div>
              <div className="h-64 mt-2">
                {leadsRcv?.byDay?.length ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <BarChart
                      data={leadsRcv.byDay.map((d) => ({
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
                Basé sur la <b>date de création</b> du contact.
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
                <div className="font-medium">
                  Demandes d’appel par jour
                </div>
                <div className="text-xs text-[--muted]">
                  {(mCallReq?.total ?? 0).toLocaleString(
                    "fr-FR"
                  )}
                </div>
              </div>
              <div className="h-64 mt-2">
                {mCallReq?.byDay?.length ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <BarChart
                      data={mCallReq.byDay.map((d) => ({
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
                          id="gradCallReq"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#06b6d4"
                            stopOpacity={0.95}
                          />
                          <stop
                            offset="100%"
                            stopColor="#0e7490"
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
                            title="Demandes d’appel"
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
                        name="Demandes"
                        dataKey="count"
                        fill="url(#gradCallReq)"
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
                Basé sur{" "}
                <b>CallRequest.requestedAt</b>.
              </div>
            </div>

            {/* RV0 faits par jour */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">RV0 faits par jour</div>
                <div className="text-xs text-[--muted]">
                  {(rv0Daily?.total ?? 0).toLocaleString("fr-FR")} au total
                </div>
              </div>

              <div className="h-64 mt-2">
                {rv0Daily?.byDay?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={rv0Daily.byDay.map((d) => ({
                        day: new Date(d.day).toLocaleDateString("fr-FR"),
                        count: d.count,
                      }))}
                      margin={{ left: 8, right: 8, top: 10, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="gradRv0Done" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.95} />
                          <stop offset="100%" stopColor="#15803d" stopOpacity={0.7} />
                        </linearGradient>
                      </defs>

                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                      <XAxis
                        dataKey="day"
                        tick={{ fill: COLORS.axis, fontSize: 12 }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fill: COLORS.axis, fontSize: 12 }}
                      />
                      <Tooltip
                        content={
                          <ProTooltip
                            title="RV0 faits"
                            valueFormatters={{
                              count: (v) => fmtInt(v),
                            }}
                          />
                        }
                      />
                      <Legend wrapperStyle={{ color: "#fff", opacity: 0.8 }} />
                      <Bar
                        name="RV0 faits"
                        dataKey="count"
                        fill="url(#gradRv0Done)"
                        radius={[8, 8, 0, 0]}
                        maxBarSize={40}
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
                Basé sur les <b>StageEvents RV0_HONORED</b> (date de RDV).
              </div>
            </div>


            {/* RV0 no-show weekly */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4 xl:col-span-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  RV0 no-show par semaine
                </div>
                <div className="text-xs text-[--muted]">
                  {rv0NsWeekly
                    .reduce(
                      (s, x) => s + (x.count || 0),
                      0
                    )
                    .toLocaleString("fr-FR")}
                </div>
              </div>
              <div className="h-64 mt-2">
                {rv0NsWeekly.length ? (
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                  >
                    <BarChart
                      data={rv0NsWeekly}
                      margin={{
                        left: 8,
                        right: 8,
                        top: 10,
                        bottom: 0,
                      }}
                    >
                      <defs>
                        <linearGradient
                          id="gradRv0Ns"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#ef4444"
                            stopOpacity={0.95}
                          />
                          <stop
                            offset="100%"
                            stopColor="#b91c1c"
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
                        allowDecimals={false}
                        tick={{
                          fill: COLORS.axis,
                          fontSize: 12,
                        }}
                      />
                      <Tooltip
                        content={
                          <ProTooltip
                            title="RV0 no-show"
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
                        name="RV0 no-show"
                        dataKey="count"
                        fill="url(#gradRv0Ns)"
                        radius={[8, 8, 0, 0]}
                        maxBarSize={44}
                        onClick={(d: any) => {
                          if (!d?.activeLabel) return;
                          const row =
                            rv0NsWeekly.find(
                              (x) =>
                                x.label ===
                                d.activeLabel
                            );
                          if (!row) return;
                          openAppointmentsDrill({
                            title: `RV0 no-show – semaine ${row.label}`,
                            type: "RV0",
                            status: "NO_SHOW",
                            from: row.weekStart.slice(
                              0,
                              10
                            ),
                            to: row.weekEnd.slice(
                              0,
                              10
                            ),
                          });
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-[--muted] text-sm">
                    Aucun no-show RV0 sur la période.
                  </div>
                )}
              </div>
              <div className="text-[11px] text-[--muted] mt-2">
                Compté sur la{" "}
                <b>date/heure du RDV</b> : chaque barre = lundi → dimanche.
              </div>
              
              {/* Annulés / reportés par jour — RV1 & RV2 */}
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(16,21,32,.55)] backdrop-blur-xl p-4 xl:col-span-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Annulés / reportés par jour (RV1 & RV2)</div>
                  <div className="text-xs text-[--muted]">
                    {(canceledDaily?.total ?? 0).toLocaleString("fr-FR")} au total
                  </div>
                </div>

                <div className="h-64 mt-2">
                  {canceledDaily?.byDay?.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={canceledDaily.byDay}
                        margin={{ left: 8, right: 8, top: 10, bottom: 0 }}
                      >
                        <defs>
                          {/* RV1 : annulé + reporté */}
                          <linearGradient id="gradRv1Status" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.95} />
                            <stop offset="100%" stopColor="#b45309" stopOpacity={0.75} />
                          </linearGradient>
                          {/* RV2 : annulé + reporté */}
                          <linearGradient id="gradRv2Status" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.95} />
                            <stop offset="100%" stopColor="#2563eb" stopOpacity={0.75} />
                          </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />

                        <XAxis
                          dataKey="day"
                          type="category"
                          tick={{ fill: COLORS.axis, fontSize: 12 }}
                          tickFormatter={(d: string) => {
                            const [y, m, dd] = d.split("-");
                            return `${dd}/${m}/${y}`;
                          }}
                        />

                        <YAxis allowDecimals={false} tick={{ fill: COLORS.axis, fontSize: 12 }} />

                        <Tooltip
                          content={
                            <ProTooltip
                              title="Annulés / reportés"
                              valueFormatters={{
                                rv1CanceledPostponed: (v) => fmtInt(v),
                                rv2CanceledPostponed: (v) => fmtInt(v),
                                total: (v) => fmtInt(v),
                              }}
                            />
                          }
                        />
                        <Legend wrapperStyle={{ color: "#fff", opacity: 0.8 }} />

                        {/* Deux barres côte à côte (pas de stackId) */}
                        <Bar
                          name="RV1 annulés + reportés"
                          dataKey="rv1CanceledPostponed"
                          fill="url(#gradRv1Status)"
                          radius={[8, 8, 0, 0]}
                          maxBarSize={40}
                        />
                        <Bar
                          name="RV2 annulés + reportés"
                          dataKey="rv2CanceledPostponed"
                          fill="url(#gradRv2Status)"
                          radius={[8, 8, 0, 0]}
                          maxBarSize={40}
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
                  Agrégation quotidienne dans le fuseau <b>{tz}</b> · chaque barre combine
                  <b> annulés + reportés</b> pour RV1 et RV2.
                </div>
              </div>

            </div>
          </div>

          {/* ===== Classements & Hall of Fame ===== */}
          <div className="relative mt-6">
            <div className="absolute inset-0 -z-10">
              <div
                className="pointer-events-none absolute -top-24 left-1/3 h-72 w-[60vw] rounded-full blur-3xl opacity-25"
                style={{
                  background:
                    "radial-gradient(60% 60% at 50% 50%, rgba(99,102,241,.35), rgba(14,165,233,.15), transparent 70%)",
                }}
              />
              <div
                className="pointer-events-none absolute -bottom-16 -left-20 h-60 w-96 rounded-full blur-3xl opacity-20"
                style={{
                  background:
                    "radial-gradient(50% 50% at 50% 50%, rgba(56,189,248,.35), rgba(59,130,246,.15), transparent 70%)",
                }}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Top Closer */}
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(18,24,38,.65)] backdrop-blur-xl p-4">
                <div className="absolute right-0 top-0 w-40 h-40 rounded-full bg-white/[0.04] blur-2xl" />
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-2xl bg-emerald-400/10 border border-emerald-400/25 flex items-center justify-center">
                    👑
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-emerald-300/80">
                      Hall of Fame
                    </div>
                    <div className="text-lg font-semibold">
                      Top Closer
                    </div>
                  </div>
                  <div className="ml-auto text-right text-xs text-[--muted]">
                    Taux closing
                  </div>
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  {sortedClosers[0] ? (
                    <div className="flex items-center gap-3">
                      <div className="text-2xl leading-none">
                        🥇
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {sortedClosers[0].name}
                        </div>
                        <div className="text-xs text-[--muted] truncate">
                          {sortedClosers[0].email}
                        </div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className="text-lg font-semibold">
                          {Math.round(
                            (sortedClosers[0]
                              .closingRate || 0) * 100
                          )}
                          %
                        </div>
                        <div className="text-[10px] text-[--muted]">
                          {sortedClosers[0].salesClosed} ventes •{" "}
                          {sortedClosers[0].rv1Honored} RV1 Fait
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-[--muted]">
                      — Aucune donnée
                    </div>
                  )}
                </div>
              </div>

              {/* Top Setter */}
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(18,24,38,.65)] backdrop-blur-xl p-4">
                <div className="absolute -right-10 -top-8 w-40 h-40 rounded-full bg-indigo-400/10 blur-2xl" />
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-2xl bg-indigo-400/10 border border-indigo-400/25 flex items-center justify-center">
                    ⚡
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-indigo-300/80">
                      Hall of Fame
                    </div>
                    <div className="text-lg font-semibold">
                      Top Setter
                    </div>
                  </div>
                  <div className="ml-auto text-right text-xs text-[--muted]">
                    RV1 & qualification
                  </div>
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  {sortedSetters[0] ? (
                    <div className="flex items-center gap-3">
                      <div className="text-2xl leading-none">
                        🥇
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {sortedSetters[0].name}
                        </div>
                        <div className="text-[10px] text-[--muted] truncate">
                          {sortedSetters[0].email}
                        </div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className="text-lg font-semibold">
                          {
                            sortedSetters[0]
                              .rv1PlannedOnHisLeads
                          }{" "}
                          RV1
                        </div>
                        <div className="text-[10px] text-[--muted]">
                          {Math.round(
                            (sortedSetters[0]
                              .qualificationRate || 0) *
                              100
                          )}
                          % qualif •{" "}
                          {sortedSetters[0]
                            .leadsReceived}{" "}
                          leads
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-[--muted]">
                      — Aucune donnée
                    </div>
                  )}
                </div>
              </div>

              {/* Top Duo */}
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(18,24,38,.65)] backdrop-blur-xl p-4">
                <div className="absolute right-0 bottom-0 w-40 h-40 rounded-full bg-amber-400/10 blur-2xl" />
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-2xl bg-amber-400/10 border border-amber-400/25 flex items-center justify-center">
                    💎
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-amber-300/80">
                      Hall of Fame
                    </div>
                    <div className="text-lg font-semibold">
                      Équipe de choc
                    </div>
                  </div>
                  <div className="ml-auto text-right text-xs text-[--muted]">
                    CA & Ventes
                  </div>
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  {duos?.[0] ? (
                    <div className="grid grid-cols-2 gap-3 items-center">
                      <div className="min-w-0">
                        <div className="text-xs text-[--muted]">
                          Setter
                        </div>
                        <div className="font-medium truncate">
                          {duos[0].setterName}
                        </div>
                        <div className="text-[10px] text-[--muted] truncate">
                          {duos[0].setterEmail}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-[--muted]">
                          Closer
                        </div>
                        <div className="font-medium truncate">
                          {duos[0].closerName}
                        </div>
                        <div className="text-[10px] text-[--muted] truncate">
                          {duos[0].closerEmail}
                        </div>
                      </div>
                      <div className="col-span-2 flex items-center justify-between">
                        <div className="text-lg font-semibold">
                          {fmtEUR(duos[0].revenue)}
                        </div>
                        <div className="text-[10px] text-[--muted]">
                          {duos[0].salesCount} ventes • RV1{" "}
                          {duos[0].rv1Honored}/
                          {duos[0].rv1Planned}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-[--muted]">
                      — Aucune donnée
                    </div>
                  )}
                </div>
              </div>
            </div>

           {/* Spotlight tables */}
        <div className="mt-6 grid grid-cols-1 gap-5">
          {/* Team Closers */}
          <div className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(45,212,191,.22),_transparent_55%),_rgba(18,24,38,.9)] backdrop-blur-xl overflow-hidden shadow-[0_18px_45px_rgba(0,0,0,.55)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-[--muted]">
                  👥 Team Closers
                </div>
                <div className="text-xs text-[--muted] mt-0.5">
                  Top 8 closers · vue synthétique : RV1 / RV2 · no-show · annulation · contrats · ventes
                </div>
              </div>
              <div className="hidden md:flex items-center gap-2 text-[10px] text-[--muted]">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400/70" /> KPI fort
                <span className="inline-flex h-2 w-2 rounded-full bg-amber-400/70" /> à surveiller
                <span className="inline-flex h-2 w-2 rounded-full bg-red-400/70" /> critique
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1500px]">
                <thead className="text-left text-[--muted] text-[11px] uppercase sticky top-0 bg-[rgba(10,16,28,.96)] backdrop-blur-md border-b border-white/10">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">Closer</th>

                    {/* RV1 */}
                    <th className="py-2.5 px-3 font-medium text-right">RV1 planifiés</th>
                    <th className="py-2.5 px-3 font-medium text-right">RV1 faits</th>
                    <th className="py-2.5 px-3 font-medium text-right">% RV1 faits / RV1 planifiés</th>
                    <th className="py-2.5 px-3 font-medium text-right">RV1 no-show</th>
                    <th className="py-2.5 px-3 font-medium text-right">RV1 annulés</th>
                    <th className="py-2.5 px-3 font-medium text-right">RV1 reportés</th>
                    <th className="py-2.5 px-3 font-medium text-right">Non qualifiés RV1</th>
                    <th className="py-2.5 px-3 font-medium text-right">% annulation RV1</th>
                    <th className="py-2.5 px-3 font-medium text-right">% no-show RV1</th>

                    {/* RV2 */}
                    <th className="py-2.5 px-3 font-medium text-right">RV2 planifiés</th>
                    <th className="py-2.5 px-3 font-medium text-right">RV2 faits</th>
                    <th className="py-2.5 px-3 font-medium text-right">% RV2 faits / RV2 planifiés</th>
                    <th className="py-2.5 px-3 font-medium text-right">No-show RV2</th>
                    <th className="py-2.5 px-3 font-medium text-right">RV2 annulés</th>
                    <th className="py-2.5 px-3 font-medium text-right">RV2 reportés</th>
                    <th className="py-2.5 px-3 font-medium text-right">% annulation RV2</th>
                    <th className="py-2.5 px-3 font-medium text-right">% no-show RV2</th>

                    {/* Contrats / ventes */}
                    <th className="py-2.5 px-3 font-medium text-right">Contrats signés</th>
                    <th className="py-2.5 px-3 font-medium text-right">Ventes</th>
                    <th className="py-2.5 px-3 font-medium text-right">CA</th>
                    <th className="py-2.5 px-3 font-medium text-right">Taux closing / RV1 planifiés</th>
                    <th className="py-2.5 px-3 font-medium text-right">Taux closing / RV1 faits</th>
                  </tr>
                </thead>

                <tbody>
                  {sortedClosers.slice(0, 8).map((c, i) => (
                    <tr
                      key={c.userId}
                      className="border-t border-white/5 odd:bg-white/[0.01] even:bg-transparent hover:bg-white/[0.06] transition-colors group"
                    >
                      {/* Closer + rang */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[11px] text-[--muted]">
                            {i < 3 ? ["🥇", "🥈", "🥉"][i] : `#${i + 1}`}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate text-[13px]">
                              {c.name || "—"}
                            </div>
                            <div className="text-[10px] text-[--muted] truncate">
                              {c.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* RV1 volumes */}
                      <td className={neutralKpiCell}>{c.rv1Planned ?? 0}</td>
                      <td className={neutralKpiCell}>{c.rv1Honored ?? 0}</td>

                      {/* % RV1 faits / planifiés */}
                      <td className="py-2.5 px-3">
                        <div className="flex justify-end">
                          <span className={positiveRateBadgeClass(c.rv1HonorRate)}>
                            {c.rv1HonorRate == null
                              ? "—"
                              : `${Math.round((c.rv1HonorRate || 0) * 100)}%`}
                          </span>
                        </div>
                      </td>

                      <td className={neutralKpiCell}>{c.rv1NoShow ?? 0}</td>
                      <td className={neutralKpiCell}>{c.rv1Canceled ?? 0}</td>
                      <td className={neutralKpiCell}>{c.rv1Postponed ?? 0}</td>
                      <td className={neutralKpiCell}>{c.rv1NotQualified ?? 0}</td>

                      {/* % annulation RV1 */}
                      <td className="py-2.5 px-3">
                        <div className="flex justify-end">
                          <span className={cancelRateBadgeClass(c.rv1CancelRate)}>
                            {c.rv1CancelRate == null
                              ? "—"
                              : `${Math.round((c.rv1CancelRate || 0) * 100)}%`}
                          </span>
                        </div>
                      </td>

                      {/* % no-show RV1 */}
                      <td className="py-2.5 px-3">
                        <div className="flex justify-end">
                          <span className={cancelRateBadgeClass(c.rv1NoShowRate)}>
                            {c.rv1NoShowRate == null
                              ? "—"
                              : `${Math.round((c.rv1NoShowRate || 0) * 100)}%`}
                          </span>
                        </div>
                      </td>

                      {/* RV2 volumes */}
                      <td className={neutralKpiCell}>{c.rv2Planned ?? 0}</td>
                      <td className={neutralKpiCell}>{c.rv2Honored ?? 0}</td>

                      {/* % RV2 faits / planifiés */}
                      <td className="py-2.5 px-3">
                        <div className="flex justify-end">
                          <span className={positiveRateBadgeClass(c.rv2HonorRate)}>
                            {c.rv2HonorRate == null
                              ? "—"
                              : `${Math.round((c.rv2HonorRate || 0) * 100)}%`}
                          </span>
                        </div>
                      </td>

                      <td className={neutralKpiCell}>{c.rv2NoShow ?? 0}</td>
                      <td className={neutralKpiCell}>{c.rv2Canceled ?? 0}</td>
                      <td className={neutralKpiCell}>{c.rv2Postponed ?? 0}</td>

                      {/* % annulation RV2 */}
                      <td className="py-2.5 px-3">
                        <div className="flex justify-end">
                          <span className={cancelRateBadgeClass(c.rv2CancelRate)}>
                            {c.rv2CancelRate == null
                              ? "—"
                              : `${Math.round((c.rv2CancelRate || 0) * 100)}%`}
                          </span>
                        </div>
                      </td>

                      {/* % no-show RV2 */}
                      <td className="py-2.5 px-3">
                        <div className="flex justify-end">
                          <span className={cancelRateBadgeClass(c.rv2NoShowRate)}>
                            {c.rv2NoShowRate == null
                              ? "—"
                              : `${Math.round((c.rv2NoShowRate || 0) * 100)}%`}
                          </span>
                        </div>
                      </td>

                      {/* Contrats / ventes / CA / closing */}
                      <td className={neutralKpiCell}>{c.contractsSigned ?? 0}</td>
                      <td className={neutralKpiCell}>{c.salesClosed ?? 0}</td>
                      <td className={neutralKpiCell}>
                        {(c.revenueTotal || 0).toLocaleString("fr-FR")} €
                      </td>

                      {/* Taux closing / RV1 planifiés */}
                      <td className="py-2.5 px-3">
                        <div className="flex justify-end">
                          <span className={positiveRateBadgeClass(c.closingOnRv1Planned)}>
                            {c.closingOnRv1Planned == null
                              ? "—"
                              : `${Math.round((c.closingOnRv1Planned || 0) * 100)}%`}
                          </span>
                        </div>
                      </td>

                      {/* Taux closing / RV1 faits */}
                      <td className="py-2.5 px-3">
                        <div className="flex justify-end">
                          <span className={positiveRateBadgeClass(c.closingRate)}>
                            {c.closingRate == null
                              ? "—"
                              : `${Math.round((c.closingRate || 0) * 100)}%`}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {!sortedClosers.length && (
                    <tr>
                      <td
                        className="py-6 px-3 text-[--muted] text-sm"
                        colSpan={24} 
                      >
                        Aucune donnée sur la période sélectionnée.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

            {/* Setters */}
            <div className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(129,140,248,.18),_transparent_55%),_rgba(18,24,38,.9)] backdrop-blur-xl overflow-hidden shadow-[0_18px_45px_rgba(0,0,0,.55)]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[--muted]">
                    ☎️ Team Setters
                  </div>
                 <div className="text-xs text-[--muted] mt-0.5">
                  Vue pipeline : leads → RV1 → ventes · vitesse, no-show & qualité de setting
                </div>
                </div>
                <div className="hidden md:flex items-center gap-2 text-[10px] text-[--muted]">
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400/70" /> TTFC bas
                  <span className="inline-flex h-2 w-2 rounded-full bg-sky-400/70" /> bon setting
                  <span className="inline-flex h-2 w-2 rounded-full bg-red-400/70" /> annulation / no-show forts
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[1280px]">
                  <thead className="text-left text-[--muted] text-[11px] uppercase sticky top-0 bg-[rgba(10,16,28,.96)] backdrop-blur-md border-b border-white/10">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Setter</th>
                      <th className="py-2.5 px-3 font-medium text-right">Demande d'appel</th>
                      <th className="py-2.5 px-3 font-medium text-right">RV1 planifiés</th>
                      <th className="py-2.5 px-3 font-medium text-right">RV1 faits</th>
                      <th className="py-2.5 px-3 font-medium text-right">% RV1 planifiés / demandes d’appel</th>
                      <th className="py-2.5 px-3 font-medium text-right">% RV1 faits / RV1 planifiés</th>
                      <th className="py-2.5 px-3 font-medium text-right">RV1 annulés</th>
                      <th className="py-2.5 px-3 font-medium text-right">RV1 no-show</th>
                      <th className="py-2.5 px-3 font-medium text-right">% annulation RV1</th>
                      <th className="py-2.5 px-3 font-medium text-right">% no-show RV1</th>
                      <th className="py-2.5 px-3 font-medium text-right">Ventes (ses leads)</th>
                      <th className="py-2.5 px-3 font-medium text-right">CA (ses leads)</th>
                      <th className="py-2.5 px-3 font-medium text-right">TTFC (min)</th>
                      <th className="py-2.5 px-3 font-medium text-right">Taux de setting</th>
                    </tr>
                  </thead>
                  <tbody>

                    {sortedSetters.slice(0, 8).map((s, i) => {
                      const rv1PlanVsCalls =
                        (s.leadsReceived || 0) > 0
                          ? (s.rv1PlannedOnHisLeads || 0) / (s.leadsReceived || 1)
                          : null;

                      const rv1DoneVsPlanned =
                        (s.rv1PlannedOnHisLeads || 0) > 0
                          ? (s.rv1DoneOnHisLeads || 0) / (s.rv1PlannedOnHisLeads || 1)
                          : null;

                      return (
                        <tr
                          key={s.userId}
                          className="border-t border-white/5 odd:bg-white/[0.01] even:bg-transparent hover:bg-white/[0.06] transition-colors group"
                        >
                          {/* Setter + rang */}
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[11px] text-[--muted]">
                                {i < 3 ? ["🥇", "🥈", "🥉"][i] : `#${i + 1}`}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium truncate text-[13px]">
                                  {s.name || "—"}
                                </div>
                                <div className="text-[10px] text-[--muted] truncate">
                                  {s.email}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Volumes bruts */}
                          <td className={neutralKpiCell}>{s.leadsReceived ?? 0}</td>
                          <td className={neutralKpiCell}>{s.rv1PlannedOnHisLeads ?? 0}</td>
                          <td className={neutralKpiCell}>{s.rv1DoneOnHisLeads ?? 0}</td>

                          {/* % RV1 planifiés / demandes d’appel */}
                          <td className="py-2.5 px-3">
                            <div className="flex justify-end">
                              <span className={positiveRateBadgeClass(rv1PlanVsCalls ?? undefined)}>
                                {rv1PlanVsCalls == null
                                  ? "—"
                                  : `${Math.round((rv1PlanVsCalls || 0) * 100)}%`}
                              </span>
                            </div>
                          </td>

                          {/* % RV1 faits / RV1 planifiés */}
                          <td className="py-2.5 px-3">
                            <div className="flex justify-end">
                              <span className={positiveRateBadgeClass(rv1DoneVsPlanned ?? undefined)}>
                                {rv1DoneVsPlanned == null
                                  ? "—"
                                  : `${Math.round((rv1DoneVsPlanned || 0) * 100)}%`}
                              </span>
                            </div>
                          </td>

                          {/* RV1 annulés / no-show (volumes) */}
                          <td className={neutralKpiCell}>{s.rv1CanceledOnHisLeads ?? 0}</td>
                          <td className={neutralKpiCell}>{s.rv1NoShowOnHisLeads ?? 0}</td>

                          {/* % annulation RV1 */}
                          <td className="py-2.5 px-3">
                            <div className="flex justify-end">
                              <span className={cancelRateBadgeClass(s.rv1CancelRateOnHisLeads ?? s.rv1CancelRate)}>
                                {s.rv1CancelRateOnHisLeads == null && s.rv1CancelRate == null
                                  ? "—"
                                  : `${Math.round(((s.rv1CancelRateOnHisLeads ?? s.rv1CancelRate) || 0) * 100)}%`}
                              </span>
                            </div>
                          </td>

                          {/* % no-show RV1 */}
                          <td className="py-2.5 px-3">
                            <div className="flex justify-end">
                              <span className={cancelRateBadgeClass(s.rv1NoShowRate)}>
                                {s.rv1NoShowRate == null
                                  ? "—"
                                  : `${Math.round((s.rv1NoShowRate || 0) * 100)}%`}
                              </span>
                            </div>
                          </td>

                          {/* Ventes & CA depuis ses leads */}
                          <td className={neutralKpiCell}>{s.salesFromHisLeads ?? 0}</td>
                          <td className={neutralKpiCell}>
                            {(s.revenueFromHisLeads || 0).toLocaleString("fr-FR")} €
                          </td>

                          {/* TTFC */}
                          <td className="py-2.5 px-3">
                            <div className="flex justify-end">
                              {s.ttfcAvgMinutes == null ? (
                                <span className="text-[11px] text-[--muted]">—</span>
                              ) : (
                                <span
                                  className={
                                    s.ttfcAvgMinutes <= 15
                                      ? "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-500/40"
                                      : s.ttfcAvgMinutes <= 45
                                      ? "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums bg-amber-500/20 text-amber-100 ring-1 ring-amber-500/40"
                                      : "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums bg-red-500/20 text-red-100 ring-1 ring-red-500/40"
                                  }
                                >
                                  {s.ttfcAvgMinutes} min
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Taux de setting global */}
                          <td className="py-2.5 px-3">
                            <div className="flex justify-end">
                              <span className={positiveRateBadgeClass(s.settingRate)}>
                                {s.settingRate == null
                                  ? "—"
                                  : `${Math.round((s.settingRate || 0) * 100)}%`}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {!sortedSetters.length && (
                      <tr>
                        <td className="py-6 px-3 text-[--muted] text-sm" colSpan={14}>
                          Aucune donnée setter sur la période sélectionnée.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

            {/* DUO STRIP */}
            {duos.length > 0 && (
              <div className="mt-5 rounded-3xl border border-white/10 bg-[rgba(13,18,29,.7)] backdrop-blur-xl overflow-hidden">
                <div className="px-4 py-2 text-xs uppercase tracking-wider border-b border-white/10 bg-[linear-gradient(90deg,rgba(251,191,36,.18),transparent)]">
                  💠 Équipe de choc — meilleurs duos
                </div>

                <div className="relative">
                  <div className="flex gap-3 p-3 overflow-x-auto snap-x">
                    {duos.map((d, i) => {
                      const medal =
                        i === 0
                          ? "🥇"
                          : i === 1
                          ? "🥈"
                          : i === 2
                          ? "🥉"
                          : "";
                      const tone =
                        i === 0
                          ? "border-emerald-400/30 bg-emerald-400/10"
                          : i === 1
                          ? "border-indigo-400/30 bg-indigo-400/10"
                          : i === 2
                          ? "border-amber-400/30 bg-amber-400/10"
                          : "border-white/10 bg-white/[0.04]";
                      return (
                        <div
                          key={
                            d.setterId +
                            "_" +
                            d.closerId
                          }
                          className={`snap-start shrink-0 min-w-[300px] rounded-2xl border ${tone} px-3 py-2`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-lg">
                              {medal || "💎"}
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">
                                {d.setterName} ×{" "}
                                {d.closerName}
                              </div>
                              <div className="text-[10px] text-[--muted] truncate">
                                {d.setterEmail} •{" "}
                                {d.closerEmail}
                              </div>
                            </div>
                            <div className="ml-auto text-right text-sm font-semibold">
                              {fmtEUR(d.revenue)}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-[--muted]">
                            <span className="px-1.5 py-0.5 rounded border border-white/10 bg-black/20">
                              {d.salesCount} ventes
                            </span>
                            <span className="px-1.5 py-0.5 rounded border border-white/10 bg-black/20">
                              RV1 {d.rv1Honored}/
                              {d.rv1Planned}
                            </span>
                            {d.rv1HonorRate != null && (
                              <span className="px-1.5 py-0.5 rounded border border-white/10 bg-black/20">
                                {d.rv1HonorRate}%
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="px-4 py-2 text-[10px] text-[--muted] border-t border-white/10">
                  Bandeau scrollable — passe ta
                  souris/ton doigt pour parcourir. Les données
                  sont calculées sur les <b>ÉLÈVES INSCRITS</b> de la
                  période.
                </div>
              </div>
            )}

            {/* ===== Exports Spotlight ===== */}
            <div className="card">
              <div className="text-sm font-medium mb-1">Exports Spotlight (Setters / Closers)</div>
              <div className="text-[12px] text-[--muted] mb-2">
                Télécharge les rapports détaillés avec analyse (PDF) ou les données brutes (CSV) pour la période sélectionnée.
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    const res = await api.get(`/reporting/export/spotlight-setters.pdf`, {
                      params: { from: fromISO, to: toISO, tz },
                      responseType: 'blob',
                    });
                    const url = URL.createObjectURL(res.data);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `spotlight_setters_${fromISO || 'from'}_${toISO || 'to'}.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  PDF Setters
                </button>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    const res = await api.get(`/reporting/export/spotlight-setters.csv`, {
                      params: { from: fromISO, to: toISO, tz },
                      responseType: 'blob',
                    });
                    const url = URL.createObjectURL(res.data);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `spotlight_setters_${fromISO || 'from'}_${toISO || 'to'}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  CSV Setters
                </button>

                <div className="w-px h-6 bg-white/10 mx-2" />

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    const res = await api.get(`/reporting/export/spotlight-closers.pdf`, {
                      params: { from: fromISO, to: toISO, tz },
                      responseType: 'blob',
                    });
                    const url = URL.createObjectURL(res.data);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `spotlight_closers_${fromISO || 'from'}_${toISO || 'to'}.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  PDF Closers
                </button>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    const res = await api.get(`/reporting/export/spotlight-closers.csv`, {
                      params: { from: fromISO, to: toISO, tz },
                      responseType: 'blob',
                    });
                    const url = URL.createObjectURL(res.data);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `spotlight_closers_${fromISO || 'from'}_${toISO || 'to'}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  CSV Closers
                </button>
              </div>
            </div>


            {/* Vues additionnelles */}
            {view === "exports" && (
              <div className="space-y-4">
                <div className="card">
                  <div className="text-sm text-[--muted] mb-2">
                    Exports PDF
                  </div>
                  <p className="text-sm text-[--muted]">
                    Télécharge les PDF “Setters” et
                    “Closers” pour la plage de dates choisie
                    ci-dessus.
                  </p>
                </div>
                <PdfExports
                  from={
                    typeof range.from === "string"
                      ? range.from
                      : range.from
                      ?.toISOString()
                      .slice(0, 10)
                  }
                  to={
                    typeof range.to === "string"
                      ? range.to
                      : range.to
                      ?.toISOString()
                      .slice(0, 10)
                  }
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== PANNEAU FILTRES ===== */}
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
                <div className="text-lg font-semibold">
                  Filtres
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setFiltersOpen(false)}
                >
                  Fermer
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="label">Période rapide</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="tab"
                      onClick={() => {
                        const d = new Date();
                        setDraftRange({ from: d, to: d });
                      }}
                    >
                      Aujourd’hui
                    </button>

                    <button
                      type="button"
                      className="tab"
                      onClick={() => {
                        const d = new Date();
                        const s = new Date();
                        s.setDate(d.getDate() - 6);
                        setDraftRange({ from: s, to: d });
                      }}
                    >
                      7 jours
                    </button>

                    <button
                      type="button"
                      className="tab"
                      onClick={() => {
                        const d = new Date();
                        const s = new Date();
                        s.setDate(d.getDate() - 29);
                        setDraftRange({ from: s, to: d });
                      }}
                    >
                      30 jours
                    </button>

                    <button
                      type="button"
                      className="tab"
                      onClick={() => {
                        const { from, to } = currentMonthRange();
                        setDraftRange({ from: asDate(from)!, to: asDate(to)! });
                      }}
                    >
                      Ce mois
                    </button>

                    {/* ✅ NOUVEAU : bouton "Max" */}
                    <button
                      type="button"
                      className="tab"
                      onClick={() => {
                        const today = new Date();
                        setDraftRange({
                          from: MAX_RANGE_START,
                          to: today,
                        });
                      }}
                    >
                      Max
                    </button>
                  </div>

                </div>

                <div>
                  <div className="label">
                    Période personnalisée
                  </div>
                  <DateRangePicker
                    value={draftRange}
                    onChange={(r) =>
                      setDraftRange({
                        from: asDate(r.from) ?? r.from,
                        to: asDate(r.to) ?? r.to,
                      })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={comparePrev}
                      onChange={(e) =>
                        setComparePrev(e.target.checked)
                      }
                    />
                    Comparer à la période précédente
                  </label>
                  <div className="text-xs text-[--muted]">
                    Clique <b>Appliquer</b> pour charger.
                  </div>
                </div>

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
                    onClick={() => {
                      setRange(draftRange);
                      setFiltersOpen(false);
                    }}
                  >
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


