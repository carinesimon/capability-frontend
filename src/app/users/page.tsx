"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import api from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

type Role = "ADMIN" | "SETTER" | "CLOSER";
type UserRow = {
  id: string; firstName: string; lastName: string; email: string;
  role: Role; isActive: boolean; createdAt: string; updatedAt: string;
};
type PageRes = { items: UserRow[]; total: number; page: number; pageSize: number };

const roleLabel: Record<Role, string> = { ADMIN: "Admin", SETTER: "Setter", CLOSER: "Closer" };
const fmtDate = (iso: string) => new Date(iso).toLocaleString("fr-FR");
const toCSV = (rows: UserRow[]) => {
  const header = "Prénom,Nom,Email,Rôle,Actif,Créé le,Dernière maj";
  const lines = rows.map(r =>
    [r.firstName, r.lastName, r.email, roleLabel[r.role], r.isActive ? "Oui" : "Non", fmtDate(r.createdAt), fmtDate(r.updatedAt)]
      .map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")
  );
  return [header, ...lines].join("\n");
};

export default function UsersAdminPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [active, setActive] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [fFirst, setFFirst] = useState("");
  const [fLast, setFLast] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fRole, setFRole] = useState<Role>("SETTER");
  const [fActive, setFActive] = useState(true);
  const [fTemp, setFTemp] = useState("");

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const res = await api.get<PageRes>("/admin/users", {
        params: {
          q: q || undefined,
          role: role || undefined,
          isActive: active || undefined,
          page, pageSize
        }
      });
      setRows(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, role, active, page, pageSize]);

  function openCreate() {
    setFFirst(""); setFLast(""); setFEmail(""); setFRole("SETTER"); setFActive(true); setFTemp("");
    setCreateOpen(true);
  }
  function openEdit(u: UserRow) {
    setEditId(u.id);
    setFFirst(u.firstName); setFLast(u.lastName); setFEmail(u.email);
    setFRole(u.role); setFActive(u.isActive); setFTemp("");
    setEditOpen(true);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/admin/users", {
        firstName: fFirst || "Unknown",
        lastName:  fLast  || "Unknown",
        email:     fEmail,
        role:      fRole,
        isActive:  fActive,
        tempPassword: fTemp || undefined,
      });
      setCreateOpen(false);
      setPage(1);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Création impossible");
    }
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId) return;
    try {
      await api.patch(`/admin/users/${editId}`, {
        firstName: fFirst, lastName: fLast, email: fEmail,
        role: fRole, isActive: fActive, tempPassword: fTemp || undefined
      });
      setEditOpen(false);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Mise à jour impossible");
    }
  }

  function exportCSV() {
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "utilisateurs.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex gap-4">
        <Sidebar />

        <div className="flex-1 space-y-5">
          {/* Header */}
          <div className="rounded-2xl border border-white/10 bg-[rgba(20,27,40,.85)] backdrop-blur px-4 py-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div>
                <div className="text-xl font-semibold">Gestion des utilisateurs</div>
                <div className="text-xs text-[--muted]">Créer, éditer, activer/désactiver, filtrer et exporter.</div>
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost" onClick={exportCSV}>Export CSV</button>
                <button className="btn btn-primary" onClick={openCreate}>+ Nouvel utilisateur</button>
              </div>
            </div>
          </div>

          {/* Filtres */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              className="input"
              placeholder="Recherche nom/email…"
              value={q}
              onChange={(e)=>{ setPage(1); setQ(e.target.value); }}
            />
            <select className="input" value={role} onChange={(e)=>{ setPage(1); setRole(e.target.value as any); }}>
              <option value="">Rôle : Tous</option>
              <option value="ADMIN">Admin</option>
              <option value="SETTER">Setter</option>
              <option value="CLOSER">Closer</option>
            </select>
            <select className="input" value={active} onChange={(e)=>{ setPage(1); setActive(e.target.value as any); }}>
              <option value="">Statut : Tous</option>
              <option value="true">Actifs</option>
              <option value="false">Inactifs</option>
            </select>
            <select className="input" value={pageSize} onChange={(e)=>{ setPage(1); setPageSize(parseInt(e.target.value,10)); }}>
              {[10,20,50,100].map(n => <option key={n} value={n}>{n} / page</option>)}
            </select>
          </div>

          {/* Table */}
          <div className="card overflow-x-auto">
            {err && <div className="text-sm text-red-400 mb-2">{err}</div>}

            <table className="w-full text-sm">
              <thead className="text-left text-[--muted]">
                <tr>
                  <th className="py-2 pr-2">Utilisateur</th>
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">Rôle</th>
                  <th className="py-2 pr-2">Statut</th>
                  <th className="py-2 pr-2">Créé</th>
                  <th className="py-2 pr-2">Maj</th>
                  <th className="py-2 pr-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="py-4 text-[--muted]">Chargement…</td></tr>}
                {!loading && rows.map(u => (
                  <tr key={u.id} className="border-top border-white/10">
                    <td className="py-2 pr-2">{u.firstName} {u.lastName}</td>
                    <td className="py-2 pr-2">{u.email}</td>
                    <td className="py-2 pr-2">{roleLabel[u.role]}</td>
                    <td className="py-2 pr-2">
                      <span className={`px-2 py-0.5 rounded text-2xs ${u.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/15 text-zinc-300'}`}>
                        {u.isActive ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="py-2 pr-2">{fmtDate(u.createdAt)}</td>
                    <td className="py-2 pr-2">{fmtDate(u.updatedAt)}</td>
                    <td className="py-2 pr-2">
                      <div className="flex justify-end gap-2">
                        <button className="btn btn-ghost px-2 py-1" onClick={()=>openEdit(u)}>Éditer</button>
                        <button
                          className="btn btn-ghost px-2 py-1"
                          onClick={async ()=>{
                            try {
                              await api.patch(`/admin/users/${u.id}`, { isActive: !u.isActive });
                              await load();
                            } catch (e:any) {
                              setErr(e?.response?.data?.message || "Action impossible");
                            }
                          }}
                        >
                          {u.isActive ? "Désactiver" : "Activer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-[--muted]">Aucun utilisateur.</td></tr>
                )}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-3">
              <div className="text-xs text-[--muted]">
                {rows.length ? ((page-1)*pageSize+1) : 0}–{Math.min(page*pageSize, total)} / {total}
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Précédent</button>
                <div className="text-sm">{page} / {totalPages}</div>
                <button className="btn btn-ghost" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Suivant</button>
              </div>
            </div>
          </div>

          {/* CREATE MODAL */}
          <AnimatePresence>
            {createOpen && (
              <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg)]"
                initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
                <motion.div initial={{y:20,opacity:0}} animate={{y:0,opacity:1}} exit={{y:20,opacity:0}} className="card w-full max-w-xl">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-lg font-semibold">Nouvel utilisateur</div>
                    <button className="btn btn-ghost" onClick={()=>setCreateOpen(false)}>Fermer</button>
                  </div>
                  <form onSubmit={submitCreate} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><div className="label">Prénom</div><input className="input" value={fFirst} onChange={e=>setFFirst(e.target.value)} required /></div>
                    <div><div className="label">Nom</div><input className="input" value={fLast} onChange={e=>setFLast(e.target.value)} required /></div>
                    <div className="md:col-span-2"><div className="label">Email</div><input className="input" type="email" value={fEmail} onChange={e=>setFEmail(e.target.value)} required/></div>
                    <div>
                      <div className="label">Rôle</div>
                      <select className="input" value={fRole} onChange={e=>setFRole(e.target.value as Role)}>
                        <option value="SETTER">Setter</option>
                        <option value="CLOSER">Closer</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </div>
                    <div>
                      <div className="label">Statut</div>
                      <select className="input" value={String(fActive)} onChange={e=>setFActive(e.target.value === 'true')}>
                        <option value="true">Actif</option>
                        <option value="false">Inactif</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <div className="label">Mot de passe temporaire (optionnel)</div>
                      <input className="input" value={fTemp} onChange={e=>setFTemp(e.target.value)} placeholder="Laisser vide pour forcer 'Mot de passe oublié'"/>
                    </div>
                    <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                      <button type="button" className="btn btn-ghost" onClick={()=>setCreateOpen(false)}>Annuler</button>
                      <button className="btn btn-primary">Créer</button>
                    </div>
                  </form>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* EDIT MODAL */}
          <AnimatePresence>
            {editOpen && (
              <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg)]"
                initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
                <motion.div initial={{y:20,opacity:0}} animate={{y:0,opacity:1}} exit={{y:20,opacity:0}} className="card w-full max-w-xl">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-lg font-semibold">Éditer l’utilisateur</div>
                    <button className="btn btn-ghost" onClick={()=>setEditOpen(false)}>Fermer</button>
                  </div>
                  <form onSubmit={submitEdit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div><div className="label">Prénom</div><input className="input" value={fFirst} onChange={e=>setFFirst(e.target.value)} required /></div>
                    <div><div className="label">Nom</div><input className="input" value={fLast} onChange={e=>setFLast(e.target.value)} required /></div>
                    <div className="md:col-span-2"><div className="label">Email</div><input className="input" type="email" value={fEmail} onChange={e=>setFEmail(e.target.value)} required/></div>
                    <div>
                      <div className="label">Rôle</div>
                      <select className="input" value={fRole} onChange={e=>setFRole(e.target.value as Role)}>
                        <option value="SETTER">Setter</option>
                        <option value="CLOSER">Closer</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </div>
                    <div>
                      <div className="label">Statut</div>
                      <select className="input" value={String(fActive)} onChange={e=>setFActive(e.target.value === 'true')}>
                        <option value="true">Actif</option>
                        <option value="false">Inactif</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <div className="label">Nouveau mot de passe temp. (optionnel)</div>
                      <input className="input" value={fTemp} onChange={e=>setFTemp(e.target.value)} placeholder="Laisser vide pour ne pas changer"/>
                    </div>
                    <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                      <button type="button" className="btn btn-ghost" onClick={()=>setEditOpen(false)}>Annuler</button>
                      <button className="btn btn-primary">Enregistrer</button>
                    </div>
                  </form>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
