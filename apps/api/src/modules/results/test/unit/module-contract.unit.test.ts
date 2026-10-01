import { describe, expect, it } from "vitest";
import { PERMISSION_KEY_RE } from "@ecoledigitale/kernel";
import { resultsEventPayloadSchemas, resultsOverrideCreateBodySchema, resultsCloseBodySchema, resultsLockBodySchema, resultsReopenBodySchema, resultsDecisionConfirmBodySchema } from "@ecoledigitale/contracts/src/v2/results";
import manifest from "../../manifest";
import subscribers from "../../subscribers";
import jobs from "../../jobs";
import { PERMISSIONS } from "../../http/guards";
import { ConsumedEvents, ALL_RESULTS_EVENT_TYPES } from "../../domain/events";
import { closureHashOf, canonicalJson, hashOf } from "../../domain/hash";
import { findOverridable, outcomeOf, DECISION_RULES } from "../../domain/catalog";
import { isLegalStateTransition, planClose, planDeliberate, planLock, planReopen, sessionsKeptLocked } from "../../domain/period-state";
import { buildPermissionCatalog, rbacManifest, resolveSystemRoles } from "../../../rbac";
import { assessManifest } from "../../../assess";
import { rulesManifest } from "../../../rules";
import { resultsTenantTables } from "../../../isolation-allowlist.results";
import { round2 } from "../parity/decimal";

describe("manifeste du module results", () => {
  it("clé, dépendances (assess, rules) et ordre de chargement sans cycle", () => {
    expect(manifest).toMatchObject({ key: "results", dependsOn: ["assess", "rules"] });
    expect(manifest.packs).toEqual(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);
    // aucun cycle : ni assess ni rules ne dépendent de results (assess ne connaît pas results, A-21)
    expect(assessManifest.dependsOn).not.toContain("results");
    expect(rulesManifest.dependsOn).not.toContain("results");
    expect(manifest.dependsOn).toEqual(expect.arrayContaining([assessManifest.key, rulesManifest.key]));
  });

  it("permissions : format `ressource.action`, uniques, TOUTES utilisées par la couche HTTP ; les actes qui modifient un résultat ou figent une période sont sensibles", () => {
    const keys = manifest.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(PERMISSION_KEY_RE);
    expect([...Object.values(PERMISSIONS)].sort()).toEqual([...keys].sort());
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    expect(sensitive).toEqual(["decision.approve", "period.close", "period.lock", "period.reopen", "period.repin", "result.override.approve", "result.settings.manage"]);
  });

  it("événements publiés = schémas du contrat ; événements consommés = ceux des abonnés", () => {
    expect([...manifest.events.publishes].sort()).toEqual(Object.keys(resultsEventPayloadSchemas).sort());
    expect([...ALL_RESULTS_EVENT_TYPES].sort()).toEqual(Object.keys(resultsEventPayloadSchemas).sort());
    // les événements que results publie lui-même (surcharges) déclenchent un recalcul mais ne sont pas « consommés d'un autre module »
    const external = Object.values(ConsumedEvents).filter((t) => !t.startsWith("results."));
    expect([...manifest.events.consumes].sort()).toEqual([...external].sort());
    const patterns = subscribers.map((s) => String(s.pattern));
    for (const type of external) expect(patterns.some((p) => p === type || p.includes(type.split(".")[0] as string)), type).toBe(true);
  });

  it("jobs : recalculs échus toutes les 10 secondes (cron à secondes) et purge quotidienne", () => {
    expect(jobs.map((j) => j.name).sort()).toEqual(["results.process-recomputes", "results.purge"]);
    expect(jobs.find((j) => j.name === "results.process-recomputes")?.cron).toBe("*/10 * * * * *");
  });

  it("menus : permission déclarée ; les menus famille exigent la fonctionnalité de visibilité", () => {
    const features = new Set(manifest.features.map((f) => f.key));
    for (const m of manifest.menus) {
      expect(manifest.permissions.some((p) => p.key === m.permission), m.key).toBe(true);
      if (m.feature) expect(features.has(m.feature), m.key).toBe(true);
    }
    expect(manifest.menus.filter((m) => m.portal !== "admin").every((m) => m.feature === "results.public-visibility")).toBe(true);
  });

  it("10 tables de tenant déclarées pour le test d'isolation", () => {
    expect(resultsTenantTables).toHaveLength(10);
    for (const t of resultsTenantTables) expect(t.startsWith("results.")).toBe(true);
  });
});

