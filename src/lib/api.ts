// frontend/src/lib/api.ts
import axios from "axios";
import type { AxiosRequestHeaders } from "axios";
import { getAccessToken, clearAccessToken } from "./auth";
import { getGlobalSourcesFilters } from "./globalSourcesFilters";

/**
 * Base URL de l'API (sans slash final)
 * Requis : NEXT_PUBLIC_API_URL
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
const DEBUG_FILTERS =
  process.env.NEXT_PUBLIC_DEBUG_FILTERS === "true" &&
  process.env.NODE_ENV !== "production";
const RESPONSE_LOG_LIMIT = 2000;
let hasWarnedMissingBaseUrl = false;
let hasLoggedMergedParams = false;
const spotlightResponsePattern =
  /^\/reporting\/(spotlight-setters|spotlight-closers)(\/|$)/;
const filterOptionsResponsePattern = /^\/reporting\/filter-options(\/|$)/;
const stageSeriesResponsePattern = /^\/metrics\/stage-series(\/|$)/;

function normalizeParams(params: unknown): Record<string, unknown> {
  if (!params) return {};
  if (params instanceof URLSearchParams) {
    return Object.fromEntries(params.entries());
  }
  if (typeof params === "object") {
    return { ...(params as Record<string, unknown>) };
  }
  return {};
}

function extractFilterParams(params: Record<string, unknown>) {
  const setterIds = params.setterIds ?? params.setterIdsCsv;
  const closerIds = params.closerIds ?? params.closerIdsCsv;
  const tags = params.tags ?? params.tagsCsv;
  return {
    from: params.from,
    to: params.to,
    tz: params.tz,
    setterIds,
    closerIds,
    sourcesCsv: params.sourcesCsv,
    sourcesExcludeCsv: params.sourcesExcludeCsv,
    tags,
  };
}

function truncateResponseBody(data: unknown): string {
  if (data == null) return "null";
  let raw: string;
  if (typeof data === "string") {
    raw = data;
  } else {
    try {
      raw = JSON.stringify(data);
    } catch {
      raw = String(data);
    }
  }
  if (raw.length <= RESPONSE_LOG_LIMIT) return raw;
  return `${raw.slice(0, RESPONSE_LOG_LIMIT)}…`;
}

function resolvePath(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
  return url;
}

function shouldLogResponse(path: string) {
  return (
    spotlightResponsePattern.test(path) ||
    filterOptionsResponsePattern.test(path) ||
    stageSeriesResponsePattern.test(path)
  );
}

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
  const path = resolvePath(url);
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
    if (DEBUG_FILTERS) {
      const params = normalizeParams(config.params);
      const baseUrl = config.baseURL ?? "";
      const urlValue = config.url ?? "";
      console.info("[API DEBUG] request", {
        url: `${baseUrl}${urlValue}`,
        params,
        filters: extractFilterParams(params),
      });
    } else if (!hasLoggedMergedParams && process.env.NODE_ENV !== "production") {
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
  (r) => {
    if (DEBUG_FILTERS) {
      const path = resolvePath(r.config?.url || "");
      if (shouldLogResponse(path)) {
        console.info("[API DEBUG] response", {
          url: `${r.config?.baseURL ?? ""}${r.config?.url ?? ""}`,
          status: r.status,
          body: truncateResponseBody(r.data),
        });
      }
    }
    return r;
  },
  (err) => {
    const status = err?.response?.status;
    const url = (err?.config?.baseURL || "") + (err?.config?.url || "");
    console.error("[API ERROR]", status, url, err?.response?.data || err?.message);
    if (DEBUG_FILTERS) {
      const path = resolvePath(err?.config?.url || "");
      if (shouldLogResponse(path)) {
        console.info("[API DEBUG] response error", {
          url,
          status,
          body: truncateResponseBody(err?.response?.data || err?.message),
        });
      }
    }

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





