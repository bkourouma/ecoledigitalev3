/**
 * Résolution du tarif d'une heure (spec 032 US5, R-PAY-08). Ordre FIGÉ :
 *
 *   1. tarif (nœud de curriculum + enseignant) valide à la DATE DE LA SÉANCE        → NODE_STAFF
 *   2. tarif (nœud, générique) valide à la date de la séance                        → NODE_GENERIC
 *   3. `default_hourly_rate` de la configuration (0 est une valeur)                 → CONFIG_DEFAULT
 *   4. 0 si la configuration est salariale (heures informatives, pas une anomalie)   → SALARY_ZERO
 *   5. sinon : anomalie (`null`) → l'enseignant est écarté `NO_RATE_RESOLVED`.
 *
 * À égalité (deux règles du même rang valides le même jour — impossible en base grâce à l'EXCLUDE, défensif
 * ici) : la plus récemment ouverte, puis l'identifiant le plus petit. La DATE DE LA SÉANCE (et non la période)
 * décide, pour les deux origines (le legacy ignorait la date pour les tarifs par cours).
 */
import type { Money } from "@ecoledigitale/kernel";
import type { ConfigType, IsoDate, RateOrigin, Uuid } from "./types";

export interface HourlyRateRule {
  readonly id: Uuid;
  readonly nodeId: Uuid;
  /** `null` = tarif générique du nœud. */
  readonly staffId: Uuid | null;
  readonly rate: Money;
  readonly validFrom: IsoDate;
  readonly validTo: IsoDate | null;
}

export interface ResolvedRate {
  readonly rate: Money;
  readonly origin: RateOrigin;
}

const coversDate = (r: HourlyRateRule, date: IsoDate): boolean => r.validFrom <= date && (r.validTo === null || r.validTo >= date);

/** Ordre de préférence : ouvert le plus récemment d'abord, puis identifiant croissant. */
const byPreference = (a: HourlyRateRule, b: HourlyRateRule): number => (a.validFrom === b.validFrom ? a.id.localeCompare(b.id) : a.validFrom < b.validFrom ? 1 : -1);

/** Index mémoire des tarifs (préchargés une fois pour tout le calcul, AC2.10). */
export class RateIndex {
  private readonly byNode = new Map<Uuid, HourlyRateRule[]>();

  constructor(rules: readonly HourlyRateRule[]) {
    for (const r of rules) {
      const list = this.byNode.get(r.nodeId);
      if (list) list.push(r);
      else this.byNode.set(r.nodeId, [r]);
    }
    for (const list of this.byNode.values()) list.sort(byPreference);
  }

  /** Tarif de nœud applicable à `date` (nominatif d'abord) ; `null` si aucun. */
  lookup(nodeId: Uuid, staffId: Uuid, date: IsoDate): { rule: HourlyRateRule; origin: "NODE_STAFF" | "NODE_GENERIC" } | null {
    const candidates = this.byNode.get(nodeId);
    if (!candidates) return null;
    const nominative = candidates.find((r) => r.staffId === staffId && coversDate(r, date));
    if (nominative) return { rule: nominative, origin: "NODE_STAFF" };
    const generic = candidates.find((r) => r.staffId === null && coversDate(r, date));
    return generic ? { rule: generic, origin: "NODE_GENERIC" } : null;
  }
}

export interface ResolveRateInput {
  readonly index: RateIndex;
  readonly nodeId: Uuid | null;
  readonly staffId: Uuid;
  readonly date: IsoDate;
  readonly configType: ConfigType;
  readonly configDefaultRate: Money | null;
  /** Zéro de la devise (pour `SALARY_ZERO`). */
  readonly zero: Money;
}

export function resolveRate(input: ResolveRateInput): ResolvedRate | null {
  if (input.nodeId !== null) {
    const hit = input.index.lookup(input.nodeId, input.staffId, input.date);
    if (hit) return { rate: hit.rule.rate, origin: hit.origin };
  }
  if (input.configDefaultRate !== null) return { rate: input.configDefaultRate, origin: "CONFIG_DEFAULT" };
  if (input.configType === "SALARY") return { rate: input.zero, origin: "SALARY_ZERO" };
  return null;
}
