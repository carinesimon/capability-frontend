import type { ReportingFilterState } from "@/lib/reportingFilters";
import { getTenantSlug } from "@/lib/api";

const STORAGE_KEY_BASE = "dashboardFilters:v1";

function getStorageKey(): string {
  const tenant = getTenantSlug();
  return tenant ? `${STORAGE_KEY_BASE}:${tenant}` : STORAGE_KEY_BASE;
}

export function loadDashboardFilters(): ReportingFilterState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ReportingFilterState;
  } catch {
    return null;
  }
}

export function saveDashboardFilters(filters: ReportingFilterState): void {
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
