"use client";
import { reportingApi } from "@/lib/reporting";
import * as React from "react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import api from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import DateRangePicker, { type Range } from "@/components/DateRangePicker";
import { currentMonthRange } from "@/lib/date";
import { motion, AnimatePresence } from "framer-motion";
// en haut du fichier

/* ================== Types alignés backend ================== */
type LeadStage =
  | "LEADS_RECEIVED"
  | "CALL_REQUESTED"
  | "CALL_ATTEMPT"
  | "CALL_ANSWERED"
  | "SETTER_NO_SHOW"
  | "FOLLOW_UP"
  | "FOLLOW_UP_CLOSER"
  | "RV0_PLANNED"
  | "RV0_HONORED"
  | "RV0_NO_SHOW"
  | "RV0_POSTPONED"
  | "RV0_CANCELED"
  | "RV1_PLANNED"
  | "RV1_HONORED"
  | "RV1_NO_SHOW"
  | "RV1_POSTPONED"
  | "RV1_CANCELED"
  | "RV2_PLANNED"
  | "RV2_HONORED"
  | "RV2_NO_SHOW"
  | "RV2_POSTPONED"
  | "RV2_CANCELED"
  | "RV0_NOT_QUALIFIED"
  | "RV1_NOT_QUALIFIED"
  | "NOT_QUALIFIED"
  | "LOST"
  | "CONTRACT_SIGNED"
  | "WON";

  // Stage côté DTO backend (create-prospect-event.dto.ts)
type StageDto =
  | "LEAD_RECU"
  | "DEMANDE_APPEL"
  | "APPEL_PASSE"
  | "APPEL_REPONDU"
  | "NO_SHOW_SETTER"
  | "RV0_PLANIFIE"
  | "RV0_HONORE"
  | "RV0_NO_SHOW"
  | "RV1_PLANIFIE"
  | "RV1_HONORE"
  | "RV1_NO_SHOW"
  | "RV2_PLANIFIE"
  | "RV2_HONORE"
  | "RV2_NO_SHOW"
  | "RV0_ANNULE"   
  | "RV1_ANNULE"   
  | "RV2_ANNULE"  
  | "WON"
  | "LOST"
  | "NOT_QUALIFIED";

// Mapping LeadStage (Prisma) -> StageDto (DTO backend)
const LEADSTAGE_TO_STAGEDTO: Partial<Record<LeadStage, StageDto>> = {
  LEADS_RECEIVED: "LEAD_RECU",
  CALL_REQUESTED: "DEMANDE_APPEL",
  CALL_ATTEMPT: "APPEL_PASSE",
  CALL_ANSWERED: "APPEL_REPONDU",
  SETTER_NO_SHOW: "NO_SHOW_SETTER",

  RV0_PLANNED: "RV0_PLANIFIE",
  RV0_HONORED: "RV0_HONORE",
  RV0_NO_SHOW: "RV0_NO_SHOW",
  RV0_CANCELED: "RV0_ANNULE",

  RV1_PLANNED: "RV1_PLANIFIE",
  RV1_HONORED: "RV1_HONORE",
  RV1_NO_SHOW: "RV1_NO_SHOW",
  RV1_CANCELED: "RV1_ANNULE",

  RV2_PLANNED: "RV2_PLANIFIE",
  RV2_HONORED: "RV2_HONORE",
  RV2_NO_SHOW: "RV2_NO_SHOW",

  RV2_CANCELED: "RV2_ANNULE",

  WON: "WON",
  LOST: "LOST",
  NOT_QUALIFIED: "NOT_QUALIFIED",
};

/** Config d’une colonne dynamique (sauvegardée côté backend) */
type ColumnConfig = {
  id: string;
  order: number;
  enabled: boolean;
  label: string;
  /** si défini → colonne mappée à un vrai stage DB (drag&drop met à jour lead.stage) */
  stage?: LeadStage | null; // sinon colonne “libre” (drag&drop écrit boardColumnKey)
};

type UserMini = { id: string; firstName: string; email: string };
type Lead = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  tag: string | null;
  source: string | null;
  opportunityValue: number | null;
  saleValue: number | null;
  stage: LeadStage;
  stageUpdatedAt: string;
  boardColumnKey?: string | null; // pour colonnes libres
  setter?: UserMini | null;
  closer?: UserMini | null;
};

type BoardColumn = {
  count: number;
  sumOpportunity: number;
  sumSales: number;
  items: Lead[];
};

type BoardResponse = {
  /** colonnes par vrais stages DB (pipeline) */
  columns: Record<LeadStage, BoardColumn>;
  /** optionnel : regroupement côté backend par colonnes libres */
  extraByColumnKey?: Record<string, Lead[]>;
};

