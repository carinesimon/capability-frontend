"use client";

import { useState } from "react";
import api from "@/lib/api";

type Props = {
  from?: string;
  to?: string;
};

function buildParams(from?: string, to?: string) {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  return p.toString();
}

export default function GlobalExports({ from, to }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const qs = buildParams(from, to);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-[--muted]">Export global</div>
          <h3 className="text-lg font-semibold">Statistiques d’ensemble</h3>
          <p className="text-sm text-[--muted] mt-1">
            Exporte les totaux et les classements (période sélectionnée).
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          className="btn btn-primary"
          disabled={loading === "csv"}
          onClick={async () => {
            try {
              setLoading("csv");
              const res = await api.get(`/reporting/summary.csv?${qs}`, {
                responseType: "arraybuffer",
              });
              const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `summary_${from || "from"}_${to || "to"}.csv`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(a.href);
            } catch (e: any) {
              alert(e?.message || "Téléchargement CSV impossible");
            } finally {
              setLoading(null);
            }
          }}
        >
          {loading === "csv" ? "Génération…" : "Télécharger CSV global"}
        </button>

        <button
          className="btn"
          disabled={loading === "json"}
          onClick={async () => {
            try {
              setLoading("json");
              const res = await api.get(`/reporting/summary?${qs}`);
              const blob = new Blob([JSON.stringify(res.data, null, 2)], {
                type: "application/json",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `summary_${from || "from"}_${to || "to"}.json`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(a.href);
            } catch (e: any) {
              alert(e?.message || "Téléchargement JSON impossible");
            } finally {
              setLoading(null);
            }
          }}
        >
          {loading === "json" ? "Génération…" : "Télécharger JSON global"}
        </button>
      </div>
    </div>
  );
}
