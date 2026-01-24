// src/hooks/useFunnelMetrics.ts
import { useEffect, useMemo, useState } from "react";
import { reportingGet } from "@/lib/reportingApi";
import { useReportingFilters } from "@/lib/reportingFilters";

export type FunnelTotals = {
  LEADS_RECEIVED: number;
  CALL_REQUESTED: number;
  CALL_ATTEMPT: number;
  CALL_ANSWERED: number;
  SETTER_NO_SHOW: number;

  RV0_PLANNED: number;
  RV0_HONORED: number;
  RV0_NO_SHOW: number;
  RV0_CANCELED: number;   // ✅ nouveau

  RV1_PLANNED: number;
  RV1_HONORED: number;
  RV1_NO_SHOW: number;
  RV1_POSTPONED?: number;
  RV1_CANCELED: number;   // ✅ nouveau

  RV2_PLANNED: number;
  RV2_HONORED: number;
  RV2_POSTPONED?: number;
  RV2_CANCELED: number;   // ✅ nouveau

  NOT_QUALIFIED?: number;
  LOST?: number;
  WON: number;

  // agrégat global des RDV annulés (si ton backend le renvoie)
  APPOINTMENT_CANCELED?: number;
};

function toISODate(d: Date | string) {
  const dd = d instanceof Date ? d : new Date(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, "0");
  const day = String(dd.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type Timezone = string; // ex: 'Europe/Paris', 'Africa/Abidjan', ...

export function useFunnelMetrics(
  fromDate?: Date | null,
  toDate?: Date | null,
  tz?: Timezone
) {
  const [data, setData] = useState<FunnelTotals | {}>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { sourcesInclude, sourcesExclude, setterIds, closerIds } =
    useReportingFilters();
  const filterKey = useMemo(
    () =>
      [
        sourcesInclude.join(","),
        sourcesExclude.join(","),
        setterIds.join(","),
        closerIds.join(","),
      ].join("|"),
    [sourcesInclude, sourcesExclude, setterIds, closerIds]
  );

  useEffect(() => {
    if (!fromDate || !toDate) return;

    let cancelled = false;
    const from = toISODate(fromDate);
    const to = toISODate(toDate);

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await reportingGet<FunnelTotals>("/metrics/funnel", {
          params: { from, to, tz }, // ✅ on envoie le tz au backend
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
  }, [fromDate?.getTime(), toDate?.getTime(), tz, filterKey]); // ✅ tz dans les deps

  return { data, loading, error };
}