/* ========= Drill modal ========= */
type DrillItem = {
  leadId: string;
  leadName: string;
  email?: string | null;
  phone?: string | null;
  setter?: { id: string; name: string; email: string } | null;
  closer?: { id: string; name: string; email: string } | null;
  saleValue?: number | null;
  opportunityValue?: number | null;
  stage?: string | null;
  createdAt?: string;
  stageUpdatedAt?: string;
};
function DrillModal({
  title, open, onClose, rows,
}: { title: string; open: boolean; onClose: () => void; rows: DrillItem[]; }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center">
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        className="w-full max-w-5xl max-h-[80vh] overflow-auto rounded-2xl border border-white/10 bg-[rgba(16,22,33,.98)] p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">{title}</div>
          <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="text-left text-[--muted] sticky top-0 bg-[rgba(16,22,33,.98)]">
              <tr>
                <th className="py-2 pr-2">Lead</th>
                <th className="py-2 pr-2">Contacts</th>
                <th className="py-2 pr-2">Setter</th>
                <th className="py-2 pr-2">Closer</th>
                <th className="py-2 pr-2">Stage</th>
                <th className="py-2 pr-2">Opportunité</th>
                <th className="py-2 pr-2">Vente</th>
                <th className="py-2 pr-2">Créé</th>
                <th className="py-2 pr-2">Maj stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((r) => (
                <tr key={r.leadId + Math.random()} className="border-t border-white/10">
                  <td className="py-2 pr-2">{r.leadName || "—"}</td>
                  <td className="py-2 pr-2 text-[--muted]">{r.email ?? "—"} • {r.phone ?? "—"}</td>
                  <td className="py-2 pr-2">{r.setter?.name ?? "—"}</td>
                  <td className="py-2 pr-2">{r.closer?.name ?? "—"}</td>
                  <td className="py-2 pr-2">{r.stage ?? "—"}</td>
                  <td className="py-2 pr-2">{Number.isFinite(r.opportunityValue as number) ? `${Math.round(Number(r.opportunityValue)).toLocaleString("fr-FR")} €` : "—"}</td>
                  <td className="py-2 pr-2">{Number.isFinite(r.saleValue as number) ? `${Math.round(Number(r.saleValue)).toLocaleString("fr-FR")} €` : "—"}</td>
                  <td className="py-2 pr-2 text-[--muted]">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                  <td className="py-2 pr-2 text-[--muted]">{r.stageUpdatedAt ? new Date(r.stageUpdatedAt).toLocaleString() : "—"}</td>
                </tr>
              )) : (
                <tr><td className="py-6 text-[--muted]" colSpan={9}>Aucune ligne</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

/* ================== Utils ================== */
const fmtInt = (n: number | null | undefined) =>
  Number.isFinite(n as number) ? Math.round(Number(n)).toLocaleString("fr-FR") : "0";
const fmtEUR = (n: number | null | undefined) =>
  Number.isFinite(n as number) ? `${Math.round(Number(n)).toLocaleString("fr-FR")} €` : "0 €";

function toISODate(d?: Date | string) {
  if (!d) return undefined;
  const dd = d instanceof Date ? d : new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ================== Couleurs stages (UI) ================== */
const STAGE_COLOR: Record<LeadStage, string> = {
  LEADS_RECEIVED: "from-blue-400/70 to-blue-300/30",
  CALL_REQUESTED: "from-violet-400/70 to-violet-300/30",
  CALL_ATTEMPT: "from-amber-400/70 to-amber-300/30",
  CALL_ANSWERED: "from-indigo-400/70 to-indigo-300/30",
  SETTER_NO_SHOW: "from-rose-400/70 to-rose-300/30",

  FOLLOW_UP: "from-teal-400/70 to-teal-300/30",
  FOLLOW_UP_CLOSER: "from-cyan-400/70 to-cyan-300/30",

  RV0_PLANNED: "from-sky-400/70 to-sky-300/30",
  RV0_HONORED: "from-emerald-400/70 to-emerald-300/30",
  RV0_NO_SHOW: "from-rose-400/70 to-rose-300/30",
  RV0_POSTPONED: "from-amber-400/70 to-amber-300/30",
  RV0_CANCELED: "from-rose-400/70 to-rose-300/30",

  RV1_PLANNED: "from-cyan-400/70 to-cyan-300/30",
  RV1_HONORED: "from-green-400/70 to-green-300/30",
  RV1_NO_SHOW: "from-rose-400/70 to-rose-300/30",
  RV1_POSTPONED: "from-amber-400/70 to-amber-300/30",
  RV1_CANCELED: "from-rose-400/70 to-rose-300/30",

  RV2_PLANNED: "from-sky-400/70 to-sky-300/30",
  RV2_HONORED: "from-green-400/70 to-green-300/30",
  RV2_NO_SHOW: "from-rose-400/70 to-rose-300/30",
  RV2_POSTPONED: "from-amber-400/70 to-amber-300/30",
  RV2_CANCELED: "from-rose-400/70 to-rose-300/30",

  RV0_NOT_QUALIFIED: "from-zinc-500/70 to-zinc-400/30",
  RV1_NOT_QUALIFIED: "from-zinc-500/70 to-zinc-400/30",

  NOT_QUALIFIED: "from-zinc-500/70 to-zinc-400/30",
  LOST: "from-red-500/80 to-red-400/40",
  CONTRACT_SIGNED: "from-amber-500/80 to-amber-400/40",
  WON: "from-emerald-500/80 to-emerald-400/40",
};

const STAGE_DOT: Record<LeadStage, string> = {
  LEADS_RECEIVED: "bg-blue-400",
  CALL_REQUESTED: "bg-violet-400",
  CALL_ATTEMPT: "bg-amber-400",
  CALL_ANSWERED: "bg-indigo-400",
  SETTER_NO_SHOW: "bg-rose-400",

  FOLLOW_UP: "bg-teal-400",
  FOLLOW_UP_CLOSER: "bg-cyan-400",

  RV0_PLANNED: "bg-sky-400",
  RV0_HONORED: "bg-emerald-400",
  RV0_NO_SHOW: "bg-rose-400",
  RV0_POSTPONED: "bg-amber-400",
  RV0_CANCELED: "bg-rose-400",

  RV1_PLANNED: "bg-cyan-400",
  RV1_HONORED: "bg-green-400",
  RV1_NO_SHOW: "bg-rose-400",
  RV1_POSTPONED: "bg-amber-400",
  RV1_CANCELED: "bg-rose-400",

  RV2_PLANNED: "bg-sky-400",
  RV2_HONORED: "bg-green-400",
  RV2_NO_SHOW: "bg-rose-400",
  RV2_POSTPONED: "bg-amber-400",
  RV2_CANCELED: "bg-rose-400",

  RV0_NOT_QUALIFIED: "bg-zinc-400",
  RV1_NOT_QUALIFIED: "bg-zinc-400",

  NOT_QUALIFIED: "bg-zinc-400",
  LOST: "bg-red-500",
  CONTRACT_SIGNED: "bg-amber-500",
  WON: "bg-emerald-500",
};

/* ========= Mapping stage → type d’événement à compter ========= */
/* Actuellement non utilisé dans ce fichier, on le laisse en Partial pour ne pas casser le typage. */
const STAGE_TO_EVENT: Partial<Record<LeadStage, string>> = {
  LEADS_RECEIVED: "LEAD_CREATED",
  CALL_REQUESTED: "CALL_REQUESTED",
  CALL_ATTEMPT: "CALL_ATTEMPT",
  CALL_ANSWERED: "CALL_ANSWERED",
  SETTER_NO_SHOW: "SETTER_NO_SHOW",
  FOLLOW_UP: "FOLLOW_UP",

  RV0_PLANNED: "APPOINTMENT_PLANNED_RV0",
  RV0_HONORED: "APPOINTMENT_HONORED_RV0",
  RV0_NO_SHOW: "APPOINTMENT_NOSHOW_RV0",
  RV0_CANCELED: "APPOINTMENT_CANCELED_RV0",

  RV1_PLANNED: "APPOINTMENT_PLANNED_RV1",
  RV1_HONORED: "APPOINTMENT_HONORED_RV1",
  RV1_NO_SHOW: "APPOINTMENT_NOSHOW_RV1",
  RV1_POSTPONED: "APPOINTMENT_POSTPONED_RV1",
  RV1_CANCELED: "APPOINTMENT_CANCELED_RV1",

  RV2_PLANNED: "APPOINTMENT_PLANNED_RV2",
  RV2_HONORED: "APPOINTMENT_HONORED_RV2",
  RV2_NO_SHOW: "APPOINTMENT_NOSHOW_RV2",
  RV2_POSTPONED: "APPOINTMENT_POSTPONED_RV2",
  RV2_CANCELED: "APPOINTMENT_CANCELED_RV2",

  NOT_QUALIFIED: "NOT_QUALIFIED",
  LOST: "LOST",
  WON: "WON",
  // Tu pourras compléter pour FOLLOW_UP_CLOSER / CONTRACT_SIGNED si tu crées des events dédiés côté backend.
};

/* ================== Colonnes par défaut (sans compteurs) ================== */
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "c_leads_rcv",  order: 0,  enabled: true,  label: "Leads reçus",              stage: "LEADS_RECEIVED" },
  { id: "c_call_req",   order: 1,  enabled: true,  label: "Demandes d’appel",         stage: "CALL_REQUESTED" },
  { id: "c_call_att",   order: 2,  enabled: true,  label: "Appels passés",            stage: "CALL_ATTEMPT" },
  { id: "c_call_ans",   order: 3,  enabled: true,  label: "Appels répondus",          stage: "CALL_ANSWERED" },
  { id: "c_ns_setter",  order: 4,  enabled: true,  label: "No-show Setter",           stage: "SETTER_NO_SHOW" },
  { id: "c_followup",   order: 5,  enabled: true,  label: "Follow Up (Setter/RV0)",   stage: "FOLLOW_UP" },
  { id: "c_followup_cl",order: 6,  enabled: true,  label: "Follow Up Closer",         stage: "FOLLOW_UP_CLOSER" },

  // RV0
  { id: "c_rv0_p",      order: 10, enabled: true,  label: "RV0 planifiés",            stage: "RV0_PLANNED" },
  { id: "c_rv0_h",      order: 11, enabled: true,  label: "RV0 honorés",              stage: "RV0_HONORED" },
  { id: "c_rv0_ns",     order: 12, enabled: true,  label: "RV0 no-show",              stage: "RV0_NO_SHOW" },
  { id: "c_rv0_post",   order: 13, enabled: false, label: "RV0 reportés",             stage: "RV0_POSTPONED" },
  { id: "c_rv0_can",    order: 14, enabled: false, label: "RV0 annulés",              stage: "RV0_CANCELED" },
  { id: "c_rv0_notq",   order: 15, enabled: false, label: "RV0 non qualifiés",        stage: "RV0_NOT_QUALIFIED" },

  // RV1
  { id: "c_rv1_p",      order: 20, enabled: true,  label: "RV1 planifiés",            stage: "RV1_PLANNED" },
  { id: "c_rv1_h",      order: 21, enabled: true,  label: "RV1 honorés",              stage: "RV1_HONORED" },
  { id: "c_rv1_ns",     order: 22, enabled: true,  label: "RV1 no-show",              stage: "RV1_NO_SHOW" },
  { id: "c_rv1_post",   order: 23, enabled: false, label: "RV1 reportés",             stage: "RV1_POSTPONED" },
  { id: "c_rv1_can",    order: 24, enabled: true,  label: "RV1 annulés",              stage: "RV1_CANCELED" },
  { id: "c_rv1_notq",   order: 25, enabled: false, label: "RV1 non qualifiés",        stage: "RV1_NOT_QUALIFIED" },

  // RV2
  { id: "c_rv2_p",      order: 30, enabled: false, label: "RV2 planifiés",            stage: "RV2_PLANNED" },
  { id: "c_rv2_h",      order: 31, enabled: false, label: "RV2 honorés",              stage: "RV2_HONORED" },
  { id: "c_rv2_ns",     order: 32, enabled: false, label: "RV2 no-show",              stage: "RV2_NO_SHOW" },
  { id: "c_rv2_post",   order: 33, enabled: false, label: "RV2 reportés",             stage: "RV2_POSTPONED" },
  { id: "c_rv2_can",    order: 34, enabled: false, label: "RV2 annulés",              stage: "RV2_CANCELED" },

  // Sorties & statuts finaux
  { id: "c_rv_notq",    order: 80, enabled: false, label: "Non qualifiés RV0/RV1",    stage: "NOT_QUALIFIED" },
  { id: "c_notq",       order: 81, enabled: true,  label: "Non qualifiés (global)",   stage: "NOT_QUALIFIED" },
  { id: "c_lost",       order: 90, enabled: true,  label: "Perdus",                   stage: "LOST" },
  { id: "c_contract",   order: 95, enabled: false, label: "Contrat signé",            stage: "CONTRACT_SIGNED" },
  { id: "c_won",        order: 99, enabled: true,  label: "Ventes (WON)",             stage: "WON" },
];

const RDV_ANNULES_COLUMN: ColumnConfig = {
  id: "c_rdv_annules",
  order: 24,
  enabled: true,
  label: "RDV annulés",
  stage: null, // colonne libre
};

/* ================== Page ================== */
export default function ProspectsPage() {
  // Période appliquée (Dates) — OK pour DateRangePicker
  const { from: defaultFrom, to: defaultTo } = useMemo(() => currentMonthRange(), []);
  const [range, setRange] = useState<Range>({ from: defaultFrom, to: defaultTo });

  // Strings ISO envoyées à l’API
  const fromISO = toISODate(range.from);
  const toISO = toISODate(range.to);

  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // autour des autres useState (par ex. après const [err, setErr] = useState<string | null>(null);)
  const [cancelTotals, setCancelTotals] = useState<{ rv0: number; rv1: number; rv2: number; all: number }>({
    rv0: 0, rv1: 0, rv2: 0, all: 0
  });

  // Gestion colonnes (brouillon)
  const [manageOpen, setManageOpen] = useState(false);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [manageDraft, setManageDraft] = useState<ColumnConfig[] | null>(null);
  const openManage = () => {
    const snap = columns.slice().sort((a, b) => a.order - b.order);
    setManageDraft(snap);
    setManageOpen(true);
  };
  const cancelManage = () => { setManageOpen(false); setManageDraft(null); };
  const saveManage = async () => {
    if (!manageDraft) return;
    const normalized = manageDraft.slice().map((x, i) => ({ ...x, order: i }));
    await saveColumnsConfig(normalized);
    setManageOpen(false);
    setManageDraft(null);
  };

  // Drag & Drop (leads)
  const [dragLead, setDragLead] = useState<Lead | null>(null);

  // Modale WON
  const [askWon, setAskWon] = useState<{ open: boolean; lead: Lead | null }>({ open: false, lead: null });
  const [wonValue, setWonValue] = useState<string>("");

  // Modale EDIT
  const [editOpen, setEditOpen] = useState(false);
  const [editLeadId, setEditLeadId] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [actors, setActors] = useState<{ setters: UserMini[]; closers: UserMini[] }>({ setters: [], closers: [] });

  // Form EDIT state
  const [fFirst, setFFirst] = useState("");
  const [fLast, setFLast] = useState<string>("");
  const [fEmail, setFEmail] = useState<string>("");
  const [fPhone, setFPhone] = useState<string>("");
  const [fTag, setFTag] = useState<string>("");
  const [fOppo, setFOppo] = useState<string>("");
  const [fSetter, setFSetter] = useState<string>("");
  const [fCloser, setFCloser] = useState<string>("");

  // Import CSV
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  // Création lead
  const [newOpen, setNewOpen] = useState(false);
  const [newData, setNewData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    tag: "",
    opportunityValue: "",
    setterId: "",
    closerId: "",
  });

  // ====== Filtres appliqués ======
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("__ALL__");
  const [sourceFilter, setSourceFilter] = useState<string>("__ALL__");

  // ====== Brouillons de filtres (n’appliquent rien tant qu’on ne clique pas) ======
  const [qDraft, setQDraft] = useState("");
  const [tagDraft, setTagDraft] = useState<string>("__ALL__");
  const [sourceDraft, setSourceDraft] = useState<string>("__ALL__");
  const [rangeDraft, setRangeDraft] = useState<Range>({ from: defaultFrom, to: defaultTo });

  const openFilters = () => {
    setQDraft(q);
    setTagDraft(tagFilter);
    setSourceDraft(sourceFilter);
    setRangeDraft({ from: range.from, to: range.to });
    setFiltersOpen(true);
  };
  const applyFilters = () => {
    setQ(qDraft);
    setTagFilter(tagDraft);
    setSourceFilter(sourceDraft);
    setRange({ from: rangeDraft.from, to: rangeDraft.to });
    setFiltersOpen(false);
  };

  // Prefs affichage
  const [density] = useState<"S" | "M" | "L">("S");
  const [colWidth] = useState<number>(320);
  const cardPad = density === "S" ? "p-2" : density === "M" ? "p-3" : "p-4";
  const titleSize = density === "S" ? "text-sm" : density === "M" ? "text-base" : "text-lg";
  const infoSize = density === "S" ? "text-2xs" : "text-xs";

  // ====== Scroll horizontal ======
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const updateScrollState = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft;
    const p = max > 0 ? left / max : 0;
    setScrollProgress(Math.max(0, Math.min(1, p)));
  };
  const nudge = (dir: "left" | "right") => {
    const el = scrollerRef.current;
    if (!el) return;
    const delta = Math.round(el.clientWidth * 0.85);
    el.scrollTo({ left: el.scrollLeft + (dir === "right" ? delta : -delta), behavior: "smooth" });
  };
  useEffect(() => { updateScrollState(); }, [columns, colWidth]);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => updateScrollState();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  /* ================== Data fetch ================== */
  async function loadBoard() {
    const res = await api.get<BoardResponse>("/prospects/board", { params: { from: fromISO, to: toISO, limit: 200 } });
    setBoard(res.data ?? { columns: {} as any });
  }
  async function loadColumnsConfig() {
  try {
    const res = await api.get<{ ok: true; columns: ColumnConfig[] }>("/prospects/columns-config");
    let rows = (res.data?.columns || []).slice();

    // 🔹 On ajoute la colonne RDV annulés si elle n'existe pas déjà en BDD
    const hasRdvAnnules = rows.some(c => c.id === RDV_ANNULES_COLUMN.id);
    if (!hasRdvAnnules) {
      rows.push(RDV_ANNULES_COLUMN);
    }

    // Tri + normalisation des order
    rows = rows
      .sort((a, b) => a.order - b.order)
      .map((c, idx) => ({ ...c, order: idx }));

    setColumns(rows.length ? rows : [...DEFAULT_COLUMNS, RDV_ANNULES_COLUMN]);
  } catch {
    // Si l'API plante, on retombe sur les colonnes par défaut + RDV annulés
    setColumns([...DEFAULT_COLUMNS, RDV_ANNULES_COLUMN]);
  }
}

  async function saveColumnsConfig(next: ColumnConfig[]) {
    const payload = next.map((c, idx) => ({
      id: c.id,
      order: idx,
      enabled: c.enabled,
      label: c.label,
      stage: c.stage ?? null,
    }));
    await api.put("/prospects/columns-config", payload);
    await loadColumnsConfig();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadBoard(), loadColumnsConfig()]);
      } catch (e: any) {
        if (!cancelled) setErr(e?.response?.data?.message || "Erreur de chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromISO, toISO]);

  useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const [rv0, rv1, rv2] = await Promise.all([
        reportingApi.stageSeries("RV0_CANCELED", fromISO, toISO, tz),
        reportingApi.stageSeries("RV1_CANCELED", fromISO, toISO, tz),
        reportingApi.stageSeries("RV2_CANCELED", fromISO, toISO, tz),
      ]);
      if (!cancelled) {
        const v0 = rv0?.total ?? 0;
        const v1 = rv1?.total ?? 0;
        const v2 = rv2?.total ?? 0;
        setCancelTotals({ rv0: v0, rv1: v1, rv2: v2, all: v0 + v1 + v2 });
      }
    } catch {
      if (!cancelled) setCancelTotals({ rv0: 0, rv1: 0, rv2: 0, all: 0 });
    }
  })();
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [fromISO, toISO]);

  /* ================== (FIX) traçage d’incrément sans bruit console ================== */
    const stageEventsSupportedRef = useRef<boolean>(true);

    async function trackStageIncrement(leadId: string, stage: LeadStage) {
      if (!stageEventsSupportedRef.current) return;

      const stageDto = LEADSTAGE_TO_STAGEDTO[stage];
      if (!stageDto) {
        // Pas de mapping → on ne trace rien pour ce stage
        return;
      }

      try {
        await api.post(`/prospects/${leadId}/events`, {
          type: "STAGE_ENTERED",                // conforme à CreateProspectEventDto
          stage: stageDto,                      // enum StageDto côté backend
          occurredAt: new Date().toISOString(), // optionnel, sinon "now" côté back
        });
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 404 || status === 405) {
          // Si jamais la route n’existait pas dans une autre version,
          // on coupe le tracking pour éviter de spammer.
          stageEventsSupportedRef.current = false;
        }
        // Autres erreurs : on ignore pour ne pas casser le drag&drop
      }
    }


  /* ================== Drag & Drop leads ================== */
  function onDragStart(lead: Lead) { setDragLead(lead); }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }

  async function moveToColumn(target: ColumnConfig) {
    if (!dragLead) return;

    // Colonne mappée → changer le vrai stage
    if (target.stage) {
      if (target.stage === "WON") {
        try {
          await api.patch(`/prospects/${dragLead.id}/stage`, { stage: "WON" });
          await loadBoard();
        } catch (e: any) {
          const code = e?.response?.data?.code;
          if (code === "SALE_VALUE_REQUIRED") {
            setWonValue(dragLead.opportunityValue != null ? String(dragLead.opportunityValue) : "");
            setAskWon({ open: true, lead: dragLead });
          } else {
            setErr(e?.response?.data?.message || "Impossible de changer de colonne");
          }
        } finally {
          setDragLead(null);
        }
        return;
      }
      try {
        await api.patch(`/prospects/${dragLead.id}/stage`, { stage: target.stage });
        await loadBoard();
      } catch (e: any) {
        setErr(e?.response?.data?.message || "Impossible de changer de colonne");
      } finally {
        setDragLead(null);
      }
      return;
    }

    // Colonne libre → enregistre la clé visuelle (si ton backend expose cet endpoint)
    try {
      await api.patch(`/prospects/${dragLead.id}/board-column`, { columnKey: target.id });
      await loadBoard();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Impossible de déplacer vers cette colonne");
    } finally {
      setDragLead(null);
    }
  }

  /* ================== WON modal actions ================== */
  async function confirmWonSame() {
    if (!askWon.lead) return;
    try {
      await api.patch(`/prospects/${askWon.lead.id}/stage`, { stage: "WON", confirmSame: true });
      // (plus d'appel trackStageIncrement ici)
      setAskWon({ open: false, lead: null });
      await loadBoard();


    } catch (e: any) {
      setErr(e?.response?.data?.message || "Erreur validation WON");
    }
  }
  async function confirmWonWithValue() {
    if (!askWon.lead) return;
    const v = Number(wonValue);
    if (Number.isNaN(v) || v < 0) return setErr("Valeur de vente invalide");
    try {
      await api.patch(`/prospects/${askWon.lead.id}/stage`, { stage: "WON", saleValue: v });
      // (plus d'appel trackStageIncrement ici)
      setAskWon({ open: false, lead: null });
      await loadBoard();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Erreur validation WON");
    }
  }

  /* ================== Suppression ================== */
  async function deleteLead(id: string) {
    if (!confirm("Supprimer définitivement ce lead ?")) return;
    try {
      await api.delete(`/prospects/${id}`);
      await loadBoard();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Suppression impossible");
    }
  }

  /* ================== Edition fiche / création ================== */
  async function openEdit(leadId: string) {
    setEditLeadId(leadId);
    setEditLoading(true);
    setEditOpen(true);
    // charge setters/closers aussi pour la modale d’édition
    loadActors().catch(() => { /* noop */ });
    try {
      const res = await api.get<Lead>(`/prospects/${leadId}`);
      const L = res.data;
      setFFirst(L.firstName || "");
      setFLast(L.lastName || "");
      setFEmail(L.email || "");
      setFPhone(L.phone || "");
      setFTag(L.tag || "");
      setFOppo(L.opportunityValue != null ? String(L.opportunityValue) : "");
      setFSetter(L.setter?.id || "");
      setFCloser(L.closer?.id || "");
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Impossible de charger la fiche");
      setEditOpen(false);
    } finally {
      setEditLoading(false);
    }
  }

  async function saveEdit() {
    if (!editLeadId) return;
    const payload: any = {
      firstName: fFirst || "Unknown",
      lastName: fLast || null,
      email: fEmail || null,
      phone: fPhone || null,
      tag: fTag || null,
      opportunityValue: fOppo === "" ? null : Number(fOppo),
      setterId: fSetter || null,
      closerId: fCloser || null,
    };
    if (payload.opportunityValue != null && (Number.isNaN(payload.opportunityValue) || payload.opportunityValue < 0)) {
      return setErr("Valeur d’opportunité invalide");
    }
    try {
      await api.patch(`/prospects/${editLeadId}`, payload);
      setEditOpen(false);
      await loadBoard();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Échec de la mise à jour");
    }
  }

  const openNew = useCallback(() => {
    setNewData({ firstName: "", lastName: "", email: "", phone: "", tag: "", opportunityValue: "", setterId: "", closerId: "" });
    setNewOpen(true);
    loadActors();
  }, []);
  async function loadActors() {
    try {
      const res = await api.get<{ setters: UserMini[]; closers: UserMini[] }>("/prospects/actors");
      setActors(res.data || { setters: [], closers: [] });
    } catch {/* noop */}
  }
  async function createLead() {
    const oppo = newData.opportunityValue === "" ? null : Number(newData.opportunityValue);
    if (oppo != null && (Number.isNaN(oppo) || oppo < 0)) {
      return setErr("Valeur d’opportunité invalide");
    }
    try {
      await api.post("/prospects", {
        firstName: newData.firstName || "Unknown",
        lastName: newData.lastName || null,
        email: newData.email || null,
        phone: newData.phone || null,
        tag: newData.tag || null,
        opportunityValue: oppo,
        setterId: newData.setterId || null,
        closerId: newData.closerId || null,
        source: "MANUAL",
        stage: "LEADS_RECEIVED",
      });
      setNewOpen(false);
      await loadBoard();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Impossible de créer le prospect");
    }
  }

  /* ================== Filtres & dérivés ================== */
  const normalize = (s?: string | null) => (s ?? "").trim();
  const normLower = (s?: string | null) => normalize(s).toLowerCase();

  const allStageItems = useMemo(() => {
    const cols = board?.columns;
    if (!cols) return [] as Lead[];
    const enabledCols = columns.filter((c) => c.enabled);
    const mapped = enabledCols.filter(c => c.stage).flatMap(c => cols[c.stage as LeadStage]?.items ?? []);
    const byKey = enabledCols.filter(c => !c.stage && board?.extraByColumnKey?.[c.id]).flatMap(c => board!.extraByColumnKey![c.id]);
    return [...mapped, ...byKey];
  }, [board, columns]);

  // Options filtres SANS doublons, triées (FR)
  const tagOptions = useMemo(() => {
    const vals = allStageItems.map(i => normalize(i.tag)).filter(Boolean);
    const uniq = Array.from(new Map(vals.map(v => [v.toLowerCase(), v])).values());
    return ["__ALL__", ...uniq.sort((a, b) => a.localeCompare(b, "fr"))];
  }, [allStageItems]);

  const sourceOptions = useMemo(() => {
    const vals = allStageItems.map(i => normalize(i.source)).filter(Boolean);
    const uniq = Array.from(new Map(vals.map(v => [v.toLowerCase(), v])).values());
    return ["__ALL__", ...uniq.sort((a, b) => a.localeCompare(b, "fr"))];
  }, [allStageItems]);

  const matchFilter = (lead: Lead) => {
    const ql = normLower(q);
    const okQ =
      !ql ||
      normLower(lead.firstName).includes(ql) ||
      normLower(lead.lastName).includes(ql) ||
      normLower(lead.email).includes(ql) ||
      normLower(lead.phone).includes(ql);
    const okTag = tagFilter === "__ALL__" || normalize(lead.tag) === tagFilter;
    const okSrc = sourceFilter === "__ALL__" || normalize(lead.source) === sourceFilter;
    return okQ && okTag && okSrc;
  };

  const kpi = useMemo(() => {
    const cols = board?.columns;
    const enabled = columns.filter((c) => c.enabled);
    if (!cols || !enabled.length) return { leads: 0, oppo: 0, sales: 0, wonCount: 0, conv: 0 };

    const mapped = enabled.filter((c) => c.stage) as Array<ColumnConfig & { stage: LeadStage }>;
    const leads = mapped.reduce((s, c) => s + (cols[c.stage]?.count ?? 0), 0);
    const oppo = mapped.reduce((s, c) => s + (cols[c.stage]?.sumOpportunity ?? 0), 0);
    const sales = cols.WON?.sumSales ?? 0;
    const wonCount = cols.WON?.count ?? 0;
    const conv = leads ? (wonCount / leads) * 100 : 0;
    return { leads, oppo, sales, wonCount, conv: Math.round(conv * 10) / 10 };
  }, [board, columns]);

  /* =============== DRILL =============== */
