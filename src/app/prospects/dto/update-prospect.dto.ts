// Front-only DTO: pas d'import class-validator ni @prisma/client.
// On garde des types optionnels simples pour l'UI.

export type UpdateProspectDto = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tag?: string;
  source?: string;

  opportunityValue?: number;
  saleValue?: number;

  setterId?: string;
  closerId?: string;

  // Était LeadStage (enum Prisma) côté backend.
  // Côté front, on passe un string (le backend validera).
  stage?: string;
};

// (Optionnel) petit helper pour normaliser des valeurs issues de formulaires
export function normalizeUpdateProspect(input: any): UpdateProspectDto {
  const s = (v: any) => (v == null ? undefined : String(v).trim());
  const n = (v: any) => {
    if (v == null || v === "") return undefined;
    const num = Number(v);
    return Number.isFinite(num) ? num : undefined;
  };

  return {
    firstName: s(input?.firstName),
    lastName: s(input?.lastName),
    email: s(input?.email),
    phone: s(input?.phone),
    tag: s(input?.tag),
    source: s(input?.source),

    opportunityValue: n(input?.opportunityValue),
    saleValue: n(input?.saleValue),

    setterId: s(input?.setterId),
    closerId: s(input?.closerId),

    stage: s(input?.stage),
  };
  
}
