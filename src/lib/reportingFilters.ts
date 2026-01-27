import { parseCsv, serializeCsv } from "@/lib/globalSourcesFilters";

export type ReportingFilterState = {
  from?: string;
  to?: string;
  tz?: string;
  setterIds?: string[];
  closerIds?: string[];
  tags?: string[];
  sources?: string[];
  excludeSources?: string[];
};

export type ReportingFilterParams = {
  from?: string;
  to?: string;
  tz?: string;
  setterIdsCsv?: string;
  closerIdsCsv?: string;
  tagsCsv?: string;
  sourcesCsv?: string;
  sourcesExcludeCsv?: string;
};

export function buildReportingFilterParams(
  filters: ReportingFilterState
): ReportingFilterParams {
  return {
    from: filters.from,
    to: filters.to,
    tz: filters.tz,
    setterIdsCsv: serializeCsv(filters.setterIds ?? []),
    closerIdsCsv: serializeCsv(filters.closerIds ?? []),
    tagsCsv: serializeCsv(filters.tags ?? []),
    sourcesCsv: serializeCsv(filters.sources ?? []),
    sourcesExcludeCsv: serializeCsv(filters.excludeSources ?? []),
  };
}

export function parseReportingFiltersFromSearchParams(
  searchParams: URLSearchParams
): ReportingFilterState {
  return {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    tz: searchParams.get("tz") ?? undefined,
    setterIds: parseCsv(searchParams.get("setterIdsCsv")),
    closerIds: parseCsv(searchParams.get("closerIdsCsv")),
    tags: parseCsv(searchParams.get("tagsCsv")),
    sources: parseCsv(searchParams.get("sourcesCsv")),
    excludeSources: parseCsv(searchParams.get("sourcesExcludeCsv")),
  };
}

export function updateSearchParamsWithReportingFilters(
  searchParams: URLSearchParams,
  filters: ReportingFilterState,
  options: { includeSources?: boolean } = {}
): URLSearchParams {
  const next = new URLSearchParams(searchParams.toString());
  const params = buildReportingFilterParams(filters);

  const setParam = (key: string, value?: string) => {
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
  };

  setParam("from", params.from);
  setParam("to", params.to);
  setParam("tz", params.tz);
  setParam("setterIdsCsv", params.setterIdsCsv);
  setParam("closerIdsCsv", params.closerIdsCsv);
  setParam("tagsCsv", params.tagsCsv);

  if (options.includeSources) {
    setParam("sourcesCsv", params.sourcesCsv);
    setParam("sourcesExcludeCsv", params.sourcesExcludeCsv);
  }

  return next;
}
