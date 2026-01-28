"use client";

import { useState } from "react";
import api from "@/lib/api"; // <-- axios déjà configuré avec baseURL et Authorization
import type { ReportingFilterParams } from "@/lib/reportingFilters";
// Si besoin d’URL absolue (debug/log), on garde la base:
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";

type Props = {
    filters: ReportingFilterParams;
};

function buildQs(params: ReportingFilterParams) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === "string" && value.length > 0) {
      q.set(key, value);
    }
  });
  return q.toString();
}

async function downloadViaAxios(url: string, filename: string) {
  const res = await api.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
  if (res.status !== 200) throw new Error(`Échec du téléchargement (${res.status})`);
  const blob = new Blob([res.data], { type: res.headers["content-type"] || "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function openPreviewViaAxios(url: string) {
  const res = await api.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
  if (res.status !== 200) throw new Error(`Échec de l’aperçu (${res.status})`);
  const type = res.headers["content-type"] || "text/html; charset=utf-8";
  const blob = new Blob([res.data], { type });
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export default function PdfExports({ filters }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const qs = buildQs(filters);
  const settersPdfPath = `/pdf-export/setters?${qs}`;
  const closersPdfPath = `/pdf-export/closers?${qs}`;
  const settersHtmlPath = `/pdf-export/setters?${qs}&format=html`;
  const closersHtmlPath = `/pdf-export/closers?${qs}&format=html`;
  const filenameFrom = filters.from || "from";
  const filenameTo = filters.to || "to";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Bloc Setters */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-[--muted]">Export</div>
            <h3 className="text-lg font-semibold">Rapport Setters</h3>
            <p className="text-sm text-[--muted] mt-1">
              Génère un PDF récapitulatif (KPI Setters) pour la période sélectionnée.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            className="btn btn-primary"
            disabled={loading === "setters-pdf"}
            onClick={async () => {
              try {
                setLoading("setters-pdf");
                await downloadViaAxios(
                  settersPdfPath,
                  `setters_${filenameFrom}_${filenameTo}.pdf`
                );;
              } catch (e: any) {
                alert(e?.message || "Téléchargement impossible");
              } finally {
                setLoading(null);
              }
            }}
          >
            {loading === "setters-pdf" ? "Génération…" : "Télécharger PDF"}
          </button>

          <button
            className="btn"
            disabled={loading === "setters-html"}
            onClick={async () => {
              try {
                setLoading("setters-html");
                await openPreviewViaAxios(settersHtmlPath);
              } catch (e: any) {
                alert(e?.message || "Aperçu impossible");
              } finally {
                setLoading(null);
              }
            }}
          >
            {loading === "setters-html" ? "Ouverture…" : "Aperçu HTML"}
          </button>
        </div>

        {/* Debug facultatif */}
        {/* <div className="mt-2 text-xs text-[--muted]">URL API: {API_BASE}{settersPdfPath}</div> */}
      </div>

      {/* Bloc Closers */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-[--muted]">Export</div>
            <h3 className="text-lg font-semibold">Rapport Closers</h3>
            <p className="text-sm text-[--muted] mt-1">
              Génère un PDF récapitulatif (KPI Closers) pour la période sélectionnée.
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            className="btn btn-primary"
            disabled={loading === "closers-pdf"}
            onClick={async () => {
              try {
                setLoading("closers-pdf");
                await downloadViaAxios(
                  closersPdfPath,
                  `closers_${filenameFrom}_${filenameTo}.pdf`
                );
              } catch (e: any) {
                alert(e?.message || "Téléchargement impossible");
              } finally {
                setLoading(null);
              }
            }}
          >
            {loading === "closers-pdf" ? "Génération…" : "Télécharger PDF"}
          </button>

          <button
            className="btn"
            disabled={loading === "closers-html"}
            onClick={async () => {
              try {
                setLoading("closers-html");
                await openPreviewViaAxios(closersHtmlPath);
              } catch (e: any) {
                alert(e?.message || "Aperçu impossible");
              } finally {
                setLoading(null);
              }
            }}
          >
            {loading === "closers-html" ? "Ouverture…" : "Aperçu HTML"}
          </button>
        </div>

        {/* Debug facultatif */}
        {/* <div className="mt-2 text-xs text-[--muted]">URL API: {API_BASE}{closersPdfPath}</div> */}
      </div>
    </div>
  );
  
}
