// src/hooks/useFunnelMetrics.ts
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import api from "@/lib/api";
import type { ReportingFilterParams } from "@/lib/reportingFilters";

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
  tz?: Timezone,
  filters?: ReportingFilterParams
) {
  const debugFilters =
    process.env.NEXT_PUBLIC_DEBUG_FILTERS === "true" &&
    process.env.NODE_ENV !== "production";
  const [data, setData] = useState<FunnelTotals | Record<string, never>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tagsUnsupportedRef = useRef(false);
  const fromTime = fromDate?.getTime();
  const toTime = toDate?.getTime();

  const isTagsUnsupportedError = (err: unknown) => {
    if (!axios.isAxiosError(err)) return false;
    const status = err.response?.status ?? 0;
    if (status !== 400 && status !== 422) return false;
    const payload = err.response?.data;
    const message =
      typeof payload === "string"
        ? payload
        : (payload as { message?: string })?.message ?? "";
    return message.toLowerCase().includes("tag");
  };

  useEffect(() => {
    if (!fromTime || !toTime) return;

    let cancelled = false;
    const from = toISODate(new Date(fromTime));
    const to = toISODate(new Date(toTime));

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const allowTags = !tagsUnsupportedRef.current;
        const params = {
          ...(filters ?? {}),
          from,
          to,
          tz,
        };
        if (!allowTags && params.tagsCsv) {
          delete params.tagsCsv;
        }

        if (debugFilters) {
          console.info("[Filters] request", {
            url: "/metrics/funnel",
            params,
          });
        }

        try {
          const res = await api.get<FunnelTotals>("/metrics/funnel", {
            params,
          });

          if (cancelled) return;
          setData(res.data || {});
        } catch (e) {
          if (allowTags && isTagsUnsupportedError(e) && params.tagsCsv) {
            tagsUnsupportedRef.current = true;
            if (debugFilters) {
              console.info("[Filters] tags unsupported, retrying without tags", {
                url: "/metrics/funnel",
              });
            }
            const { tagsCsv: _tagsCsv, ...rest } = params;
            void _tagsCsv;
            const retry = await api.get<FunnelTotals>("/metrics/funnel", {
              params: rest,
            });
            if (cancelled) return;
            setData(retry.data || {});
            return;
          }
          throw e;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e);
        setData({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fromTime, toTime, tz, filters, debugFilters]); // ✅ tz dans les deps
  return { data, loading, error };
}

