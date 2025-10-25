"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import api from "@/lib/api";
import Sidebar from "@/components/Sidebar";

/* ======================= Types ======================= */
type Auto = {
  id: string;
  name: string;
  status: "OFF" | "DRY_RUN" | "ON";
  webhookUrl: string;
  mappingJson: any; // structure libre
  updatedAt?: string;
};

type StageOption = { value: string; label: string };


type Ev = {
  id: string;
  receivedAt: string;
  status: "RECEIVED" | "PROCESSED" | "FAILED";
  error?: string | null;
  result?: any;
  payload: any;
};

// ⚠️ Plus d'énum figée : laisse passer toutes les valeurs de ton schéma Prisma
type LeadStage = string;

/** Valeurs par défaut (adapter si besoin à ton ENUM Prisma actuel) */
const STAGE_DEFAULTS: string[] = [
  "LEADS_RECEIVED",
  "CALL_REQUESTED",
  "CALL_ATTEMPT",
  "CALL_ANSWERED",
  "SETTER_NO_SHOW",
  "FOLLOW_UP",

  "RV0_PLANNED",
  "RV0_HONORED",
  "RV0_NO_SHOW",

  "RV1_PLANNED",
  "RV1_HONORED",
  "RV1_NO_SHOW",
  "RV1_POSTPONED",

  "RV2_PLANNED",
  "RV2_HONORED",
  "RV2_POSTPONED",

  "WON",
  "LOST",
  "NOT_QUALIFIED",
];


/** Alias ancien schéma → nouveau (migration silencieuse) */
const LEGACY_TO_NEW: Record<string, string> = {
  LEAD_RECU: "LEADS_RECEIVED",
  DEMANDE_APPEL: "CALL_REQUESTED",
  APPEL_PASSE: "CALL_ATTEMPT",
  APPEL_REPONDU: "CALL_ANSWERED",
  NO_SHOW_SETTER: "SETTER_NO_SHOW",
  FOLLOW_UP: "FOLLOW_UP",

  RV0_PLANIFIE: "RV0_PLANNED",
  RV0_HONORE:  "RV0_HONORED",
  RV0_NO_SHOW: "RV0_NO_SHOW",

  RV1_PLANIFIE: "RV1_PLANNED",
  RV1_HONORE:  "RV1_HONORED",
  RV1_NO_SHOW: "RV1_NO_SHOW",

  RV2_PLANIFIE: "RV2_PLANNED",
  RV2_HONORE:  "RV2_HONORED",

  WON: "WON",
  LOST: "LOST",
  NOT_QUALIFIED: "NOT_QUALIFIED",
};


