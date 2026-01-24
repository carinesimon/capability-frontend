import type { AxiosRequestConfig } from "axios";
import api from "@/lib/api";
import { buildReportingFilterParams, getReportingFilters } from "@/lib/reportingFilters";

export function withReportingFilters(
  params?: Record<string, unknown>
): Record<string, unknown> {
  const filterParams = buildReportingFilterParams(getReportingFilters());
  return {
    ...filterParams,
    ...(params ?? {}),
  };
}

export function reportingGet<T>(
  url: string,
  config: AxiosRequestConfig = {}
) {
  return api.get<T>(url, {
    ...config,
    params: withReportingFilters(config.params as Record<string, unknown>),
  });
}
