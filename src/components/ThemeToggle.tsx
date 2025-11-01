"use client";
import useTheme from "@/hooks/useTheme";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label="Basculer le thème"
      className="px-3 py-1.5 rounded-lg text-sm bg-white/5 hover:bg-white/10 transition flex items-center gap-2"
    >
      {isDark ? (
        <>
          {/* Sun icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.8 1.42-1.42zm10.48 14.32l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM12 4V1h-0v3h0zm0 19v-3h0v3h0zM4 12H1v0h3v0zm19 0h-3v0h3v0zM6.76 19.16l-1.42 1.42-1.79-1.8 1.41-1.41 1.8 1.79zm12.02-12.02l1.41-1.41-1.79-1.8-1.41 1.41 1.79 1.8zM12 7a5 5 0 100 10 5 5 0 000-10z"/></svg>
          Jour
        </>
      ) : (
        <>
          {/* Moon icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z"/></svg>
          Nuit
        </>
      )}
    </button>
  );
  
}
