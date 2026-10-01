/**
 * GOLDEN — scénarios du supérieur (BTS, Licence, notes aux limites, conduite) : le pipeline `credit-semester@1`, alimenté par
 * le RuleSet `CI-HIGHER-LMD` seul, reproduit les observations du legacy (ECUE, UE, bulletins, classement, décisions).
 *
 * Les scénarios sont les MÊMES fichiers de données que ceux du legacy (`tests/characterization/scenarios`), lus par
 * `loadScenario` ; les sorties sont comparées aux snapshots par `compareWithTolerance`. Seuls les bogues connus du legacy
 * (catalogue `knownLegacyDefects`, statuts bug/dead) et leurs conséquences DÉCLARÉES peuvent diverger.
 */
import { describe, expect, it } from "vitest";
import type { Scenario } from "../../../../../../../tests/characterization/scenarios/types";
import { LmdScenarioWorld } from "./lmd-pipeline";
import { compareStrict, describeDifferences, loadScenario, loadSnapshot, type ComparisonResult, type Snapshot } from "./helpers";
import { RuleRunner, compiledSeed } from "../support/runner";

const STANDARD = new RuleRunner(compiledSeed("CI-HIGHER-LMD"));
/** RuleSet évalué (remplaçable par une variante de test pour prouver que la comparaison détecte une dérive). */
let rules: RuleRunner = STANDARD;

const STATUT_ECUE: Record<string, string> = { PENDING: "en_cours", ELIMINATORY: "eliminatoire", VALIDATED: "valide", COMPENSATED: "compense", INSUFFICIENT: "insuffisant" };
const ETAT_UE: Record<string, string> = { VALIDATED: "validee", RESIT: "rattrapage", DEBT: "dette" };
const DECISION: Record<string, string> = { ADMITTED: "admis", RESIT: "rattrapage", ADJOURNED: "ajourne" };
const STATUT_ETUDIANT: Record<string, string> = { ADMITTED: "valide", RESIT: "session2", ADJOURNED: "dette" };

const display = (x: number | null): number | null => rules.num("arrondi_affichage", { valeur: x });

type Observation = Record<string, any>;

