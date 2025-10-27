"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import api from "@/lib/api";
import { setAccessToken } from "@/lib/auth";

/** --------- FX : blobs doux animés (sans deps externes) --------- */
function BackgroundFX() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* gradient radial global */}
      <div className="absolute -inset-[30%] bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.25),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(34,197,94,0.18),transparent_42%),radial-gradient(circle_at_70%_80%,rgba(14,165,233,0.18),transparent_40%)]" />
      {/* blobs animés */}
      <motion.div
        aria-hidden
        className="absolute left-[-10%] top-[12%] h-80 w-80 rounded-full blur-3xl bg-indigo-500/25"
        animate={{ y: [0, -30, 0], x: [0, 20, 0], scale: [1, 1.06, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute right-[-6%] top-[25%] h-96 w-96 rounded-full blur-3xl bg-emerald-400/20"
        animate={{ y: [0, 25, 0], x: [0, -20, 0], scale: [1, 1.04, 1] }}
        transition={{ duration: 13, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
      />
      <motion.div
        aria-hidden
        className="absolute left-[10%] bottom-[-8%] h-96 w-96 rounded-full blur-[90px] bg-sky-400/20"
        animate={{ y: [0, -18, 0], x: [0, 16, 0], scale: [1, 1.05, 1] }}
        transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
      />
      {/* fine grid */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.14]" aria-hidden>
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" className="text-white" />
      </svg>
    </div>
  );
}

/** --------- Icônes analytics inline (SVGs) --------- */
function IconBars() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-90">
      <path fill="currentColor" d="M5 21H3V10h2zm6 0H9V3h2zm6 0h-2v-6h2z"/>
    </svg>
  );
}
function IconLine() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-90">
      <path fill="currentColor" d="M3 17l6-6l4 4l7-7l1.5 1.5L13 18l-4-4l-6 6z"/>
    </svg>
  );
}
function IconDonut() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-90">
      <path fill="currentColor" d="M11 2v4a6 6 0 1 1-6 6H1A11 11 0 1 0 12 1z"/>
    </svg>
  );
}

/** --------- Petit spinner pour le bouton --------- */
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-90" d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" fill="none" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { email, password });
      const token = res?.data?.access_token || res?.data?.token;
      if (!token) throw new Error("Token manquant dans la réponse");
      setAccessToken(token);
      router.replace("/dashboard");
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error("LOGIN_ERROR", e?.response?.status, e?.response?.data || e?.message);
      setErr(e?.response?.data?.message || "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-[linear-gradient(180deg,#0b1020_0%,#0b1020_60%,#0e1424_100%)]">
      <BackgroundFX />

      {/* Header compact */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-6">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center h-10 w-10 rounded-2xl bg-white/10 border border-white/10">
            {/* logo dashboard */}
            <svg width="20" height="20" viewBox="0 0 24 24" className="text-white opacity-90">
              <path fill="currentColor" d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z" />
            </svg>
          </div>
          <div>
            <div className="text-sm tracking-widest text-white/60 uppercase">Welcome to</div>
            <div className="text-xl font-semibold flex items-center gap-2">
              Capability Dashboard
              <span className="text-white/60 flex items-center gap-1">
                <IconBars /> <IconLine /> <IconDonut />
              </span>
            </div>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 text-white/60 text-xs">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Système sécurisé
        </div>
      </div>

      {/* Hero titre */}
      <div className="relative z-10 mt-10 flex flex-col items-center text-center px-6">
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="text-3xl md:text-4xl font-semibold tracking-tight"
        >
          Entrez dans votre <span className="text-indigo-300">Dashboard</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut", delay: 0.05 }}
          className="mt-2 max-w-2xl text-white/70 flex items-center justify-center gap-2"
        >
          KPIs, opérations et analyses — au même endroit
          <span className="inline-flex items-center gap-1 text-white/60">
            <IconBars /> <IconLine /> <IconDonut />
          </span>
        </motion.p>
      </div>

      {/* Carte Login */}
      <div className="relative z-10 mx-auto mt-8 w-full max-w-md px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="relative rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl shadow-[0_10px_60px_rgba(0,0,0,0.35)]"
        >
          {/* Décors analytics discrets autour de la carte */}
          <div className="pointer-events-none absolute -top-3 -right-3 text-white/20">
            <IconBars />
          </div>
          <div className="pointer-events-none absolute -bottom-3 -left-3 text-white/20">
            <IconLine />
          </div>

          <div className="mb-5">
            <div className="text-sm tracking-widest text-white/60 uppercase">Connexion</div>
            <div className="mt-1 text-2xl font-semibold">Heureux de vous revoir 👋</div>
            <div className="mt-1 text-xs text-white/60">
              Authentifiez-vous pour accéder au tableau de bord.
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {/* Email */}
            <div className="group">
              <label className="label mb-1 text-sm text-white/80">Email</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60">
                  <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M12 13.5L2 7V6l10 6l10-6v1zM2 8.5l10 6l10-6V18H2z"/></svg>
                </span>
                <input
                  className="input w-full pl-10"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div className="group">
              <label className="label mb-1 text-sm text-white/80">Mot de passe</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-60">
                  <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1a5 5 0 0 0-5 5v3H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V6a5 5 0 0 0-5-5m-3 8V6a3 3 0 0 1 6 0v3z"/></svg>
                </span>
                <input
                  className="input w-full pl-10 pr-10"
                  type={showPwd ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  aria-label={showPwd ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-white/70 hover:text-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  {showPwd ? "Masquer" : "Afficher"}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {err && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {err}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button disabled={loading} className="btn btn-primary w-full group">
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <Spinner />
                  Connexion…
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <IconBars />
                  Se connecter
                </div>
              )}
            </button>
          </form>

          {/* Bandeau features */}
          <div className="mt-6 grid grid-cols-1 gap-2 text-xs text-white/60 md:grid-cols-3">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <span>📈</span> KPIs en temps réel
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <span>📊</span> Analyses & rapports
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <span>🔒</span> Accès sécurisé
            </div>
          </div>
        </motion.div>
      </div>

      {/* Footer discret */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-center pb-6 text-[10px] text-white/40">
        © {new Date().getFullYear()} – Capability Dashboard
      </div>
    </div>
  );
}