const [drillOpen, setDrillOpen] = useState(false);
const [drillTitle, setDrillTitle] = useState("");
const [drillRows, setDrillRows] = useState<DrillItem[]>([]);

async function openDrillLeadsReceived() {
  const res = await api.get("/reporting/drill/leads-received", {
    params: { from: fromISO, to: toISO, limit: 2000 },
  });
  const items: DrillItem[] = (res.data?.items || []).map((it: any) => ({
    leadId: it.leadId,
    leadName: it.leadName,
    email: it.email,
    phone: it.phone,
    setter: it.setter,
    closer: it.closer,
    stage: it.stageLabel || it.stageEnum || null,
    createdAt: it.createdAt,
    stageUpdatedAt: it.stageUpdatedAt,
    opportunityValue: it.opportunityValue ?? null,
    saleValue: it.saleValue ?? null,
  }));
  setDrillTitle("Leads reçus – détail");
  setDrillRows(items);
  setDrillOpen(true);
}

async function openDrillWon() {
  const res = await api.get("/reporting/drill/won", {
    params: { from: fromISO, to: toISO, limit: 2000 },
  });
  const items: DrillItem[] = (res.data?.items || []).map((it: any) => ({
    leadId: it.leadId,
    leadName: it.leadName,
    email: it.email,
    phone: it.phone,
    setter: it.setter,
    closer: it.closer,
    stage: it.stageLabel || it.stageEnum || null,
    createdAt: it.createdAt,
    stageUpdatedAt: it.stageUpdatedAt,
    saleValue: it.saleValue ?? null,
  }));
  setDrillTitle("Ventes (WON) – détail");
  setDrillRows(items);
  setDrillOpen(true);
}