function observe(world: LmdScenarioWorld): Observation {
  const { setup } = world;
  const ecueResults: Record<string, Record<string, unknown>> = {};
  const ueResults: Record<string, Record<string, unknown>> = {};
  const bulletins: Record<string, Record<string, unknown>> = {};
  const fullBulletins: Record<string, Record<string, unknown>> = {};

  for (const group of setup.groups) {
    const programme = setup.programmes.find((p) => p.key === group.programme)!;

    // Résultats d'ECUE et d'UE (hors conduite).
    for (const ue of programme.ues.filter((u) => !u.conduct)) {
      const cohort: Record<string, unknown> = {};
      for (const student of group.students) {
        for (const ecueKey of ue.ecues) {
          const c = world.ecue(group.key, student, ecueKey);
          if (!c) continue;
          cohort[`${student}/${ecueKey}`] = {
            moyenne: display(c.note),
            moyenne_devoirs: display(c.moyenneDevoirs),
            note_examen: display(c.noteExamen),
            eliminee: rules.bool("ecue_eliminee", { note: c.note, validation_manuelle: c.manual }),
            validee: rules.bool("ecue_validee", { note: c.note, validation_manuelle: c.manual }),
            validee_manuellement: c.manual,
          };
        }
      }
      ecueResults[`${group.key}:${ue.code}`] = cohort;
    }
    for (const student of group.students) {
      const perUe: Record<string, unknown> = {};
      for (const ue of programme.ues.filter((u) => !u.conduct)) {
        const r = world.ueOf(group.key, student, ue);
        // Un résultat d'UE n'existe que si au moins une de ses ECUE a un résultat.
        if (r && ue.ecues.some((e) => world.hasResult(group.key, student, e))) perUe[ue.code] = { statut: r.validee ? "validee" : r.motifs.includes("INCOMPLET") ? "en_cours" : "echec" };
      }
      ueResults[student] = perUe;
    }

    // Bulletins par semestre.
    for (const semester of programme.semesters) {
      const computed = new Map(group.students.map((s) => [s, world.semester(group.key, s, semester.key)] as const));
      const cohorte = [...computed.values()].map((c) => c.moyenneSession);
      bulletins[semester.key] ??= {};
      fullBulletins[semester.key] ??= {};
      for (const student of group.students) {
        const sem = computed.get(student)!;
        if (world.bulletinUnavailable(sem)) {
          bulletins[semester.key]![student] = { ok: false, error: "SESSION2_PENDING" };
          continue;
        }
        bulletins[semester.key]![student] = {
          ok: true,
          data: {
            moyenne_session: display(sem.moyenneSession),
            credits_valides: sem.creditsValides,
            credits_total: sem.creditsTotal,
            semestre_valide: sem.semestreValide,
            decision: DECISION[sem.decision],
            statut_etudiant: STATUT_ETUDIANT[sem.decision],
            nb_ue_total: sem.ues.length,
            nb_ue_validees: sem.ues.filter((u) => u.validee).length,
            ues: sem.ues.map((u) => ({
              code: u.ue.code,
              credits: u.credits,
              moyenne_ue: display(u.moyenne),
              validee: u.validee,
              etat: ETAT_UE[u.etat],
              session_validation: u.sessionValidation,
              motifs: u.motifs,
              ecues: u.ecues.map((e) => ({
                credits: e.credits,
                note_ecue: display(e.note),
                validee: e.validee,
                validee_manuellement: e.manual,
                statut: STATUT_ECUE[e.statut as string],
                session_obtention: e.sessionObtention,
                // Conduite : note unique saisie directement (ni devoirs, ni pondération).
                moyenne_devoirs: e.computation ? display(e.computation.moyenneDevoirs) : null,
                note_examen: e.computation ? display(e.computation.noteExamen) : display(e.note),
              })),
            })),
          },
        };
        fullBulletins[semester.key]![student] = {
          decision: DECISION[sem.decision],
          effectif: group.students.length,
          moyenne_session: display(sem.moyenneSession),
          rang: rules.num("rang", { moyenne: sem.moyenneSession, cohorte }),
          statut_etudiant: STATUT_ETUDIANT[sem.decision],
        };
      }
    }
  }
  return { ecueResults, ueResults, bulletins, fullBulletins };
}

/** Les résultats d'UE du legacy sont des tableaux ordonnés ; on les indexe par code d'UE pour ne comparer que les décisions. */
function ueResultsByCode(snapshot: Snapshot): Snapshot {
  const clone = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
  const data = clone.data as { observations: Record<string, Observation> };
  for (const obs of Object.values(data.observations)) {
    if (!obs.ueResults) continue;
    for (const [student, list] of Object.entries(obs.ueResults as Record<string, Array<{ ue_code: string; statut: string }>>)) {
      obs.ueResults[student] = Object.fromEntries(list.map((u) => [u.ue_code, { statut: u.statut }]));
    }
  }
  return clone;
}

/** Les bulletins du legacy listent les UE dans leur ordre ; on les indexe par code pour comparer UE par UE. */
function bulletinUesByCode(snapshot: Snapshot): Snapshot {
  const data = snapshot.data as { observations: Record<string, Observation> };
  for (const obs of Object.values(data.observations)) {
    for (const sem of Object.values((obs.bulletins ?? {}) as Record<string, Record<string, any>>)) {
      for (const b of Object.values(sem)) {
        if (b.ok && Array.isArray(b.data?.ues)) {
          for (const ue of b.data.ues as any[]) ue.ecues = (ue.ecues as any[]).map((e) => ({ credits: e.credits, note_ecue: e.note_ecue, validee: e.validee, validee_manuellement: e.validee_manuellement, statut: e.statut, session_obtention: e.session_obtention, moyenne_devoirs: e.moyenne_devoirs, note_examen: e.note_examen }));
          b.data.ues = (b.data.ues as any[]).map((ue) => ({ code: ue.code, credits: ue.credits, moyenne_ue: ue.moyenne_ue, validee: ue.validee, etat: ue.etat, session_validation: ue.session_validation, motifs: ue.motifs, ecues: ue.ecues }));
        }
      }
    }
  }
  return snapshot;
}

