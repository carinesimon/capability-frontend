"use client";

import { clearAccessToken, getAccessToken } from "@/lib/auth";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [isLogged, setIsLogged] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsLogged(!!getAccessToken());
  }, []);

  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-[rgba(12,17,26,.7)] backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <div
          className="text-lg font-semibold tracking-tight cursor-pointer select-none"
          onClick={() => router.push("/dashboard")}
        >
          CRM Dashboard
        </div>

        <div className="ml-auto flex items-center gap-2">
          {mounted && isLogged && (
            <>
              <button
                onClick={() => router.push("/dashboard")}
                className={`tab ${pathname === "/dashboard" ? "tab--active" : ""}`}
              >
                Dashboard
              </button>
              <button
                onClick={() => {
                  clearAccessToken();
                  router.replace("/login");
                }}
                className="tab"
                title="Se déconnecter"
              >
                Déconnexion
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
  
}
