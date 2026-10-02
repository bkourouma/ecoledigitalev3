/**
 * Domaine pur : faits sans flottant ni calcul, trace de la suggestion, effets, participants proposés, snapshot du PV déterministe,
 * modèle de pack sans valeur réglementaire, parité des machines à états avec la base, traduction des erreurs de la base.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNCILS_EVENT_TYPES, COUNCIL_PLACEHOLDER_NOTICE, councilsMinutesSnapshotSchema, findNonExactNumber } from "@ecoledigitale/contracts/src/v2/councils";
import manifest from "../../manifest";
import { requiredJustificationLength, traceSuggestion } from "../../domain/decisions";
import { normalizeDecisionType, validateDecisionTypeShape } from "../../domain/decision-type";
import { effectKindOfProposal, effectKindsOfDecision, initialEffectStatus } from "../../domain/effects";
import { CouncilsCode, translateViolation } from "../../domain/errors";
import { ALL_EVENT_TYPES } from "../../domain/events";
import { InvalidFactsError, buildFacts, isMissingResults, type FactsSources } from "../../domain/facts";
import { COUNCIL_TRANSITIONS, EFFECT_TRANSITIONS, TRANSFER_TRANSITIONS, UNLOCK_TRANSITIONS, canTransition, resultsReady, type Transitions } from "../../domain/machines";
import { buildMinutesSnapshot, InvalidMinutesError, type MinutesInput } from "../../domain/minutes";
import { proposeParticipants } from "../../domain/participants";
import { evaluateQuorum, requiredSigners } from "../../domain/quorum";
import { CouncilsPackTemplateSchema } from "../../domain/template";
import ciSecondary from "../../templates/CI/secondary.json";

const results = { status: "FINAL", average: "12.50", averageDisplay: "12,50", rank: 3, cohortSize: 30, mentionCode: "M1", missingResults: false, ruleVersionRef: "R@1", ruleSourceKind: "placeholder" as const, suggestions: [], appreciations: [] };
const src = (over: Partial<FactsSources> = {}): FactsSources => ({ results, attendance: null, discipline: null, funding: { type: null, stateAssigned: false }, repeating: false, ...over });

describe("instantané de faits : chaînes, entiers, booléens, null — jamais de flottant ni de calcul", () => {
  it("assemble sans rien calculer et signale l'absence de résultat exploitable", () => {
    const f = buildFacts(src());
    expect(f.schema).toBe("council-facts/1");
    expect(f.results).toMatchObject({ average: "12.50", missingResults: false });
    expect(buildFacts(src({ results: { ...results, status: "ERROR", average: null } })).results?.missingResults).toBe(true);
    expect(buildFacts(src({ results: null })).results).toBeNull();
    expect(isMissingResults(null)).toBe(true);
    expect(isMissingResults({ status: "FINAL", average: null })).toBe(true);
    expect(isMissingResults({ status: "FINAL", average: "0.00" })).toBe(false);
  });

  it("refuse un flottant glissé dans une source (rang, comptage, moyenne en nombre)", () => {
    expect(() => buildFacts(src({ results: { ...results, rank: 2.5 } }))).toThrow(InvalidFactsError);
    expect(() => buildFacts(src({ attendance: { available: true, absentMinutes: 12.5, excusedMinutes: 0, absentCount: 1, excusedCount: 0, lateCount: 0 } }))).toThrow(InvalidFactsError);
    expect(findNonExactNumber({ a: [1, 2, { b: 0.1 }] })).toBe("$.a[2].b");
    expect(findNonExactNumber({ a: [1, "2.5", null, true] })).toBeNull();
  });
});

describe("décision : suggestion conservée à côté, justification d'écart", () => {
  const facts = buildFacts(src({ results: { ...results, suggestions: [{ kind: "DECISION", code: "PROMOTED", ref: "R@1" }, { kind: "DECISION", code: "COUNCIL_REVIEW", ref: "R@1" }] } }));
  it("une suggestion ferme est tracée ; s'en écarter (passage / redoublement) exige 20 caractères", () => {
    expect(traceSuggestion({ facts, family: "PASSAGE", finalCode: "PROMOTED" })).toEqual({ suggestedCode: "PROMOTED", suggestionRef: "R@1", differsFromSuggestion: false });
    const differs = traceSuggestion({ facts, family: "REPEAT", finalCode: "REPEAT" });
    expect(differs).toMatchObject({ suggestedCode: "PROMOTED", differsFromSuggestion: true });
    expect(requiredJustificationLength({ family: "REPEAT", differsFromSuggestion: true, facts })).toBe(20);
    // une orientation n'est pas un « écart » du passage suggéré
    expect(traceSuggestion({ facts, family: "ORIENTATION", finalCode: null }).differsFromSuggestion).toBe(false);
    expect(requiredJustificationLength({ family: "ORIENTATION", differsFromSuggestion: false, facts })).toBe(0);
  });
  it("« la règle ne tranche pas » (COUNCIL_REVIEW) n'est jamais une suggestion ferme ; sans résultat, passage et redoublement exigent une justification", () => {
    const review = buildFacts(src({ results: { ...results, suggestions: [{ kind: "DECISION", code: "COUNCIL_REVIEW", ref: null }] } }));
    expect(traceSuggestion({ facts: review, family: "PASSAGE", finalCode: "PROMOTED" })).toEqual({ suggestedCode: null, suggestionRef: null, differsFromSuggestion: false });
    const missing = buildFacts(src({ results: null }));
    expect(requiredJustificationLength({ family: "PASSAGE", differsFromSuggestion: false, facts: missing })).toBe(20);
    expect(requiredJustificationLength({ family: "OTHER", differsFromSuggestion: false, facts: missing })).toBe(0);
  });
});

describe("effets", () => {
  const t = { family: "PASSAGE", resultsDecisionKind: "YEAR_END", resultsFinalCode: "PROMOTED", academicOutcomeCode: "PROMOTED", needsHumanApplication: false, hasTarget: false };
  it("passage : résultats + issue d'inscription + information des tuteurs ; exclusion : demande de statut ; réorientation : dossier + transfert", () => {
    expect(effectKindsOfDecision(t)).toEqual(["RESULTS_DECISION", "ENROLLMENT_OUTCOME", "NOTIFY_GUARDIANS"]);
    expect(effectKindsOfDecision({ ...t, family: "EXCLUSION", resultsDecisionKind: null, resultsFinalCode: null, needsHumanApplication: true })).toEqual(["ENROLLMENT_OUTCOME", "STUDENT_STATUS_REQUEST", "NOTIFY_GUARDIANS"]);
    expect(effectKindsOfDecision({ ...t, family: "REORIENTATION", resultsDecisionKind: null, resultsFinalCode: null, hasTarget: true })).toEqual(["ENROLLMENT_OUTCOME", "ORIENTATION_FILE", "SERIES_TRANSFER", "NOTIFY_GUARDIANS"]);
    expect(effectKindsOfDecision({ ...t, family: "REQUIRED_OPINION", resultsDecisionKind: null, resultsFinalCode: null, academicOutcomeCode: null })).toEqual(["NOTIFY_GUARDIANS"]);
    expect(effectKindOfProposal("APPRECIATION")).toBe("RESULTS_APPRECIATION");
    expect(effectKindOfProposal("DISTINCTION")).toBe("RESULTS_DISTINCTION");
    expect(effectKindOfProposal("REMARK")).toBeNull();
  });
  it("l'exclusion n'est JAMAIS appliquée automatiquement (hors notification) : miroir de `effect_needs_human`", () => {
    expect(initialEffectStatus("STUDENT_STATUS_REQUEST", true)).toBe("AWAITING_HUMAN");
    expect(initialEffectStatus("ENROLLMENT_OUTCOME", true)).toBe("AWAITING_HUMAN");
    expect(initialEffectStatus("NOTIFY_GUARDIANS", true)).toBe("PENDING");
    expect(initialEffectStatus("RESULTS_DECISION", false)).toBe("PENDING");
  });
});

describe("quorum et signataires : miroir de la base, aucune valeur par défaut", () => {
  const p = (roleCode: string, presence: string, fn: string | null = null, counts = true) => ({ roleCode, councilFunction: fn, presence, countsForQuorum: counts });
  it("NULL = aucun contrôle ; seuil et rôles exigés comptent les PRÉSENTS qui comptent pour le quorum", () => {
    const room = [p("PRESIDENT", "PRESENT", "PRESIDENT"), p("TEACHER", "PRESENT"), p("TEACHER", "ABSENT"), p("EDUCATOR", "PRESENT", null, false)];
    expect(evaluateQuorum(room, { minParticipants: null, requiredRoleCodes: [] })).toMatchObject({ met: true, presentCount: 2, presidentPresent: true });
    expect(evaluateQuorum(room, { minParticipants: 3, requiredRoleCodes: [] }).met).toBe(false);
    expect(evaluateQuorum(room, { minParticipants: 2, requiredRoleCodes: ["EDUCATOR", "PARENT_REP"] })).toMatchObject({ met: false, missingRoles: ["PARENT_REP"] });
    expect(evaluateQuorum([p("PRESIDENT", "ABSENT", "PRESIDENT")], { minParticipants: null, requiredRoleCodes: [] }).presidentPresent).toBe(false);
  });
  it("les signataires exigés sont les PRÉSENTS dont la fonction ou le rôle est listé", () => {
    const room = [p("PRESIDENT", "PRESENT", "PRESIDENT"), p("SECRETARY", "PRESENT", "SECRETARY"), p("TEACHER", "PRESENT"), p("TEACHER", "ABSENT", "SECRETARY")];
    expect(requiredSigners(room, { signerFunctions: ["PRESIDENT", "SECRETARY"], signerRoleCodes: [] })).toHaveLength(2);
    expect(requiredSigners(room, { signerFunctions: [], signerRoleCodes: ["TEACHER"] })).toHaveLength(1);
  });
});

describe("participants proposés", () => {
  it("le professeur principal prime, les rôles n'existent que s'ils sont actifs chez l'établissement, aucune fonction n'est proposée", () => {
    const out = proposeParticipants(
      [
        { staffId: "b", displayName: "Zoé", assignmentRole: "LEAD" },
        { staffId: "a", displayName: "Alice", assignmentRole: "LEAD" },
        { staffId: "a", displayName: "Alice", assignmentRole: "HOMEROOM" },
        { staffId: "c", displayName: "Charles", assignmentRole: "SUPERVISOR" },
      ],
      new Set(["HOMEROOM_TEACHER", "TEACHER"]),
    );
    expect(out.map((x) => [x.staffId, x.source, x.roleCode, x.councilFunction])).toEqual([["a", "HOMEROOM", "HOMEROOM_TEACHER", null], ["c", "TEACHING", null, null], ["b", "TEACHING", "TEACHER", null]]);
    expect(proposeParticipants([{ staffId: "a", displayName: "A", assignmentRole: "LEAD" }], new Set())[0]!.roleCode).toBeNull();
  });
});

describe("procès-verbal : snapshot DÉTERMINISTE, sans flottant, avec mention de démonstration", () => {
  const facts = buildFacts(src());
  const input = (order: "asc" | "desc", kind: "placeholder" | "regulation"): MinutesInput => {
    const participants = [
      { id: "00000000-0000-4000-8000-000000000012", displayName: "Zoé", roleCode: "SECRETARY", roleLabel: "Secrétaire", councilFunction: "SECRETARY" as const, presence: "PRESENT" as const },
      { id: "00000000-0000-4000-8000-000000000011", displayName: "Alice", roleCode: "PRESIDENT", roleLabel: "Président", councilFunction: "PRESIDENT" as const, presence: "PRESENT" as const },
      { id: "00000000-0000-4000-8000-000000000013", displayName: "Marc", roleCode: "TEACHER", roleLabel: null, councilFunction: null, presence: "ABSENT" as const },
    ];
    const students = [
      { agendaItemId: "i1", enrollmentId: "00000000-0000-4000-8000-000000000021", studentId: "00000000-0000-4000-8000-000000000031", name: "Élève A", position: 1, factsVersion: 1, factsHash: "h", facts },
      { agendaItemId: "i2", enrollmentId: "00000000-0000-4000-8000-000000000022", studentId: "00000000-0000-4000-8000-000000000032", name: "Élève B", position: 2, factsVersion: 2, factsHash: "h2", facts },
    ];
    return {
      council: {
        id: "00000000-0000-4000-8000-0000000000c1", institutionId: "00000000-0000-4000-8000-000000000001", institutionName: "Établissement", classroomId: "00000000-0000-4000-8000-000000000002", classroomName: "6e A", gradeLevelCode: "6E",
        academicYearId: "00000000-0000-4000-8000-000000000003", academicPeriodId: null, periodLabel: null, typeCode: "T", typeLabel: "Type", scope: "YEAR", heldOn: "2026-11-02", location: null, reopenCount: 0, quorumWaived: false, quorumWaiverReason: "ignoré",
        signerFunctions: ["PRESIDENT", "SECRETARY"], signerRoleCodes: [], ruleVersionRef: "R@1", ruleSourceKind: kind,
      },
      participants: order === "asc" ? participants : [...participants].reverse(),
      students: order === "asc" ? students : [...students].reverse(),
      decisions: [{ agendaItemId: "i1", decisionTypeCode: "PASSAGE", decisionTypeLabel: "Passage", family: "PASSAGE", suggestedCode: "PROMOTED", differsFromSuggestion: false, justification: null, mode: "CONSENSUS", votesFor: null, votesAgainst: null, votesAbstain: null, targetLabel: null, deciderName: "Alice" }],
      proposals: [{ agendaItemId: "i1", kind: "APPRECIATION", code: null, body: "Bien.", status: "ACCEPTED", createdAt: "2026-11-02T10:00:00.000Z" }],
    };
  };
  it("même entrée = même texte octet pour octet, quel que soit l'ordre de lecture ; signataires = présents exigés", () => {
    const a = JSON.stringify(buildMinutesSnapshot(input("asc", "placeholder")));
    const b = JSON.stringify(buildMinutesSnapshot(input("desc", "placeholder")));
    expect(a).toBe(b);
    const snap = buildMinutesSnapshot(input("asc", "placeholder"));
    expect(snap.signers.map((s) => s.name)).toEqual(["Alice", "Zoé"]);
    expect(snap.council.quorumWaiverReason).toBeNull(); // un motif de dérogation n'est imprimé que si le quorum a été levé
    expect(snap.students[0]).toMatchObject({ name: "Élève A", appreciation: "Bien.", decisions: [{ decisionTypeCode: "PASSAGE", suggestedCode: "PROMOTED" }] });
    expect(findNonExactNumber(snap)).toBeNull();
    expect(councilsMinutesSnapshotSchema.safeParse(snap).success).toBe(true);
  });
  it("la mention « règles de démonstration » n'est imprimée que sous un jeu `placeholder`", () => {
    expect(buildMinutesSnapshot(input("asc", "placeholder")).placeholderNotice).toBe(COUNCIL_PLACEHOLDER_NOTICE);
    expect(buildMinutesSnapshot(input("asc", "regulation")).placeholderNotice).toBeNull();
  });
  it("refuse un flottant dans le contenu", () => {
    const bad = input("asc", "placeholder");
    expect(() => buildMinutesSnapshot({ ...bad, decisions: bad.decisions.map((d) => ({ ...d, votesFor: 1.5 })) })).toThrow(InvalidMinutesError);
  });
});

describe("modèle de pack : aucune valeur réglementaire par défaut (spec 006 AC13.3)", () => {
  const template = CouncilsPackTemplateSchema.parse(ciSecondary);
  it("quorum NULL, aucun rôle exigé, aucun parcours d'orientation", () => {
    expect(template.councilTypes.length).toBeGreaterThan(0);
    for (const t of template.councilTypes) {
      expect(t.minParticipants).toBeNull();
      expect(t.requiredRoleCodes).toEqual([]);
    }
    expect(template.orientationPaths).toEqual([]);
  });
  it("types de décision cohérents (miroir des contraintes de table) ; seuls des codes d'intégration dans les contrats de règles", () => {
    for (const d of template.decisionTypes) {
      const shape = normalizeDecisionType({ ...d, requiresTarget: d.requiresTarget, needsHumanApplication: d.needsHumanApplication });
      expect(validateDecisionTypeShape(shape), d.code).toEqual([]);
    }
    expect(template.decisionTypes.filter((d) => d.resultsFinalCode !== null).map((d) => d.resultsFinalCode).sort()).toEqual(["PROMOTED", "REPEAT"]);
    expect(template.decisionTypes.find((d) => d.family === "EXCLUSION")).toMatchObject({ needsHumanApplication: true });
  });
  it("refuse un modèle qui livrerait un quorum, un rôle exigé ou un parcours", () => {
    const base = JSON.parse(JSON.stringify(ciSecondary));
    expect(CouncilsPackTemplateSchema.safeParse({ ...base, councilTypes: [{ ...base.councilTypes[0], minParticipants: 5 }] }).success).toBe(false);
    expect(CouncilsPackTemplateSchema.safeParse({ ...base, councilTypes: [{ ...base.councilTypes[0], requiredRoleCodes: ["PRESIDENT"] }] }).success).toBe(false);
    expect(CouncilsPackTemplateSchema.safeParse({ ...base, orientationPaths: [{}] }).success).toBe(false);
  });
});

describe("parité avec la base : machines à états et catalogue", () => {
  const sql = readFileSync(resolve(__dirname, "../../migrations/2104_councils_guards.sql"), "utf8");
  /** Tuples `('A', 'B')` d'un bloc `(OLD.status, NEW.status) IN (…)` repéré par son préfixe. */
  function tuplesAfter(marker: string): Array<[string, string]> {
    const i = sql.indexOf(marker);
    expect(i, marker).toBeGreaterThan(-1);
    const block = sql.slice(i, sql.indexOf("THEN", i));
    return [...block.matchAll(/\('([A-Z_]+)',\s*'([A-Z_]+)'\)/g)].map((m) => [m[1] as string, m[2] as string]);
  }
  const same = (ts: Transitions<string>, db: Array<[string, string]>): void => {
    expect([...ts].map(([a, b]) => `${a}>${b}`).sort()).toEqual(db.map(([a, b]) => `${a}>${b}`).sort());
  };
  it("séance, effets, demandes de déverrouillage, transferts : mêmes transitions en TypeScript et en SQL", () => {
    same(COUNCIL_TRANSITIONS, tuplesAfter("IF NOT ((OLD.status, NEW.status) IN (\n        ('PLANNED', 'OPEN')"));
    same(EFFECT_TRANSITIONS, tuplesAfter("('PENDING', 'APPLIED'), ('PENDING', 'FAILED')"));
    same(UNLOCK_TRANSITIONS, tuplesAfter("IF NOT ((OLD.status, NEW.status) IN (('REQUESTED', 'APPROVED')"));
    same(TRANSFER_TRANSITIONS, tuplesAfter("NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (\n        ('PLANNED', 'APPLIED')"));
  });
  it("transitions : exemples métier", () => {
    expect(canTransition(COUNCIL_TRANSITIONS, "SIGNED", "OPEN")).toBe(true);
    expect(canTransition(COUNCIL_TRANSITIONS, "CANCELLED", "OPEN")).toBe(false);
    expect(canTransition(EFFECT_TRANSITIONS, "AWAITING_HUMAN", "FAILED")).toBe(false);
    expect(resultsReady("DELIBERATED", "GRADING_LOCKED")).toBe(true);
    expect(resultsReady("OPEN", "GRADING_LOCKED")).toBe(false);
    expect(resultsReady("INCONNU", "OPEN")).toBe(false);
  });
  it("le catalogue d'événements du module, le contrat Zod et le manifeste sont identiques ; aucun événement hors `councils.*`", () => {
    expect([...ALL_EVENT_TYPES].sort()).toEqual([...COUNCILS_EVENT_TYPES].sort());
    expect([...manifest.events.publishes].sort()).toEqual([...ALL_EVENT_TYPES].sort());
    for (const e of ALL_EVENT_TYPES) expect(e).toMatch(/^councils\.[a-z_]+\.[a-z_]+$/);
  });
  it("les permissions sensibles de la spec le sont au manifeste (MFA) ; clés dans le préfixe `council.`", () => {
    const sensitive = new Set(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key));
    for (const k of ["council.session.run", "council.decision.record", "council.minutes.sign", "council.minutes.revoke", "council.unlock.approve", "council.exclusion.apply", "council.settings.manage", "council.orientation.override"]) expect(sensitive.has(k), k).toBe(true);
    for (const p of manifest.permissions) expect(p.key.startsWith("council.")).toBe(true);
  });
});

