import type { Scenario } from "../scenarios/types";
import type { DefectCollector } from "./defects";
import { Rat, ZERO } from "./exact";
import type { SeedContext } from "./seeder";

/**
 * ORACLE de la paie : cohérence arithmétique EXACTE d'un bulletin à partir de ses propres lignes enregistrées.
 *
 * Règle documentée : une ligne de détail vaut heures × tarif (les deux figés à l'enregistrement) et le total d'un bulletin
 * horaire = somme de ses lignes. Le legacy calcule sur des flottants puis enregistre le total et chaque ligne en
 * numeric(10,2) séparément, avec un tarif de ligne en numeric(8,2) : les arrondis divergent d'un centime ou plus.
 */
export interface PayrollDetectionInput {
  scenario: Scenario;
  ctx: SeedContext;
  /** Observation finale des bulletins, indexée par `période/enseignant`. */
  payments: Record<string, any>;
  stepsPath: string;
}

export function detectPayrollDefects(defects: DefectCollector, input: PayrollDetectionInput): void {
  for (const [key, p] of Object.entries(input.payments)) {
    if (p.payment_type !== "hourly") continue;
    const lines = (p.hourDetails ?? []) as { hours_count: string; hourly_rate: string; amount: string }[];
    if (lines.length === 0) continue;
    const base = `${input.stepsPath}.${key}`;
    const scope = [`${base}.**`, "steps.**"];

    let stored = ZERO;
    lines.forEach((l, i) => {
      const expected = Rat.of(l.hours_count).mul(Rat.of(l.hourly_rate)).toFixedHalfUp(2);
      stored = stored.add(Rat.of(l.amount));
      if (Rat.of(expected).cmp(Rat.of(l.amount)) !== 0) {
        defects.flag("PAYSLIP_LINES_ROUNDING", `${base}.hourDetails[${i}].amount`, l.amount, expected, {
          note: `ligne enregistrée : ${l.hours_count} h × ${l.hourly_rate} = ${expected}, montant enregistré ${l.amount}`,
          scope,
        });
      }
    });

    const total = Rat.of(p.base_amount).add(Rat.of(p.overtime_amount));
    if (total.cmp(stored) !== 0) {
      defects.flag("PAYSLIP_LINES_ROUNDING", `${base}.total_amount`, p.total_amount, stored.toFixedHalfUp(2), {
        note: `somme des lignes enregistrées ${stored.toFixedHalfUp(2)} ; base + heures supplémentaires ${total.toFixedHalfUp(2)}`,
        scope,
      });
    }
  }
}
