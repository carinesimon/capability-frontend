// app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "Capability Dashboard",
  description: "Tableau de bord CRM (Next + Nest) — analytics & opérations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        {/* Wrapper client : gère l’affichage de la Sidebar */}
        <ClientFrame>{children}</ClientFrame>
      </body>
    </html>
  );
}

// ⚠️ ce import doit pointer sur un fichier présent dans le même dossier.
import ClientFrame from "./ClientFrame";