function openDrillOpportunitiesFromBoard() {
  const items: DrillItem[] = allStageItems
    .filter(matchFilter)
    .map((L) => ({
      leadId: L.id,
      leadName: [L.firstName, L.lastName].filter(Boolean).join(" ") || "—",
      email: L.email,
      phone: L.phone,
      setter: L.setter ? { id: L.setter.id, name: L.setter.firstName, email: L.setter.email } : null,
      closer: L.closer ? { id: L.closer.id, name: L.closer.firstName, email: L.closer.email } : null,
      stage: L.stage,
      opportunityValue: L.opportunityValue ?? null,
      saleValue: L.saleValue ?? null,
      createdAt: undefined,
      stageUpdatedAt: L.stageUpdatedAt,
    }))
    .sort((a, b) => (b.opportunityValue ?? 0) - (a.opportunityValue ?? 0));
  setDrillTitle("Opportunités – détail (toutes colonnes visibles)");
  setDrillRows(items);
  setDrillOpen(true);
}

function openDrillColumn(col: ColumnConfig, items: Lead[]) {
  const rows: DrillItem[] = (items || [])
    .filter(matchFilter)
    .map((L) => ({
      leadId: L.id,
      leadName: [L.firstName, L.lastName].filter(Boolean).join(" ") || "—",
      email: L.email,
      phone: L.phone,
      setter: L.setter ? { id: L.setter.id, name: L.setter.firstName, email: L.setter.email } : null,
      closer: L.closer ? { id: L.closer.id, name: L.closer.firstName, email: L.closer.email } : null,
      stage: L.stage,
      opportunityValue: L.opportunityValue ?? null,
      saleValue: L.saleValue ?? null,
      createdAt: undefined,
      stageUpdatedAt: L.stageUpdatedAt,
    }));
  setDrillTitle(`${col.label} — détail`);
  setDrillRows(rows);
  setDrillOpen(true);
}


  // Badge filtres appliqués (compte période si ≠ période par défaut)
  const filtersAppliedCount =
    (q ? 1 : 0) +
    (tagFilter !== "__ALL__" ? 1 : 0) +
    (sourceFilter !== "__ALL__" ? 1 : 0) +
    ((toISODate(defaultFrom) !== fromISO || toISODate(defaultTo) !== toISO) ? 1 : 0);

  /* ================== UI helpers ================== */
  const scrollerStyle = { gridAutoColumns: `minmax(${colWidth}px, ${colWidth}px)` };

  /* ================== Render ================== */
  return (
    <div className="h-[100dvh] w-full">
      <div className="h-full flex">
        <Sidebar />

        <div className="flex-1 min-w-0 flex flex-col relative">
          {/* Toolbar */}
          <div className="px-4 pt-4 relative z-[60]">
            <div className="rounded-2xl border border-white/10 bg-[rgba(12,17,26,.7)] backdrop-blur px-4 py-3">
              <div className="flex items-center flex-wrap gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(true)}>
                  Importer CSV
                </button>
                <button className="btn btn-primary" onClick={() => { setNewOpen(true); loadActors(); }}>+ Nouveau prospect</button>

                <div className="grow" />

                <button className="btn btn-ghost" onClick={openFilters}>
                  Filtres
                  {filtersAppliedCount > 0 && (
                    <span className="ml-2 text-2xs px-1.5 py-0.5 rounded bg-white/20">
                      {filtersAppliedCount}
                    </span>
                  )}
                </button>

                <button className="btn btn-ghost" onClick={openManage}>
                  Gérer les colonnes
                </button>
              </div>
            </div>
          </div>

          {/* KPI */}
          <div className="px-4 mt-4 relative z-[50]">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <button
                className="card text-left hover:bg-white/[0.08]"
                onClick={openDrillLeadsReceived}
                title="Voir la liste des leads créés sur la période"
              >
                <div className="text-xs uppercase tracking-wide text-[--muted]">Leads</div>
                <div className="mt-1 text-2xl font-semibold">{fmtInt(kpi.leads)}</div>
              </button>

              <button
                className="card text-left hover:bg-white/[0.08]"
                onClick={openDrillOpportunitiesFromBoard}
                title="Voir les opportunités (toutes colonnes visibles)"
              >
                <div className="text-xs uppercase tracking-wide text-[--muted]">Σ Opportunités</div>
                <div className="mt-1 text-2xl font-semibold">{fmtEUR(kpi.oppo)}</div>
              </button>

              <button
                className="card text-left hover:bg-white/[0.08]"
                onClick={openDrillWon}
                title="Voir la liste des ventes (WON) sur la période"
              >
                <div className="text-xs uppercase tracking-wide text-[--muted]">Σ CA (WON)</div>
                <div className="mt-1 text-2xl font-semibold">{fmtEUR(kpi.sales)}</div>
              </button>

              <button
                className="card text-left hover:bg-white/[0.08]"
                onClick={openDrillWon}
                title="Conversion = WON / Leads (ouvre la liste des WON)"
              >
                <div className="text-xs uppercase tracking-wide text-[--muted]">Conversion → WON</div>
                <div className="mt-1 text-2xl font-semibold">{kpi.conv}%</div>
              </button>
            </div>
          </div>

          {err && <div className="px-4 mt-2 text-sm text-red-400 relative z-[50]">{err}</div>}

          {/* ===== Board ===== */}
          <div className="flex-1 min-h-0 mt-4 px-4 pb-6 relative">
            <div className="relative h-full">
              {/* Flèches */}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[40] flex justify-between">
                <div className="pl-1 pt-1">
                  <button className="btn btn-ghost pointer-events-auto" onClick={() => nudge("left")} aria-label="Gauche">◀</button>
                </div>
                <div className="pr-1 pt-1">
                  <button className="btn btn-ghost pointer-events-auto" onClick={() => nudge("right")} aria-label="Droite">▶</button>
                </div>
              </div>

              <div ref={scrollerRef} className="h-full overflow-x-auto overflow-y-hidden pb-3" style={{ scrollBehavior: "smooth" }}>
                <div className="grid grid-flow-col gap-3" style={scrollerStyle}>
                  {columns.filter(c => c.enabled).sort((a,b)=>a.order-b.order).map((col) => {
                    const mappedStage = col.stage as LeadStage | undefined;

                    // Récup items : stage mappé → board.columns[stage], sinon → extraByColumnKey
                    // ...
                  let items: Lead[] = [];
                  if (mappedStage && board?.columns?.[mappedStage]) {
                    items = board.columns[mappedStage].items;
                  } else if (!mappedStage && board?.extraByColumnKey?.[col.id]) {
                    items = board.extraByColumnKey[col.id];
                  }
                  items = items.filter(matchFilter);

                  // --- compteur affiché ---
                  // par défaut: nombre d'items visibles
                  let count = items.length;

                  // si colonne "annulés" mappée à un stage, on affiche le total historique
                  if (mappedStage === "RV0_CANCELED") count = cancelTotals.rv0;
                  if (mappedStage === "RV1_CANCELED") count = cancelTotals.rv1;
                  if (mappedStage === "RV2_CANCELED") count = cancelTotals.rv2;

                  // si colonne libre "RDV annulés" (sans mapping), on affiche la somme des trois
                  if (!mappedStage && col.id === RDV_ANNULES_COLUMN.id) count = cancelTotals.all;

                  const sOppoNum = items.reduce((s, l) => s + (l.opportunityValue ?? 0), 0);
                  const sSalesNum = items.reduce((s, l) => s + (l.saleValue ?? 0), 0);
                  const sOppo = fmtEUR(sOppoNum);
                  const sSales = fmtEUR(sSalesNum);

                    return (
                      <div key={col.id} className="card min-h-[72vh] p-3"
                        onDragOver={(e)=>{ e.preventDefault(); }}
                        onDrop={() => moveToColumn(col)}
                      >
                        <div className="sticky top-0 -mx-3 px-3 py-2 bg-[rgba(16,22,33,.85)] backdrop-blur rounded-t-xl border-b border-white/10 z-[10]">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {mappedStage && <span className={`inline-block w-2.5 h-2.5 rounded-full ${STAGE_DOT[mappedStage]}`} />}
                              <div className={`font-medium ${titleSize}`}>{col.label}</div>
                            </div>

                            {/* Zone clic “metrics” colonne → ouvre la modale de détail */}
                            <button
                              className="text-xs text-[--muted] whitespace-nowrap hover:underline"
                              onClick={() => openDrillColumn(col, items)}
                              title="Voir le détail des leads de cette colonne"
                            >
                              {`${count} leads`} • {mappedStage === "WON" ? `ΣSales ${sSales}` : `ΣOppo ${sOppo}`}
                            </button>
                          </div>
                        </div>

                        <div className={`mt-2 ${density === "S" ? "gap-2" : "gap-3"} max-h-[66vh] overflow-y-auto overflow-x-hidden pr-1 pb-1`}>
                          {loading && items.length === 0 && (
                            Array.from({ length: 6 }).map((_, i) => (
                              <div key={i} className={`rounded-xl border border-white/10 bg-white/5 ${cardPad} animate-pulse`}>
                                <div className="h-4 w-1/3 bg-white/10 rounded mb-2" />
                                <div className="h-3 w-2/3 bg-white/10 rounded mb-1" />
                                <div className="h-3 w-1/2 bg-white/10 rounded" />
                              </div>
                            ))
                          )}

                          {items.map((lead) => (
                            <motion.div
                              layout
                              key={lead.id}
                              draggable
                              onDragStart={() => setDragLead(lead)}
                              onClick={() => openEdit(lead.id)}
                              className={[
                                "relative rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition cursor-pointer group overflow-hidden",
                                cardPad,
                                "text-sm",
                                dragLead?.id === lead.id ? "ring-1 ring-white/30" : "",
                              ].join(" ")}
                              title="Cliquer pour éditer • Glisser pour changer de colonne"
                            >
                              {mappedStage && (
                                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl bg-gradient-to-b ${STAGE_COLOR[lead.stage]}`} />
                              )}

                              {/* Header carte */}
                              <div className="flex items-center justify-between">
                                <div className="font-medium truncate">{lead.firstName} {lead.lastName ?? ""}</div>
                                <div className="flex items-center gap-2">
                                  {lead.tag && <span className={`${infoSize} px-2 py-0.5 rounded-lg bg-white/10`}>{lead.tag}</span>}
                                  {lead.source && <span className={`${infoSize} px-2 py-0.5 rounded-lg bg-white/10 opacity-80`}>{lead.source}</span>}
                                </div>
                              </div>

                              {/* Infos */}
                              <div className={`mt-1 ${infoSize} text-[--muted] break-all truncate`}>
                                {lead.email || "—"} • {lead.phone || "—"}
                              </div>
                              <div className={`mt-1 flex items-center gap-2 ${infoSize} text-[--muted]`}>
                                {lead.setter && <span className="px-2 py-0.5 rounded bg-white/10">Setter: {lead.setter.firstName}</span>}
                                {lead.closer && <span className="px-2 py-0.5 rounded bg-white/10">Closer: {lead.closer.firstName}</span>}
                              </div>

                              {/* Valeurs */}
                              <div className="mt-2 text-sm flex items-center justify-between">
                                {mappedStage === "WON"
                                  ? <span className="font-semibold">{fmtEUR(lead.saleValue)}</span>
                                  : <span className="text-[--muted]">Oppo: {fmtEUR(lead.opportunityValue)}</span>
                                }
                              </div>

                              {/* Barre d’actions flottante */}
                              <div className="absolute inset-x-0 bottom-0 px-2 py-2 bg-gradient-to-t from-black/50 to-transparent backdrop-blur-sm
                                              translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    className="px-2 py-1 rounded-lg text-2xs bg-white/10 hover:bg-white/15"
                                    onClick={(e) => { e.stopPropagation(); openEdit(lead.id); }}
                                  >
                                    Éditer
                                  </button>

                                  <button
                                    className="px-2 py-1 rounded-lg text-2xs text-rose-300 bg-rose-500/10 hover:bg-rose-500/20"
                                    onClick={(e) => { e.stopPropagation(); deleteLead(lead.id); }}
                                    title="Supprimer définitivement"
                                  >
                                    Supprimer
                                  </button>

                                  {mappedStage !== "WON" && (
                                    <button
                                      className="px-2 py-1 rounded-lg text-2xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 font-medium"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAskWon({ open: true, lead });
                                        setWonValue(lead.opportunityValue != null ? String(lead.opportunityValue) : "");
                                      }}
                                    >
                                      Valider WON
                                    </button>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          ))}

                          {!loading && items.length === 0 && (
                            <div className="text-sm text-[--muted] px-1 py-6 text-center">
                              Aucun lead ne correspond aux filtres.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-white/40 transition-[width]" style={{ width: `${scrollProgress * 100}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ====== PANNEAU DE FILTRES ====== */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm flex items-start justify-end"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="w-full max-w-xl h-full bg-[rgba(16,22,33,.98)] border-l border-white/10 p-5 overflow-auto"
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}>
              <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-semibold">Filtres</div>
                <button className="btn btn-ghost" onClick={() => setFiltersOpen(false)}>Fermer</button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="label">Recherche</div>
                  <input
                    className="input"
                    placeholder="Nom, email, téléphone…"
                    value={qDraft}
                    onChange={(e) => setQDraft(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="label">Tag</div>
                    <select className="input" value={tagDraft} onChange={(e)=>setTagDraft(e.target.value)}>
                      {tagOptions.map(v => (
                        <option key={v} value={v}>{v === "__ALL__" ? "Tous" : v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="label">Source</div>
                    <select className="input" value={sourceDraft} onChange={(e)=>setSourceDraft(e.target.value)}>
                      {sourceOptions.map(v => (
                        <option key={v} value={v}>{v === "__ALL__" ? "Toutes" : v}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-2">
                  <div className="label">Période personnalisée</div>
                  <DateRangePicker
                    value={rangeDraft}
                    onChange={(r)=>setRangeDraft({ from: r?.from, to: r?.to })}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 pt-4">
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setQDraft("");
                      setTagDraft("__ALL__");
                      setSourceDraft("__ALL__");
                      setRangeDraft({ from: defaultFrom, to: defaultTo });
                    }}
                  >
                    Réinitialiser
                  </button>
                  <button className="btn btn-primary" onClick={applyFilters}>
                    Appliquer
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ====== GESTION DES COLONNES (modale brouillon) ====== */}
      <AnimatePresence>
        {manageOpen && manageDraft && (
          <motion.div
            className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="dialog"
            aria-modal="true"
            onClick={cancelManage}
          >
            <motion.div
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 18, opacity: 0 }}
              className="w-full max-w-3xl max-h-[85vh] rounded-2xl border border-white/10 bg-[rgba(16,22,33,.98)] shadow-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header sticky */}
              <div className="sticky top-0 z-10 px-5 py-3 border-b border-white/10 bg-[rgba(16,22,33,.98)] rounded-t-2xl">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">Gérer les colonnes</div>
                  <button className="btn btn-ghost" onClick={cancelManage}>Fermer</button>
                </div>
                <div className="text-xs text-[--muted] mt-1">
                  Les colonnes <b>libres</b> (sans “Stage mappé”) n’affichent des leads que si tu les y déposes (drag &amp; drop).
                  Les colonnes avec “Stage mappé” synchronisent le <code>stage</code> réel du lead.
                </div>
              </div>

              {/* Liste scrollable (brouillon) */}
              <div className="px-5 py-3 overflow-y-auto" style={{ maxHeight: "calc(85vh - 120px)" }}>
                <div className="space-y-2">
                  {manageDraft.map((c, idx) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => setDragColId(c.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (!dragColId || dragColId === c.id) return;
                        const list = manageDraft.slice();
                        const from = list.findIndex(x => x.id === dragColId);
                        const to = idx;
                        if (from < 0 || to < 0) return;
                        const moved = list.splice(from,1)[0];
                        list.splice(to,0,moved);
                        const renum = list.map((x,i)=>({ ...x, order: i }));
                        setManageDraft(renum);
                      }}
                      className="rounded-lg border border-white/10 bg-white/5 p-2 grid grid-cols-12 gap-2 items-center"
                      title="Glisser pour réordonner"
                    >
                      <div className="col-span-1 cursor-grab select-none opacity-70">⋮⋮</div>

                      <div className="col-span-4">
                        <input
                          className="input"
                          value={c.label}
                          onChange={(e)=>{
                            const v = e.target.value;
                            setManageDraft(manageDraft.map(x => x.id === c.id ? { ...x, label: v } : x));
                          }}
                        />
                      </div>

                      <div className="col-span-4">
                        <select
                          className="input"
                          value={c.stage ?? ""}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            setManageDraft(
                              manageDraft.map(x =>
                                x.id === c.id ? { ...x, stage: (v ? (v as LeadStage) : null) } : x,
                              ),
                            );
                          }}
                        >
                          <option value="">— Colonne libre (sans mapping) —</option>

                          <optgroup label="Entrée & Appels">
                            <option value="LEADS_RECEIVED">LEADS_RECEIVED</option>
                            <option value="CALL_REQUESTED">CALL_REQUESTED</option>
                            <option value="CALL_ATTEMPT">CALL_ATTEMPT</option>
                            <option value="CALL_ANSWERED">CALL_ANSWERED</option>
                            <option value="SETTER_NO_SHOW">SETTER_NO_SHOW</option>
                            <option value="FOLLOW_UP">FOLLOW_UP</option>
                            <option value="FOLLOW_UP_CLOSER">FOLLOW_UP_CLOSER</option>
                          </optgroup>

                          <optgroup label="RV0">
                            <option value="RV0_PLANNED">RV0_PLANNED</option>
                            <option value="RV0_HONORED">RV0_HONORED</option>
                            <option value="RV0_NO_SHOW">RV0_NO_SHOW</option>
                            <option value="RV0_POSTPONED">RV0_POSTPONED</option>
                            <option value="RV0_CANCELED">RV0_CANCELED</option>
                            <option value="RV0_NOT_QUALIFIED">RV0_NOT_QUALIFIED</option>
                          </optgroup>

                          <optgroup label="RV1">
                            <option value="RV1_PLANNED">RV1_PLANNED</option>
                            <option value="RV1_HONORED">RV1_HONORED</option>
                            <option value="RV1_NO_SHOW">RV1_NO_SHOW</option>
                            <option value="RV1_POSTPONED">RV1_POSTPONED</option>
                            <option value="RV1_CANCELED">RV1_CANCELED</option>
                            <option value="RV1_NOT_QUALIFIED">RV1_NOT_QUALIFIED</option>
                          </optgroup>

                          <optgroup label="RV2">
                            <option value="RV2_PLANNED">RV2_PLANNED</option>
                            <option value="RV2_HONORED">RV2_HONORED</option>
                            <option value="RV2_NO_SHOW">RV2_NO_SHOW</option>
                            <option value="RV2_POSTPONED">RV2_POSTPONED</option>
                            <option value="RV2_CANCELED">RV2_CANCELED</option>
                          </optgroup>

                          <optgroup label="Sorties">
                            <option value="NOT_QUALIFIED">NOT_QUALIFIED</option>
                            <option value="LOST">LOST</option>
                            <option value="CONTRACT_SIGNED">CONTRACT_SIGNED</option>
                            <option value="WON">WON</option>
                          </optgroup>
                        </select>

                      </div>

                      <div className="col-span-2">
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={c.enabled}
                            onChange={(e)=>{
                              setManageDraft(manageDraft.map(x => x.id === c.id ? { ...x, enabled: e.target.checked } : x));
                            }}
                          />
                          Visible
                        </label>
                      </div>

                      <div className="col-span-1 flex items-center justify-end gap-1">
                        <button
                          className="btn btn-ghost px-2 py-1 text-rose-300"
                          onClick={()=>{
                            const next = manageDraft.filter(x => x.id !== c.id).map((x,i)=>({ ...x, order: i }));
                            setManageDraft(next);
                          }}
                        >
                          Suppr
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer sticky : Annuler / Enregistrer / + Ajouter */}
              <div className="sticky bottom-0 z-10 px-5 py-3 border-t border-white/10 bg-[rgba(16,22,33,.98)] rounded-b-2xl">
                <div className="flex items-center justify-between">
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      if (!manageDraft) return;
                      const next: ColumnConfig = {
                        id: `col_${Date.now()}`,
                        order: manageDraft.length,
                        enabled: true,
                        label: "Nouvelle colonne",
                        stage: null,
                      };
                      setManageDraft([...manageDraft, next]);
                    }}
                  >
                    + Ajouter une colonne
                  </button>

                  <div className="flex gap-2">
                    <button className="btn btn-ghost" onClick={cancelManage}>Annuler</button>
                    <button className="btn btn-primary" onClick={saveManage}>Enregistrer</button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== MODALS: Import / WON / Edit / New Lead ===== */}
      <AnimatePresence>
        {importOpen && (
          <motion.div className="fixed inset-0 z-[95] flex items-center justify-center bg-[var(--bg)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setImportOpen(false)} role="dialog" aria-modal="true">
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
              className="card w-full max-w-md" onClick={(e)=>e.stopPropagation()}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-lg font-semibold">Importer des leads (CSV)</div>
                <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(false)}>Fermer</button>
              </div>
              <div className="text-sm text-[--muted] mb-3">
                Colonnes recommandées : firstName, lastName, email, phone, tag, source, opportunityValue, setterEmail, closerEmail.
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const fileInput = (e.currentTarget.elements.namedItem("file") as HTMLInputElement | null);
                  const f = fileInput?.files?.[0];
                  if (!f) return;
                  try {
                    setImporting(true);
                    const fd = new FormData();
                    fd.append("file", f);
                    await api.post("/prospects/import-csv", fd, { headers: { "Content-Type": "multipart/form-data" } });
                    setImportOpen(false);
                    await loadBoard();
                  } catch (err: any) {
                    setErr(err?.response?.data?.message || "Import impossible");
                  } finally { setImporting(false); }
                }}
                className="space-y-3"
              >
                <input name="file" type="file" accept=".csv,text/csv" className="input" required />
                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary flex-1" disabled={importing}>
                    {importing ? "Import…" : "Importer"}
                  </button>
                  <button type="button" className="btn btn-ghost flex-1" onClick={() => setImportOpen(false)}>
                    Annuler
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {askWon.open && askWon.lead && (
          <motion.div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--bg)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="card w-full max-w-md">
              <div className="text-lg font-semibold mb-1">Valider la vente</div>
              <div className="text-sm text-[--muted] mb-3">Cette valeur impacte le ROAS du closer, du setter et de l’entreprise.</div>
              <div className="space-y-3">
                <div>
                  <div className="label">Valeur réelle (€)</div>
                  <input className="input" type="number" min={0}
                    onKeyDown={(e) => { if (e.key === '-' || e.key === 'e') e.preventDefault(); }}
                    value={wonValue} onChange={(e) => setWonValue(e.target.value)}
                    placeholder={askWon.lead.opportunityValue != null ? String(askWon.lead.opportunityValue) : "Ex: 5000"} />
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-primary flex-1" onClick={confirmWonWithValue}>Enregistrer</button>
                  {askWon.lead.opportunityValue != null && (
                    <button className="btn btn-ghost flex-1" onClick={confirmWonSame}>
                      Confirmer {fmtInt(askWon.lead.opportunityValue)} €
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {newOpen && (
          <motion.div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--bg)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="card w-full max-w-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="text-lg font-semibold">Nouveau prospect</div>
                <button className="btn btn-ghost" onClick={()=>setNewOpen(false)}>Fermer</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><div className="label">Prénom</div><input className="input" value={newData.firstName} onChange={(e)=>setNewData({...newData, firstName: e.target.value})}/></div>
                <div><div className="label">Nom</div><input className="input" value={newData.lastName} onChange={(e)=>setNewData({...newData, lastName: e.target.value})}/></div>
                <div><div className="label">Email</div><input className="input" value={newData.email} onChange={(e)=>setNewData({...newData, email: e.target.value})}/></div>
                <div><div className="label">Téléphone</div><input className="input" value={newData.phone} onChange={(e)=>setNewData({...newData, phone: e.target.value})}/></div>
                <div><div className="label">Tag</div><input className="input" value={newData.tag} onChange={(e)=>setNewData({...newData, tag: e.target.value})}/></div>
                <div>
                  <div className="label">Valeur d’opportunité (€)</div>
                  <input className="input" type="number" min={0}
                    onKeyDown={(e) => { if (e.key === '-' || e.key === 'e') e.preventDefault(); }}
                    value={newData.opportunityValue}
                    onChange={(e)=>setNewData({...newData, opportunityValue: e.target.value})}/>
                </div>
                <div>
                  <div className="label">Setter</div>
                  <select className="input" value={newData.setterId} onChange={(e)=>setNewData({...newData, setterId: e.target.value})}>
                    <option value="">— Aucun —</option>
                    {actors?.setters?.map(u=> (<option key={u.id} value={u.id}>{u.firstName} ({u.email})</option>))}
                  </select>
                </div>
                <div>
                  <div className="label">Closer</div>
                  <select className="input" value={newData.closerId} onChange={(e)=>setNewData({...newData, closerId: e.target.value})}>
                    <option value="">— Aucun —</option>
                    {actors?.closers?.map(u=> (<option key={u.id} value={u.id}>{u.firstName} ({u.email})</option>))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex gap-2 justify-end">
                <button className="btn btn-ghost" onClick={()=>setNewOpen(false)}>Annuler</button>
                <button className="btn btn-primary" onClick={createLead}>Créer</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editOpen && (
          <motion.div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--bg)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="card w-full max-w-xl">
              <div className="flex items-center justify-between mb-2">
                <div className="text-lg font-semibold">Éditer l’opportunité</div>
                <button className="btn btn-ghost px-2 py-1" onClick={() => setEditOpen(false)}>Fermer</button>
              </div>

              {editLoading ? (
                <div className="text-[--muted]">Chargement…</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><div className="label">Prénom</div><input className="input" value={fFirst} onChange={(e) => setFFirst(e.target.value)} /></div>
                  <div><div className="label">Nom</div><input className="input" value={fLast} onChange={(e) => setFLast(e.target.value)} /></div>
                  <div><div className="label">Email</div><input className="input" value={fEmail} onChange={(e) => setFEmail(e.target.value)} /></div>
                  <div><div className="label">Téléphone</div><input className="input" value={fPhone} onChange={(e) => setFPhone(e.target.value)} /></div>
                  <div><div className="label">Tag</div><input className="input" value={fTag} onChange={(e) => setFTag(e.target.value)} /></div>
                  <div>
                    <div className="label">Valeur d’opportunité (€)</div>
                    <input className="input" type="number" min={0}
                      onKeyDown={(e) => { if (e.key === '-' || e.key === 'e') e.preventDefault(); }}
                      value={fOppo} onChange={(e) => setFOppo(e.target.value)} placeholder="Ex: 5000" />
                  </div>
                  <div>
                    <div className="label">Setter</div>
                    <select className="input" value={fSetter} onChange={(e) => setFSetter(e.target.value)}>
                      <option value="">— Aucun —</option>
                      {actors.setters.map((u) => (<option key={u.id} value={u.id}>{u.firstName} ({u.email})</option>))}
                    </select>
                  </div>
                  <div>
                    <div className="label">Closer</div>
                    <select className="input" value={fCloser} onChange={(e) => setFCloser(e.target.value)}>
                      <option value="">— Aucun —</option>
                      {actors.closers.map((u) => (<option key={u.id} value={u.id}>{u.firstName} ({u.email})</option>))}
                    </select>
                  </div>
                  <div className="md:col-span-2 pt-2 flex gap-2 justify-end">
                    <button className="btn btn-ghost" onClick={() => setEditOpen(false)}>Annuler</button>
                    <button className="btn btn-primary" onClick={saveEdit}>Enregistrer</button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Drill modal ===== */}
      <AnimatePresence>
        {drillOpen && (
          <DrillModal title={drillTitle} open={drillOpen} onClose={()=>setDrillOpen(false)} rows={drillRows} />
        )}
      </AnimatePresence>
    </div>
  );
}
