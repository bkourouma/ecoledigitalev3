/**
 * Libellés des codes de sortie (`label_map`, spec 012 : `{ "<CODE>": { "fr": "Très bien" } }`, une table PAR RÈGLE de la version).
 * Fonction PURE : aucun libellé n'est jamais comparé par la logique (R-RUL-08) ; ce service ne sert qu'à l'AFFICHAGE
 * (propositions du conseil, appréciations suggérées, bulletins).
 */
import type { LabelMap } from "./types";

export interface LabelledRule {
  readonly key: string;
  readonly labelMap: LabelMap;
}

/**
 * Libellé d'un code de sortie dans la langue demandée (`fr` par défaut). Si `ruleKey` est donné, seule cette règle est consultée ;
 * sinon la première règle (dans l'ordre fourni) qui définit ce code. `null` si aucun libellé n'est défini : l'appelant garde le code.
 */
export function outputLabelOf(rules: readonly LabelledRule[], code: string, options: { locale?: string; ruleKey?: string } = {}): string | null {
  const locale = options.locale ?? "fr";
  for (const rule of rules) {
    if (options.ruleKey !== undefined && rule.key !== options.ruleKey) continue;
    const text = rule.labelMap[code]?.[locale];
    if (typeof text === "string" && text.trim().length > 0) return text.trim();
  }
  return null;
}
