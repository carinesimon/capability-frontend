"use client";

import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useGlobalFilters } from "@/components/GlobalFiltersProvider";

type SourceOptionMeta = {
  count?: number;
  lastSeenAt?: string;
};

type SourceOption = {
  value: string;
  label: string;
  meta?: SourceOptionMeta;
};

type SourcePayload =
  | string
  | { source?: string; count?: number; lastSeenAt?: string };

type SourcesResponse =
  | SourcePayload[]
  | { sources?: SourcePayload[] };

type Mode = "include" | "exclude";

export default function SourcesFilter({
  className,
}: {
  className?: string;
}) {
  const {
    sources,
    excludeSources,
    setSources,
    setExcludeSources,
  } = useGlobalFilters();
  const [mode, setMode] = useState<Mode>("include");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SourceOption[]>([]);
  const [loading, setLoading] = useState(false);
  
  const normalizeOptions = (payload: SourcesResponse): SourceOption[] => {
    const list = Array.isArray(payload) ? payload : payload?.sources ?? [];
    const mapped = list
      .map((entry): SourceOption | null => {
        if (typeof entry === "string") {
          return { value: entry, label: entry };
        }
        if (entry && typeof entry === "object") {
          const source = entry.source?.trim();
          if (!source) return null;
          return {
            value: source,
            label: source,
            meta: {
              count: entry.count,
              lastSeenAt: entry.lastSeenAt,
            },
          };
        }
        return null;
      })
      .filter((entry): entry is SourceOption => entry !== null);
    const seen = new Set<string>();
    return mapped.filter((entry) => {
      if (seen.has(entry.value)) return false;
      seen.add(entry.value);
      return true;
    });
  };
  useEffect(() => {
    let cancelled = false;
    async function loadSources() {
      try {
        setLoading(true);
        const res = await api.get<SourcesResponse>("/reporting/sources");
        if (cancelled) return;
        setOptions(normalizeOptions(res.data));
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSources();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = mode === "include" ? sources : excludeSources;
  const setActive = mode === "include" ? setSources : setExcludeSources;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(needle)
    );
  }, [options, query]);

  const toggleSource = (value: string) => {
    const isActive = active.includes(value);
    setActive((prev) =>
      prev.includes(value)
        ? prev.filter((entry) => entry !== value)
        : [...prev, value]
    );

    if (!isActive) {
      if (mode === "include") {
        setExcludeSources((prev) =>
          prev.includes(value) ? prev.filter((entry) => entry !== value) : prev
        );
      } else {
        setSources((prev) =>
          prev.includes(value) ? prev.filter((entry) => entry !== value) : prev
        );
      }
    }
  };

  const selectionHint =
    mode === "include"
      ? sources.length
        ? `${sources.length} source(s) incluse(s)`
        : "Toutes les sources (incluant Unknown)"
      : excludeSources.length
      ? `${excludeSources.length} source(s) exclue(s)`
      : "Aucune exclusion";

  return (
    <div className={className}>
      <div className="label">Sources</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={`tab ${mode === "include" ? "tab--active" : ""}`}
          onClick={() => setMode("include")}
        >
          Inclure
        </button>
        <button
          type="button"
          className={`tab ${mode === "exclude" ? "tab--active" : ""}`}
          onClick={() => setMode("exclude")}
        >
          Exclure
        </button>
      </div>

      <div className="mt-3">
        <input
          className="input w-full"
          placeholder="Rechercher une source"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="mt-2 space-y-1 max-h-44 overflow-auto rounded-lg border border-white/10 bg-white/[0.02] p-2">
        {loading ? (
          <div className="text-xs text-[--muted]">Chargement…</div>
        ) : filtered.length > 0 ? (
          filtered.map((option) => (
            <label
              key={`${mode}-${option.value}`}
              className="flex items-center gap-2 text-xs"
            >
              <input
                type="checkbox"
                checked={active.includes(option.value)}
                onChange={() => toggleSource(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))
        ) : (
          <div className="text-xs text-[--muted]">Aucune source.</div>
        )}
      </div>

      <div className="mt-2 text-xs text-[--muted]">{selectionHint}</div>
    </div>
  );
}
