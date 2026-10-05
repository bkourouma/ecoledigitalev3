/**
 * Tests unitaires (sans base de données) du domaine d'admissions : manifeste, identité normalisée, numérotation, validation du
 * workflow modèle et de ses défauts, ordre de la liste d'attente, jetons et empreintes, suivi public, contrats Zod stricts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveModuleOrder } from "@ecoledigitale/kernel";
import {
  admissionsCreateApplicationBodySchema,
  admissionsDecisionBodySchema,
  admissionsEventPayloadSchemas,
  admissionsPublicFormDtoSchema,
  admissionsPublicSubmitBodySchema,
  admissionsReplaceStagesBodySchema,
  ADMISSION_STATUSES,
} from "@ecoledigitale/contracts/src/v2/admissions";
import manifest from "../../manifest";
import { ALL_ADMISSIONS_EVENT_TYPES, AdmissionsEvents } from "../../domain/events";
import { DEFAULT_DECISION_REASONS, DEFAULT_STAGES, DEFAULT_TRANSITIONS } from "../../domain/default-workflow";
import { daysSince1900, identityKey, isPlausibleBirthDate, normalizeName } from "../../domain/identity";
import { formatApplicationNumber, isValidNumberPattern } from "../../domain/number";
import { canonicalTrackingCode, ipFingerprint, newOpaqueToken, newPublicSlug, newTrackingCode, tokenHash, trackingCodeHash, truncateIp, userAgentFingerprint } from "../../domain/tokens";
import { publicPhaseOf, PUBLIC_PHASE_LABELS } from "../../domain/tracking";
import { NO_PRIORITY_RANK, orderWaitlist } from "../../domain/waitlist";
import { decisionKindFor, validateWorkflow, type StageFacts, type TransitionFacts } from "../../domain/workflow";

const factsOf = (): { stages: StageFacts[]; transitions: TransitionFacts[] } => ({
  stages: DEFAULT_STAGES.map((s) => ({ code: s.code, canonicalStatus: s.canonicalStatus, isInitial: s.isInitial ?? false, isTerminal: s.isTerminal ?? false, holdsSeat: s.holdsSeat ?? false, requiresDecision: s.requiresDecision ?? false, createsEnrollment: s.createsEnrollment ?? false, closureKind: s.closureKind ?? null })),
  transitions: DEFAULT_TRANSITIONS.map((t) => ({ fromStage: t.fromStage, toStage: t.toStage })),
});

describe("manifeste", () => {
  it("est valide, ses permissions sont uniques et bien formées, ses menus visent ses propres permissions", () => {
    expect(manifest.key).toBe("admissions");
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
    const keys = manifest.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^admission(\.[a-z_]+)+$/);
    for (const menu of manifest.menus) expect(keys).toContain(menu.permission);
    const features = manifest.features.map((f) => f.key);
    for (const menu of manifest.menus) if (menu.feature) expect(features).toContain(menu.feature);
  });

  it("déclare les permissions sensibles du spec (dépassement de capacité, publication du workflow, anonymisation)", () => {
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    expect(sensitive).toEqual(["admission.anonymize", "admission.capacity.override", "admission.workflow.publish"]);
  });

  it("les événements publiés sont ceux des contrats, au format <module>.<entité>.<verbe-passé>", () => {
    expect([...manifest.events.publishes].sort()).toEqual([...ALL_ADMISSIONS_EVENT_TYPES].sort());
    expect(Object.keys(admissionsEventPayloadSchemas).sort()).toEqual([...ALL_ADMISSIONS_EVENT_TYPES].sort());
    for (const e of Object.values(AdmissionsEvents)) expect(e).toMatch(/^admissions\.[a-z_]+\.[a-z_]+$/);
    expect(manifest.events.consumes).toEqual(expect.arrayContaining(["academic.enrollment.confirmed", "tenancy.institution.created"]));
  });
});

describe("identité normalisée (miroir de admissions.normalize_name)", () => {
  it("ignore casse, accents courants, ponctuation et espaces multiples", () => {
    expect(normalizeName("  Kouamé-N'Guessan  ")).toBe("kouame n guessan");
    expect(normalizeName("ÉLÉONORE")).toBe("eleonore");
    expect(normalizeName("Œuvre  Æ")).toBe("ouvre a"); // œ -> o, æ -> a (table de translate du SQL)
    expect(normalizeName(null)).toBe("");
  });

  it("la clé d'identité distingue des jumeaux (même naissance, prénoms différents) et rapproche une saisie accentuée", () => {
    const a = identityKey({ lastName: "Koné", firstName: "Awa", birthDate: "2019-04-12" });
    const b = identityKey({ lastName: "KONE", firstName: "awa", birthDate: "2019-04-12" });
    const twin = identityKey({ lastName: "Koné", firstName: "Aïcha", birthDate: "2019-04-12" });
    expect(a).toBe(b);
    expect(twin).not.toBe(a);
    expect(daysSince1900("1900-01-02")).toBe(1);
  });

  it("une naissance plausible est passée et postérieure à 1950 ; aucune règle d'âge d'entrée n'est codée", () => {
    expect(isPlausibleBirthDate("2019-04-12", "2026-10-02")).toBe(true);
    expect(isPlausibleBirthDate("2030-01-01", "2026-10-02")).toBe(false);
    expect(isPlausibleBirthDate("1949-12-31", "2026-10-02")).toBe(false);
  });
});

describe("numérotation", () => {
  it("applique le motif de l'établissement ({YEAR}, {SEQ:n}) et exige un compteur", () => {
    expect(formatApplicationNumber("{YEAR}-{SEQ:5}", { year: 2026, seq: 42 })).toBe("2026-00042");
    expect(formatApplicationNumber("ADM/{SEQ}", { year: 2026, seq: 7 })).toBe("ADM/7");
    expect(isValidNumberPattern("{YEAR}-{SEQ:5}")).toBe(true);
    expect(isValidNumberPattern("{YEAR}")).toBe(false);
    expect(isValidNumberPattern("A B {SEQ}")).toBe(false);
  });
});

describe("workflow modèle livré en donnée", () => {
  it("passe la validation de publication sans aucun défaut", () => {
    const { stages, transitions } = factsOf();
    expect(validateWorkflow(stages, transitions)).toEqual([]);
  });

  it("couvre les huit statuts canoniques ; ENROLLED est unique, terminal et atteint seulement depuis l'étape qui crée l'inscription", () => {
    const covered = new Set(DEFAULT_STAGES.map((s) => s.canonicalStatus));
    for (const status of ADMISSION_STATUSES) expect(covered.has(status), status).toBe(true);
    expect(DEFAULT_STAGES.filter((s) => s.canonicalStatus === "ENROLLED")).toHaveLength(1);
    const creators = DEFAULT_STAGES.filter((s) => s.createsEnrollment).map((s) => s.code);
    expect(creators).toEqual(["AWAITING_PAYMENT"]);
    const toEnrolled = DEFAULT_TRANSITIONS.filter((t) => t.toStage === "ENROLLED").map((t) => t.fromStage);
    expect(toEnrolled).toEqual(creators);
  });

  it("chaque transition cite une permission du manifeste (aucun rôle en dur)", () => {
    const keys = new Set(manifest.permissions.map((p) => p.key));
    for (const t of DEFAULT_TRANSITIONS) expect(keys.has(t.permissionKey), t.permissionKey).toBe(true);
  });

  it("les motifs par défaut sont codés, de type connu et à libellé neutre", () => {
    for (const r of DEFAULT_DECISION_REASONS) {
      expect(r.code).toMatch(/^[A-Z][A-Z0-9_]{1,39}$/);
      expect(["ACCEPT", "REJECT", "WAITLIST", "WITHDRAW"]).toContain(r.kind);
      expect(r.label.length).toBeGreaterThan(5);
    }
  });

  it("liste TOUS les défauts d'un workflow mal formé (sans étape initiale, impasse, inatteignable, entrée ENROLLED illégale…)", () => {
    const { stages, transitions } = factsOf();
    const broken = validateWorkflow(
      stages.filter((s) => s.code !== "DRAFT").concat({ code: "ORPHAN", canonicalStatus: "UNDER_REVIEW", isInitial: false, isTerminal: false, holdsSeat: false, requiresDecision: false, createsEnrollment: false, closureKind: null }),
      [...transitions.filter((t) => t.fromStage !== "DRAFT"), { fromStage: "UNDER_REVIEW", toStage: "ENROLLED" }],
    );
    const codes = broken.map((d) => d.code);
    expect(codes).toContain("admissions.workflow_initial");
    expect(codes).toContain("admissions.workflow_dead_end");
    expect(codes).toContain("admissions.workflow_enrolled_entry");
  });

  it("refuse deux étapes qui créent l'inscription, l'absence de décision formelle et une sortie d'étape terminale", () => {
    const { stages, transitions } = factsOf();
    const twoCreators = stages.map((s) => (s.code === "ACCEPTED" ? { ...s, createsEnrollment: true } : s));
    expect(validateWorkflow(twoCreators, transitions).map((d) => d.code)).toContain("admissions.workflow_creates_enrollment");
    const noDecision = stages.map((s) => (s.canonicalStatus === "REJECTED" ? { ...s, requiresDecision: false } : s));
    expect(validateWorkflow(noDecision, transitions).map((d) => d.code)).toContain("admissions.workflow_decision_missing");
    const exit = validateWorkflow(stages, [...transitions, { fromStage: "REJECTED", toStage: "UNDER_REVIEW" }]);
    expect(exit.map((d) => d.code)).toContain("admissions.workflow_terminal_exit");
  });

  it("le type de décision attendu dérive du statut canonique et du motif de clôture", () => {
    expect(decisionKindFor({ canonicalStatus: "ACCEPTED", closureKind: null })).toBe("ACCEPT");
    expect(decisionKindFor({ canonicalStatus: "WAITLISTED", closureKind: null })).toBe("WAITLIST");
    expect(decisionKindFor({ canonicalStatus: "REJECTED", closureKind: "REJECTED_BY_SCHOOL" })).toBe("REJECT");
    expect(decisionKindFor({ canonicalStatus: "REJECTED", closureKind: "WITHDRAWN_BY_FAMILY" })).toBe("WITHDRAW");
    expect(decisionKindFor({ canonicalStatus: "ENROLLED", closureKind: null })).toBeNull();
  });
});

describe("liste d'attente : ordre = rang décidé par la direction (Q-A03), jamais l'ancienneté ni la priorité", () => {
  it("le rang manuel prime sur la classe de priorité et l'ancienneté ; les dossiers à classer passent après, par date d'entrée", () => {
    const rows = [
      { applicationId: "c", priorityRank: null, enteredAt: "2026-01-01T00:00:00Z", manualRank: 3 },
      { applicationId: "b", priorityRank: 2, enteredAt: "2026-01-03T00:00:00Z", manualRank: 1 },
      { applicationId: "a", priorityRank: 1, enteredAt: "2026-02-01T00:00:00Z", manualRank: 2 },
      { applicationId: "e", priorityRank: 1, enteredAt: "2026-03-01T00:00:00Z", manualRank: null },
      { applicationId: "d", priorityRank: 2, enteredAt: "2026-01-02T00:00:00Z" },
    ];
    expect(orderWaitlist(rows).map((r) => r.applicationId)).toEqual(["b", "a", "c", "d", "e"]);
    expect(orderWaitlist(rows).map((r) => r.queuePosition)).toEqual([1, 2, 3, 4, 5]);
    expect(NO_PRIORITY_RANK).toBeGreaterThan(1_000_000);
  });

  it("sans aucun rang décidé, l'ordre n'est qu'un affichage par date d'entrée (jamais une promotion implicite)", () => {
    const out = orderWaitlist([
      { applicationId: "z", priorityRank: 1, enteredAt: "2026-02-01T00:00:00Z" },
      { applicationId: "y", priorityRank: null, enteredAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(out.map((r) => r.applicationId)).toEqual(["y", "z"]);
    expect(out.map((r) => r.queuePosition)).toEqual([1, 2]);
  });

  it("à date identique, l'identifiant départage (ordre total, stable)", () => {
    const t = "2026-01-01T00:00:00Z";
    const out = orderWaitlist([
      { applicationId: "z", priorityRank: 1, enteredAt: t, manualRank: null },
      { applicationId: "m", priorityRank: 1, enteredAt: t, manualRank: null },
    ]);
    expect(out.map((r) => r.applicationId)).toEqual(["m", "z"]);
  });
});

describe("jetons et empreintes", () => {
  it("le slug public respecte le format de la base (16 à 40 caractères a-z0-9) et ne se répète pas", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const slug = newPublicSlug();
      expect(slug).toMatch(/^[a-z0-9]{16,40}$/);
      seen.add(slug);
    }
    expect(seen.size).toBe(200);
  });

  it("le code de suivi est lisible (sans caractères ambigus), insensible à la casse et aux séparateurs", () => {
    const code = newTrackingCode();
    expect(code).toMatch(/^[A-HJKMN-Z2-9]{4}(-[A-HJKMN-Z2-9]{4}){3}$/);
    expect(trackingCodeHash(code)).toBe(trackingCodeHash(code.toLowerCase().replace(/-/g, " ")));
    expect(trackingCodeHash(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalTrackingCode(code)).toHaveLength(16);
  });

  it("l'empreinte d'un jeton dépend de sa finalité (un jeton de formulaire n'ouvre pas une offre)", () => {
    const token = newOpaqueToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash(token, "form")).not.toBe(tokenHash(token, "offer"));
  });

  it("l'IP n'est jamais conservée en clair, ni même exacte : /24 avant HMAC", () => {
    const secret = "secret-de-test-0123456789abcdef";
    const a = ipFingerprint(secret, "203.0.113.7");
    const b = ipFingerprint(secret, "203.0.113.200");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
    expect(ipFingerprint("autre-secret-0123456789abcdef", "203.0.113.7")).not.toBe(a);
    expect(userAgentFingerprint(secret, "Mozilla/5.0")).toMatch(/^[0-9a-f]{64}$/);
    expect(truncateIp("203.0.113.7")).toBe("203.0.113.0/24");
    expect(truncateIp("2001:db8:1:2::1")).toBe("2001:db8:1::/48");
  });
});

describe("suivi public : statut grossier et libellés neutres", () => {
  it("chaque statut canonique a une phase publique ; aucune ne révèle l'étape personnalisée", () => {
    for (const status of ADMISSION_STATUSES) {
      const phase = publicPhaseOf({ status, createsEnrollment: false });
      expect(PUBLIC_PHASE_LABELS[phase].length).toBeGreaterThan(5);
    }
    expect(publicPhaseOf({ status: "ACCEPTED", createsEnrollment: true })).toBe("ENROLLMENT_IN_PROGRESS");
    expect(publicPhaseOf({ status: "ACCEPTED", createsEnrollment: false })).toBe("OFFER_PENDING");
    expect(publicPhaseOf({ status: "REJECTED", createsEnrollment: false })).toBe("CLOSED");
  });
});

describe("contrats Zod : schémas stricts", () => {
  const guardian = { relationshipCode: "MOTHER", firstName: "Mariam", lastName: "Koné", phone: "+22507000000" };
  const base = {
    formToken: "t".repeat(43),
    applicantFirstName: "Awa",
    applicantLastName: "Koné",
    applicantBirthDate: "2019-04-12",
    desiredGradeLevelCode: "CP1",
    guardians: [guardian],
    consent: { accepted: true as const, textVersion: "v1", guardianIndex: 0 },
  };

  it("le dépôt public refuse toute clé inconnue, exige le consentement, un tuteur avec un contact et des dates plausibles en forme", () => {
    expect(admissionsPublicSubmitBodySchema.safeParse(base).success).toBe(true);
    expect(admissionsPublicSubmitBodySchema.safeParse({ ...base, role: "admin" }).success).toBe(false);
    expect(admissionsPublicSubmitBodySchema.safeParse({ ...base, consent: { accepted: false, textVersion: "v1", guardianIndex: 0 } }).success).toBe(false);
    expect(admissionsPublicSubmitBodySchema.safeParse({ ...base, guardians: [{ relationshipCode: "MOTHER", firstName: "M", lastName: "K" }] }).success).toBe(false);
    expect(admissionsPublicSubmitBodySchema.safeParse({ ...base, applicantBirthDate: "12/04/2019" }).success).toBe(false);
    expect(admissionsPublicSubmitBodySchema.safeParse({ ...base, guardians: [] }).success).toBe(false);
    // champ leurre accepté par le schéma (c'est le cas d'usage qui le traite)
    expect(admissionsPublicSubmitBodySchema.safeParse({ ...base, website: "http://spam" }).success).toBe(true);
  });

  it("le formulaire public (réponse) n'expose que la liste blanche : toute clé de capacité ou d'effectif est refusée", () => {
    const ok = {
      institutionName: "École",
      grades: [{ code: "CP1", label: "CP1" }],
      documents: [],
      relationships: [],
      consent: { kind: "DATA_PROCESSING", version: "v1", language: "fr", body: "texte" },
      antiSpam: { minimumFormSeconds: 5, captchaRequired: false, honeypotField: "website" },
      formToken: "x",
    };
    expect(admissionsPublicFormDtoSchema.safeParse(ok).success).toBe(true);
    for (const leak of ["seats", "seatsLeft", "waitlistCount", "capacities", "institutionId", "campaignId", "applications"]) {
      expect(admissionsPublicFormDtoSchema.safeParse({ ...ok, [leak]: 1 }).success, leak).toBe(false);
    }
  });

  it("une candidature d'élève affecté par l'État exige sa référence d'affectation ; un seul tuteur principal", () => {
    const app = { campaignId: "0192f0a4-7b1e-7c3a-8d2e-000000000001", applicantFirstName: "A", applicantLastName: "B", applicantBirthDate: "2019-04-12", desiredGradeLevelCode: "CP1", guardians: [{ ...guardian, isPrimary: true }] };
    expect(admissionsCreateApplicationBodySchema.safeParse({ ...app, fundingTypeRequested: "STATE_ASSIGNED" }).success).toBe(false);
    expect(admissionsCreateApplicationBodySchema.safeParse({ ...app, fundingTypeRequested: "STATE_ASSIGNED", assignmentReference: "AFF-2026-001" }).success).toBe(true);
    expect(admissionsCreateApplicationBodySchema.safeParse({ ...app, guardians: [{ ...guardian, isPrimary: true }, { ...guardian, isPrimary: true }] }).success).toBe(false);
  });

  it("une décision de refus ou de retrait cite un motif codé ; un dépassement de capacité exige un motif d'au moins 10 caractères", () => {
    const id = "0192f0a4-7b1e-7c3a-8d2e-000000000002";
    expect(admissionsDecisionBodySchema.safeParse({ toStageId: id, kind: "REJECT" }).success).toBe(false);
    expect(admissionsDecisionBodySchema.safeParse({ toStageId: id, kind: "REJECT", reasonCode: "NO_SEAT" }).success).toBe(true);
    expect(admissionsDecisionBodySchema.safeParse({ toStageId: id, kind: "ACCEPT", overrideCapacity: true, reasonText: "court" }).success).toBe(false);
    expect(admissionsDecisionBodySchema.safeParse({ toStageId: id, kind: "ACCEPT", overrideCapacity: true, reasonText: "Fratrie d'un élève du personnel" }).success).toBe(true);
  });

  it("l'éditeur ne peut pas saisir un statut canonique inconnu ni un code d'étape mal formé", () => {
    const stage = { code: "REVIEW", label: "Étude", canonicalStatus: "UNDER_REVIEW", ordinal: 1 };
    expect(admissionsReplaceStagesBodySchema.safeParse({ stages: [stage] }).success).toBe(true);
    expect(admissionsReplaceStagesBodySchema.safeParse({ stages: [{ ...stage, canonicalStatus: "PENDING" }] }).success).toBe(false);
    expect(admissionsReplaceStagesBodySchema.safeParse({ stages: [{ ...stage, code: "étape 1" }] }).success).toBe(false);
  });
});

describe("hygiène du code (lint R2 et règles du module)", () => {
  const root = resolve(__dirname, "../..");
  const files: string[] = [];
  (function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === "test" || name === "migrations" || name === "node_modules") continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) files.push(full);
    }
  })(root);

  it("aucun Math.random, aucun new Date() sans argument (horloge injectée), aucun console.log", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/Math\.random\(/.test(src)) offenders.push(`${f} : Math.random`);
      if (/new Date\(\)/.test(src)) offenders.push(`${f} : new Date()`);
      if (/console\.(log|info|warn)\(/.test(src)) offenders.push(`${f} : console`);
    }
    expect(offenders).toEqual([]);
  });

  it("aucune constante de capacité, de priorité, de délai ou d'âge n'est codée dans le module (données d'établissement)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes("default-workflow")) continue; // modèle livré EN DONNÉE (étapes et motifs), pas une règle
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(seats|capacity|waitlistLimit|offerValidityDays|paymentDeadlineDays|retentionMonths|minimumAge|maxAge)\s*[:=]\s*\d+/g)) offenders.push(`${f} : ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("le SQL n'apparaît que dans infrastructure/ (et le garde de publication public)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes(`${join("admissions", "infrastructure")}`)) continue;
      const src = readFileSync(f, "utf8");
      // les cas d'usage purs (sauf jobs et anonymisation qui planifient des sélections) n'écrivent pas de SQL
      if (/\b(INSERT INTO|UPDATE admissions\.|DELETE FROM)\b/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