const ONLY = [
  "observations.*.ecueResults.*.*.moyenne",
  "observations.*.ecueResults.*.*.moyenne_devoirs",
  "observations.*.ecueResults.*.*.note_examen",
  "observations.*.ecueResults.*.*.eliminee",
  "observations.*.ecueResults.*.*.validee",
  "observations.*.ecueResults.*.*.validee_manuellement",
  "observations.*.ueResults.*.*.statut",
  "observations.*.bulletins.*.*.ok",
  "observations.*.bulletins.*.*.error",
  "observations.*.bulletins.*.*.data.moyenne_session",
  "observations.*.bulletins.*.*.data.credits_valides",
  "observations.*.bulletins.*.*.data.credits_total",
  "observations.*.bulletins.*.*.data.semestre_valide",
  "observations.*.bulletins.*.*.data.decision",
  "observations.*.bulletins.*.*.data.statut_etudiant",
  "observations.*.bulletins.*.*.data.nb_ue_total",
  "observations.*.bulletins.*.*.data.nb_ue_validees",
  "observations.*.bulletins.*.*.data.ues.*.code",
  "observations.*.bulletins.*.*.data.ues.*.credits",
  "observations.*.bulletins.*.*.data.ues.*.moyenne_ue",
  "observations.*.bulletins.*.*.data.ues.*.validee",
  "observations.*.bulletins.*.*.data.ues.*.etat",
  "observations.*.bulletins.*.*.data.ues.*.session_validation",
  "observations.*.bulletins.*.*.data.ues.*.motifs.*",
  "observations.*.bulletins.*.*.data.ues.*.ecues.*.credits",
  "observations.*.bulletins.*.*.data.ues.*.ecues.*.note_ecue",
  "observations.*.bulletins.*.*.data.ues.*.ecues.*.validee",
  "observations.*.bulletins.*.*.data.ues.*.ecues.*.validee_manuellement",
  "observations.*.bulletins.*.*.data.ues.*.ecues.*.statut",
  "observations.*.bulletins.*.*.data.ues.*.ecues.*.session_obtention",
  "observations.*.bulletins.*.*.data.ues.*.ecues.*.moyenne_devoirs",
  "observations.*.bulletins.*.*.data.ues.*.ecues.*.note_examen",
  "observations.*.fullBulletins.*.*.decision",
  "observations.*.fullBulletins.*.*.effectif",
  "observations.*.fullBulletins.*.*.moyenne_session",
  "observations.*.fullBulletins.*.*.rang",
  "observations.*.fullBulletins.*.*.statut_etudiant",
];

export function runHigherScenario(name: string, runner: RuleRunner = STANDARD): { actual: { observations: Record<string, Observation> }; scenario: Scenario } {
  rules = runner;
  const scenario = loadScenario(name);
  const higher = scenario.higher!;
  const world = new LmdScenarioWorld(rules, higher.higher);
  const observations: Record<string, Observation> = {};
  for (const step of higher.steps) {
    if (step.do === "observe") observations[step.label] = observe(world);
    else world.apply(step);
  }
  if (!observations.final) observations.final = observe(world);
  return { actual: { observations }, scenario };
}

function compareScenario(name: string, runner: RuleRunner = STANDARD): { result: ComparisonResult; snapshot: Snapshot; actual: { observations: Record<string, Observation> } } {
  const { actual } = runHigherScenario(name, runner);
  const snapshot = bulletinUesByCode(ueResultsByCode(loadSnapshot(name)));
  // Seules les observations rejouées sont comparées (le legacy observe aussi le reste de l'application).
  const result = compareStrict(actual, snapshot, { only: ONLY });
  return { result, snapshot, actual };
}

const SCENARIOS = ["notes-limites", "bts-premiere-annee", "licence-rattrapage", "conduite-absences"] as const;

