// frontend/src/lib/api.ts
import axios from "axios";
import type { AxiosRequestHeaders } from "axios";import type { AxiosRequestHeaders } from "axios";
import { getAccessToken, clearAccessToken } from "./auth";
import { getGlobalSourcesFilters } from "./globalSourcesFilters";

/**
 * Base URL de l'API (sans slash final)
 * Requis : NEXT_PUBLIC_API_URL
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
let hasWarnedMissingBaseUrl = false;
let hasLoggedMergedParams = false;

/**
 * Détection optionnelle du tenant
 * - /t/<slug>/... dans l'URL
 * - localStorage("tenant")
 * - NEXT_PUBLIC_TENANT
 */
export function getTenantSlug(): string | null {
  try {
    if (typeof window !== "undefined") {
      // Schéma d'URL : /t/<tenant>/...
      const m = window.location.pathname.match(/^\/t\/([^/]+)/);
      if (m?.[1]) return m[1];

      // Stockage local (au besoin)
      const ls = localStorage.getItem("tenant");
      if (ls) return ls;
    }
  } catch {
    /* ignore */
  }
  return process.env.NEXT_PUBLIC_TENANT ?? null;
}

/**
 * Construit un chemin d'API sûr :
 * - garantit un slash initial
 * - préfixe /t/<tenant> si un tenant est présent
 */
export function apiPath(path: string): string {
  const tenant = getTenantSlug();
  if (!path.startsWith("/")) path = `/${path}`;
  return tenant ? `/t/${tenant}${path}` : path;
}

/** Instance Axios */
const api = axios.create({
  baseURL: BASE_URL || undefined,
  withCredentials: false, // passe à true si tu utilises des cookies httpOnly
  timeout: 15000,
});

/** Intercepteur requête : Bearer */
api.interceptors.request.use((config) => {
  if (!BASE_URL) {
    const isAuthCall = /\/auth(\/|$)/.test(config.url || "");
    if (!hasWarnedMissingBaseUrl && process.env.NODE_ENV !== "production") {
      hasWarnedMissingBaseUrl = true;
      console.warn(
        "[API] NEXT_PUBLIC_API_URL is not set; non-auth calls will be blocked to avoid localhost requests."
      );
    }
    if (!isAuthCall) {
      throw new Error(
        "NEXT_PUBLIC_API_URL is required for API requests. Set it to avoid localhost calls."
      );
    }
  }
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers || {};
    (config.headers as AxiosRequestHeaders).Authorization = `Bearer ${token}`;
  }
  const url = config.url || "";
  const path = url.startsWith("http")
    ? new URL(url).pathname
    : url;
  if (/\/(reporting|metrics)(\/|$)/.test(path)) {
    const { sourcesCsv, sourcesExcludeCsv } = getGlobalSourcesFilters();
    if (sourcesCsv || sourcesExcludeCsv) {
      if (config.params instanceof URLSearchParams) {
        if (sourcesCsv) {
          config.params.set("sourcesCsv", sourcesCsv);
        }
        if (sourcesExcludeCsv) {
          config.params.set("sourcesExcludeCsv", sourcesExcludeCsv);
        }
      } else {
        config.params = {
          ...(config.params ?? {}),
          ...(sourcesCsv ? { sourcesCsv } : {}),
          ...(sourcesExcludeCsv ? { sourcesExcludeCsv } : {}),
        };
      }
    }
    if (!hasLoggedMergedParams && process.env.NODE_ENV !== "production") {
      hasLoggedMergedParams = true;
      const baseUrl = config.baseURL ?? "";
      const urlValue = config.url ?? "";
      console.info("[API] request params", {
        url: `${baseUrl}${urlValue}`,
        params: config.params,
      });
    }
  }
  return config;
});

/** Intercepteur réponse : 401 → redirection login (sauf /auth/login) */
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const url = (err?.config?.baseURL || "") + (err?.config?.url || "");
    console.error("[API ERROR]", status, url, err?.response?.data || err?.message);

    const isAuthLoginCall = /\/auth\/login$/.test(err?.config?.url || "");
    if (typeof window !== "undefined" && status === 401 && !isAuthLoginCall) {
      clearAccessToken();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.replace("/login");
      }
    }
    return Promise.reject(err);
  }
);

/* ===================== Helpers spécifiques ===================== */

/** Funnel metrics — retourne { totals: Record<string, number> } */
export async function getFunnelMetrics(startISO: string, endISO: string) {
  const res = await api.get(apiPath("/metrics/funnel"), {
    params: { start: startISO, end: endISO },
  });
  // Selon ton backend : soit il renvoie { totals: {...} }, soit déjà un record simple.
  // On normalise pour que l'appelant puisse lire .totals.
  const data = res.data ?? {};
  if (data.totals && typeof data.totals === "object") return data as { totals: Record<string, number> };
  return { totals: data as Record<string, number> };
}

/** Déplacer un lead vers un stage (event-sourcing + update current) */
export async function moveLeadToStage(leadId: string, toStage: string) {
  await api.post(apiPath(`/leads/${leadId}/stage`), { toStage, source: "ui" });
}

/** Déplacer un lead vers une colonne libre (board) */
export async function moveLeadToBoardColumn(leadId: string, columnKey: string) {
  await api.post(apiPath(`/leads/${leadId}/board`), { columnKey });
}
export default api;


