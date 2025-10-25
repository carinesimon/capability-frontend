"use client";

import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";

export type Range = { from: string; to: string };

function fmt(d: dayjs.Dayjs) { return d.format("YYYY-MM-DD"); }

function presets(): Record<string, Range> {
  const now = dayjs();
  return {
    "Aujourd'hui": { from: fmt(now.startOf("day")), to: fmt(now.endOf("day")) },
    "7 jours":     { from: fmt(now.subtract(6, "day").startOf("day")), to: fmt(now.endOf("day")) },
    "30 jours":    { from: fmt(now.subtract(29, "day").startOf("day")), to: fmt(now.endOf("day")) },
    "Ce mois":     { from: fmt(now.startOf("month")), to: fmt(now.endOf("month")) },
    "Personnalisé": { from: fmt(now.startOf("month")), to: fmt(now.endOf("month")) },
  };
}

export default function DateRangePicker({
  value,
  onChange,
}: {
  value: Range;
  onChange: (v: Range) => void;
}) {
  const P = useMemo(() => presets(), []);
  const [active, setActive] = useState<string>("Ce mois");

  function applyPreset(name: string) {
    setActive(name);
    if (name !== "Personnalisé") onChange(P[name]);
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          {Object.keys(P).map((name) => (
            <button
              key={name}
              onClick={() => applyPreset(name)}
              className={clsx("tab", active === name && "tab--active")}
            >
              {name}
            </button>
          ))}
        </div>

        <motion.div layout className="flex items-end gap-3 ml-auto">
          <div>
            <div className="label">DU</div>
            <input
              type="date"
              className="input"
              value={value.from}
              onChange={(e) => { setActive("Personnalisé"); onChange({ ...value, from: e.target.value }); }}
            />
          </div>
          <div>
            <div className="label">AU</div>
            <input
              type="date"
              className="input"
              value={value.to}
              onChange={(e) => { setActive("Personnalisé"); onChange({ ...value, to: e.target.value }); }}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
