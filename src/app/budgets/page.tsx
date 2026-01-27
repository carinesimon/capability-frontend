  "use client";

  import {
    useEffect,
    useMemo,
    useState,
    type ReactNode,
  } from "react";
  import Sidebar from "@/components/Sidebar";
  import api from "@/lib/api";
  import DateRangePicker, { type Range } from "@/components/DateRangePicker";
  import { getAccessToken } from "@/lib/auth";
  import { useRouter } from "next/navigation";
  import { motion, AnimatePresence } from "framer-motion";
  import { useFunnelMetrics } from "@/hooks/useFunnelMetrics";

  // ✅ IMPORT DU BUDGET PANEL
  import BudgetPanel from "@/components/BudgetPanel";

  /* =============================================================================
    Helpers GET/POST pour tester plusieurs routes (reporting/analytics)
  ============================================================================= */
  async function tryGet<T>(
    candidates: Array<{ url: string; params?: Record<string, any> }>,
    fallback: T
  ): Promise<{ data: T; hit: string | null }> {
    for (const c of candidates) {
      try {
        const res = await api.get(c.url, {
          params: c.params,
        });
        return { data: (res.data ?? fallback) as T, hit: c.url };
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 404) continue;
      }
    }
    return { data: fallback, hit: null };
  }

  async function tryPost(
    candidates: Array<{ url: string; body?: any }>
  ): Promise<{ ok: boolean; hit: string | null }> {
    for (const c of candidates) {
      try {
        const res = await api.post(c.url, c.body ?? {});
        if (res.status >= 200 && res.status < 300) {
          return { ok: true, hit: c.url };
        }
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 404) continue;
      }
    }
    return { ok: false, hit: null };
  }

  /** ---------- Types alignés backend ---------- */
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
    caEncaisse?: number | null;
  };

  type WeeklyOpsRow = {
    weekStart: string;
    weekEnd: string;
    callRequests: number;
    rv0Planned: number;
    rv0Honored: number;
    rv0NoShow?: number;
    rv0Postponed?: number;
    rv0Canceled?: number;
    rv0NotQualified?: number;
    rv1Planned: number;
    rv1Honored: number;
    rv1NoShow: number;
    rv1Postponed?: number;
    rv1Canceled?: number;
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

  type LeadsReceivedOut = {
    total: number;
    byDay?: Array<{ day: string; count: number }>;
  };

  /** ---------- Utils ---------- */
  const fmtInt = (n: number) => Math.round(n).toLocaleString("fr-FR");
  const fmtEUR = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;
  const fmtMaybeEUR = (n: number | null) =>
    n == null || !Number.isFinite(n) ? "—" : fmtEUR(n);

  const fmtMaybeRatio = (n: number | null) =>
    n == null || !Number.isFinite(n) ? "—" : n.toFixed(2);

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

  /** Normalise les totaux d’événements (FR/EN) */
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

      RV1_NOT_QUALIFIED: pick(
        "RV1_NOT_QUALIFIED",
        "NOT_QUALIFIED_RV1",
        "RV1_NON_QUALIFIE",
        "RV1_NON_QUALIFIÉ"
      ),

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

      RV0_CANCELED: pick("RV0_CANCELED", "RV0_ANNULÉ", "RV0_ANNULE"),
      RV1_CANCELED: pick("RV1_CANCELED", "RV1_ANNULÉ", "RV1_ANNULE"),
      RV2_CANCELED: pick("RV2_CANCELED", "RV2_ANNULÉ", "RV2_ANNULE"),

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

  /** ---------- Helpers semaine (lundi → dimanche) ---------- */
  function startOfWeekMonday(d: Date): Date {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDay(); // 0 = dimanche, 1 = lundi, ...
    const diff = (day + 6) % 7; // 0 si lundi, 6 si dimanche
    x.setDate(x.getDate() - diff);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function endOfWeekSunday(d: Date): Date {
    const start = startOfWeekMonday(d);
    const e = new Date(start);
    e.setDate(start.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
  }

  function getWeekBoundsForDate(d: Date): { from: Date; to: Date } {
    const from = startOfWeekMonday(d);
    const to = endOfWeekSunday(d);
    return { from, to };
  }

  function getCurrentWeek(): { from: Date; to: Date } {
    return getWeekBoundsForDate(new Date());
  }

  function getLastFullWeek(): { from: Date; to: Date } {
    const today = new Date();
    const currentWeekStart = startOfWeekMonday(today);
    const lastWeekStart = new Date(currentWeekStart);
    lastWeekStart.setDate(currentWeekStart.getDate() - 7);
    const lastWeekEnd = endOfWeekSunday(lastWeekStart);
    return { from: lastWeekStart, to: lastWeekEnd };
  }

  /** Export CSV simple */
  function exportSeriesCSV(series: WeeklySnapshot[]) {
    const header = [
      "Semaine début",
      "Semaine fin",
      "Dépenses",
      "Leads",
      "CPL",
      "CA (Cohorte)",
      "Ventes (Cohorte)",
      "ROAS",
    ];
    const lines = series.map((s) =>
      [
        s.weekStart,
        s.weekEnd,
        s.spend,
        s.leadsReceived,
        s.cpl ?? "",
        s.revenue,
        s.wonCount,
        s.roas ?? "",
      ].join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "budget_series_fr.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /** --------- Modale Drill --------- */
  function DrillModal({
    title,
    open,
    onClose,
    rows,
    extra,
  }: {
    title: string;
    open: boolean;
    onClose: () => void;
    rows: DrillItem[];
    extra?: ReactNode;
  }) {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
        <div className="card w-full max-w-5xl max-h-[80vh] overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="text-lg font-semibold">{title}</div>
            <button className="btn btn-ghost" onClick={onClose}>
              Fermer
            </button>
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
                {rows.length ? (
                  rows.map((r) => (
                    <tr key={r.leadId} className="border-t border-white/10">
                      <td className="py-2 pr-2">
                        <div className="font-medium">{r.leadName}</div>
                        <div className="text-xs text-[--muted]">
                          {r.email ?? "—"} • {r.phone ?? "—"}
                        </div>
                      </td>
                      <td className="py-2 pr-2">{r.setter?.name ?? "—"}</td>
                      <td className="py-2 pr-2">{r.closer?.name ?? "—"}</td>
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
                          ? `${Math.round(r.saleValue).toLocaleString(
                              "fr-FR"
                            )} €`
                          : "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-6 text-[--muted]" colSpan={5}>
                      Aucune ligne
                    </td>
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

    /** -------- Filtres : semaine par défaut = semaine écoulée -------- */
    const { defaultFrom, defaultTo } = useMemo(() => {
      const { from, to } = getLastFullWeek();
      return { defaultFrom: from, defaultTo: to };
    }, []);

    const [uiRange, setUiRange] = useState<Range>({
      from: defaultFrom,
      to: defaultTo,
    });
    const [appliedRange, setAppliedRange] = useState<Range>({
      from: defaultFrom,
      to: defaultTo,
    });

    const [tz] = useState<string>("Europe/Paris");

    // Période pour le funnel = période appliquée (mêmes dates que le dashboard)
    const fromDate = useMemo(
      () => normalizeDate(appliedRange.from) ?? new Date(),
      [appliedRange.from]
    );
    const toDate = useMemo(
      () => normalizeDate(appliedRange.to) ?? new Date(),
      [appliedRange.to]
    );

    const {
      data: funnelRaw = {},
      loading: funnelLoading,
      error: funnelErrorRaw,
    } = useFunnelMetrics(fromDate, toDate, tz) as {
      data?: Record<string, number | undefined>;
      loading: boolean;
      error: unknown;
    };

  // On normalise l’erreur en string nullable, exploitable en ReactNode
  const funnelError =
    funnelErrorRaw == null
      ? null
      : typeof funnelErrorRaw === "string"
      ? funnelErrorRaw
      : JSON.stringify(funnelErrorRaw);


    const funnelTotals = normalizeTotals(
      funnelRaw as Record<string, number | undefined>
    );

    /** -------- Auth guard -------- */
    const [authChecked, setAuthChecked] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

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
            setAuthError("Non autorisé");
          }
        }
      }
      verify();
      return () => {
        cancelled = true;
      };
    }, [router]);

    /** -------- Dates ISO pour API -------- */
    const fromISO = appliedRange.from ? toISODate(appliedRange.from as any) : undefined;
    const toISO = appliedRange.to ? toISODate(appliedRange.to as any) : undefined;

    const [filtersOpen, setFiltersOpen] = useState(false);

    const defaultRangeKey = `${defaultFrom?.toDateString() ?? ""}|${
      defaultTo?.toDateString() ?? ""
    }`;
    const currentRangeKey = `${
      normalizeDate(appliedRange.from)?.toDateString() ?? ""
    }|${normalizeDate(appliedRange.to)?.toDateString() ?? ""}`;
    const activeFiltersCount = currentRangeKey !== defaultRangeKey ? 1 : 0;

    /** -------- Data -------- */
    const [series, setSeries] = useState<WeeklySnapshot[]>([]);
    const [budgets, setBudgets] = useState<BudgetRow[]>([]);
    const [ops, setOps] = useState<WeeklyOpsRow[]>([]);
    const [weeklySales, setWeeklySales] = useState<WeeklySales[]>([]);
    const [leadsTotal, setLeadsTotal] = useState<number>(0);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    /** -------- Drill UI -------- */
    const [drillOpen, setDrillOpen] = useState(false);
    const [drillTitle, setDrillTitle] = useState("");
    const [drillRows, setDrillRows] = useState<DrillItem[]>([]);
    const [drillExtra, setDrillExtra] = useState<ReactNode>(null);

    /** -------- Saisie comptable -------- */
    const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});
    const [cashInDrafts, setCashInDrafts] = useState<Record<string, string>>({});
    const [savingWeek, setSavingWeek] = useState<string | null>(null);
    const [supportsBudgetPost, setSupportsBudgetPost] = useState<boolean>(false);

    /** -------- Chargement -------- */
    useEffect(() => {
      if (!authChecked || authError) return;
      let cancelled = false;

      async function load() {
        setLoading(true);
        setErr(null);
        try {
          // ====== Budgets (GET) : on récupère tous les budgets
          const budgetGet = await tryGet<any>(
            [
              { url: "/reporting/budget" },
              { url: "/analytics/budget" },
            ],
            []
          );
          const bData = (budgetGet.data ?? []) as any;
          if (!cancelled) {
            setBudgets(Array.isArray(bData) ? bData : bData.rows ?? []);
            setSupportsBudgetPost(Boolean(budgetGet.hit));
          }

          // ====== Weekly series : /reporting/weekly-series | /analytics/weekly-series
          const seriesGet = await tryGet<any>(
            [
              {
                url: "/reporting/weekly-series",
                params: { from: fromISO, to: toISO },
              },
              {
                url: "/analytics/weekly-series",
                params: { from: fromISO, to: toISO },
              },
            ],
            []
          );

          const rawSeries = seriesGet.data as any;
          let s: WeeklySnapshot[] = [];

          if (Array.isArray(rawSeries)) {
            s = rawSeries;
          } else if (Array.isArray(rawSeries?.series)) {
            s = rawSeries.series;
          } else if (Array.isArray(rawSeries?.weeklySeries)) {
            s = rawSeries.weeklySeries;
          }

          if (!cancelled) {
            setSeries(s);
          }

          // ====== Weekly ops
          const opsGet = await tryGet<any>(
            [
              {
              url: "/reporting/weekly-ops",
              params: { from: fromISO, to: toISO },
            },
              { url: "/analytics/weekly-ops", params: { from: fromISO, to: toISO } },
            ],
            []
          );
          const oData = opsGet.data as any;
          const rows: WeeklyOpsRow[] = Array.isArray(oData)
            ? oData
            : oData?.rows ?? [];
          if (!cancelled) {
            setOps(rows.slice().sort((a, b) => a.weekStart.localeCompare(b.weekStart)));
          }

          // ====== Weekly sales
          const salesGet = await tryGet<WeeklySales[]>(
            [
              {
                url: "/reporting/sales-weekly",
                params: { from: fromISO, to: toISO },
              },
              {
                url: "/analytics/sales-weekly",
                params: { from: fromISO, to: toISO },
              },
            ],
            []
          );
          if (!cancelled) {
            setWeeklySales(
              (salesGet.data || [])
                .slice()
                .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
            );
          }

          // ====== Leads reçus sur la période (fallback si funnel indispo)
          const leadsGet = await tryGet<any>(
            [
              {
                url: "/reporting/leads-received",
                params: { from: fromISO, to: toISO },
              },
              {
                url: "/metrics/leads-by-day",
                params: { from: fromISO, to: toISO },
              },
            ],
            { total: 0 }
          );

          const L = leadsGet.data as LeadsReceivedOut | any;

          const leadsTotalComputed =
            (typeof L?.total === "number" ? L.total : 0) ||
            (Array.isArray(L?.byDay)
              ? L.byDay.reduce(
                  (s: number, d: any) => s + (d.count || d.value || 0),
                  0
                )
              : 0);

          if (!cancelled) {
            setLeadsTotal(leadsTotalComputed);
          }
        } catch (e: any) {
          if (!cancelled) setErr(e?.message || "Erreur de chargement");
        } finally {
          if (!cancelled) setLoading(false);
        }
      }

      load();
      return () => {
        cancelled = true;
      };
    }, [authChecked, authError, fromISO, toISO]);

    /** -------- Drill helpers -------- */
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
      const res = await api.get("/reporting/drill/appointments", {
        params: {
          type: params.type,
          status: params.status,
          from: params.from ?? fromISO,
          to: params.to ?? toISO,
          limit: 2000,
        },
      });
      setDrillTitle(params.title);
      setDrillRows(res.data?.items || []);
      setDrillExtra(null);
      setDrillOpen(true);
    }

    async function openSalesWeekDrill(
      weekStartISO: string,
      weekEndISO: string
    ) {
      const res = await api.get("/reporting/drill/won", {
        params: {
          from: weekStartISO.slice(0, 10),
          to: weekEndISO.slice(0, 10),
          limit: 2000,
        },
      });
      setDrillTitle(
        `Ventes (WON) – semaine ${new Date(
          weekStartISO
        ).toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
        })} → ${new Date(weekEndISO).toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
        })}`
      );
      setDrillExtra(
        <div className="mb-3 text-xs text-[--muted]">
          Fenêtre ventes (stageUpdatedAt/createdAt dans la semaine).
        </div>
      );
      setDrillRows(res.data?.items || []);
      setDrillOpen(true);
    }

    async function openLeadsDrill() {
      const res = await api.get("/reporting/drill/leads-received", {
        params: { from: fromISO, to: toISO, limit: 2000 },
      });
      setDrillTitle("Leads reçus (créés sur la période)");
      setDrillExtra(null);
      setDrillRows(res.data?.items || []);
      setDrillOpen(true);
    }

    async function openCohortSalesDrill() {
      const res = await api.get("/reporting/drill/won", {
        params: {
        cohortFrom: fromISO,
        cohortTo: toISO,
        limit: 2000,
      },
      });
      setDrillTitle("Ventes (Cohorte) – détail");
      setDrillExtra(
        <div className="mb-3 text-xs text-[--muted]">
          Cohorte = leads créés pendant la période (peu importe la date de
          passage en WON).
        </div>
      );
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
    const res: any = await fetchSafe("/reporting/drill/call-requests", {
      from: fromISO,
      to: toISO,
      limit: 2000,
      tz,
    });

    setDrillTitle("Demandes d’appel – détail");

    const data = res?.data;
    console.log("DEBUG /reporting/drill/call-requests =>", data);

    let items: DrillItem[] = [];

    // ✅ Cas 1 : l’API renvoie directement un tableau
    if (Array.isArray(data)) {
      items = data as DrillItem[];
    }
    // ✅ Cas 2 : l’API renvoie { items: [...] }
    else if (Array.isArray(data?.items)) {
      items = data.items as DrillItem[];
    }
    // ✅ Cas 3 : certains backends renvoient { rows: [...] }
    else if (Array.isArray(data?.rows)) {
      items = data.rows as DrillItem[];
    }

    // ✅ Cas 4 : l’endpoint renvoie seulement { total, byDay } (agrégats)
    if (
      !items.length &&
      (typeof data?.total === "number" || Array.isArray(data?.byDay))
    ) {
      items = [
        {
          leadId: "__info__",
          leadName:
            "L’API renvoie seulement des agrégats (total / byDay) pour les demandes d’appel. " +
            "Le détail lead par lead n’est pas encore exposé par /reporting/drill/call-requests.",
        } as any,
      ];
    }

    // ✅ Si fetchSafe a créé un message d’erreur fonctionnelle
    if (data?.__error) {
      items.unshift({
        leadId: "__error__",
        leadName: data.__error,
      } as any);
    }

    setDrillRows(items);
    setDrillOpen(true);
  }

    /** -------- Helpers UI -------- */
    const chip = (
      label: string,
      value: number,
      onClick?: () => void,
      tone: "muted" | "ok" | "warn" | "info" = "muted"
    ) => {
      const tones: Record<string, string> = {
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
      return ok ? (
        <span className="text-emerald-400">✓</span>
      ) : (
        <span className="text-amber-400">⚠</span>
      );
    }

    function stackedBar(
      parts: Array<{ label: string; value: number; color: string; on?: () => void }>
    ) {
      const total = parts.reduce((s, p) => s + p.value, 0) || 1;
      return (
        <div className="h-2 w-full rounded bg-white/10 overflow-hidden">
          <div className="flex h-full">
            {parts.map((p, i) => (
              <div
                key={i}
                style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
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
      const ws = w.weekStart.slice(0, 10),
        we = w.weekEnd.slice(0, 10);
      const sales = weeklySalesMap.get(w.weekStart);
      const headDates = `${new Date(w.weekStart).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
      })} → ${new Date(w.weekEnd).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
      })}`;

      const rv0NoShow = w.rv0NoShow || 0,
        rv0Post = w.rv0Postponed || 0,
        rv0Can = w.rv0Canceled || 0,
        rv0NQ = w.rv0NotQualified || 0;
      const rv2NoShow = w.rv2NoShow || 0,
        rv2Post = w.rv2Postponed || 0,
        rv2Can = w.rv2Canceled || 0;
      const rv1Post = w.rv1Postponed || 0,
        rv1Can = w.rv1Canceled || 0;

      return (
        <div className="rounded-2xl border border-white/10 p-4 bg-[rgba(16,22,33,.9)]">
          <div className="flex items-center gap-3">
            <div className="text-sm text-[--muted]">{headDates}</div>
            <div className="flex-1" />
            <div className="text-xs text-[--muted] flex flex-wrap items-center gap-2">
              Ventes:{" "}
              <button
                className="underline"
                onClick={() => openSalesWeekDrill(w.weekStart, w.weekEnd)}
              >
                {fmtInt(sales?.count || 0)}
              </button>
              • CA:{" "}
              <button
                className="underline"
                onClick={() => openSalesWeekDrill(w.weekStart, w.weekEnd)}
              >
                {fmtEUR(sales?.revenue || 0)}
              </button>
              • {eqCheck(w.rv0Planned, [
                w.rv0Honored,
                rv0NoShow,
                rv0Post,
                rv0Can,
                rv0NQ,
              ])}
              {eqCheck(w.rv1Planned, [
                w.rv1Honored,
                w.rv1NoShow,
                rv1Post,
                rv1Can,
              ])}
              {eqCheck(w.rv2Planned, [
                w.rv2Honored,
                rv2NoShow,
                rv2Post,
                rv2Can,
              ])}
            </div>
          </div>

          {/* RV0 */}
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium w-10">RV0</div>
              {stackedBar([
                {
                  label: "Honorés",
                  value: w.rv0Honored,
                  color: "rgb(16 185 129)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV0 honorés (semaine)",
                      type: "RV0",
                      status: "HONORED",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "No-show",
                  value: rv0NoShow,
                  color: "rgb(245 158 11)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV0 no-show (semaine)",
                      type: "RV0",
                      status: "NO_SHOW",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "Reportés",
                  value: rv0Post,
                  color: "rgb(56 189 248)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV0 reportés (semaine)",
                      type: "RV0",
                      status: "POSTPONED",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "Annulés",
                  value: rv0Can,
                  color: "rgb(244 63 94)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV0 annulés (semaine)",
                      type: "RV0",
                      status: "CANCELED",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "Non qual.",
                  value: rv0NQ,
                  color: "rgb(148 163 184)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV0 non qualifiés (semaine)",
                      type: "RV0",
                      status: "NOT_QUALIFIED",
                      from: ws,
                      to: we,
                    }),
                },
              ])}
              <div className="flex-1" />
              <div className="flex gap-2">
                {chip(
                  "P",
                  w.rv0Planned,
                  () =>
                    openAppointmentsDrill({
                      title: "RV0 planifiés (semaine)",
                      type: "RV0",
                      from: ws,
                      to: we,
                    }),
                  "info"
                )}
                {chip(
                  "H",
                  w.rv0Honored,
                  () =>
                    openAppointmentsDrill({
                      title: "RV0 honorés (semaine)",
                      type: "RV0",
                      status: "HONORED",
                      from: ws,
                      to: we,
                    }),
                  "ok"
                )}
                {chip(
                  "NS",
                  rv0NoShow,
                  () =>
                    openAppointmentsDrill({
                      title: "RV0 no-show (semaine)",
                      type: "RV0",
                      status: "NO_SHOW",
                      from: ws,
                      to: we,
                    }),
                  "warn"
                )}
                {chip(
                  "R",
                  rv0Post,
                  () =>
                    openAppointmentsDrill({
                      title: "RV0 reportés (semaine)",
                      type: "RV0",
                      status: "POSTPONED",
                      from: ws,
                      to: we,
                    })
                )}
                {chip(
                  "A",
                  rv0Can,
                  () =>
                    openAppointmentsDrill({
                      title: "RV0 annulés (semaine)",
                      type: "RV0",
                      status: "CANCELED",
                      from: ws,
                      to: we,
                    })
                )}
                {chip(
                  "NQ",
                  rv0NQ,
                  () =>
                    openAppointmentsDrill({
                      title: "RV0 non qualifiés (semaine)",
                      type: "RV0",
                      status: "NOT_QUALIFIED",
                      from: ws,
                      to: we,
                    })
                )}
              </div>
            </div>

            {/* RV1 */}
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium w-10">RV1</div>
              {stackedBar([
                {
                  label: "Honorés",
                  value: w.rv1Honored,
                  color: "rgb(16 185 129)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV1 honorés (semaine)",
                      type: "RV1",
                      status: "HONORED",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "No-show",
                  value: w.rv1NoShow,
                  color: "rgb(245 158 11)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV1 no-show (semaine)",
                      type: "RV1",
                      status: "NO_SHOW",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "Reportés",
                  value: w.rv1Postponed || 0,
                  color: "rgb(56 189 248)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV1 reportés (semaine)",
                      type: "RV1",
                      status: "POSTPONED",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "Annulés",
                  value: w.rv1Canceled || 0,
                  color: "rgb(244 63 94)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV1 annulés (semaine)",
                      type: "RV1",
                      status: "CANCELED",
                      from: ws,
                      to: we,
                    }),
                },
              ])}
              <div className="flex-1" />
              <div className="flex gap-2">
                {chip(
                  "P",
                  w.rv1Planned,
                  () =>
                    openAppointmentsDrill({
                      title: "RV1 planifiés (semaine)",
                      type: "RV1",
                      from: ws,
                      to: we,
                    }),
                  "info"
                )}
                {chip(
                  "H",
                  w.rv1Honored,
                  () =>
                    openAppointmentsDrill({
                      title: "RV1 honorés (semaine)",
                      type: "RV1",
                      status: "HONORED",
                      from: ws,
                      to: we,
                    }),
                  "ok"
                )}
                {chip(
                  "NS",
                  w.rv1NoShow,
                  () =>
                    openAppointmentsDrill({
                      title: "RV1 no-show (semaine)",
                      type: "RV1",
                      status: "NO_SHOW",
                      from: ws,
                      to: we,
                    }),
                  "warn"
                )}
                {chip(
                  "R",
                  w.rv1Postponed || 0,
                  () =>
                    openAppointmentsDrill({
                      title: "RV1 reportés (semaine)",
                      type: "RV1",
                      status: "POSTPONED",
                      from: ws,
                      to: we,
                    })
                )}
                {chip(
                  "A",
                  w.rv1Canceled || 0,
                  () =>
                    openAppointmentsDrill({
                      title: "RV1 annulés (semaine)",
                      type: "RV1",
                      status: "CANCELED",
                      from: ws,
                      to: we,
                    })
                )}
              </div>
            </div>

            {/* RV2 */}
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium w-10">RV2</div>
              {stackedBar([
                {
                  label: "Honorés",
                  value: w.rv2Honored,
                  color: "rgb(16 185 129)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV2 honorés (semaine)",
                      type: "RV2",
                      status: "HONORED",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "No-show",
                  value: w.rv2NoShow || 0,
                  color: "rgb(245 158 11)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV2 no-show (semaine)",
                      type: "RV2",
                      status: "NO_SHOW",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "Reportés",
                  value: w.rv2Postponed || 0,
                  color: "rgb(56 189 248)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV2 reportés (semaine)",
                      type: "RV2",
                      status: "POSTPONED",
                      from: ws,
                      to: we,
                    }),
                },
                {
                  label: "Annulés",
                  value: w.rv2Canceled || 0,
                  color: "rgb(244 63 94)",
                  on: () =>
                    openAppointmentsDrill({
                      title: "RV2 annulés (semaine)",
                      type: "RV2",
                      status: "CANCELED",
                      from: ws,
                      to: we,
                    }),
                },
              ])}
              <div className="flex-1" />
              <div className="flex gap-2">
                {chip(
                  "P",
                  w.rv2Planned,
                  () =>
                    openAppointmentsDrill({
                      title: "RV2 planifiés (semaine)",
                      type: "RV2",
                      from: ws,
                      to: we,
                    }),
                  "info"
                )}
                {chip(
                  "H",
                  w.rv2Honored,
                  () =>
                    openAppointmentsDrill({
                      title: "RV2 honorés (semaine)",
                      type: "RV2",
                      status: "HONORED",
                      from: ws,
                      to: we,
                    }),
                  "ok"
                )}
                {chip(
                  "NS",
                  w.rv2NoShow || 0,
                  () =>
                    openAppointmentsDrill({
                      title: "RV2 no-show (semaine)",
                      type: "RV2",
                      status: "NO_SHOW",
                      from: ws,
                      to: we,
                    }),
                  "warn"
                )}
                {chip(
                  "R",
                  w.rv2Postponed || 0,
                  () =>
                    openAppointmentsDrill({
                      title: "RV2 reportés (semaine)",
                      type: "RV2",
                      status: "POSTPONED",
                      from: ws,
                      to: we,
                    })
                )}
                {chip(
                  "A",
                  w.rv2Canceled || 0,
                  () =>
                    openAppointmentsDrill({
                      title: "RV2 annulés (semaine)",
                      type: "RV2",
                      status: "CANCELED",
                      from: ws,
                      to: we,
                    })
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    /** -------- Maps & agrégations -------- */
    const weeklySalesMap = useMemo(() => {
      const m = new Map<string, WeeklySales>();
      for (const w of weeklySales) m.set(w.weekStart, w);
      return m;
    }, [weeklySales]);

    const opsByWeek = useMemo(() => {
      const m = new Map<string, WeeklyOpsRow>();
      for (const o of ops) {
        m.set(o.weekStart, o);
      }
      return m;
    }, [ops]);

    const weeklyBudgetByWeekStart = useMemo(() => {
      const m = new Map<string, BudgetRow>();
      for (const b of budgets) {
        if (b.period === "WEEKLY" && b.weekStart) {
          m.set(b.weekStart, b);
        }
      }
      return m;
    }, [budgets]);

    // Totaux bruts
    const rawSpendTotal = series.reduce(
      (n, x) => n + (x.spend || 0),
      0
    );
    const rawRevenueTotal = series.reduce(
      (n, x) => n + (x.revenue || 0),
      0
    );

    // Semaine sélectionnée (lundi → dimanche)
    const selectedWeekStartDate =
      appliedRange.from
        ? startOfWeekMonday(normalizeDate(appliedRange.from)!)
        : null;

    const selectedWeekKey =
      selectedWeekStartDate ? toISODate(selectedWeekStartDate) : undefined;

    // Budget unique de la semaine filtrée
    const selectedBudgetRow: BudgetRow | undefined =
      selectedWeekKey
        ? budgets
            .filter((b) => b.period === "WEEKLY" && b.weekStart)
            .sort((a, b) => (a.weekStart || "").localeCompare(b.weekStart || ""))
            .find((b) => b.weekStart!.slice(0, 10) === selectedWeekKey)
        : undefined;

    const totalBudgetFromBudgets = selectedBudgetRow?.amount ?? 0;

    const totalCaVendu =
      weeklySales.reduce((n, w) => n + (w.revenue || 0), 0) ||
      rawRevenueTotal;

    const totalBudget = totalBudgetFromBudgets || rawSpendTotal;
    const totalCashIn = selectedBudgetRow?.caEncaisse ?? 0;

    // Totaux ops pour la période
    const opsTotals = useMemo(
      () =>
        ops.reduce(
          (acc, w) => {
            acc.rv0Honored += w.rv0Honored || 0;
            acc.rv1Planned += w.rv1Planned || 0;
            acc.rv1Honored += w.rv1Honored || 0;
            acc.callRequests += w.callRequests || 0;
            return acc;
          },
          { rv0Honored: 0, rv1Planned: 0, rv1Honored: 0, callRequests: 0 }
        ),
      [ops]
    );

    // ✅ Totaux période basés sur funnel (avec fallback)
    const totalCallRequests =
      funnelTotals.CALL_REQUESTED || opsTotals.callRequests || 0;

    const totalLeads =
      funnelTotals.LEADS_RECEIVED || leadsTotal || 0;

    const totalSales = weeklySales.reduce(
      (n, x) => n + (x.count || 0),
      0
    );

    // KPIs coûts & ROAS
    const costPerCallRequest =
      totalCallRequests > 0 ? totalBudget / totalCallRequests : null;

    const cplGlobal =
      totalLeads > 0 ? totalBudget / totalLeads : null;

    const costPerRv0Honored =
      opsTotals.rv0Honored > 0
        ? totalBudget / opsTotals.rv0Honored
        : null;

    const costPerRv1Planned =
      opsTotals.rv1Planned > 0
        ? totalBudget / opsTotals.rv1Planned
        : null;

    const costPerRv1Honored =
      opsTotals.rv1Honored > 0
        ? totalBudget / opsTotals.rv1Honored
        : null;

    const costPerSale =
      totalSales > 0 ? totalBudget / totalSales : null;

    const roasVendu =
      totalBudget > 0 ? totalCaVendu / totalBudget : null;

    const profit = totalCaVendu - totalBudget;

    const accountingRows = useMemo(() => {
      const weekKeys = new Set<string>();

      for (const s of series) weekKeys.add(s.weekStart);
      for (const o of ops) weekKeys.add(o.weekStart);
      for (const b of budgets) {
        if (b.period === "WEEKLY" && b.weekStart) {
          weekKeys.add(b.weekStart);
        }
      }
      for (const w of weeklySales) weekKeys.add(w.weekStart);

      const selectedKey =
        appliedRange.from
          ? toISODate(startOfWeekMonday(normalizeDate(appliedRange.from)!))
          : undefined;

      return Array.from(weekKeys)
        .filter((ws) => !selectedKey || ws.slice(0, 10) === selectedKey)
        .sort((a, b) => a.localeCompare(b))
        .map((ws) => {
          const s = series.find((x) => x.weekStart === ws);
          const opsWeek = opsByWeek.get(ws);
          const budgetWeek = weeklyBudgetByWeekStart.get(ws);
          const salesWeek = weeklySalesMap.get(ws);

          const we =
            s?.weekEnd ??
            opsWeek?.weekEnd ??
            salesWeek?.weekEnd ??
            ws;

          const label = `${new Date(ws).toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
          })} → ${new Date(we).toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
          })}`;

          const rv0Planned = opsWeek?.rv0Planned ?? 0;
          const rv0Honored = opsWeek?.rv0Honored ?? 0;

          const rv1Planned = opsWeek?.rv1Planned ?? 0;
          const rv1Honored = opsWeek?.rv1Honored ?? 0;
          const callRequestsWeek = opsWeek?.callRequests ?? 0;

          const salesCount = salesWeek?.count ?? s?.wonCount ?? 0;
          const caVendu = salesWeek?.revenue ?? s?.revenue ?? 0;

          const budgetAmount = budgetWeek?.amount ?? s?.spend ?? 0;
          const caEncaisse = budgetWeek?.caEncaisse ?? null;

          const cpl =
            callRequestsWeek > 0 && budgetAmount > 0
              ? budgetAmount / callRequestsWeek
              : null;
          const costPerRv1Hon =
            rv1Honored > 0 && budgetAmount > 0
              ? budgetAmount / rv1Honored
              : null;
          const costPerSaleW =
            salesCount > 0 && budgetAmount > 0
              ? budgetAmount / salesCount
              : null;
          const roasEncaisseW =
            caEncaisse != null && budgetAmount > 0
              ? caEncaisse / budgetAmount
              : null;

          return {
            weekStart: ws,
            weekEnd: we,
            label,
            budgetAmount,
            callRequests: callRequestsWeek,
            rv0Planned,
            rv0Honored,
            rv1Planned,
            rv1Honored,
            salesCount,
            caVendu,
            caEncaisse,
            cpl,
            costPerRv1Hon,
            costPerSaleW,
            roasEncaisseW,
          };
        });
    }, [
      series,
      ops,
      budgets,
      weeklySales,
      opsByWeek,
      weeklyBudgetByWeekStart,
      weeklySalesMap,
      appliedRange,
    ]);

    async function saveWeekFinancials(
      weekStartISO: string,
      amountStr: string,
      cashInStr: string
    ) {
      const parseOrNull = (v: string): number | null => {
        const trimmed = v.trim();
        if (!trimmed) return null;
        const n = Number(trimmed.replace(",", "."));
        return Number.isFinite(n) ? n : NaN;
      };

      const amount = parseOrNull(amountStr);
      const cashIn = parseOrNull(cashInStr);

      if (Number.isNaN(amount)) {
        setErr("Le budget doit être un nombre valide");
        return;
      }
      if (Number.isNaN(cashIn)) {
        setErr("Le CA encaissé doit être un nombre valide");
        return;
      }

      if (amount == null && cashIn == null) {
        setErr("Rien à enregistrer pour cette semaine");
        return;
      }

      setSavingWeek(weekStartISO);
      try {
        const body: any = { weekStartISO };
        if (amount != null) body.amount = amount;
        if (cashIn != null) body.cashIn = cashIn;

        const posted = await tryPost([
          { url: "/reporting/budget", body },
          { url: "/analytics/budget", body },
        ]);
        if (!posted.ok) {
          setErr("Échec enregistrement des données financières");
          return;
        }

        const [seriesGet, budgetGet, opsGet, salesGet] = await Promise.all([
          tryGet<any>(
            [
              {
                url: "/reporting/weekly-series",
                params: { from: fromISO, to: toISO },
              },
              {
                url: "/analytics/weekly-series",
                params: { from: fromISO, to: toISO },
              },
            ],
            []
          ),
          tryGet<any>(
            [
              {
                url: "/reporting/budget",
              },
              {
                url: "/analytics/budget",
              },
            ],
            []
          ),
          tryGet<any>(
            [
              {
                url: "/reporting/weekly-ops",
                params: { from: fromISO, to: toISO },
              },
              {
                url: "/analytics/weekly-ops",
                params: { from: fromISO, to: toISO },
              },
            ],
            []
          ),
          tryGet<WeeklySales[]>(
            [
              {
                url: "/reporting/sales-weekly",
                params: { from: fromISO, to: toISO },
              },
              {
                url: "/analytics/sales-weekly",
                params: { from: fromISO, to: toISO },
              },
            ],
            []
          ),
        ]);

        const sData = seriesGet.data as any;
        setSeries(Array.isArray(sData) ? sData : sData?.series ?? []);

        const bData = (budgetGet.data ?? []) as any;
        setBudgets(Array.isArray(bData) ? bData : bData.rows ?? []);

        const oData = opsGet.data as any;
        const rows: WeeklyOpsRow[] = Array.isArray(oData)
          ? oData
          : oData?.rows ?? [];
        setOps(rows.slice().sort((a, b) => a.weekStart.localeCompare(b.weekStart)));

        setWeeklySales(
          (salesGet.data || [])
            .slice()
            .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
        );
      } catch (e: any) {
        setErr(e?.message || "Erreur lors de l’enregistrement");
      } finally {
        setSavingWeek(null);
      }
    }

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
                  <div className="text-xl md:text-2xl font-semibold">
                    Budget & ROAS – Vue hebdo
                  </div>
                  <div className="text-xs text-[--muted]">
                    Pour chaque semaine : budget pub, volumes d’ops et résultats
                    financiers. Pour la période : CPL, coûts par étape, ROAS et
                    bénéfices.
                  </div>
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-ghost relative"
                    onClick={() => setFiltersOpen(true)}
                    title="Filtres"
                  >
                    Filtres
                    {activeFiltersCount > 0 && (
                      <span className="absolute -right-2 -top-2 text-2xs px-1.5 py-0.5 rounded bg-white/20">
                        {activeFiltersCount}
                      </span>
                    )}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => exportSeriesCSV(series)}
                    title="Exporter en CSV"
                  >
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

            {loading ? (
              LoadingSkeleton
            ) : (
              <>
                {/* ✅ PANEL BUDGET SIMPLE */}
                <BudgetPanel />

                {/* KPIs global période */}
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {/* Leads période */}
                  <div
                    className="card cursor-pointer"
                    onClick={() => {
                      openLeadsDrill();
                    }}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Leads (période)
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {fmtInt(totalLeads)}
                    </div>
                  </div>

                  {/* Budget pub (période) */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Budget pub (période)
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {fmtEUR(totalBudget)}
                    </div>
                  </div>

                  {/* 🔥 Demandes d’appel (période) – même chiffre que dashboard */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Demandes d’appel (période)
                    </div>
                    <div className="mt-1 flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-semibold">
                          {fmtInt(totalCallRequests)}
                        </span>
                        {/*<button
                          type="button"
                          onClick={openCallRequestsDrill}
                          className="ml-auto text-[11px] text-sky-300 hover:text-sky-200"
                        >
                          Voir le détail
                        </button>*/}
                      </div>
                      {funnelLoading && (
                        <div className="text-[11px] text-[--muted]">
                          Chargement des métriques du funnel…
                        </div>
                      )}
                      {funnelError && (
                        <div className="text-[11px] text-rose-300">
                          Erreur funnel : {String(funnelError)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* CA vendu (CRM) */}
                  <div
                    className="card cursor-pointer"
                    onClick={() => openCohortSalesDrill()}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      CA vendu (CRM)
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {fmtEUR(totalCaVendu)}
                    </div>
                  </div>

                  {/* Profit */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Profit (CA vendu - budget)
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {fmtEUR(profit)}
                    </div>
                  </div>

                  {/* Ventes période */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Ventes (période)
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {fmtInt(totalSales)}
                    </div>
                  </div>

                  {/* RV0 faits période */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      RV0 faits (période)
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {fmtInt(opsTotals.rv0Honored)}
                    </div>
                  </div>

                  {/* RV1 planifiés période */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      RV1 planifiés (période)
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {fmtInt(opsTotals.rv1Planned)}
                    </div>
                  </div>

                  {/* RV1 faits période */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      RV1 faits (période)
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {fmtInt(opsTotals.rv1Honored)}
                    </div>
                  </div>
                </div>

                {/* KPIs coûts par étape */}
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                  {/* CPL global */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      CPL global
                    </div>
                    <div className="mt-1 text-xl font-semibold">
                      {fmtMaybeEUR(cplGlobal)}
                    </div>
                  </div>

                  {/* Coût / demande d’appel */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Coût / demande d’appel
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {fmtMaybeEUR(costPerCallRequest)}
                    </div>
                    <div className="mt-1 text-[11px] text-[--muted]">
                      Basé sur le budget pub et le nombre total de demandes d’appel
                      (mêmes chiffres que le dashboard).
                    </div>
                  </div>

                  {/* Coût / RV0 fait */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Coût / RV0 fait
                    </div>
                    <div className="mt-1 text-xl font-semibold">
                      {fmtMaybeEUR(costPerRv0Honored)}
                    </div>
                  </div>

                  {/* Coût / RV1 planifié */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Coût / RV1 planifié
                    </div>
                    <div className="mt-1 text-xl font-semibold">
                      {fmtMaybeEUR(costPerRv1Planned)}
                    </div>
                  </div>

                  {/* Coût / RV1 fait */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Coût / RV1 fait
                    </div>
                    <div className="mt-1 text-xl font-semibold">
                      {fmtMaybeEUR(costPerRv1Honored)}
                    </div>
                  </div>

                  {/* Coût / Vente */}
                  <div className="card">
                    <div className="text-[10px] uppercase tracking-wide text-[--muted]">
                      Coût / Vente
                    </div>
                    <div className="mt-1 text-xl font-semibold">
                      {fmtMaybeEUR(costPerSale)}
                    </div>
                  </div>
                </div>

                {/* Weekly Ops Board */}
                <div className="space-y-3">
                  <div className="text-sm font-medium">
                    Opérations par semaine
                  </div>
                  {ops.length ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {ops.map((w) => (
                        <WeekCard key={w.weekStart} {...w} />
                      ))}
                    </div>
                  ) : (
                    <div className="card text-[--muted]">
                      Aucune donnée sur l’intervalle.
                    </div>
                  )}
                </div>

                {/* Tableau hebdo comptable */}
                {supportsBudgetPost && (
                  <div className="card">
                    <div className="mb-2 font-medium">
                      Vue hebdomadaire – Budgets & résultats financiers
                    </div>
                    <div className="text-[11px] text-[--muted] mb-3">
                      Pour chaque semaine : saisis le budget pub et le CA encaissé.
                      Les coûts par lead, par RV0/RV1 fait, par vente et le ROAS sont
                      calculés automatiquement.
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[1100px]">
                        <thead className="text-left text-[--muted]">
                          <tr>
                            <th className="py-2 pr-2">Semaine</th>
                            <th className="py-2 pr-2">Budget pub (€)</th>
                            <th className="py-2 pr-2">Leads</th>
                            <th className="py-2 pr-2">RV0 planifiés</th>
                            <th className="py-2 pr-2">RV0 faits</th>
                            <th className="py-2 pr-2">CPL</th>
                            <th className="py-2 pr-2">RV1 planifiés</th>
                            <th className="py-2 pr-2">RV1 faits</th>
                            <th className="py-2 pr-2">Coût / RV1 fait</th>
                            <th className="py-2 pr-2">Ventes</th>
                            <th className="py-2 pr-2">Coût / Vente</th>
                            <th className="py-2 pr-2">CA vendu (€)</th>
                            <th className="py-2 pr-2">CA encaissé (€)</th>
                            <th className="py-2 pr-2">ROAS encaissé</th>
                            <th className="py-2 pr-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accountingRows.length ? (
                            accountingRows.map((r) => {
                              const key = r.weekStart;
                              const budgetDraft =
                                budgetDrafts[key] ??
                                (r.budgetAmount
                                  ? String(Math.round(r.budgetAmount))
                                  : "");
                              const cashDraft =
                                cashInDrafts[key] ??
                                (r.caEncaisse != null
                                  ? String(Math.round(r.caEncaisse))
                                  : "");

                              return (
                                <tr
                                  key={key}
                                  className="border-t border-white/10 hover:bg-white/[0.03]"
                                >
                                  <td className="py-2 pr-2">{r.label}</td>
                                  <td className="py-2 pr-2">
                                    <input
                                      className="w-24 rounded bg-white/10 px-2 py-1 text-right"
                                      inputMode="decimal"
                                      value={budgetDraft}
                                      onChange={(e) =>
                                        setBudgetDrafts((prev) => ({
                                          ...prev,
                                          [key]: e.target.value,
                                        }))
                                      }
                                    />
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtInt(r.callRequests)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtInt(r.rv0Planned)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtInt(r.rv0Honored)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtMaybeEUR(r.cpl)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtInt(r.rv1Planned)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtInt(r.rv1Honored)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtMaybeEUR(r.costPerRv1Hon)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtInt(r.salesCount)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtMaybeEUR(r.costPerSaleW)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtEUR(r.caVendu)}
                                  </td>
                                  <td className="py-2 pr-2">
                                    <input
                                      className="w-24 rounded bg-white/10 px-2 py-1 text-right"
                                      inputMode="decimal"
                                      value={cashDraft}
                                      onChange={(e) =>
                                        setCashInDrafts((prev) => ({
                                          ...prev,
                                          [key]: e.target.value,
                                        }))
                                      }
                                    />
                                  </td>
                                  <td className="py-2 pr-2">
                                    {fmtMaybeRatio(r.roasEncaisseW)}
                                  </td>
                                  <td className="py-2 pr-2 text-right">
                                    <button
                                      className="btn btn-ghost text-2xs"
                                      disabled={savingWeek === key}
                                      onClick={() =>
                                        saveWeekFinancials(
                                          key,
                                          budgetDraft,
                                          cashDraft
                                        )
                                      }
                                    >
                                      {savingWeek === key ? "…" : "Enregistrer"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td
                                className="py-4 text-[--muted]"
                                colSpan={15}
                              >
                                Aucune donnée hebdomadaire sur la période
                                sélectionnée.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

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
                  <button
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
                        className="tab"
                        onClick={() => {
                          const { from, to } = getCurrentWeek();
                          setUiRange({ from, to });
                        }}
                      >
                        Semaine en cours
                      </button>
                      <button
                        className="tab"
                        onClick={() => {
                          const { from, to } = getLastFullWeek();
                          setUiRange({ from, to });
                        }}
                      >
                        Semaine écoulée
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="label">Période personnalisée</div>
                    <DateRangePicker value={uiRange} onChange={setUiRange} />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-4">
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        const { from, to } = getLastFullWeek();
                        setUiRange({ from, to });
                      }}
                    >
                      Réinitialiser
                    </button>
                    <div className="flex gap-2">
                      <button
                        className="btn btn-ghost"
                        onClick={() => setFiltersOpen(false)}
                      >
                        Annuler
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          const f = uiRange.from
                            ? normalizeDate(uiRange.from)
                            : undefined;
                          const t = uiRange.to
                            ? normalizeDate(uiRange.to)
                            : undefined;

                          if (!f || !t) {
                            setErr(
                              "Merci de sélectionner une période complète."
                            );
                            return;
                          }

                          // On force : une seule semaine lundi → dimanche
                          const weekStart = startOfWeekMonday(f);
                          const weekEnd = endOfWeekSunday(f);

                          const tNoTime = new Date(
                            t.getFullYear(),
                            t.getMonth(),
                            t.getDate()
                          );
                          const weekEndNoTime = new Date(
                            weekEnd.getFullYear(),
                            weekEnd.getMonth(),
                            weekEnd.getDate()
                          );

                          if (tNoTime.getTime() !== weekEndNoTime.getTime()) {
                            setErr(
                              "Les filtres ne peuvent être appliqués que semaine par semaine, du lundi au dimanche. Merci de sélectionner une semaine complète."
                            );
                            return;
                          }

                          const snappedRange: Range = {
                            from: weekStart,
                            to: weekEnd,
                          };

                          setErr(null);
                          setUiRange(snappedRange);
                          setAppliedRange(snappedRange);
                          setFiltersOpen(false);
                        }}
                      >
                        Appliquer
                      </button>
                    </div>
                  </div>

                  <div className="text-[10px] text-[--muted]">
                    Rappel : les filtres s’appliquent{" "}
                    <b>semaine par semaine (lundi → dimanche)</b>.
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
