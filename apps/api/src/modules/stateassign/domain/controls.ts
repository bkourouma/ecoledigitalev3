/**
 * Contrôles périodiques — règles PURES.
 *
 *  - Machine d'états (miroir de `stateassign.controls_guard`) : PENDING → OK | ANOMALY | WAIVED ; ANOMALY → OK (avec motif).
 *  - Planification : AUCUN contrôle n'est exigé par défaut. L'établissement choisit les natures (`required_control_kinds`)
 *    et le décalage (`control_due_offset_days`) ; sans l'un des deux, rien n'est planifié. L'application PLANIFIE, un humain
 *    RÉALISE : un contrôle n'est jamais réalisé automatiquement.
 *  - Les natures liées à une période (présence, rapprochement financier) sont planifiées une fois par période ÉCHUE ;
 *    les autres une seule fois, à partir de la vérification du dossier.
 */
import type { ControlKind, ControlStatus, IsoDate, SettingsRecord } from "./types";
import { addDays } from "./reconciliation";

export const CONTROL_TRANSITIONS: Readonly<Record<ControlStatus, readonly ControlStatus[]>> = Object.freeze({
  PENDING: ["OK", "ANOMALY", "WAIVED"],
  ANOMALY: ["OK"],
  OK: [],
  WAIVED: [],
});

export const canTransitionControl = (from: ControlStatus, to: ControlStatus): boolean => CONTROL_TRANSITIONS[from].includes(to);

/** Natures de contrôle attachées à une période de l'année. */
export const PERIOD_CONTROL_KINDS: readonly ControlKind[] = Object.freeze(["ATTENDANCE", "FINANCE_RECONCILIATION"]);

export interface PeriodFact {
  readonly id: string;
  readonly endsOn: IsoDate;
}

export interface ExistingControlKey {
  readonly kind: ControlKind;
  readonly academicPeriodId: string | null;
}

export interface PlannedControl {
  readonly kind: ControlKind;
  readonly academicPeriodId: string | null;
  readonly dueOn: IsoDate;
}

/** Contrôles à créer à `today` pour un dossier vérifié le `verifiedOn` : ceux qui manquent, rien d'autre. */
export function planControls(input: {
  readonly settings: Pick<SettingsRecord, "requiredControlKinds" | "controlDueOffsetDays">;
  readonly verifiedOn: IsoDate;
  readonly periods: readonly PeriodFact[];
  readonly existing: readonly ExistingControlKey[];
  readonly today: IsoDate;
}): PlannedControl[] {
  const offset = input.settings.controlDueOffsetDays;
  if (offset === null || input.settings.requiredControlKinds.length === 0) return [];
  const has = new Set(input.existing.map((c) => `${c.kind}|${c.academicPeriodId ?? ""}`));
  const planned: PlannedControl[] = [];
  for (const kind of input.settings.requiredControlKinds) {
    if (PERIOD_CONTROL_KINDS.includes(kind)) {
      for (const p of [...input.periods].sort((a, b) => (a.endsOn < b.endsOn ? -1 : 1))) {
        if (p.endsOn > input.today) continue; // période non échue : rien à contrôler encore
        if (has.has(`${kind}|${p.id}`)) continue;
        planned.push({ kind, academicPeriodId: p.id, dueOn: addDays(p.endsOn, offset) });
      }
    } else if (!has.has(`${kind}|`)) {
      planned.push({ kind, academicPeriodId: null, dueOn: addDays(input.verifiedOn, offset) });
    }
  }
  return planned;
}

export const controlOverdue = (c: { status: ControlStatus; dueOn: IsoDate }, today: IsoDate): boolean => c.status === "PENDING" && c.dueOn < today;
