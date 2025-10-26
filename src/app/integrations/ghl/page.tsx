"use client";

import * as React from "react";
import api from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import { motion, AnimatePresence } from "framer-motion";

/* ===== Types alignés sur le service backend GhlService ===== */
type InboxSummary = { id: string; receivedAt: string; contentType: string };
type InboxListOut = { ok: true; items: InboxSummary[] };

type InboxItem = {
  id: string;
  receivedAt: string;
  contentType: string;
  headers: Record<string, any>;
  query: Record<string, any>;
  raw: string;
  parsed: Record<string, any> | null;
  hash: string;
};

type ImportMapping = {
  ghlContactId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  tag?: string | null;
  source?: string | null;
  stageName?: string | undefined;
  saleValue?: number | null;
};

type Mapping = Partial<{
  ghlContactId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  tag: string;
  source: string;
  stageName: string;
  saleValue: string;
  createdAt: string;
}>;

type Defaults = Partial<{
  /** ✅ ajouté pour éviter l’erreur de type sur defaults.ghlContactId */
  ghlContactId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  tag: string | null;
  source: string | null;
  stageName: string | undefined;
  saleValue: number | null;
}>;

/* ===== Utils ===== */
function isRecord(v: any): v is Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v);
}

/** Extrait toutes les "dot paths" pour les feuilles scalaires */
function enumeratePaths(obj: any, prefix = ""): string[] {
  const out: string[] = [];
  if (!isRecord(obj)) return out;
  for (const key of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    const val = (obj as any)[key];
    if (isRecord(val)) out.push(...enumeratePaths(val, p));
    else if (Array.isArray(val)) {
      // on expose aussi p[0].xxx
      if (val.length > 0 && isRecord(val[0])) {
        out.push(...enumeratePaths(val[0], `${p}[0]`));
      } else {
        out.push(p);
      }
    } else {
      out.push(p);
    }
  }
  // tri simple: chemins courts d'abord
  return out.sort((a, b) => a.length - b.length);
}

function getByPath(obj: any, path?: string) {
  if (!path) return undefined;
  // support "x.y" et "arr[0].z"
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur = obj;
  for (const k of parts) {
    if (cur == null) return undefined;
    cur = cur[k as any];
  }
  return cur;
}

function pretty(val: any) {
  if (val == null) return "—";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return String(val);
  try { return JSON.stringify(val); } catch { return String(val); }
}

/* ===== Composants réutilisables ===== */

