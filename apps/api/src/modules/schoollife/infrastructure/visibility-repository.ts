/**
 * LA règle de visibilité (`schoollife.audience_may_see`, migration 2202) appliquée à UNE ligne déjà chargée : jamais recopiée
 * dans le code applicatif (le miroir pur de `domain/confidentiality.ts` ne sert qu'aux tests de parité et à l'affichage).
 */
import type { Tx } from "@ecoledigitale/database";

export interface VisibilityQuery {
  audience: string;
  kind: "INCIDENT" | "MEASURE" | "NOTE" | "CONVOCATION";
  confidentiality: string;
  shareable: boolean;
  status: string;
  noteVisibility?: string | null;
}

export async function maySee(tx: Tx, q: VisibilityQuery): Promise<boolean> {
  const row = await tx.queryOne<{ v: boolean }>(`SELECT schoollife.audience_may_see($1, $2, $3, $4, $5, $6) AS v`, [q.audience, q.kind, q.confidentiality, q.shareable, q.status, q.noteVisibility ?? null]);
  return row?.v === true;
}
