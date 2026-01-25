// src/lib/reporting.ts
import api from "@/lib/api";

/** ---- Types alignés au backend ---- */
export type LeadsReceivedOut = {

  total: number;
  byDay?: Array<{ day: string; count: number }>;
};

export type SalesTotalOut = {
  revenue: number;
  count: number;
  byCloser: Array<{ closerId: string | null; closerName: string; revenue: number; count: number }>;
  bySetter: Array<{ setterId: string | null; setterName: string; revenue: number; count: number }>;
};

export type SalesWeeklyItem = { weekStart: string; weekEnd: string; revenue: number; count: number };

export type SummaryOut = {
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

export type MetricSeriesOut = {
  total: number;
  byDay?: Array<{ day: string; count: number }>;
};

export type CohortStatusRequest = {
  cohortFrom: string;
  cohortTo: string;
  asOf: string;
  tz?: string;
  sourcesCsv?: string;
  sourcesExcludeCsv?: string;
  setterIdsCsv?: string;
  closerIdsCsv?: string;
};

export type CohortStatusResponse = {
  total: number;
  withStage: number;
  unreached: number;
  stages?: Array<{ stage: string; count: number }>;
  byStage?: Array<{ stage: string; count: number }>;
};

export type SpotlightSetterRow = {
  userId: string;
  name: string;
  email: string;
  rv1PlannedOnHisLeads: number;
  rv1DoneOnHisLeads: number;
  rv1CanceledOnHisLeads: number;
  rv1CancelRate: number | null;
  salesFromHisLeads: number;
  revenueFromHisLeads: number;
  settingRate: number | null;
  leadsReceived: number;
};

export type SpotlightCloserRow = {
  userId: string;
  name: string;
  email: string;
  rv1Planned: number;
  rv1Honored: number;
  rv1Canceled: number;
  rv1CancelRate: number | null;
  rv2Planned: number;
  rv2Canceled: number;
  rv2CancelRate: number | null;
  salesClosed: number;
  revenueTotal: number;
  closingRate: number | null;
};

export async function getSpotlightSetters(from?: string, to?: string): Promise<SpotlightSetterRow[]> {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const res = await fetch(`/reporting/spotlight-setters?${q.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch spotlight setters');
  return res.json();
}

export async function getSpotlightClosers(from?: string, to?: string): Promise<SpotlightCloserRow[]> {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const res = await fetch(`/reporting/spotlight-closers?${q.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch spotlight closers');
  return res.json();
}


/** Un util simple pour fusionner des séries par jour */
function mergeByDay(keys: string[], seriesMap: Record<string, Array<{ day: string; count: number }>>): Array<any> {
  const allDays = new Set<string>();
  for (const k of keys) for (const it of (seriesMap[k] || [])) allDays.add(it.day);

  const days = Array.from(allDays).sort((a, b) => a.localeCompare(b));
  return days.map(dayISO => {
    const row: any = { day: dayISO };
    for (const k of keys) {
      const hit = (seriesMap[k] || []).find(x => x.day === dayISO);
      row[k] = hit?.count ?? 0;
    }
    row.total = keys.reduce((s, k) => s + (row[k] || 0), 0);
    return row;
  });
}

export const reportingApi = {
  /** Tous ces endpoints acceptent maintenant le fuseau IANA (tz) */
  leadsReceived: (from?: string, to?: string, tz?: string) =>
    api.get<LeadsReceivedOut>("/reporting/leads-received", { params: { from, to, tz } }).then(r => r.data),

  salesTotal: (from?: string, to?: string, tz?: string) =>
    api.get<SalesTotalOut>("/reporting/sales-total", { params: { from, to, tz } }).then(r => r.data),

  salesWeekly: (from?: string, to?: string, tz?: string) =>
    api.get<SalesWeeklyItem[]>("/reporting/sales-weekly", { params: { from, to, tz } }).then(r => r.data),

  summary: (from?: string, to?: string, tz?: string) =>
    api.get<SummaryOut>("/reporting/summary", { params: { from, to, tz } }).then(r => r.data),

  listBudgets: (from?: string, to?: string, tz?: string) =>
    api
      .get<Array<{ id: string; weekStart: string; amount: number }>>("/reporting/budget", {
        params: { from, to, tz },
      })
      .then(r => r.data),

  upsertWeeklyBudget: (weekStartISO: string, amount: number) =>
    api.post("/reporting/budget", { weekStartISO, amount }),

  /** --------- Nouveaux helpers pour les séries d’événements (StageEvent) --------- */

  /**
   * Séries d’un stage donné, agrégées par jour dans le fuseau tz (backend: /metrics/stage-series).
   * Exemples de stage : "RV0_CANCELED", "RV1_CANCELED", "RV2_CANCELED", "CALL_REQUESTED", ...
   */
  stageSeries: (stage: string, from?: string, to?: string, tz?: string) =>
    api
      .get<MetricSeriesOut>("/metrics/stage-series", { params: { stage, from, to, tz } })
      .then(r => r.data),

  /**
   * Annulés par jour (un seul graphe) : renvoie un tableau
   * [{ day, RV0_CANCELED, RV1_CANCELED, RV2_CANCELED, total }]
   * déjà fusionné, prêt pour Recharts.
   */
  canceledDaily: async (from?: string, to?: string, tz?: string) => {
    const [rv0, rv1, rv2] = await Promise.all([
      api.get<MetricSeriesOut>("/metrics/stage-series", { params: { stage: "RV0_CANCELED", from, to, tz } }),
      api.get<MetricSeriesOut>("/metrics/stage-series", { params: { stage: "RV1_CANCELED", from, to, tz } }),
      api.get<MetricSeriesOut>("/metrics/stage-series", { params: { stage: "RV2_CANCELED", from, to, tz } }),
    ]);

    const data = mergeByDay(
      ["RV0_CANCELED", "RV1_CANCELED", "RV2_CANCELED"],
      {
        RV0_CANCELED: rv0.data?.byDay || [],
        RV1_CANCELED: rv1.data?.byDay || [],
        RV2_CANCELED: rv2.data?.byDay || [],
      }
    );

    return {
      total:
        (rv0.data?.total || 0) +
        (rv1.data?.total || 0) +
        (rv2.data?.total || 0),
      byDay: data as Array<{ day: string; RV0_CANCELED: number; RV1_CANCELED: number; RV2_CANCELED: number; total: number }>,
    };
  },
  cohortStatus: (payload: CohortStatusRequest) =>
    api
      .post<CohortStatusResponse>("/reporting/cohort-status", payload)
      .then((r) => r.data),
};