describe.each(SCENARIOS)("GOLDEN %s : CI-HIGHER-LMD reproduit le legacy, sauf bogues connus", (name) => {
  const { result, snapshot, actual } = compareScenario(name);

  it("aucun écart inexpliqué", () => {
    expect(result.differences, describeDifferences(result, 40)).toEqual([]);
  });

  it("ne reproduit aucun bogue connu du legacy", () => {
    expect(result.stillDefective.map((d) => `${d.id} ${d.path}`)).toEqual([]);
  });

  it("rejoue les mêmes étudiants que le legacy ; tout bulletin en plus est l'effet d'un bogue connu corrigé", () => {
    const obs = (snapshot.data as { observations: Record<string, Observation> }).observations;
    for (const [label, o] of Object.entries(actual.observations)) {
      const expected = obs[label];
      if (!expected) continue;
      for (const [sem, students] of Object.entries(expected.bulletins as Record<string, Record<string, { ok: boolean }>>)) {
        expect(Object.keys(o.bulletins[sem] ?? {}).sort(), `${label}/${sem}`).toEqual(Object.keys(students).sort());
        const legacyFull = Object.keys(expected.fullBulletins[sem] ?? {});
        const v2Full = Object.keys(o.fullBulletins[sem] ?? {});
        const explained = (student: string): boolean => result.acceptedDivergences.some((d) => d.path.startsWith(`observations.${label}.bulletins.${sem}.${student}.`));
        // Une différence de disponibilité du bulletin doit être EXPLIQUÉE par un bogue connu du legacy (arrondi des entrées, flottants…).
        for (const missing of legacyFull.filter((s) => !v2Full.includes(s))) {
          expect(explained(missing), `${label}/${sem}/${missing} : bulletin du legacy indisponible en v2, sans bogue connu pour l'expliquer`).toBe(true);
        }
        for (const extra of v2Full.filter((s) => !legacyFull.includes(s))) {
          expect(explained(extra), `${label}/${sem}/${extra} : bulletin disponible en v2 mais pas en legacy, sans bogue connu pour l'expliquer`).toBe(true);
        }
      }
    }
  });
});

describe("GOLDEN supérieur : synthèse des écarts acceptés (bogues connus corrigés)", () => {
  it("les 24 couples à 10 et les 8 couples à 5 du scénario notes-limites sont corrigés", () => {
    const { result } = compareScenario("notes-limites");
    const corrected = (id: string) => result.corrected.filter((d) => d.id === id).length;
    const accepted = (id: string) => result.acceptedDivergences.filter((d) => d.defect === id).length;
    // Le legacy invalide à tort les couples exactement à 10 (FLOAT_ECUE_VALIDATION_10) : la v2 les valide ; chaque occurrence est une divergence acceptée.
    expect(corrected("FLOAT_ECUE_VALIDATION_10") + accepted("FLOAT_ECUE_VALIDATION_10")).toBeGreaterThan(0);
    expect(result.stillDefective).toEqual([]);
  });
});

describe("GOLDEN supérieur : la comparaison est SENSIBLE (une règle modifiée est détectée)", () => {
  it("un seuil de validation relevé à 11 fait diverger les résultats du legacy", () => {
    const variant = new RuleRunner(
      compiledSeed("CI-HIGHER-LMD", (rs) =>
        rs.map((r) => (r.key === "ecue_validee" || r.key === "ue_validee" || r.key === "statut_ecue" ? { ...r, parameters: { ...r.parameters, seuil_validation: { ...r.parameters.seuil_validation!, default: 11 } } } : r)),
      ),
    );
    const { result } = compareScenario("bts-premiere-annee", variant);
    expect(result.differences.length).toBeGreaterThan(5);
    rules = STANDARD;
  });

  it("le mode de session 2 BEST change le rattrapage du legacy (omar : 12 -> 4 remplacé en REPLACE)", () => {
    const best = new RuleRunner(
      compiledSeed("CI-HIGHER-LMD", (rs) =>
        rs.map((r) => (r.key === "note_examen_retenue" || r.key === "session_examen_retenue" ? { ...r, parameters: { ...r.parameters, mode_session2: { ...r.parameters.mode_session2!, default: "BEST" } } } : r)),
      ),
    );
    const { result } = compareScenario("licence-rattrapage", best);
    expect(result.differences.some((d) => d.path.includes(".omar."))).toBe(true);
    rules = STANDARD;
    // Décision métier : REPLACE par défaut reproduit le legacy (SESSION2_REPLACES_EVEN_IF_LOWER n'est pas un défaut à corriger).
    expect(compareScenario("licence-rattrapage").result.differences).toEqual([]);
  });
});
