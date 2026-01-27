"use client";

import type { Dispatch, SetStateAction } from "react";
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

type SourcesResponse = SourcePayload[] | { sources?: SourcePayload[] };

type Mode = "include" | "exclude";

type SourcesFilterProps = {
  className?: string;
  sources?: string[];
  excludeSources?: string[];
  onSourcesChange?: Dispatch<SetStateAction<string[]>>;
  onExcludeSourcesChange?: Dispatch<SetStateAction<string[]>>;
};

const noopSetter: Dispatch<SetStateAction<string[]>> = () => {};

export default function SourcesFilter({
  className,
  sources: sourcesProp,
  excludeSources: excludeSourcesProp,
  onSourcesChange,
  onExcludeSourcesChange,
}: SourcesFilterProps) {
  const globalFilters = useGlobalFilters();

  const sources = sourcesProp ?? globalFilters?.sources ?? [];
  const excludeSources = excludeSourcesProp ?? globalFilters?.excludeSources ?? [];

  const setSources =
    onSourcesChange ?? globalFilters?.setSources ?? noopSetter;
  const setExcludeSources =
    onExcludeSourcesChange ?? globalFilters?.setExcludeSources ?? noopSetter;

  const [mode, setMode] = useState<Mode>("include");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SourceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizeOptions = (payload: SourcesResponse): SourceOption[] => {
    const list = Array.isArray(payload) ? payload : payload?.sources ?? [];

    const mapped = list
      .map((entry): SourceOption | null => {
        if (typeof entry === "string") {
          const v = entry.trim();
          if (!v) return null;
          return { value: v, label: v };
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
    const unique = mapped.filter((entry) => {
      const key = entry.value;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.sort((a, b) => a.label.localeCompare(b.label, "fr"));
    return unique;
  };

  useEffect(() => {
    let cancelled = false;

    async function loadSources() {
      try {
        setLoading(true);
        setError(null);

        const res = await api.get<SourcesResponse>("/reporting/sources");
        if (cancelled) return;

        setOptions(normalizeOptions(res.data));
      } catch (e) {
        if (!cancelled) {
          setError("Impossible de charger les sources pour le moment.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSources();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = mode === "include" ? sources : excludeSources;
  const setActive = mode === "include" ? setSources : setExcludeSources;

  const selectionHint = useMemo(() => {
    const label = mode === "include" ? "Inclure" : "Exclure";
    if (!active?.length) return `${label} : aucune source sélectionnée`;
    return `${label} : ${active.length} source(s) sélectionnée(s)`;
  }, [active, mode]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(needle)
    );
  }, [options, query]);

  const toggleSource = (value: string) => {
    const isActive = active.includes(value);

    // Toggle dans le mode courant
    setActive((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      return [...prev, value];
    });

    // Bonus robustesse : éviter qu'une source soit à la fois en include et exclude
    if (!isActive) {
      if (mode === "include") {
        setExcludeSources((prev) => prev.filter((v) => v !== value));
      } else {
        setSources((prev) => prev.filter((v) => v !== value));
      }
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Sources</div>

        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
          <button
            type="button"
            onClick={() => setMode("include")}
            className={[
              "px-2 py-1 text-xs rounded-md",
              mode === "include"
                ? "bg-white/10 text-white"
                : "text-[--muted] hover:text-white",
            ].join(" ")}
          >
            Inclure
          </button>
          <button
            type="button"
            onClick={() => setMode("exclude")}
            className={[
              "px-2 py-1 text-xs rounded-md",
              mode === "exclude"
                ? "bg-white/10 text-white"
                : "text-[--muted] hover:text-white",
            ].join(" ")}
          >
            Exclure
          </button>
        </div>
      </div>

      <div className="mt-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une source…"
          className="w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs outline-none placeholder:text-[--muted]"
        />
      </div>

      <div className="mt-2 space-y-1 max-h-44 overflow-auto rounded-lg border border-white/10 bg-white/[0.02] p-2">
        {loading ? (
          <div className="text-xs text-[--muted]">Chargement…</div>
        ) : filtered.length > 0 ? (
          filtered.map((option) => (
            <label
              key={`${mode}-${option.value}`}
              className="flex items-center justify-between gap-2 text-xs py-1"
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={active.includes(option.value)}
                  onChange={() => toggleSource(option.value)}
                />
                <span>{option.label}</span>
              </span>

              {typeof option.meta?.count === "number" ? (
                <span className="text-[10px] text-[--muted]">
                  {option.meta.count}
                </span>
              ) : null}
            </label>
          ))
        ) : (
          <div className="text-xs text-[--muted]">Aucune source.</div>
        )}
      </div>

      {error ? (
        <div className="mt-2 text-xs text-amber-200/90">{error}</div>
      ) : null}

      <div className="mt-2 text-xs text-[--muted]">{selectionHint}</div>
    </div>
  );
}