/* ======================= Page ======================= */
export default function AutomationPage() {
  // ⚠️ IMPORTANT: on utilise useParams (pas de { params } dans la signature)
  const params = useParams<{ id: string }>();
  const id = (params?.id ?? "") as string;

  const [a, setA] = useState<Auto | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [modal, setModal] = useState<{ open: boolean; ok: boolean; message: string }>({
    open: false,
    ok: true,
    message: "",
  });

  const [dragPath, setDragPath] = useState<string | null>(null);

  /* ======================= Data load ======================= */
  async function load() {
    if (!id) return;
    try {
      const [ra, re] = await Promise.all([
        api.get<Auto>(`/integrations/automations/${id}`),
        api.get<Ev[]>(`/integrations/automations/${id}/events`, { params: { limit: 30 } }),
      ]);
      setA(ra.data);
      setEvents(Array.isArray(re.data) ? re.data : []);
      setErr(null);
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Erreur chargement");
      setA(null);
      setEvents([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ======================= Actions ======================= */
  async function setStatus(s: Auto["status"]) {
    if (!id) return;
    try {
      await api.patch(`/integrations/automations/${id}`, { status: s });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Changement de statut impossible");
    }
  }

  /** Normalise les noms de stages côté mapping avant enregistrement */
  function normalizeStageNames(m: any) {
    const out = structuredClone(m || {});
    const node = out;

    if (node?.stage?.fixed) {
      node.stage.fixed = LEGACY_TO_NEW[node.stage.fixed] ?? node.stage.fixed;
    }
    if (node?.stage?.table?.fallback) {
      node.stage.table.fallback = LEGACY_TO_NEW[node.stage.table.fallback] ?? node.stage.table.fallback;
    }
    if (node?.stage?.table?.map) {
      const map: Record<string, string> = node.stage.table.map;
      for (const k of Object.keys(map)) {
        const v = map[k];
        map[k] = LEGACY_TO_NEW[v] ?? v;
      }
    }
    return out;
  }

  async function saveMapping() {
    if (!id) return;
    try {
      const raw = a?.mappingJson || {};
      const normalized = normalizeStageNames(raw);
      await api.patch(`/integrations/automations/${id}`, { mappingJson: normalized });
      setModal({ open: true, ok: true, message: "Mapping enregistré avec succès." });
      setTimeout(() => setModal((m) => ({ ...m, open: false })), 1400);
      await load();
    } catch (e: any) {
      setModal({ open: true, ok: false, message: e?.response?.data?.message || "Échec de l’enregistrement." });
    }
  }

  async function deleteAutomation() {
    if (!id) return;
    if (!confirm("Supprimer cette automation ?")) return;
    try {
      await api.delete(`/integrations/automations/${id}`);
      window.location.href = "/integrations/automatisations";
    } catch (e: any) {
      setErr(e?.response?.data?.message || "Suppression impossible");
    }
  }

  /* ======================= Helpers ======================= */
  const lastPayload = useMemo(() => (events?.[0]?.payload ?? {}), [events]);

  const getByPath = (obj: any, path?: string) => {
    if (!path) return undefined;
    try {
      return path.split(".").reduce((acc: any, k: string) => (acc != null ? acc[k] : undefined), obj);
    } catch {
      return undefined;
    }
  };

  const sampleEntries = useMemo(() => {
    const out: Array<{ path: string; value: any }> = [];
    const walk = (obj: any, base: string) => {
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const k of Object.keys(obj)) {
          const next = base ? `${base}.${k}` : k;
          const v = (obj as any)[k];
          if (v && typeof v === "object" && !Array.isArray(v)) walk(v, next);
          else out.push({ path: next, value: v });
        }
      } else if (base) {
        out.push({ path: base, value: obj });
      }
    };
    walk(lastPayload, "");
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }, [lastPayload]);

  const statusChip = (s: Auto["status"]) => (
    <span
      className={
        "text-2xs px-2 py-0.5 rounded " +
        (s === "ON"
          ? "bg-emerald-500/20 text-emerald-300"
          : s === "DRY_RUN"
          ? "bg-amber-500/20 text-amber-300"
          : "bg-zinc-500/20 text-zinc-300")
      }
      title={
        s === "ON"
          ? "Active: traite et écrit en base"
          : s === "DRY_RUN"
          ? "Test: traite sans écrire en base"
          : "OFF: n'exécute rien"
      }
    >
      {s === "ON" ? "Active" : s === "DRY_RUN" ? "Test (dry-run)" : "Off"}
    </span>
  );

  // ----- Mutateurs mappingJson -----
  const setFieldFrom = (field: string, fromPath: string | null) => {
    if (!a) return;
    const next = structuredClone(a);
    next.mappingJson ??= {};
    next.mappingJson.fields ??= {};
    next.mappingJson.fields[field] ??= {};
    if (fromPath) next.mappingJson.fields[field].from = fromPath;
    else delete next.mappingJson.fields[field].from;
    setA(next);
  };

  const setStageMode = (mode: "fixed" | "table" | "none") => {
    if (!a) return;
    const n = structuredClone(a);
    n.mappingJson ??= {};
    n.mappingJson.stage ??= {};
    n.mappingJson.stage.mode = mode;
    setA(n);
  };

  const setStageFixed = (stage: LeadStage) => {
    if (!a) return;
    const n = structuredClone(a);
    n.mappingJson ??= {};
    n.mappingJson.stage ??= {};
    n.mappingJson.stage.fixed = stage;
    setA(n);
  };

  const setStageTableFrom = (path: string) => {
    if (!a) return;
    const n = structuredClone(a);
    n.mappingJson ??= {};
    n.mappingJson.stage ??= {};
    n.mappingJson.stage.table ??= {};
    n.mappingJson.stage.table.from = path;
    setA(n);
  };

  const setStageTableMap = (fromValue: string, toStage: LeadStage) => {
    if (!a) return;
    const n = structuredClone(a);
    n.mappingJson ??= {};
    n.mappingJson.stage ??= {};
    n.mappingJson.stage.table ??= {};
    n.mappingJson.stage.table.map ??= {};
    n.mappingJson.stage.table.map[fromValue] = toStage;
    setA(n);
  };

  const setStageTableFallback = (stage: LeadStage) => {
    if (!a) return;
    const n = structuredClone(a);
    n.mappingJson ??= {};
    n.mappingJson.stage ??= {};
    n.mappingJson.stage.table ??= {};
    n.mappingJson.stage.table.fallback = stage;
    setA(n);
  };

  const setMergeStrategy = (strategy: "preserve" | "overwriteMapped") => {
    if (!a) return;
    const n = structuredClone(a);
    n.mappingJson ??= {};
    n.mappingJson.merge ??= {};
    n.mappingJson.merge.strategy = strategy;
    setA(n);
  };

  const setMergeSkipNull = (skip: boolean) => {
    if (!a) return;
    const n = structuredClone(a);
    n.mappingJson ??= {};
    n.mappingJson.merge ??= {};
    n.mappingJson.merge.skipNull = skip;
    setA(n);
  };

  // ----- Mutateurs assign (NOUVEAU) -----
  const setAssignRoundRobinSetter = (on: boolean) => {
    if (!a) return;
    const n = structuredClone(a);
    n.mappingJson ??= {};
    n.mappingJson.assign ??= {};
    n.mappingJson.assign.roundRobin ??= {};
    n.mappingJson.assign.roundRobin.setter = on;
    setA(n);
  };

  const pushAssignRule = (rule: any) => {
    if (!a) return;
    const n = structuredClone(a);
    n.mappingJson ??= {};
    n.mappingJson.assign ??= {};
    n.mappingJson.assign.rules ??= [];
    n.mappingJson.assign.rules.push(rule);
    setA(n);
  };

  const updateAssignRule = (idx: number, patch: any) => {
    if (!a) return;
    const n = structuredClone(a);
    const rules: any[] = n.mappingJson?.assign?.rules || [];
    if (!rules[idx]) return;
    rules[idx] = { ...rules[idx], ...patch };
    n.mappingJson.assign.rules = rules;
    setA(n);
  };

  const removeAssignRule = (idx: number) => {
    if (!a) return;
    const n = structuredClone(a);
    const rules: any[] = n.mappingJson?.assign?.rules || [];
    rules.splice(idx, 1);
    n.mappingJson.assign.rules = rules;
    setA(n);
  };

  // DnD
  const onDragStartPath = (p: string) => setDragPath(p);
  const onDragOverDropzone = (e: React.DragEvent) => e.preventDefault();
  const onDropToField = (field: string) => {
    if (!dragPath) return;
    setFieldFrom(field, dragPath);
    setDragPath(null);
  };

  /** Champs cibles CRM */
  const targetFields = [
    { key: "firstName", label: "Prénom" },
    { key: "lastName", label: "Nom" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Téléphone" },
    { key: "tag", label: "Tag" },
    { key: "opportunityValue", label: "Valeur d’opportunité (€)" },
    { key: "ghlContactId", label: "GHL Contact ID" },
  ];

  // Liste d’options pour les <select> d’étapes : defaults + valeurs déjà présentes dans le mapping
  const stageOptions = useMemo(() => {
    const set = new Set<string>(STAGE_DEFAULTS);
    const m = a?.mappingJson ?? {};
    const fixed = m?.stage?.fixed as string | undefined;
    const fallback = m?.stage?.table?.fallback as string | undefined;
    const tableMap: Record<string, string> = (m?.stage?.table?.map || {});
    if (fixed) set.add(LEGACY_TO_NEW[fixed] ?? fixed);
    if (fallback) set.add(LEGACY_TO_NEW[fallback] ?? fallback);
    Object.values(tableMap).forEach((v) => set.add(LEGACY_TO_NEW[v] ?? v));
    return Array.from(set);
  }, [a]);

  // UI
  const cannotLoad = !id;
  const webhookDisplay = a?.webhookUrl || "—";

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex gap-4">
        <Sidebar />

        <div className="flex-1 space-y-4">
          {err && <div className="text-sm text-red-400">{err}</div>}
          {cannotLoad && <div className="card">Préparation…</div>}

          {!cannotLoad && !a ? (
            <div className="card">Chargement…</div>
          ) : !cannotLoad && a ? (
            <>
              {/* Header + status */}
              <div className="card">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">{a.name}</div>
                  <div className="flex gap-2">
                    <button className={`btn ${a.status === "OFF" ? "btn-primary" : "btn-ghost"}`} onClick={() => setStatus("OFF")}>
                      OFF
                    </button>
                    <button className={`btn ${a.status === "DRY_RUN" ? "btn-primary" : "btn-ghost"}`} onClick={() => setStatus("DRY_RUN")}>
                      DRY-RUN
                    </button>
                    <button className={`btn ${a.status === "ON" ? "btn-primary" : "btn-ghost"}`} onClick={() => setStatus("ON")}>
                      ON
                    </button>
                    <button className="btn btn-ghost" onClick={deleteAutomation}>
                      Supprimer
                    </button>
                  </div>
                </div>

                <div className="mt-2 space-y-2">
                  <div className="text-xs text-[--muted]">Statut: {statusChip(a.status)}</div>
                  <div className="text-xs text-[--muted]">
                    Webhook URL: <code>{webhookDisplay}</code> (colle-la dans GHL)
                  </div>
                </div>
              </div>

              {/* ======= Mapping Drag & Drop ======= */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-medium">Mapping (glisser-déposer)</div>
                  <button className="btn btn-primary" onClick={saveMapping}>
                    Enregistrer
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Source (payload) */}
                  <div>
                    <div className="label">Échantillon (dernier payload)</div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 max-h-[420px] overflow-auto">
                      {Object.keys(lastPayload || {}).length ? (
                        <ul className="space-y-1">
                          {sampleEntries.map(({ path, value }) => (
                            <li
                              key={path}
                              draggable
                              onDragStart={() => onDragStartPath(path)}
                              className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/15 cursor-grab flex items-center justify-between gap-2"
                              title="Glisser sur une zone à droite"
                            >
                              <span className="truncate">{path}</span>
                              <span className="text-[10px] opacity-80 truncate max-w-[50%]">{String(value)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-xs text-[--muted]">
                          Aucune donnée échantillon. Envoie un test depuis GHL (automation en DRY-RUN).
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Targets (CRM) */}
                  <div>
                    <div className="label">Cible CRM (dépose ici)</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {targetFields.map((f) => {
                        const curPath = a.mappingJson?.fields?.[f.key]?.from || "";
                        const curVal = curPath ? getByPath(lastPayload, curPath) : undefined;
                        return (
                          <div key={f.key}>
                            <div className="text-2xs mb-1 text-[--muted]">{f.label}</div>
                            <div
                              className="rounded-lg border border-dashed border-white/20 bg-white/5 px-2 py-2 min-h-10"
                              onDragOver={onDragOverDropzone}
                              onDrop={() => onDropToField(f.key)}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  className="bg-transparent outline-none text-xs flex-1"
                                  placeholder="Dépose un path ou saisis-le (a.b.c)"
                                  value={curPath}
                                  onChange={(e) => setFieldFrom(f.key, e.target.value || null)}
                                />
                                {curPath && (
                                  <button className="text-2xs opacity-60 hover:opacity-100" onClick={() => setFieldFrom(f.key, null)}>
                                    ×
                                  </button>
                                )}
                              </div>
                              {curPath && (
                                <div className="mt-1 text-[10px] text-[--muted] truncate">
                                  Valeur actuelle: <span className="opacity-90">{String(curVal ?? "—")}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Stage Rules */}
                    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="font-medium mb-2">Règles d’étape (pipeline)</div>

                      <div className="flex gap-2 text-sm">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="stageMode"
                            checked={(a.mappingJson?.stage?.mode || "table") === "fixed"}
                            onChange={() => setStageMode("fixed")}
                          />
                          <span>Fixed</span>
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="stageMode"
                            checked={(a.mappingJson?.stage?.mode || "table") === "table"}
                            onChange={() => setStageMode("table")}
                          />
                          <span>Table</span>
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="stageMode"
                            checked={(a.mappingJson?.stage?.mode || "table") === "none"}
                            onChange={() => setStageMode("none")}
                          />
                          <span>None</span>
                        </label>
                      </div>

                      {(a.mappingJson?.stage?.mode || "table") === "fixed" && (
                        <div className="mt-2">
                          <div className="label">Étape fixe</div>
                          <select
                            className="input"
                            value={a.mappingJson?.stage?.fixed || "LEAD_RECU"}
                            onChange={(e) => setStageFixed(e.target.value as LeadStage)}
                          >
                            {stageOptions.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {(a.mappingJson?.stage?.mode || "table") === "table" && (
                        <div className="mt-2 space-y-2">
                          <div>
                            <div className="label">Champ source (dépose un path)</div>
                            <div
                              className="rounded-lg border border-dashed border-white/20 bg-white/5 px-2 py-2 min-h-10"
                              onDragOver={onDragOverDropzone}
                              onDrop={() => dragPath && setStageTableFrom(dragPath)}
                            >
                              <input
                                className="bg-transparent outline-none text-xs w-full"
                                placeholder="ex: pipeline_stage"
                                value={a.mappingJson?.stage?.table?.from || ""}
                                onChange={(e) => setStageTableFrom(e.target.value)}
                              />
                            </div>
                          </div>

                          <div>
                            <div className="label">Table de correspondance</div>
                            <div className="space-y-2">
                              {Object.entries(a.mappingJson?.stage?.table?.map || {}).map(([fromVal, stage]) => (
                                <div key={fromVal} className="flex items-center gap-2">
                                  <input className="input flex-1" value={fromVal} readOnly />
                                  <select
                                    className="input"
                                    value={stage as string}
                                    onChange={(e) => setStageTableMap(fromVal, e.target.value as LeadStage)}
                                  >
                                    {stageOptions.map((s) => (
                                      <option key={s} value={s}>
                                        {s}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                              <div className="flex items-center gap-2">
                                <input
                                  className="input flex-1"
                                  placeholder="Valeur source (ex: RV1 fait)"
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      const v = (e.currentTarget as HTMLInputElement).value.trim();
                                      if (v) {
                                        setStageTableMap(v, "LEAD_RECU");
                                        (e.currentTarget as HTMLInputElement).value = "";
                                      }
                                    }
                                  }}
                                />
                                <span className="text-xs text-[--muted]">Entrée ↵</span>
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="label">Fallback</div>
                            <select
                              className="input"
                              value={a.mappingJson?.stage?.table?.fallback || "LEAD_RECU"}
                              onChange={(e) => setStageTableFallback(e.target.value as LeadStage)}
                            >
                              {stageOptions.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Merge strategy */}
                    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="font-medium mb-2">Stratégie de fusion</div>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="mergeStrat"
                            checked={(a.mappingJson?.merge?.strategy || "preserve") === "preserve"}
                            onChange={() => setMergeStrategy("preserve")}
                          />
                          <span>Préserver l’existant</span>
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="mergeStrat"
                            checked={(a.mappingJson?.merge?.strategy || "preserve") === "overwriteMapped"}
                            onChange={() => setMergeStrategy("overwriteMapped")}
                          />
                          <span>Écraser (champs mappés)</span>
                        </label>

                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={Boolean(a.mappingJson?.merge?.skipNull ?? true)}
                            onChange={(e) => setMergeSkipNull(e.target.checked)}
                          />
                          <span>Ignorer les valeurs vides/null</span>
                        </label>
                      </div>
                      <div className="text-[11px] text-[--muted] mt-1">
                        Note: <code>opportunityValue</code> et <code>tag</code> sont toujours mis à jour si mappés (forceOverwrite).
                      </div>
                    </div>

                    {/* Assignation (auto) — NOUVEAU */}
                    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="font-medium mb-2">Assignation (auto)</div>

                      <div className="flex items-center gap-3 text-sm">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={Boolean(a.mappingJson?.assign?.roundRobin?.setter ?? true)}
                            onChange={(e) => setAssignRoundRobinSetter(e.target.checked)}
                          />
                          <span>Round-robin sur SETTER si aucune règle ne matche</span>
                        </label>
                      </div>

                      <div className="mt-3">
                        <div className="label">Règles (évaluées dans l’ordre)</div>
                        <div className="space-y-2">
                          {(a.mappingJson?.assign?.rules || []).map((r: any, i: number) => (
                            <div key={i} className="rounded-lg border border-white/10 p-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  className="input h-8"
                                  value={r.role || "SETTER"}
                                  onChange={(e) => updateAssignRule(i, { role: e.target.value })}
                                  title="Rôle cible"
                                >
                                  <option value="SETTER">SETTER</option>
                                  <option value="CLOSER">CLOSER</option>
                                </select>

                                <select
                                  className="input h-8"
                                  value={r.by || "email"}
                                  onChange={(e) => updateAssignRule(i, { by: e.target.value })}
                                  title="Type de règle"
                                >
                                  <option value="email">par email (from path)</option>
                                  <option value="name">par nom (from path)</option>
                                  <option value="static">statique (match → userId)</option>
                                </select>

                                {(r.by === "email" || r.by === "name" || r.by === "static") && (
                                  <input
                                    className="input h-8 w-56"
                                    placeholder="Path source (ex: owner.email)"
                                    value={r.from || ""}
                                    onChange={(e) => updateAssignRule(i, { from: e.target.value })}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => {
                                      if (dragPath) {
                                        updateAssignRule(i, { from: dragPath });
                                        setDragPath(null);
                                      }
                                    }}
                                    title="Dépose un path depuis la colonne de gauche"
                                  />
                                )}

                                {r.by === "static" && (
                                  <>
                                    <input
                                      className="input h-8 w-44"
                                      placeholder="match.equals / match.contains"
                                      value={r.match?.equals || r.match?.contains || ""}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        updateAssignRule(i, { match: v ? { equals: v } : {} });
                                      }}
                                      title="equals / contains / regex via JSON si besoin"
                                    />
                                    <input
                                      className="input h-8 w-44"
                                      placeholder="userId cible"
                                      value={r.userId || ""}
                                      onChange={(e) => updateAssignRule(i, { userId: e.target.value })}
                                      title="l’ID du user en base"
                                    />
                                  </>
                                )}

                                <button className="btn btn-ghost h-8 px-2" onClick={() => removeAssignRule(i)}>
                                  Supprimer
                                </button>
                              </div>

                              {r.from && (
                                <div className="text-[11px] text-[--muted] mt-1">
                                  Valeur actuelle ({r.from}) :{" "}
                                  <span className="opacity-90">
                                    {String(getByPath(lastPayload, r.from) ?? "—")}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}

                          <div>
                            <button
                              className="btn btn-ghost"
                              onClick={() => pushAssignRule({ role: "SETTER", by: "email", from: "" })}
                            >
                              + Ajouter une règle
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* /Assignation (auto) */}
                  </div>
                </div>
              </div>

              {/* Inbox des événements */}
              <div className="card">
                <div className="font-medium mb-2">Inbox des événements (30 derniers)</div>
                <div className="space-y-2">
                  {events.map((ev) => (
                    <details key={ev.id} className="rounded-lg border border-white/10 p-3">
                      <summary className="cursor-pointer">
                        <span className="text-sm">
                          #{ev.id.slice(-6)} • {new Date(ev.receivedAt).toLocaleString()} • {ev.status}
                        </span>
                        {ev.error && <span className="ml-2 text-rose-300">— {ev.error}</span>}
                        {ev.result?.leadId && <span className="ml-2 text-emerald-300">→ lead {ev.result.leadId}</span>}
                      </summary>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="label">Payload reçu</div>
                          <pre className="text-xs bg-white/5 rounded p-2 overflow-auto">
                            {JSON.stringify(ev.payload, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="label">Résultat</div>
                          <pre className="text-xs bg-white/5 rounded p-2 overflow-auto">
                            {JSON.stringify(ev.result || {}, null, 2)}
                          </pre>
                          <button
                            className="btn btn-ghost mt-2"
                            onClick={() => api.post(`/integrations/events/${ev.id}/replay`).then(load)}
                          >
                            Rejouer
                          </button>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>

                {!events.length && (
                  <div className="text-sm text-[--muted]">
                    Aucun événement reçu. Laisse l’automation en <b>DRY-RUN</b>, envoie un test depuis GHL puis reviens
                    mapper.
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Modal de confirmation */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="card max-w-sm w-full text-center">
            <div className={`text-4xl mb-2 ${modal.ok ? "text-emerald-300" : "text-rose-300"}`}>{modal.ok ? "✅" : "❌"}</div>
            <div className="text-lg font-semibold">{modal.ok ? "Enregistré" : "Échec"}</div>
            <div className="text-sm text-[--muted] mt-1">{modal.message}</div>
            <div className="mt-4">
              <button className="btn btn-primary" onClick={() => setModal((m) => ({ ...m, open: false }))}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
