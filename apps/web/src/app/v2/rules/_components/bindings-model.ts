/**
 * Lecture d'affichage des liaisons règle <-> périmètre. Aucun calcul de règle : ce module ne fait que ranger les liaisons
 * par contrat et croiser, pour un AVERTISSEMENT d'écran, les programmes avec les liaisons déjà posées. La résolution réelle
 * (quel jeu de règles s'applique à quel programme, à quelle date) reste celle de l'API.
 */
import type { RulesBindingDto } from "@ecoledigitale/contracts/v2/rules";

export type ScopeKind = "tenant" | "institution" | "program" | "level" | "other";

/** Nature du périmètre d'une liaison (aucun champ renseigné = tout l'établissement). */
export function scopeKind(b: Pick<RulesBindingDto, "institutionId" | "curriculumNodeId" | "levelCode">): ScopeKind {
  if (b.curriculumNodeId && !b.levelCode) return "program";
  if (b.levelCode && !b.curriculumNodeId) return "level";
  if (b.curriculumNodeId && b.levelCode) return "other";
  return b.institutionId ? "institution" : "tenant";
}

/** La liaison est en vigueur à `today` (dates civiles `AAAA-MM-JJ`, comparaison lexicographique). */
export function isEffective(b: Pick<RulesBindingDto, "effectiveFrom" | "effectiveTo">, today: string): boolean {
  return b.effectiveFrom <= today && (b.effectiveTo === null || today <= b.effectiveTo);
}

export type BindingState = "active" | "upcoming" | "expired";

export function bindingState(b: Pick<RulesBindingDto, "effectiveFrom" | "effectiveTo">, today: string): BindingState {
  if (b.effectiveFrom > today) return "upcoming";
  if (b.effectiveTo !== null && b.effectiveTo < today) return "expired";
  return "active";
}

export function groupByContract<T extends { contractId: string }>(items: ReadonlyArray<T>, knownIds: ReadonlyArray<string>): Array<{ contractId: string; items: T[] }> {
  const ids = [...knownIds];
  for (const b of items) if (!ids.includes(b.contractId)) ids.push(b.contractId);
  return ids.map((contractId) => ({ contractId, items: items.filter((b) => b.contractId === contractId) }));
}

/**
 * Programmes sans aucune liaison en vigueur pour le contrat qu'ils déclarent : ni liaison propre au programme, ni liaison
 * générale (établissement entier), ni liaison par niveau (que l'écran ne peut pas rattacher à un programme : elle compte comme
 * couverture possible). C'est un indicateur de vigilance, pas la résolution du serveur.
 */
export function programsWithoutBinding<P extends { id: string }>(
  programs: ReadonlyArray<P>,
  contractIdOf: (program: P) => string | null,
  contractId: string,
  bindings: ReadonlyArray<RulesBindingDto>,
  today: string,
): P[] {
  const live = bindings.filter((b) => b.contractId === contractId && isEffective(b, today));
  const covers = (programId: string) => live.some((b) => (b.curriculumNodeId === null && b.levelCode === null) || b.levelCode !== null || b.curriculumNodeId === programId);
  return programs.filter((p) => contractIdOf(p) === contractId && !covers(p.id));
}