describe("alignement avec les rôles système du module rbac", () => {
  const catalog = buildPermissionCatalog([assessManifest, manifest]);
  const roles = new Map(resolveSystemRoles(catalog).map((r) => [r.template.key, new Set(r.permissions)]));
  const can = (role: string, perm: string): boolean => roles.get(role)?.has(perm) === true;

  it("la direction a tous les droits du module", () => {
    for (const k of manifest.permissions.map((p) => p.key)) {
      if (k === "result.self.read" || k === "result.child.read") continue;
      expect(can("directeur", k), k).toBe(true);
    }
  });
  it("un enseignant ne verrouille, ne clôture, ne rouvre ni n'approuve aucune surcharge", () => {
    for (const k of ["period.lock", "period.close", "period.reopen", "period.repin", "result.override.approve", "decision.approve", "result.settings.manage"]) expect(can("enseignant", k), k).toBe(false);
  });
  it("élève : ses propres résultats seulement ; parent : ceux de ses enfants seulement", () => {
    expect(can("eleve", "result.self.read")).toBe(true);
    expect(can("eleve", "result.child.read")).toBe(false);
    expect(can("parent", "result.child.read")).toBe(true);
    expect(can("parent", "result.self.read")).toBe(false);
    expect(can("parent", "result.read")).toBe(false);
    expect(can("parent", "result.explain")).toBe(false);
  });
});

