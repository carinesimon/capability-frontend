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
  // raccourci éventuel si besoin : topClosers, topSetters, raw...
};

export const reportingApi = {
  leadsReceived: (from?: string, to?: string) =>
    api.get<LeadsReceivedOut>("/reporting/leads-received", { params: { from, to } }).then(r => r.data),

  salesTotal: (from?: string, to?: string) =>
    api.get<SalesTotalOut>("/reporting/sales-total", { params: { from, to } }).then(r => r.data),

  salesWeekly: (from?: string, to?: string) =>
    api.get<SalesWeeklyItem[]>("/reporting/sales-weekly", { params: { from, to } }).then(r => r.data),

  summary: (from?: string, to?: string) =>
    api.get<SummaryOut>("/reporting/summary", { params: { from, to } }).then(r => r.data),

  listBudgets: (from?: string, to?: string) =>
    api.get<Array<{ id: string; weekStart: string; amount: number }>>("/reporting/budget", {
      params: { from, to },
    }).then(r => r.data),

  upsertWeeklyBudget: (weekStartISO: string, amount: number) =>
    api.post("/reporting/budget", { weekStartISO, amount }),
};
