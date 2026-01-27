export type GlobalSourcesFiltersState = {
  sources: string[];
  excludeSources: string[];
};

type GlobalSourcesFiltersPayload = {
  sourcesCsv?: string;
  sourcesExcludeCsv?: string;
};

let currentFilters: GlobalSourcesFiltersPayload = {};

export function setGlobalSourcesFilters(next: GlobalSourcesFiltersPayload) {
  currentFilters = next;
}

export function getGlobalSourcesFilters(): GlobalSourcesFiltersPayload {
  return currentFilters;
}

export function parseCsv(value: string | null): string[] {
  if (!value) return [];
  const parts = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out;
}

export function serializeCsv(values: string[]): string | undefined {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
  if (!normalized.length) return undefined;
  return normalized.join(",");
}
