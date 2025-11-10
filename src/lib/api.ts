// frontend/src/lib/api.ts
import axios from "axios";
import { getAccessToken, clearAccessToken } from "./auth";

/**
 * Base URL de l'API (sans slash final)
 * Compat : accepte NEXT_PUBLIC_API_URL ou NEXT_PUBLIC_API_BASE_URL
 */
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:4000").replace(/\/$/, "");

console.log("[API] baseURL =", BASE_URL);

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
  baseURL: BASE_URL,
  withCredentials: false, // passe à true si tu utilises des cookies httpOnly
  timeout: 15000,
});

/** Intercepteur requête : Bearer */
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Intercepteur réponse : 401 → redirection login (sauf /auth/login) */
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err?.response?.status;
    const url = (err?.config?.baseURL || "") + (err?.config?.url || "");
    // eslint-disable-next-line no-console
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