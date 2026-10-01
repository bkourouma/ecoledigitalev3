import type { ClassicSetup } from "../scenarios/types";
import type { DefectCollector } from "./defects";
import { Rat, shortestDecimal, weightedMean } from "./exact";
import type { SeedContext } from "./seeder";

/**
 * ORACLE de la pile classique : règles DOCUMENTÉES (docs/inventory/legacy-dependents-by-slice.md, tranche 2.4 ;
 * apps/web bulletin-format) restituées en arithmétique exacte, sans exécuter le code legacy.
 *
 *   mention d'une moyenne : >=16 Excellent, >=14 Très bien, >=12 Bien, >=10 Assez bien, >=8 Passable, sinon Insuffisant
 *   décision de période   : >=10 validée, >=8 renforcement recommandé, sinon non validée
 *   moyenne annuelle      : (S1 + 2·S2)/3 au deuxième semestre quand S1 et S2 existent, sinon la moyenne du semestre
 *   distinction           : >=17 félicitations, >=15 encouragement, >=12 tableau d'honneur
 *   appréciation du conseil : seuils 8 / 10 / 12 / 14 / 16 / 18
 *   décision de fin d'année : ≥10 admis, sinon redoublement ; BTS 2 au 2e semestre : « Redouble en cas d'échec au BTS »
 */

export interface ClassicDetectionInput {
  ctx: SeedContext;
  setup: ClassicSetup;
  classKey: string;
  periodKey: string;
  /** Préfixe du chemin de l'étape dans la snapshot (ex. `steps.02-rapport`). */
  stepPath: string;
  /** Documents de bulletin par clé d'étudiant (valeurs brutes, avant normalisation). */
  documents: Record<string, any>;
  /** Moyennes saisies relues en base (entrées). */
  inputs: { student: string; course: string; period: string; value: string }[];
}

const T = (n: number) => Rat.of(n);

export const exactRules = {
  mention(avg: Rat | null): string {
    if (avg === null) return "En attente";
    if (avg.gte(T(16))) return "Excellent";
    if (avg.gte(T(14))) return "Très bien";
    if (avg.gte(T(12))) return "Bien";
    if (avg.gte(T(10))) return "Assez bien";
    if (avg.gte(T(8))) return "Passable";
    return "Insuffisant";
  },
  councilDecision(avg: Rat | null): string {
    if (avg === null) return "Notes incompletes";
    if (avg.gte(T(10))) return "Periode validee";
    if (avg.gte(T(8))) return "Renforcement recommande";
    return "Periode non validee";
  },
  appreciation(annual: Rat | null): string {
    if (annual === null) return "";
    if (annual.lt(T(8))) return "Travail insuffisant.";
    if (annual.lt(T(10))) return "Travail fragile.";
    if (annual.lt(T(12))) return "Travail passable.";
    if (annual.lt(T(14))) return "Travail assez bon.";
    if (annual.lt(T(16))) return "Bon travail.";
    if (annual.lt(T(18))) return "Très bon travail.";
    return "Excellent travail.";
  },
  distinction(annual: Rat | null): string {
    if (annual === null) return "";
    if (annual.gte(T(17))) return "Tableau d'honneur + félicitations";
    if (annual.gte(T(15))) return "Tableau d'honneur + Encouragement";
    if (annual.gte(T(12))) return "Tableau d'honneur";
    return "";
  },
  endYear(annual: Rat | null, secondSemester: boolean, finalYearBts: boolean): string {
    if (annual === null) return "Décision en attente";
    if (secondSemester && finalYearBts) return "Redouble en cas d'échec au BTS";
    if (annual.gte(T(10))) return "Admis(e) en année supérieure";
    return "Redoublement";
  },
};

const ratOf = (x: number | string) => Rat.of(typeof x === "number" ? shortestDecimal(x) : x);

