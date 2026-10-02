import { describe, expect, it } from "vitest";
import catalog from "../../../messages/fr-CI.json";
import {
  ACADEMIC_CONFIRMATION_POLICIES,
  ACADEMIC_COURSE_CONFIRMATION_POLICIES,
  ACADEMIC_HOLIDAY_KINDS,
  ACADEMIC_OUTCOME_KINDS,
  ACADEMIC_PACKS,
  ACADEMIC_PERIOD_KINDS,
  ACADEMIC_ROLLOVER_RUN_STATUSES,
  ACADEMIC_ROLLOVER_STEPS,
  ACADEMIC_ROLLOVER_STEP_STATUSES,
} from "@ecoledigitale/contracts/v2/academic";
import { HIGHER_PREREQUISITE_MODES } from "@ecoledigitale/contracts/v2/higher";
import { ANOMALY_CODES, WARNING_CODES } from "./academic/_components/rollover/labels";
import { SETTINGS_TABS } from "./academic/_components/settings/settings-tabs";
import { PEOPLE_TOKENS, REGISTRATION_TOKENS } from "./academic/_components/settings/numbering-utils";

/**
 * Libellés des écrans « reconduction, paramètres académiques, liaisons de règles, prérequis, mon dossier » : les clés
 * statiques sont vérifiées par `messages-coverage.test.ts` (dossiers `academic`, `student`) et
 * `grades-messages-coverage.test.ts` (dossiers `rules`, `higher`) ; ici, les clés CALCULÉES à partir d'énumérations des contrats
 * et l'absence de valeur vide dans nos espaces de noms.
 */

const OWN_NAMESPACES = ["v2Rollover", "v2AcademicSettings", "v2RulesBindings", "v2HigherPrerequisites", "v2StudentSelf"] as const;

function lookup(path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), catalog);
}

describe("messages fr-CI (reconduction, paramètres, liaisons, prérequis, mon dossier)", () => {
  it("les libellés d'énumération calculés existent tous", () => {
    const expectations: Array<[string, ReadonlyArray<string>]> = [
      ["v2Rollover.step", ACADEMIC_ROLLOVER_STEPS],
      ["v2Rollover.stepHint", ACADEMIC_ROLLOVER_STEPS],
      ["v2Rollover.stepStatus", ACADEMIC_ROLLOVER_STEP_STATUSES],
      ["v2Rollover.runStatus", ACADEMIC_ROLLOVER_RUN_STATUSES],
      ["v2Rollover.holidayKind", ACADEMIC_HOLIDAY_KINDS],
      ["v2Rollover.warnings.code", WARNING_CODES],
      ["v2Rollover.anomalies.code", ANOMALY_CODES],
      ["v2Rollover.warnings.title", ["plan", "report"]],
      ["v2Rollover.plan.curriculum.action", ["CLONE", "EXISTS", "NO_SOURCE"]],
      ["v2Rollover.plan.enrollments.kind", ACADEMIC_OUTCOME_KINDS],
      ["v2AcademicSettings.tabs", SETTINGS_TABS],
      ["v2AcademicSettings.pack", ACADEMIC_PACKS],
      ["v2AcademicSettings.periods.kind", ACADEMIC_PERIOD_KINDS],
      ["v2AcademicSettings.funding.outcomeKind", ACADEMIC_OUTCOME_KINDS],
      ["v2AcademicSettings.funding.outcomes.kindHelp", ACADEMIC_OUTCOME_KINDS],
      ["v2AcademicSettings.enrollments.policyLabel", ACADEMIC_CONFIRMATION_POLICIES],
      ["v2AcademicSettings.enrollments.policyHelp", ACADEMIC_CONFIRMATION_POLICIES],
      ["v2AcademicSettings.enrollments.coursePolicyLabel", ACADEMIC_COURSE_CONFIRMATION_POLICIES],
      ["v2AcademicSettings.enrollments.coursePolicyHelp", ACADEMIC_COURSE_CONFIRMATION_POLICIES],
      ["v2AcademicSettings.numbering.token", [...REGISTRATION_TOKENS, ...PEOPLE_TOKENS].map((x) => x.name)],
      ["v2HigherPrerequisites.mode", HIGHER_PREREQUISITE_MODES],
      ["v2HigherPrerequisites.mode", HIGHER_PREREQUISITE_MODES.map((m) => `${m}Help`)],
      ["v2HigherPrerequisites.reason", ["NOT_ACQUIRED", "NOT_ATTENDED", "AVERAGE_TOO_LOW"]],
      ["v2RulesBindings.state", ["active", "upcoming", "expired"]],
      ["v2RulesBindings.dialog.scopeChoice", ["tenant", "program", "level", "tenantHelp", "programHelp", "levelHelp"]],
      ["v2StudentSelf.sex", ["M", "F"]],
    ];
    const missing: string[] = [];
    for (const [ns, values] of expectations) for (const v of values) if (typeof lookup(`${ns}.${v}`) !== "string") missing.push(`${ns}.${v}`);
    expect(missing).toEqual([]);
  });

  it("aucune valeur de nos espaces de noms n'est vide", () => {
    const empty: string[] = [];
    const visit = (value: unknown, trail: string) => {
      if (typeof value === "string") {
        if (value.trim() === "") empty.push(trail);
      } else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, `${trail}.${k}`);
    };
    for (const ns of OWN_NAMESPACES) {
      expect(lookup(ns), ns).toBeTruthy();
      visit(lookup(ns), ns);
    }
    expect(empty).toEqual([]);
  });

  it("les accolades littérales des motifs de numérotation sont protégées (syntaxe ICU)", () => {
    const hints = [lookup("v2AcademicSettings.numbering.registration.patternHint"), lookup("v2AcademicSettings.numbering.people.patternHint")] as string[];
    for (const hint of hints) {
      // Toute accolade doit être entre apostrophes (`'{'` ou `'}'`), sinon next-intl la lit comme un argument.
      expect(hint.replace(/'[{}]'/g, "")).not.toMatch(/[{}]/);
    }
  });
});
