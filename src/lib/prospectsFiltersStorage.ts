import { getTenantSlug } from "@/lib/api";

export type ProspectsFiltersState = {
  from?: string;
  to?: string;
  limit?: number;
  q?: string;
  tag?: string;
  source?: string;
  setterIds?: string[];
  closerIds?: string[];
};

const STORAGE_KEY_BASE = "prospectsFilters:v1";

function getStorageKey(): string {
  const tenant = getTenantSlug();
  return tenant ? `${STORAGE_KEY_BASE}:${tenant}` : STORAGE_KEY_BASE;
}

export function loadProspectsFilters(): ProspectsFiltersState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ProspectsFiltersState;
  } catch {
    return null;
  }
}

export function saveProspectsFilters(filters: ProspectsFiltersState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getStorageKey(),
      JSON.stringify(filters)
    );
  } catch {
    // ignore storage failures
  }
}
