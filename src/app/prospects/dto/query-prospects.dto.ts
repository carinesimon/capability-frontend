// Front-only DTO: pas de class-validator / class-transformer / Prisma ici.
// On expose un type souple pour les filtres de recherche côté UI.

export type QueryProspectsDto = {
  // ⚠️ Était LeadStage côté backend : on garde un string côté front
  stage?: string;

  // Texte de recherche libre
  q?: string;
  search?: string;

  // Pagination
  page?: number;
  limit?: number;
  offset?: number;

  // Tri
  sort?: string;
  order?: "asc" | "desc";

  // Filtres divers
  assignedToId?: string;
  from?: string; // ISO yyyy-mm-dd
  to?: string;   // ISO yyyy-mm-dd
};

// (Optionnel) petit helper runtime pour normaliser un objet quelconque
export function normalizeQueryProspects(input: any): QueryProspectsDto {
  const n = (v: any) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const s = (v: any) => (v === undefined || v === null ? undefined : String(v));

  return {
    stage: s(input?.stage),
    q: s(input?.q),
    search: s(input?.search),
    page: n(input?.page),
    limit: n(input?.limit),
    offset: n(input?.offset),
    sort: s(input?.sort),
    order: input?.order === "desc" ? "desc" : input?.order === "asc" ? "asc" : undefined,
    assignedToId: s(input?.assignedToId),
    from: s(input?.from),
    to: s(input?.to),
  };
}
