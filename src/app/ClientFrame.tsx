// app/ClientFrame.tsx
"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";

/**
 * Règle simple :
 * - Sidebar MASQUÉE sur /login uniquement
 * - Sidebar VISIBLE partout ailleurs (donc après connexion)
 * Le contenu principal décale à droite (ml-64) seulement quand la sidebar est visible.
 */
export default function ClientFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login"; // ajuste si tu as d’autres routes d’auth

  return (
    <>
      {!isLogin && <Sidebar />}
      <div className={isLogin ? "min-h-screen" : "min-h-screen sm:ml-64"}>{children}</div>
    </>
  );
}