describe("contrats Zod", () => {
  const id = "0190c6a0-0000-7000-8000-000000000001";
  it("une surcharge exige un motif de 20 caractères au moins, un type cohérent (valeur décimale ou drapeau)", () => {
    const base = { stateId: id, enrollmentId: id, level: "ECUE", curriculumNodeId: id, ruleKey: "ecue_validee", kind: "VALIDATION", flag: true, justification: "Le jury valide l'ECUE après examen du dossier." };
    expect(resultsOverrideCreateBodySchema.safeParse(base).success).toBe(true);
    expect(resultsOverrideCreateBodySchema.safeParse({ ...base, justification: "court" }).success).toBe(false);
    expect(resultsOverrideCreateBodySchema.safeParse({ ...base, kind: "VALUE", flag: undefined }).success).toBe(false);
    expect(resultsOverrideCreateBodySchema.safeParse({ ...base, kind: "VALUE", flag: undefined, value: "14.5" }).success).toBe(true);
    expect(resultsOverrideCreateBodySchema.safeParse({ ...base, kind: "VALUE", flag: undefined, value: "-3" }).success).toBe(false);
    expect(resultsOverrideCreateBodySchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
  it("verrouillage ou clôture forcés : motif obligatoire ; réouverture : motif d'au moins 10 caractères", () => {
    expect(resultsLockBodySchema.safeParse({ force: true }).success).toBe(false);
    expect(resultsLockBodySchema.safeParse({ force: true, reason: "Évaluation abandonnée par l'enseignant." }).success).toBe(true);
    expect(resultsLockBodySchema.safeParse({}).success).toBe(true);
    expect(resultsCloseBodySchema.safeParse({ force: true }).success).toBe(false);
    expect(resultsReopenBodySchema.safeParse({ reason: "court" }).success).toBe(false);
    expect(resultsReopenBodySchema.parse({ reason: "Erreur de saisie constatée en conseil." }).kind).toBe("CORRECTION");
  });
  it("confirmer telle que proposée n'exige rien ; changer le code exige une justification de 20 caractères (R-RES-05)", () => {
    expect(resultsDecisionConfirmBodySchema.safeParse({}).success).toBe(true);
    expect(resultsDecisionConfirmBodySchema.safeParse({ finalCode: "RESIT", justification: "court" }).success).toBe(false);
    expect(resultsDecisionConfirmBodySchema.safeParse({ finalCode: "ADMITTED", justification: "Le jury admet l'étudiant après délibération." }).success).toBe(true);
    expect(resultsDecisionConfirmBodySchema.safeParse({ finalCode: "admis" }).success).toBe(false);
    expect(resultsDecisionConfirmBodySchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe("domaine pur", () => {
  it("empreintes : JSON canonique à clés triées, indépendant de l'ordre ; le hash de clôture ignore l'ordre des élèves", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }));
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(closureHashOf(["h2", "h1", "h3"])).toBe(closureHashOf(["h3", "h1", "h2"]));
    expect(closureHashOf(["h1", "h2"])).not.toBe(closureHashOf(["h1", "h2", "h3"]));
    expect(closureHashOf(["h1"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("l'issue d'une décision se lit dans le CODE (jamais un libellé) ; un code inconnu est « autre »", () => {
    expect(outcomeOf("ADMITTED")).toBe("ADMITTED");
    expect(outcomeOf("RESIT")).toBe("RESIT");
    expect(outcomeOf("INCOMPLETE")).toBe("PENDING");
    expect(outcomeOf("EXAM_REFERRAL")).toBe("EXAM_REFERRAL");
    expect(outcomeOf("Admis")).toBe("OTHER");
    expect(outcomeOf("code-inconnu")).toBe("OTHER");
  });

  it("surcharges permises : liste fermée par contrat, niveau et nature ; jamais le rang ni une décision", () => {
    expect(findOverridable("credit-semester@1", "ecue_validee", "ECUE", "VALIDATION")).toBeDefined();
    expect(findOverridable("credit-semester@1", "moyenne_ue", "UE", "VALUE")).toBeDefined();
    expect(findOverridable("credit-semester@1", "moyenne_ue", "UE", "VALIDATION")).toBeUndefined();
    expect(findOverridable("credit-semester@1", "rang", "PERIOD", "VALUE")).toBeUndefined();
    expect(findOverridable("credit-semester@1", "decision_semestre", "PERIOD", "VALIDATION")).toBeUndefined();
    expect(findOverridable("coef-semester@1", "moyenne_matiere", "SUBJECT", "VALUE")).toBeDefined();
    expect(findOverridable("inconnu@1", "note_ecue", "ECUE", "VALUE")).toBeUndefined();
    expect(DECISION_RULES["credit-semester@1"]?.map((d) => d.kind)).toEqual(["SEMESTER_STATUS"]);
  });

  it("machine à états de la période : OPEN → GRADING_LOCKED → DELIBERATED → CLOSED → OPEN", () => {
    expect(planLock("OPEN")).toMatchObject({ ok: true, value: { alreadyLocked: false } });
    expect(planLock("GRADING_LOCKED")).toMatchObject({ ok: true, value: { alreadyLocked: true } });
    expect(planLock("CLOSED")).toMatchObject({ ok: false, error: { code: "results.invalid_state_transition" } });
    expect(planDeliberate("GRADING_LOCKED", { heldDeliberation: false })).toMatchObject({ ok: false, error: { code: "results.deliberation_required" } });
    expect(planDeliberate("GRADING_LOCKED", { heldDeliberation: true }).ok).toBe(true);
    expect(planDeliberate("OPEN", { heldDeliberation: true }).ok).toBe(false);
    expect(planClose("DELIBERATED", { requireDeliberation: true })).toMatchObject({ ok: true, value: { withoutDeliberation: false } });
    expect(planClose("GRADING_LOCKED", { requireDeliberation: false })).toMatchObject({ ok: true, value: { withoutDeliberation: true } });
    expect(planClose("GRADING_LOCKED", { requireDeliberation: true }).ok).toBe(false);
    expect(planClose("OPEN", { requireDeliberation: false }).ok).toBe(false);
    expect(planReopen("CLOSED", { kind: "CORRECTION", reason: "Erreur de saisie constatée." }).ok).toBe(true);
    expect(planReopen("CLOSED", { kind: "CORRECTION", reason: "court" })).toMatchObject({ ok: false, error: { code: "results.reopen_requires_reason" } });
    expect(planReopen("OPEN", { kind: "CORRECTION", reason: "Erreur de saisie constatée." }).ok).toBe(false);
    expect(isLegalStateTransition("CLOSED", "OPEN")).toBe(true);
    expect(isLegalStateTransition("CLOSED", "GRADING_LOCKED")).toBe(false);
    expect(isLegalStateTransition("OPEN", "CLOSED")).toBe(false);
  });

  it("la réouverture pour session de rattrapage ne libère QUE la session 2", () => {
    expect(sessionsKeptLocked("RESIT_SESSION")).toEqual([1]);
    expect(sessionsKeptLocked("CORRECTION")).toEqual([]);
  });

  it("arrondi décimal exact de l'adaptateur de parité : demi-supérieur, sans flottant", () => {
    expect(round2("9.995")).toBe(10);
    expect(round2("9.994999")).toBe(9.99);
    expect(round2("12.857142857")).toBe(12.86);
    expect(round2("0.005")).toBe(0.01);
    expect(round2("11.4")).toBe(11.4);
    expect(round2(null)).toBeNull();
  });
});