export function detectClassicDefects(defects: DefectCollector, input: ClassicDetectionInput): void {
  const { setup, classKey, periodKey, stepPath, documents, inputs } = input;
  const period = setup.periods.find((p) => p.key === periodKey)!;
  const cls = setup.classes.find((c) => c.key === classKey)!;
  const secondSemester = period.role === "second-semester";
  const firstPeriod = setup.periods.find((p) => p.role === "first-semester");
  const coefOf = new Map(setup.courses.map((c) => [c.key, c.coefficient]));

  for (const [student, doc] of Object.entries(documents)) {
    const base = `${stepPath}.documents.${student}`;
    const scope = [
      `${base}.**`,
      `${stepPath}.documents.*.summary.rank`,
      `${stepPath}.documents.*.summary.annualRank`,
      `${stepPath}.documents.*.sections.**`,
    ];
    const lines = (doc.sections as any[]).flatMap((s) => s.lines as any[]);

    // Moyenne exacte de la période (entrées = moyennes saisies, lues dans les lignes du document).
    const s2 = weightedMean(lines.filter((l) => l.average != null).map((l) => ({ value: ratOf(l.average), weight: l.coef })));

    // Sections.
    (doc.sections as any[]).forEach((section, i) => {
      const exact = weightedMean(section.lines.filter((l: any) => l.average != null).map((l: any) => ({ value: ratOf(l.average), weight: l.coef })));
      const expected = exactRules.mention(exact);
      if (section.appreciation !== expected) {
        defects.flag("CLASSIC_FLOAT_WEIGHTED_MEAN", `${base}.sections[${i}].appreciation`, section.appreciation, expected, {
          scope,
          note: `moyenne de section exacte ${exact?.toString()} ; flottant ${section.average}`,
        });
      }
    });

    // Moyenne de période : mention et décision du conseil.
    const mention = exactRules.mention(s2);
    if (doc.summary.mention !== mention) {
      defects.flag("CLASSIC_FLOAT_WEIGHTED_MEAN", `${base}.summary.mention`, doc.summary.mention, mention, {
        scope,
        note: `moyenne exacte ${s2?.toString()} ; flottant ${doc.summary.overallAverage}`,
      });
    }
    const council = exactRules.councilDecision(s2);
    if (doc.summary.decision !== council) {
      defects.flag("CLASSIC_FLOAT_WEIGHTED_MEAN", `${base}.summary.decision`, doc.summary.decision, council, {
        scope,
        note: `moyenne exacte ${s2?.toString()} ; flottant ${doc.summary.overallAverage}`,
      });
    }

    // Moyenne annuelle exacte.
    let s1: Rat | null = null;
    if (secondSemester && firstPeriod) {
      s1 = weightedMean(
        inputs
          .filter((x) => x.student === student && x.period === firstPeriod.key)
          .map((x) => ({ value: Rat.of(x.value), weight: coefOf.get(x.course) ?? 1 })),
      );
    }
    const annual = secondSemester && s1 !== null && s2 !== null ? s1.add(s2.mul(2)).div(3) : s2;

    const legacyAnnual: number | null = doc.summary.annualAverage ?? null;
    const sameNumber = annual === null ? legacyAnnual === null : legacyAnnual !== null && Math.abs(legacyAnnual - annual.toNumber()) < 1e-9;
    if (!sameNumber) {
      defects.flag("CLASSIC_SEMESTER_DETECTED_BY_NAME", `${base}.summary.annualAverage`, legacyAnnual, annual?.toString() ?? null, {
        scope,
        note: `période « ${period.name} » (rôle ${period.role ?? "non précisé"}) : le legacy ne la reconnaît pas comme deuxième semestre`,
      });
    }

    const distinction = exactRules.distinction(annual);
    const appreciation = exactRules.appreciation(annual);
    const endYear = exactRules.endYear(annual, secondSemester, cls.finalYearBts === true);
    const checks: [string, string, string][] = [
      ["distinctionSanctions", doc.summary.distinctionSanctions, distinction],
      ["councilAppreciation", doc.summary.councilAppreciation, appreciation],
      ["endYearDecision", doc.summary.endYearDecision, endYear],
    ];
    for (const [field, legacy, expected] of checks) {
      if (legacy === expected) continue;
      const id = sameNumber ? (field === "endYearDecision" && cls.finalYearBts !== undefined && /bts/i.test(cls.name) ? "CLASSIC_SEMESTER_DETECTED_BY_NAME" : "CLASSIC_FLOAT_WEIGHTED_MEAN") : "CLASSIC_SEMESTER_DETECTED_BY_NAME";
      defects.flag(id, `${base}.summary.${field}`, legacy, expected, {
        scope,
        note: `moyenne annuelle exacte ${annual?.toString() ?? "n/a"} ; legacy ${legacyAnnual}`,
      });
    }

    // Redoublant déduit du texte de la décision.
    if (doc.summary.repeating === true && doc.summary.endYearDecision === "Redouble en cas d'échec au BTS" && annual !== null && annual.gte(T(10))) {
      defects.flag("CLASSIC_REPEATING_FROM_DECISION_TEXT", `${base}.summary.repeating`, true, "à arbitrer (admis selon la moyenne)", {
        scope,
        note: `décision « ${doc.summary.endYearDecision} » ; moyenne annuelle ${annual.toString()}`,
      });
    }
  }
}
