"use client";
import { useEffect, useState, useCallback } from "react";

type Theme = "dark" | "light";

export default function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  // Lire le thème actuel depuis <html data-theme="...">
  useEffect(() => {
    const current =
      (typeof document !== "undefined" &&
        (document.documentElement.dataset.theme as Theme)) || "dark";
    setTheme(current);
  }, []);

  const apply = useCallback((t: Theme) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem("theme", t);
    setTheme(t);
  }, []);

  const toggle = useCallback(() => {
    apply(theme === "dark" ? "light" : "dark");
  }, [theme, apply]);

  return { theme, setTheme: apply, toggle };
  
}
