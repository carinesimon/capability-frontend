"use client";

import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import Sidebar from "@/components/Sidebar";

type Status = "OFF" | "DRY_RUN" | "ON";

type Auto = {
  id: string;
  name: string;
  status: Status;
  webhookUrl?: string; // ← peut être undefined sur la liste
  createdAt?: string;
  updatedAt?: string;
};

export default function AutomatisationsPage() {
  const [list, setList] = useState<Auto[]>([]);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<Auto | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // UI
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "ALL">("ALL");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Compteur TOTAL d’événements
  const [totalCounts, setTotalCounts] = useState<Record<string, number>>({});

  // Toast
  const [toast, setToast] = useState<{ open: boolean; ok: boolean; msg: string }>({ open: false, ok: true, msg: "" });
  const showToast = (ok: boolean, msg: string) => {
    setToast({ open: true, ok, msg });
    setTimeout(() => setToast((t) => ({ ...t, open: false })), 1600);
  };

  async function load() {
    try {
      const r = await api.get<Auto[]>("/integrations/automations");
      const ordered = [...(Array.isArray(r.data) ? r.data : [])].sort((a, b) => {
        const da = a?.updatedAt || a?.createdAt || "";
        const db = b?.updatedAt || b?.createdAt || "";
        return db.localeCompare(da);
      });
      setList(ordered);
      fetchTotals(ordered);
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Erreur chargement");
    }
  }
  useEffect(() => { load(); }, []);

  async function fetchTotals(items: Auto[]) {
    const pairs = await Promise.all(
      items.map(async (a) => {
        try {
          const r = await api.get(`/integrations/automations/${a.id}/events`, { params: { limit: 1000 } });
          const arr = Array.isArray(r.data) ? r.data : [];
          return [a.id, arr.length] as const;
        } catch {
          return [a.id, 0] as const;
        }
      })
    );
    const map: Record<string, number> = {};
    pairs.forEach(([id, n]) => (map[id] = n));
    setTotalCounts(map);
  }

  async function create() {
    if (!name.trim()) return;
    try {
      const r = await api.post<Auto>("/integrations/automations", { name: name.trim() });
      setCreated(r.data);
      setName("");
      showToast(true, "Automation créée");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Création impossible");
      showToast(false, "Création impossible");
    }
  }

  async function setStatusApi(id: string, status: Status) {
    try {
      setSavingId(id);
      await api.patch(`/integrations/automations/${id}`, { status });
      await load();
      showToast(true, "Statut mis à jour");
    } catch (e: any) {
      showToast(false, e?.response?.data?.message || "Échec mise à jour statut");
    } finally {
      setSavingId(null);
    }
  }

  async function saveName(id: string) {
    const newName = editingName.trim();
    if (!newName) { setEditingId(null); return; }
    try {
      setSavingId(id);
      await api.patch(`/integrations/automations/${id}`, { name: newName });
      setEditingId(null);
      showToast(true, "Nom mis à jour");
      await load();
    } catch (e: any) {
      showToast(false, e?.response?.data?.message || "Échec renommage");
    } finally {
      setSavingId(null);
    }
  }

  async function duplicate(id: string) {
    try {
      setSavingId(id);
      const r = await api.post(`/integrations/automations/${id}/duplicate`);
      if (r?.data?.id) {
        showToast(true, "Dupliquée");
        await load();
      } else {
        showToast(false, "Duplication non supportée");
      }
    } catch {
      showToast(false, "Duplication non supportée côté API");
    } finally {
      setSavingId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Supprimer cette automation ?")) return;
    try {
      setSavingId(id);
      await api.delete(`/integrations/automations/${id}`);
      await load();
      showToast(true, "Automation supprimée");
    } catch (e: any) {
      showToast(false, e?.response?.data?.message || "Suppression impossible");
    } finally {
      setSavingId(null);
    }
  }

  // --- COPY WEBHOOK URL (robuste) ---
  async function copyWebhook(a: Auto) {
    try {
      // 1) si déjà présent sur la carte, on l’utilise
      let url = a.webhookUrl;

      // 2) sinon, on va chercher le détail (qui renvoie l’URL complète basée sur PUBLIC_BASE_URL)
      if (!url) {
        const r = await api.get<Auto>(`/integrations/automations/${a.id}`);
        url = r?.data?.webhookUrl;
      }

      // 3) si toujours pas dispo → erreur explicite
      if (!url) {
        showToast(false, "URL introuvable pour cette automation");
        return;
      }

      await navigator.clipboard.writeText(url);
      showToast(true, "Lien copié");
    } catch {
      showToast(false, "Copie impossible");
    }
  }

  const statusChip = (s: Status) => (
    <span
      className={
        "text-2xs px-2 py-0.5 rounded " +
        (s === "ON"
          ? "bg-emerald-500/20 text-emerald-300"
          : s === "DRY_RUN"
          ? "bg-amber-500/20 text-amber-300"
          : "bg-zinc-500/20 text-zinc-300")
      }
      title={s === "ON" ? "Active: traite et écrit en base" : s === "DRY_RUN" ? "Test: traite sans écrire en base" : "OFF: n'exécute rien"}
    >
      {s === "ON" ? "Active" : s === "DRY_RUN" ? "Test (dry-run)" : "Off"}
    </span>
  );

  const filtered = useMemo(() => {
    const term = (q ?? "").trim().toLowerCase();
    const s = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");

    return (Array.isArray(list) ? list : [])
      .filter((a) => (statusFilter === "ALL" ? true : a?.status === statusFilter))
      .filter((a) => {
        if (!term) return true;
        const name = s(a?.name);
        const url  = s(a?.webhookUrl || "");
        const id   = s(a?.id);
        return name.includes(term) || url.includes(term) || id.includes(term);
      })
      .sort((a, b) => {
        const da = a?.updatedAt || a?.createdAt || "";
        const db = b?.updatedAt || b?.createdAt || "";
        return db.localeCompare(da);
      });
  }, [list, q, statusFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex gap-4">
        <Sidebar />

        <div className="flex-1 space-y-4">
          {/* Header + creation */}
          <div className="card">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Automations (Webhook)</div>
                <div className="text-xs text-[--muted]">Crée, renomme, filtre, copie l’URL, change le statut.</div>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <input
                  className="input flex-1"
                  placeholder="Nom de l’automation"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                />
                <button className="btn btn-primary" onClick={create}>+ Créer</button>
              </div>
            </div>

            {created && (
              <div className="mt-3 text-sm rounded-xl border border-white/10 bg-white/5 p-3">
                <div>Créée : <b>{created.name}</b></div>
                <div className="text-[--muted]">URL Webhook : <code>{created.webhookUrl || "—"}</code></div>
                <div className="text-[--muted]">Statut : {statusChip(created.status)}</div>
              </div>
            )}
          </div>

          {err && <div className="text-sm text-red-400">{err}</div>}

          {/* Filtres */}
          <div className="card">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  className={`text-2xs px-2 py-1 rounded ${statusFilter==="ALL" ? "bg-white/15 ring-1 ring-white/10" : "hover:bg-white/10"}`}
                  onClick={()=>setStatusFilter("ALL")}
                >Tous</button>
                {(["ON","DRY_RUN","OFF"] as Status[]).map(s => (
                  <button
                    key={s}
                    className={`text-2xs px-2 py-1 rounded ${statusFilter===s ? "bg-white/15 ring-1 ring-white/10" : "hover:bg-white/10"}`}
                    onClick={()=>setStatusFilter(s)}
                  >
                    {statusChip(s)}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 w-full sm:w-80">
                <input
                  className="input flex-1"
                  placeholder="Rechercher (nom, URL, id)…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Liste */}
          <div className="card">
            {!filtered.length ? (
              <div className="text-sm text-[--muted] py-8 text-center">Aucune automation. Crée la première ci-dessus.</div>
            ) : (
              <div className="grid gap-3">
                {filtered.map((a) => (
                  <div key={a.id} className="rounded-xl border border-white/10 bg-white/5 p-3 group">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      {/* gauche */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {editingId === a.id ? (
                            <>
                              <input
                                className="input h-7 px-2 py-1"
                                value={editingName}
                                onChange={(e)=>setEditingName(e.target.value)}
                                onKeyDown={(e)=>{ if(e.key==='Enter') saveName(a.id); if(e.key==='Escape') setEditingId(null); }}
                                autoFocus
                              />
                              <button className="btn btn-primary h-7 px-2" onClick={()=>saveName(a.id)} disabled={savingId===a.id}>OK</button>
                              <button className="btn btn-ghost h-7 px-2" onClick={()=>setEditingId(null)}>Annuler</button>
                            </>
                          ) : (
                            <>
                              <a href={`/integrations/automatisations/${a.id}`} className="font-medium truncate hover:underline" title="Ouvrir le détail & mapping">
                                {a.name}
                              </a>
                              <div className="shrink-0">{statusChip(a.status)}</div>
                              <span className="text-2xs px-2 py-0.5 rounded bg-white/10">{totalCounts[a.id] ?? 0} évts</span>
                            </>
                          )}
                        </div>

                        <div className="text-[10px] text-[--muted] mt-1">
                          {a.updatedAt ? `MAJ ${new Date(a.updatedAt).toLocaleString()}` :
                           a.createdAt ? `Créée ${new Date(a.createdAt).toLocaleString()}` : null}
                        </div>
                      </div>

                      {/* droite */}
                      <div className="flex items-center gap-2">
                        <div className="text-2xs px-2 py-0.5 rounded bg-white/10 truncate max-w-[52ch]">{a.webhookUrl || "—"}</div>

                        {/* <-- utilisation de copyWebhook pour gérer le cas undefined */}
                        <button
                          className="btn btn-ghost h-7 px-2"
                          title="Copier l’URL"
                          onClick={() => copyWebhook(a)}
                        >
                          Copier
                        </button>

                        <div className="hidden md:flex rounded-lg overflow-hidden border border-white/10">
                          {(["OFF","DRY_RUN","ON"] as Status[]).map(s => (
                            <button
                              key={s}
                              className={`text-2xs px-2 py-1 ${a.status===s ? "bg-white/15" : "bg-transparent hover:bg-white/10"}`}
                              onClick={()=>setStatusApi(a.id, s)}
                              disabled={savingId===a.id}
                              title={s==="ON" ? "Active" : s==="DRY_RUN" ? "Dry-run" : "Off"}
                            >
                              {s}
                            </button>
                          ))}
                        </div>

                        <div className="relative">
                          <button
                            className="btn btn-ghost h-7 px-2"
                            aria-haspopup="menu"
                            onClick={() => setOpenMenuId((v) => (v === a.id ? null : a.id))}
                            title="Plus d’actions"
                          >
                            ⋯
                          </button>
                          {openMenuId === a.id && (
                            <div className="absolute right-0 top-8 z-20 min-w-44 rounded-xl border border-white/10 bg-[rgba(16,22,33,.98)] shadow-xl p-1" role="menu" onMouseLeave={() => setOpenMenuId(null)}>
                              <button className="menu-item" onClick={() => { setEditingId(a.id); setEditingName(a.name); setOpenMenuId(null); }}>Renommer</button>
                              <button className="menu-item" onClick={() => { setStatusApi(a.id, "ON"); setOpenMenuId(null); }}>Activer</button>
                              <button className="menu-item" onClick={() => { setStatusApi(a.id, "DRY_RUN"); setOpenMenuId(null); }}>Mode Dry-run</button>
                              <button className="menu-item" onClick={() => { setStatusApi(a.id, "OFF"); setOpenMenuId(null); }}>Désactiver</button>
                              <div className="h-px bg-white/10 my-1" />
                              <button className="menu-item" onClick={() => { duplicate(a.id); setOpenMenuId(null); }}>Dupliquer</button>
                              <button className="menu-item text-rose-300" onClick={() => { setOpenMenuId(null); remove(a.id); }}>Supprimer</button>
                              <a className="menu-item" href={`/integrations/automatisations/${a.id}`} onClick={() => setOpenMenuId(null)}>Ouvrir le détail</a>
                            </div>
                          )}
                        </div>

                        <a className="btn btn-primary h-7 px-2" href={`/integrations/automatisations/${a.id}`}>Ouvrir</a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {toast.open && (
        <div className="fixed bottom-5 right-5 z-50">
          <div className={`rounded-xl border px-4 py-3 shadow-lg ${toast.ok ? "border-emerald-500/30 bg-emerald-500/15" : "border-rose-500/30 bg-rose-500/15"}`}>
            <div className="text-sm">{toast.msg}</div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .menu-item { display:block; width:100%; text-align:left; font-size:12px; padding:8px 10px; border-radius:8px; }
        .menu-item:hover { background: rgba(255,255,255,0.08); }
      `}</style>
    </div>
  );
}
