"use client";

import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { motion } from "framer-motion";

type Budget = {
  id: string;
  period: "WEEKLY" | "MONTHLY";
  amount: number;
  weekStart: string | null; // ISO
  monthStart: string | null; // ISO
  createdAt: string;
  updatedAt: string;
  
};

type SummaryOut = {
  period: { from?: string; to?: string };
  totals: {
    revenue: number;
    spend: number;
    roas: number | null;
    leads: number;
    rv1Honored: number;
  };
};

function mondayISO(d = new Date()) {
  const x = new Date(d);
  const day = x.getDay(); // 0=dim
  const diff = (day + 6) % 7; // lundi=0
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  // YYYY-MM-DD
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function BudgetPanel() {
  const [weekStartISO, setWeekStartISO] = useState<string>(mondayISO());
  const [amount, setAmount] = useState<string>("0");
  const [list, setList] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // on affiche aussi un résumé global sur la période couverte par la liste (si pratique)
  const minWeek = useMemo(() => {
    const xs = list.map(b => b.weekStart).filter(Boolean) as string[];
    if (!xs.length) return null;
    return xs.reduce((a, b) => (a < b ? a : b));
  }, [list]);
  const maxWeek = useMemo(() => {
    const xs = list.map(b => b.weekStart).filter(Boolean) as string[];
    if (!xs.length) return null;
    return xs.reduce((a, b) => (a > b ? a : b));
  }, [list]);

  const [summary, setSummary] = useState<SummaryOut | null>(null);

  async function load() {
    setLoading(true); setMsg(null);
    try {
      const res = await api.get<Budget[]>("/reporting/budget");
      setList(res.data || []);
    } catch (e: any) {
      setMsg(e?.response?.data?.message || "Erreur de chargement des budgets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    // charge un summary pour la plage couverte par la liste de budgets (facultatif)
    async function loadSummary() {
      if (!minWeek || !maxWeek) { setSummary(null); return; }
      try {
        const sRes = await api.get<SummaryOut>("/reporting/summary", {
          params: { from: minWeek, to: maxWeek },
        });
        setSummary(sRes.data || null);
      } catch {
        setSummary(null);
      }
    }
    loadSummary();
  }, [minWeek, maxWeek]);

  async function onSave() {
    setMsg(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      setMsg("Montant invalide (>= 0)");
      return;
    }
    try {
      await api.post("/reporting/budget", { weekStartISO, amount: value });
      setMsg("Budget enregistré");
      await load();
    } catch (e: any) {
      setMsg(e?.response?.data?.message || "Erreur d’enregistrement");
    }
  }

  const totSpend = list.reduce((s, b) => s + (b.amount || 0), 0);

  return (
    <div className="card">
      <div className="mb-3 font-medium">Budgets hebdomadaires</div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <div className="label">Semaine (lundi)</div>
          <input
            className="input"
            type="date"
            value={weekStartISO}
            onChange={(e) => setWeekStartISO(e.target.value)}
          />
          <div className="text-xs text-[--muted] mt-1">Sélectionne le lundi de la semaine.</div>
        </div>
        <div>
          <div className="label">Montant (€)</div>
          <input
            className="input"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Ex: 450"
          />
        </div>
        <div className="flex items-end">
          <button className="btn btn-primary w-full" onClick={onSave}>
            Enregistrer / Mettre à jour
          </button>
        </div>
      </div>

      {msg && <div className="mt-2 text-sm">{msg}</div>}

      {/* Mini KPIs budgets */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card">
          <div className="text-xs uppercase tracking-wide text-[--muted]">Total budgets listés</div>
          <div className="mt-2 text-xl font-semibold">{Math.round(totSpend).toLocaleString("fr-FR")} €</div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card">
          <div className="text-xs uppercase tracking-wide text-[--muted]">CA (période liste)</div>
          <div className="mt-2 text-xl font-semibold">
            {summary ? Math.round(summary.totals.revenue).toLocaleString("fr-FR") + " €" : "—"}
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card">
          <div className="text-xs uppercase tracking-wide text-[--muted]">ROAS (période liste)</div>
          <div className="mt-2 text-xl font-semibold">
            {summary?.totals?.roas == null ? "—" : Number(summary.totals.roas).toFixed(2)}
          </div>
        </motion.div>
      </div>

      {/* Tableau budgets */}
      <div className="mt-4 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Semaine (lundi)</th>
              <th>Montant (€)</th>
              <th>Mis à jour</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={3} className="text-[--muted]">Chargement…</td></tr>
            )}
            {!loading && list.length === 0 && (
              <tr><td colSpan={3} className="text-[--muted]">Aucun budget saisi.</td></tr>
            )}
            {list.map(b => (
              <tr key={b.id}>
                <td>{b.weekStart ? new Date(b.weekStart).toLocaleDateString("fr-FR") : "—"}</td>
                <td>{Math.round(b.amount).toLocaleString("fr-FR")} €</td>
                <td className="text-[--muted]">{new Date(b.updatedAt).toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
