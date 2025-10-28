// Toujours côté client
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem("access_token"); } catch { return null; }
}

export function setAccessToken(token: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem("access_token", token); } catch {}
}

export function clearAccessToken() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem("access_token"); } catch {}
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
