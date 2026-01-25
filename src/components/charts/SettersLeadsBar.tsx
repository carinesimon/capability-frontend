"use client";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Row = { name: string; leads: number };

export default function SettersLeadsBar({ data }: { data: Row[] }) {
  // Evite les surprises d'hydratation liées à Recharts/mesures
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Formatage stable (FR)
  const nf = useMemo(() => new Intl.NumberFormat("fr-FR"), []);

  if (!mounted) {
    return (
      <div className="card">
        <div className="text-sm text-[--muted] mb-2">Leads reçus par Setter</div>
        <div className="h-64 rounded-xl bg-white/5 animate-pulse" />
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="card">
        <div className="text-sm text-[--muted] mb-2">Leads reçus par Setter</div>
        <div className="h-64 grid place-items-center text-[--muted]">Aucune donnée sur la période.</div>
      </div>
    );
  }

  return (
    <div className="card" role="img" aria-label="Histogramme des leads reçus par setter">
      <div className="text-sm text-[--muted] mb-2">Leads reçus par Setter</div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <defs>
              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1, #7C3AED)" stopOpacity={0.95} />
                <stop offset="100%" stopColor="var(--chart-1, #7C3AED)" stopOpacity={0.65} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} stroke="rgba(255,255,255,.08)" />
            <XAxis
              dataKey="name"
              stroke="rgba(255,255,255,.6)"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tickMargin={8}
            />
            <YAxis
              stroke="rgba(255,255,255,.6)"
              tickFormatter={(v: number) => nf.format(v)}
              width={46}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,.06)" }}
              formatter={(v: number | undefined) => [nf.format(v ?? 0), "Leads"] as [string, string]}
              contentStyle={{
                background: "rgba(20,26,36,.95)",
                border: "1px solid rgba(255,255,255,.08)",
                borderRadius: 12,
              }}
            />
            <Bar dataKey="leads" radius={[8, 8, 0, 0]} barSize={22} maxBarSize={32} fill="url(#barGradient)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
  
}
