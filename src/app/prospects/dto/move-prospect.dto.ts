// Front-only DTO: pas de class-validator, pas de @prisma/client ici.
// On garde un type léger pour décrire la forme attendue.

export type MoveProspectDto = {
  /** Nom du stage cible (p. ex. "WON", "LOST", "Qualified", etc.) */
  toStage: string;
};

// (Optionnel) petit garde-fou runtime si tu veux valider côté front
export function isMoveProspectDto(v: unknown): v is MoveProspectDto {
  return !!v && typeof (v as any).toStage === "string" && (v as any).toStage.length > 0;
  
}
