// src/app/not-found.tsx
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-5xl font-bold">404</div>
        <div className="text-lg font-semibold">Page introuvable</div>
        <p className="text-[--muted]">
          La ressource demandée n’existe pas ou a été déplacée.
        </p>
        <div className="flex items-center justify-center gap-2">
          <a href="/" className="btn btn-primary">Revenir à l’accueil</a>
          <a href="/login" className="btn btn-ghost">Se connecter</a>
        </div>
      </div>
    </div>
    
  );
}
