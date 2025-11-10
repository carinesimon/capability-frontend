// src/hooks/useFunnelMetrics.ts
import { useEffect, useState } from "react";
import api from "@/lib/api";

export type FunnelTotals = {
  LEADS_RECEIVED: number;
  CALL_REQUESTED: number;
  CALL_ATTEMPT: number;
  CALL_ANSWERED: number;
  SETTER_NO_SHOW: number;
  RV0_PLANNED: number;
  RV0_HONORED: number;
  RV0_NO_SHOW: number;
  RV1_PLANNED: number;
  RV1_HONORED: number;
  RV1_NO_SHOW: number;
  RV2_PLANNED: number;
  RV2_HONORED: number;
  WON: number;
  // si ton enum LeadStage a d’autres valeurs, elles
  // arriveront aussi dans l’objet, et seront gérées
  // par normalizeTotals côté page.tsx
};

function toISODate(d: Date | string) {
  const dd = d instanceof Date ? d : new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function useFunnelMetrics(fromDate?: Date | null, toDate?: Date | null) {
  const [data, setData] = useState<FunnelTotals | {}>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!fromDate || !toDate) return;

    let cancelled = false;
    const from = toISODate(fromDate);
    const to = toISODate(toDate);

    async function load() {
      try {
        setLoading(true);
        setError(null);

        // ✅ On utilise enfin le backend de métriques basé sur StageEvent
        const res = await api.get<FunnelTotals>("/metrics/funnel", {
          params: { from, to },
        });

        if (cancelled) return;
        setData(res.data || {});
      } catch (e) {
        if (cancelled) return;
        setError(e);
        setData({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    // on dépend des timestamps pour éviter les boucles
  }, [fromDate?.getTime(), toDate?.getTime()]);

  return { data, loading, error };
}
