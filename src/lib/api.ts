import axios from "axios";
import { getAccessToken, clearAccessToken } from "./auth";

// Accepte deux noms d'env, fallback sur 4000 (Nest par défaut)
const BASE_URL =
  (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");

console.log("[API] baseURL =", BASE_URL);

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: false, // passe à true si tu utilises des cookies httpOnly
  timeout: 15000,
});

// Bearer à chaque requête
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// Gestion 401 : ne pas rediriger pour l'appel /auth/login
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

export default api;