describe("traduction des refus de la base en erreurs applicatives stables (jamais un 500)", () => {
  it("codes `councils.*`, classés par nature", () => {
    expect(translateViolation({ sqlstate: "42501", message: "councils.human_decision_required: cet acte exige un utilisateur" })).toMatchObject({ code: "councils.human_decision_required", httpStatus: 403 });
    expect(translateViolation({ sqlstate: "23514", message: "councils.quorum_not_met: 2 présent(s)" })).toMatchObject({ code: "councils.quorum_not_met", httpStatus: 400 });
    expect(translateViolation({ sqlstate: "23001", message: "councils.locked: la séance (CLOSED) est verrouillée" })).toMatchObject({ code: "councils.locked", httpStatus: 409 });
    expect(translateViolation({ sqlstate: "23514", message: "councils.item_mismatch: x" })).toMatchObject({ httpStatus: 400 });
    expect(translateViolation({ sqlstate: "23505", message: "dup", constraint: "councils_one_live" })).toMatchObject({ code: CouncilsCode.DUPLICATE, httpStatus: 409 });
    expect(translateViolation({ sqlstate: "23503", message: "fk" })).toMatchObject({ code: CouncilsCode.INVALID_REFERENCE });
    expect(translateViolation({ sqlstate: "42501", message: "new row violates row-level security policy" })).toBeNull(); // la RLS n'est pas masquée
    expect(translateViolation({ sqlstate: "XX000", message: "autre" })).toBeNull();
  });
});
