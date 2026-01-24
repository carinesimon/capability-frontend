import { useEffect, useState } from "react";
import api from "@/lib/api";

export type FilterOptionUser = {
  id: string;
  name: string;
};

export type ReportingFilterOptions = {
  sources: string[];
  setters: FilterOptionUser[];
  closers: FilterOptionUser[];
};

function normalizeUser(entry: unknown): FilterOptionUser | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const id =
    record.id ??
    record.userId ??
    record._id ??
    record.value ??
    record.email ??
    record.name;
  if (!id) return null;
  const name =
    (record.name as string | undefined) ??
    (record.label as string | undefined) ??
    (record.email as string | undefined) ??
    String(id);
  return { id: String(id), name };
}

function normalizeList(list: unknown): FilterOptionUser[] {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeUser).filter(Boolean) as FilterOptionUser[];
}

export function useReportingFilterOptions() {
  const [options, setOptions] = useState<ReportingFilterOptions>({
    sources: [],
    setters: [],
    closers: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await api.get("/reporting/filter-options");
        if (cancelled) return;
        const data = res.data ?? {};
        setOptions({
          sources: Array.isArray(data.sources)
            ? data.sources.filter(Boolean).map(String)
            : [],
          setters: normalizeList(data.setters),
          closers: normalizeList(data.closers),
        });
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { options, loading, error };
}
