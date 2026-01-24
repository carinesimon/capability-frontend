import { useSyncExternalStore } from "react";

export type ReportingFilters = {
  from?: string;
  to?: string;
  tz: string;
  sourcesInclude: string[];
  sourcesExclude: string[];
  setterIds: string[];
  closerIds: string[];
};

const DEFAULT_TZ = "Europe/Paris";

let filters: ReportingFilters = {
  from: undefined,
  to: undefined,
  tz: DEFAULT_TZ,
  sourcesInclude: [],
  sourcesExclude: [],
  setterIds: [],
  closerIds: [],
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getReportingFilters(): ReportingFilters {
  return filters;
}

export function setReportingFilters(next: Partial<ReportingFilters>) {
  filters = {
    ...filters,
    ...next,
  };
  emit();
}

export function subscribeReportingFilters(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReportingFilters() {
  return useSyncExternalStore(
    subscribeReportingFilters,
    getReportingFilters,
    getReportingFilters
  );
}

function parseCsv(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseReportingFiltersFromSearchParams(
  params: URLSearchParams
): Partial<ReportingFilters> {
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  const tz = params.get("tz") ?? undefined;
  return {
    from,
    to,
    tz,
    sourcesInclude: parseCsv(params.get("sourcesCsv")),
    sourcesExclude: parseCsv(params.get("sourcesExcludeCsv")),
    setterIds: parseCsv(params.get("setterIdsCsv")),
    closerIds: parseCsv(params.get("closerIdsCsv")),
  };
}

export function buildReportingFilterParams(
  current: ReportingFilters
): Record<string, string> {
  const params: Record<string, string> = {};
  if (current.from) params.from = current.from;
  if (current.to) params.to = current.to;
  if (current.tz) params.tz = current.tz;
  if (current.sourcesInclude.length > 0)
    params.sourcesCsv = current.sourcesInclude.join(",");
  if (current.sourcesExclude.length > 0)
    params.sourcesExcludeCsv = current.sourcesExclude.join(",");
  if (current.setterIds.length > 0)
    params.setterIdsCsv = current.setterIds.join(",");
  if (current.closerIds.length > 0)
    params.closerIdsCsv = current.closerIds.join(",");
  return params;
}

export function applyReportingFiltersToSearchParams(
  params: URLSearchParams,
  current: ReportingFilters
) {
  if (current.from) params.set("from", current.from);
  else params.delete("from");

  if (current.to) params.set("to", current.to);
  else params.delete("to");

  if (current.tz) params.set("tz", current.tz);
  else params.delete("tz");

  if (current.sourcesInclude.length > 0)
    params.set("sourcesCsv", current.sourcesInclude.join(","));
  else params.delete("sourcesCsv");

  if (current.sourcesExclude.length > 0)
    params.set("sourcesExcludeCsv", current.sourcesExclude.join(","));
  else params.delete("sourcesExcludeCsv");

  if (current.setterIds.length > 0)
    params.set("setterIdsCsv", current.setterIds.join(","));
  else params.delete("setterIdsCsv");

  if (current.closerIds.length > 0)
    params.set("closerIdsCsv", current.closerIds.join(","));
  else params.delete("closerIdsCsv");
}

export function normalizeReportingFilters(
  current: Partial<ReportingFilters>
): ReportingFilters {
  return {
    from: current.from,
    to: current.to,
    tz: current.tz ?? DEFAULT_TZ,
    sourcesInclude: current.sourcesInclude ?? [],
    sourcesExclude: current.sourcesExclude ?? [],
    setterIds: current.setterIds ?? [],
    closerIds: current.closerIds ?? [],
  };
}