function FieldPicker({
  label,
  value,
  onChange,
  options,
  exampleValue,
  placeholder,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  options: string[];
  exampleValue?: any;
  placeholder?: string;
}) {
  const [q, setQ] = React.useState("");
  const filtered = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options.slice(0, 300);
    return options.filter((p) => p.toLowerCase().includes(qq)).slice(0, 300);
  }, [q, options]);

  return (
    <div className="space-y-1">
      <div className="label">{label}</div>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder={placeholder ?? "ex: contact.first_name"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          list={`${label}-paths`}
        />
        <input
          className="input w-40"
          placeholder="Filtrer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          title="Filtrer la liste de chemins"
        />
      </div>

      <datalist id={`${label}-paths`}>
        {filtered.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {exampleValue !== undefined && (
        <div className="text-2xs text-[--muted]">
          Extrait actuel : <span className="opacity-90">{pretty(exampleValue)}</span>
        </div>
      )}
    </div>
  );
}

function JsonBlock({ title, obj }: { title: string; obj: any }) {
  return (
    <div className="card">
      <div className="font-semibold mb-2">{title}</div>
      <pre className="text-2xs whitespace-pre-wrap break-all overflow-auto max-h-72">
        {obj ? JSON.stringify(obj, null, 2) : "—"}
      </pre>
    </div>
  );
}

/* ===== Page principale ===== */

export default function GhlIntegrationsPage() {
  const [list, setList] = React.useState<InboxSummary[]>([]);
  const [loadingList, setLoadingList] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [selId, setSelId] = React.useState<string | null>(null);
  const [item, setItem] = React.useState<InboxItem | null>(null);
  const [loadingItem, setLoadingItem] = React.useState(false);

  const [mapping, setMapping] = React.useState<Mapping>({
    firstName: "contact.first_name",
    lastName: "contact.last_name",
    email: "contact.email",
    phone: "contact.phone",
    stageName: "opportunity.stage_name",
    saleValue: "opportunity.monetary_value",
    ghlContactId: "contact.id",
  });
  const [defaults, setDefaults] = React.useState<Defaults>({
    source: "GHL",
    /** optionnel : tu peux aussi mettre un défaut pour l’ID s’il t’en faut un */
    ghlContactId: null,
  });

  const [submitting, setSubmitting] = React.useState(false);
  const [applyMsg, setApplyMsg] = React.useState<string | null>(null);

  const [paths, setPaths] = React.useState<string[]>([]);

  async function loadList() {
    setLoadingList(true);
    setErr(null);
    try {
      const res = await api.get<InboxListOut>("/webhooks/ghl/inbox");
      setList(res.data.items || []);
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Impossible de charger la liste inbox");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadOne(id: string) {
    setLoadingItem(true);
    setItem(null);
    try {
      const res = await api.get<InboxItem>(`/webhooks/ghl/inbox/${id}`);
      setItem(res.data);
      setPaths(enumeratePaths(res.data?.parsed || {}));
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Impossible de charger l’événement");
    } finally {
      setLoadingItem(false);
    }
  }

  React.useEffect(() => {
    loadList();
  }, []);

  React.useEffect(() => {
    if (selId) loadOne(selId);
  }, [selId]);

  // Aperçu du “lead” qui serait produit par le mapping (coté front uniquement)
  const preview = React.useMemo(() => {
    const p = item?.parsed || {};
    const pick = (k?: string) => getByPath(p, k);
    const rawSale = pick(mapping.saleValue);
    const saleNum = Number(rawSale);
    return {
      ghlContactId: (pick(mapping.ghlContactId) ?? defaults.ghlContactId ?? null) || null,
      firstName: (pick(mapping.firstName) ?? defaults.firstName ?? "Unknown") as string,
      lastName: (pick(mapping.lastName) ?? defaults.lastName ?? null) as string | null,
      email: (pick(mapping.email) ?? defaults.email ?? null) as string | null,
      phone: (pick(mapping.phone) ?? defaults.phone ?? null) as string | null,
      tag: (pick(mapping.tag) ?? defaults.tag ?? null) as string | null,
      source: (pick(mapping.source) ?? defaults.source ?? "GHL") as string | null,
      stageName: (pick(mapping.stageName) ?? defaults.stageName ?? undefined) as string | undefined,
      saleValue: Number.isFinite(saleNum) ? saleNum : undefined,
      createdAtISO: (pick(mapping.createdAt) ?? undefined) as string | undefined,
    };
  }, [item, mapping, defaults]);

  async function applyMapping() {
    if (!selId) return;
    setSubmitting(true);
    setApplyMsg(null);
    try {
      await api.post(`/webhooks/ghl/inbox/${selId}/process`, { mapping, defaults });
      setApplyMsg("✔️ Mapping appliqué et lead upsert en base.");
    } catch (e: any) {
      setApplyMsg(e?.response?.data?.message || "Échec de l’application du mapping");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex gap-4">
        <Sidebar />

        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Intégrations · GoHighLevel (Inbox & Mapping)</div>
              <div className="text-sm text-[--muted]">
                Visualise les événements reçus, choisis les champs à mapper → crée/maj les leads (comme Zapier).
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={loadList} disabled={loadingList}>
                Rafraîchir
              </button>
            </div>
          </div>

          {err && <div className="text-sm text-red-400">{err}</div>}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* ===== Colonne 1 : Liste d’inbox ===== */}
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Derniers événements</div>
                <div className="text-2xs text-[--muted]">{loadingList ? "Chargement…" : `${list.length} items`}</div>
              </div>

              <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                {list.map((it) => {
                  const active = it.id === selId;
                  return (
                    <button
                      key={it.id}
                      className={[
                        "w-full text-left rounded-xl border border-white/10 px-3 py-2 hover:bg-white/10 transition",
                        active ? "bg-white/10 ring-1 ring-white/20" : "",
                      ].join(" ")}
                      onClick={() => setSelId(it.id)}
                    >
                      <div className="text-sm font-medium truncate">{it.id}</div>
                      <div className="text-2xs text-[--muted]">{new Date(it.receivedAt).toLocaleString()}</div>
                      <div className="text-2xs text-[--muted]">{it.contentType || "—"}</div>
                    </button>
                  );
                })}
                {!loadingList && list.length === 0 && (
                  <div className="text-sm text-[--muted] py-4 text-center">Aucun événement encore reçu.</div>
                )}
              </div>
            </div>

            {/* ===== Colonne 2 : Détail brut ===== */}
            <div className="space-y-3">
              <div className="card">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">Événement sélectionné</div>
                  {loadingItem && <div className="text-2xs text-[--muted]">Chargement…</div>}
                </div>
                {item ? (
                  <div className="text-2xs grid grid-cols-2 gap-2">
                    <div><div className="label">ID</div><div className="opacity-90 break-all">{item.id}</div></div>
                    <div><div className="label">Reçu</div><div className="opacity-90">{new Date(item.receivedAt).toLocaleString()}</div></div>
                    <div className="col-span-2"><div className="label">Content-Type</div><div className="opacity-90">{item.contentType || "—"}</div></div>
                  </div>
                ) : (
                  <div className="text-sm text-[--muted]">Sélectionne un événement à gauche.</div>
                )}
              </div>

              <JsonBlock title="Headers" obj={item?.headers} />
              <JsonBlock title="Query" obj={item?.query} />
              <JsonBlock title="Parsed (payload)" obj={item?.parsed} />
              <div className="card">
                <div className="font-semibold mb-1">Raw</div>
                <pre className="text-2xs whitespace-pre-wrap break-all overflow-auto max-h-56">{item?.raw || "—"}</pre>
              </div>
            </div>

            {/* ===== Colonne 3 : Mapping (à la Zapier) ===== */}
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Mapping</div>
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    setMapping({
                      firstName: "contact.first_name",
                      lastName: "contact.last_name",
                      email: "contact.email",
                      phone: "contact.phone",
                      stageName: "opportunity.stage_name",
                      saleValue: "opportunity.monetary_value",
                      ghlContactId: "contact.id",
                    })
                  }
                >
                  Preset “classique GHL”
                </button>
              </div>

              {!item && <div className="text-sm text-[--muted]">Sélectionne un événement pour mapper ses champs.</div>}

              {item && (
                <>
                  <div className="grid grid-cols-1 gap-3">
                    <FieldPicker
                      label="Prénom"
                      value={mapping.firstName}
                      onChange={(v) => setMapping((m) => ({ ...m, firstName: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.firstName)}
                    />
                    <FieldPicker
                      label="Nom"
                      value={mapping.lastName}
                      onChange={(v) => setMapping((m) => ({ ...m, lastName: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.lastName)}
                    />
                    <FieldPicker
                      label="Email"
                      value={mapping.email}
                      onChange={(v) => setMapping((m) => ({ ...m, email: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.email)}
                    />
                    <FieldPicker
                      label="Téléphone"
                      value={mapping.phone}
                      onChange={(v) => setMapping((m) => ({ ...m, phone: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.phone)}
                    />
                    <FieldPicker
                      label="Tag"
                      value={mapping.tag}
                      onChange={(v) => setMapping((m) => ({ ...m, tag: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.tag)}
                      placeholder="ex: contact.tags[0].name"
                    />
                    <FieldPicker
                      label="Source"
                      value={mapping.source}
                      onChange={(v) => setMapping((m) => ({ ...m, source: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.source)}
                      placeholder='ex: "GHL" (vide = par défaut)'
                    />
                    <FieldPicker
                      label="Nom de colonne Pipeline (stageName)"
                      value={mapping.stageName}
                      onChange={(v) => setMapping((m) => ({ ...m, stageName: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.stageName)}
                    />
                    <FieldPicker
                      label="Valeur de vente (€) si WON"
                      value={mapping.saleValue}
                      onChange={(v) => setMapping((m) => ({ ...m, saleValue: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.saleValue)}
                    />
                    <FieldPicker
                      label="Contact ID GHL"
                      value={mapping.ghlContactId}
                      onChange={(v) => setMapping((m) => ({ ...m, ghlContactId: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.ghlContactId)}
                    />
                    <FieldPicker
                      label="Date de création (ISO)"
                      value={mapping.createdAt}
                      onChange={(v) => setMapping((m) => ({ ...m, createdAt: v }))}
                      options={paths}
                      exampleValue={getByPath(item.parsed, mapping.createdAt)}
                    />
                  </div>

                  {/* Defaults rapides */}
                  <div className="mt-2">
                    <div className="label">Valeurs par défaut</div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="input"
                        placeholder='source (ex: "GHL")'
                        value={defaults.source ?? ""}
                        onChange={(e) => setDefaults((d) => ({ ...d, source: e.target.value || null }))}
                      />
                      <input
                        className="input"
                        placeholder="tag par défaut"
                        value={defaults.tag ?? ""}
                        onChange={(e) => setDefaults((d) => ({ ...d, tag: e.target.value || null }))}
                      />
                    </div>
                  </div>

                  {/* Aperçu */}
                  <div className="card">
                    <div className="font-medium mb-1">Aperçu (lead qui sera upsert)</div>
                    <pre className="text-2xs whitespace-pre-wrap break-all">
                      {JSON.stringify(preview, null, 2)}
                    </pre>
                  </div>

                  <div className="flex items-center gap-2">
                    <button className="btn btn-primary" onClick={applyMapping} disabled={submitting}>
                      {submitting ? "Application…" : "Appliquer ce mapping"}
                    </button>
                    {applyMsg && <div className="text-2xs text-[--muted]">{applyMsg}</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
