// src/app/layout.tsx
import "./globals.css";
import { Suspense } from "react";
import ClientFrame from "./ClientFrame";

export const metadata = {
  title: "Capability Dashboard",
  description:
    "Tableau de bord CRM (Next + Nest) — analytics & opérations",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="min-h-screen antialiased bg-[#0b0f17] text-[#f9fafb] overflow-x-hidden"
      >
        {/* Init thème sans flicker */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var t=localStorage.getItem('theme');
              if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
              document.documentElement.dataset.theme=t;
            }catch(e){}})();`,
          }}
        />
        {/* ⚠️ Important: tout le rendu (y compris /404) est sous Suspense
            pour satisfaire l'exigence de Next quand useSearchParams() est utilisé. */}
        <Suspense fallback={null}>
          <ClientFrame>{children}</ClientFrame>
        </Suspense>
      </body>
    </html>
  );
}
