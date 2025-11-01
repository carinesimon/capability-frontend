"use client";
import { motion } from "framer-motion";

export default function KpiCard({
  label, value, delta, spark = [], format = (n:number)=>n.toLocaleString()
}: {
  label: string;
  value: number;
  delta?: number;      // en %
  spark?: number[];    // 7–30 points
  format?: (n:number)=>string;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <motion.div
      initial={{opacity:0, y:6}}
      animate={{opacity:1, y:0}}
      className="card overflow-hidden"
    >
      <div className="text-xs uppercase tracking-wide text-[--muted]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-semibold">{format(value)}</div>
        {delta !== undefined && (
          <span className={`text-xs px-1.5 py-0.5 rounded-md ${up ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
            {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      {/* sparkline minimaliste */}
      {spark.length > 0 && (
        <svg className="mt-3 h-8 w-full" viewBox="0 0 100 24" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="currentColor"
            className="text-white/40"
            strokeWidth="1.5"
            points={spark
              .map((v, i) => {
                const x = (i / Math.max(1, spark.length - 1)) * 100;
                const min = Math.min(...spark), max = Math.max(...spark);
                const y = 24 - (max === min ? 12 : ((v - min) / (max - min)) * 20 + 2);
                return `${x},${y}`;
              })
              .join(" ")
            }
          />
        </svg>
      )}
    </motion.div>
  );
  
}
