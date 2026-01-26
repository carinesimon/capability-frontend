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
import {
  parseCsv,
  serializeCsv,
  setGlobalSourcesFilters,
} from "@/lib/globalSourcesFilters";

export type GlobalSourcesFiltersContextValue = {
  sources: string[];
  excludeSources: string[];
  setSources: Dispatch<SetStateAction<string[]>>;
  setExcludeSources: Dispatch<SetStateAction<string[]>>;
  sourcesCsv?: string;
  sourcesExcludeCsv?: string;
};

const GlobalSourcesFiltersContext =
  createContext<GlobalSourcesFiltersContextValue | null>(null);

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default function GlobalSourcesFilterProvider({
  children,
}: {
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [sources, setSources] = useState<string[]>(() =>
    parseCsv(searchParams.get("sourcesCsv"))
  );
  const [excludeSources, setExcludeSources] = useState<string[]>(() =>
    parseCsv(searchParams.get("sourcesExcludeCsv"))
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
    const nextSources = parseCsv(searchParams.get("sourcesCsv"));
    const nextExclude = parseCsv(searchParams.get("sourcesExcludeCsv"));

    setSources((prev) =>
      arraysEqual(prev, nextSources) ? prev : nextSources
    );
    setExcludeSources((prev) =>
      arraysEqual(prev, nextExclude) ? prev : nextExclude
    );
  }, [searchParams]);

  useEffect(() => {
    setGlobalSourcesFilters({ sourcesCsv, sourcesExcludeCsv });
  }, [sourcesCsv, sourcesExcludeCsv]);

  const updateUrl = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
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
    const currentQuery = searchParams.toString();

    if (nextQuery === currentQuery) return;
    const url = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    router.replace(url, { scroll: false });
  }, [pathname, router, searchParams, sourcesCsv, sourcesExcludeCsv]);

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
    <GlobalSourcesFiltersContext.Provider value={value}>
      {children}
    </GlobalSourcesFiltersContext.Provider>
  );
}

export function useGlobalSourcesFilters() {
  const ctx = useContext(GlobalSourcesFiltersContext);
  if (!ctx) {
    throw new Error(
      "useGlobalSourcesFilters must be used within GlobalSourcesFilterProvider"
    );
  }
  return ctx;
}
