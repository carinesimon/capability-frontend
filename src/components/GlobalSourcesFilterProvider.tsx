"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { serializeCsv } from "@/lib/globalSourcesFilters";

export type GlobalFiltersContextValue = {
  sources: string[];
  excludeSources: string[];
  setSources: Dispatch<SetStateAction<string[]>>;
  setExcludeSources: Dispatch<SetStateAction<string[]>>;
  sourcesCsv?: string;
  sourcesExcludeCsv?: string;
};

const GlobalFiltersContext = createContext<GlobalFiltersContextValue | null>(
  null
);

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default function GlobalFiltersProvider({
  children,
}: {
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const safePathname = pathname ?? "/";
  const safeSearchParams = useMemo(
    () => searchParams ?? new URLSearchParams(),
    [searchParams]
  );

  const [sources, setSources] = useState<string[]>(() =>
    parseCsv(safeSearchParams.get("sourcesCsv"))
  );
  const [excludeSources, setExcludeSources] = useState<string[]>(() =>
    parseCsv(safeSearchParams.get("sourcesExcludeCsv"))
  );

  const sourcesCsv = useMemo(
    () => serializeCsv(sources),
    [sources]
  );
  const sourcesExcludeCsv = useMemo(
    () => serializeCsv(excludeSources),
    [excludeSources]
  );

  useEffect(() => {
    const nextSources = parseCsv(safeSearchParams.get("sourcesCsv"));
    const nextExclude = parseCsv(safeSearchParams.get("sourcesExcludeCsv"));

    setSources((prev) =>
      arraysEqual(prev, nextSources) ? prev : nextSources
    );
    setExcludeSources((prev) =>
      arraysEqual(prev, nextExclude) ? prev : nextExclude
    );
  }, [safeSearchParams]);

  const updateUrl = useCallback(() => {
    const params = new URLSearchParams(safeSearchParams.toString());
    if (sourcesCsv) {
      params.set("sourcesCsv", sourcesCsv);
    } else {
      params.delete("sourcesCsv");
    }

    if (sourcesExcludeCsv) {
      params.set("sourcesExcludeCsv", sourcesExcludeCsv);
    } else {
      params.delete("sourcesExcludeCsv");
    }

    const nextQuery = params.toString();
    const currentQuery = safeSearchParams.toString();

    if (nextQuery === currentQuery) return;
    const url = nextQuery ? `${safePathname}?${nextQuery}` : safePathname;
    router.replace(url, { scroll: false });
  }, [
    safePathname,
    router,
    safeSearchParams,
    sourcesCsv,
    sourcesExcludeCsv,
  ]);

  useEffect(() => {
    updateUrl();
  }, [updateUrl]);

  const value = useMemo(
    () => ({
      sources,
      excludeSources,
      setSources,
      setExcludeSources,
      sourcesCsv,
      sourcesExcludeCsv,
    }),
    [sources, excludeSources, sourcesCsv, sourcesExcludeCsv]
  );

  return (
    <GlobalFiltersContext.Provider value={value}>
      {children}
    </GlobalFiltersContext.Provider>
  );
}

export function useGlobalFilters() {
  const ctx = useContext(GlobalSourcesFiltersContext);
  if (!ctx) {
    throw new Error(
      "useGlobalSourcesFilters must be used within GlobalSourcesFilterProvider"
    );
  }
  return ctx;
}
