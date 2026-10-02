/**
 * Rôles système contre le catalogue RÉEL (manifestes de TOUS les modules découverts).
 *
 *  1. Aucun motif « en attente » HORS de la liste blanche `RESERVED_FOR_UPCOMING_MODULES` : tout motif d'un
 *     modèle désigne une vraie permission, ou une permission RÉSERVÉE à un module pas encore livré (liste
 *     versionnée, `templates/reserved-permissions.ts` ; ses propres garde-fous sont dans
 *     `reserved-permissions.test.ts`).
 *  2. Pour CHAQUE rôle et CHAQUE module : ce que le rôle PEUT et NE PEUT PAS faire, énuméré ici
 *     indépendamment des modèles (oracle). Un nouveau module ou une nouvelle permission sans décision
 *     explicite fait échouer le test.
 *  3. Interdits notables, expliqués (séparation des tâches, moindre privilège).
 *  4. Paires de tâches incompatibles : aucun rôle autre que owner/directeur ne détient les deux côtés.
 *  5. Permissions sensibles : justifiées ; `mfaRecommended` cohérent.
 *  6. `*` réservé à owner/directeur ; parent/élève : exactement les permissions `child` / `self`
 *     (trois ET quatre segments : `student.child.read`, `primary.competency.child.read`).
 *
 * Les permissions RÉSERVÉES (modules à venir) sont décrites dans l'oracle (`reserved`) en plus des permissions
 * réelles (`can`) : tant que le module n'est pas chargé elles restent en attente (non accordées) ; dès que son
 * manifeste est chargé elles doivent être accordées au rôle.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { matchesPermissionPattern } from "../domain/permission-catalog";
import {
  CHILD_PERMISSION_PATTERNS,
  RESERVED_FOR_UPCOMING_MODULES,
  RESERVED_MODULES,
  SELF_PERMISSION_PATTERNS,
  getReservedPermission,
  isReservedPermission,
  permissionScopeOf,
} from "../templates/reserved-permissions";
import { SYSTEM_ROLE_KEYS, SYSTEM_ROLE_TEMPLATES, getSystemRoleTemplate } from "../templates/system-roles";
import { loadRealCatalog, resolveAgainst, type RealCatalog } from "./real-catalog";

let real: RealCatalog;
let roles: ReturnType<typeof resolveAgainst>;
beforeAll(async () => {
  real = await loadRealCatalog();
  roles = resolveAgainst(real, SYSTEM_ROLE_TEMPLATES);
});

/** Permissions RÉELLEMENT accordées (résolues contre le catalogue des modules chargés). */
const granted = (role: string): ReadonlySet<string> => roles.get(role)?.permissions ?? new Set();
/** Accordées + en attente (clés exactes d'un module pas encore livré) : tout ce que le modèle DÉCLARE. */
const declared = (role: string): ReadonlySet<string> => new Set([...granted(role), ...(roles.get(role)?.pending ?? [])]);
const matchesAny = (patterns: readonly string[], key: string): boolean => patterns.some((p) => matchesPermissionPattern(p, key));
const isChildKey = (key: string): boolean => matchesAny(CHILD_PERMISSION_PATTERNS, key);
const isSelfKey = (key: string): boolean => matchesAny(SELF_PERMISSION_PATTERNS, key);
const LOADED_UPCOMING_MODULES = (): string[] => RESERVED_MODULES.filter((m) => real.manifests.some((mf) => mf.key === m));

/** Exclusions des deux rôles à motif `*`. */
const OWNER_EXCEPT = ["rules.platform.manage"];
const DIRECTEUR_EXCEPT = ["entitlements.manage", "rbac.role.manage", "payroll.payslip.approve_owner", "payroll.settings.manage", "rules.platform.manage"];

/**
 * ORACLE : permissions exactes de chaque rôle, indépendantes des modèles. `"ALL"` = tout le catalogue
 * moins `except`.
 */
const EXPECTED: Record<string, { all: true; except: string[] } | { all?: false; can: string[]; reserved?: string[] }> = {
  owner: { all: true, except: OWNER_EXCEPT },
  directeur: { all: true, except: DIRECTEUR_EXCEPT },

  directeur_etudes: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.send.any", "messaging.announcement.publish", "messaging.announcement.manage",
      // documents
      "documents.read", "documents.read.restricted", "documents.upload", "documents.share", "documents.archive", "documents.history.read",
      // notifications
      "notifications.read", "notifications.send",
      // academic (structure, curriculum, inscriptions)
      "academic.read", "academic.year.read", "academic.year.manage", "academic.period.read", "academic.period.manage", "academic.period.close",
      "academic.program.read", "academic.program.manage", "academic.classroom.read", "academic.classroom.manage", "academic.settings.manage",
      "curriculum.read", "curriculum.manage", "curriculum.publish",
      "enrollment.read", "enrollment.update", "enrollment.outcome.record", "enrollment.course.manage",
      // assess
      "assessment.type.read", "assessment.read", "assessment.manage",
      "grade.read", "grade.review", "grade.validate", "grade.publish", "grade.revise.approve",
      // results
      "result.read", "result.explain", "result.recompute", "result.override.request", "period.lock", "period.close",
      "decision.record", "decision.approve", "appreciation.write",
      // reportcards
      "reportcard.read", "reportcard.explain", "reportcard.generate", "reportcard.publish", "reportcard.template.manage",
      // higher
      "higher.diploma.read", "higher.diploma.manage", "higher.award.read", "higher.award.create", "higher.document.read", "higher.document.issue",
      "higher.credits.read", "higher.prerequisite.manage", "higher.resit.manage", "higher.settings.manage",
      // scheduling
      "schedule.read", "schedule.manage", "schedule.publish", "schedule.room.manage", "schedule.room.book", "schedule.calendar.manage",
      "schedule.occurrence.validate", "schedule.conflict.override",
      // attendance
      "attendance.read", "attendance.manage", "attendance.validate", "attendance.justification.read", "attendance.justification.decide",
      "attendance.staff.read", "attendance.staff.record", "attendance.leave.decide", "attendance.report.read", "attendance.settings.manage",
      // people
      "student.list", "student.read", "guardian.read", "staff.list", "staff.read", "staff.availability.manage", "teaching.read", "teaching.assign",
      // rules
      "rules.ruleset.read", "rules.version.simulate",
      // schoollife (006) : lecture générale seulement
      "schoollife.read.all",
      // stateassign (006) : lecture seule
      "stateassign.read",
      // primary_school (005) : pilotage pédagogique, jamais le scellé / la révision / le gel / le modèle / les réglages
      "primary.framework.read", "primary.framework.manage", "primary.framework.publish", "primary.competency.read",
      "primary.phrase.read", "primary.phrase.manage", "primary.council.read", "primary.council.manage",
      "primary.bilan.read", "primary.bilan.prepare", "primary.archive.prepare", "primary.report.read", "primary.class.read_all",
      // examinations (018) : consultation seulement
      "exam.type.read", "exam.session.read", "exam.candidate.read", "exam.result.read", "exam.statistics.read",
      // imports (031, O-03) : classes et curriculum
      "imports.read", "imports.create", "imports.import.classrooms", "imports.import.curriculum", "imports.cancel",
    ],
    reserved: [
      // conseils de classe (006) : `council.*` sauf l'approbation d'un déverrouillage et la révocation d'un PV
      "council.read", "council.manage", "council.prepare", "council.session.run", "council.proposal.write", "council.decision.record",
      "council.minutes.generate", "council.minutes.read", "council.minutes.sign", "council.unlock.request", "council.effect.manage",
      "council.exclusion.apply", "council.settings.manage", "council.orientation.read", "council.orientation.manage", "council.orientation.override",
    ],
  },

  secretariat: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.announcement.publish",
      // documents
      "documents.read", "documents.read.restricted", "documents.upload", "documents.share", "documents.history.read",
      // notifications
      "notifications.read", "notifications.send",
      "enrollment.read", "enrollment.create", "enrollment.update", "enrollment.cancel", "enrollment.course.manage",
      "academic.read", "academic.year.read", "academic.period.read", "academic.program.read", "academic.classroom.read", "curriculum.read",
      "student.list", "student.read", "student.create", "student.update", "student.status.update", "student.sensitive.read", "student.export",
      "guardian.read", "guardian.manage",
      "reportcard.read", "reportcard.generate",
      "higher.document.read", "higher.document.issue",
      "attendance.read", "attendance.take", "attendance.justification.submit", "attendance.justification.read", "attendance.report.read",
      "schedule.read",
      "finance.invoice.read", "finance.payment.read", "finance.receipt.read",
      // admissions (007) : traitement d'un dossier, jamais la décision
      "admission.read", "admission.create", "admission.update", "admission.document.upload", "admission.document.review",
      "admission.interview.manage", "admission.offer.manage", "admission.duplicate.resolve", "admission.waitlist.manage",
      "admission.prospect.manage", "admission.enroll", "admission.report.read",
      // affectation d'État (006) : enregistrer et rattacher les pièces, jamais vérifier
      "stateassign.read", "stateassign.record", "stateassign.document.manage",
      // primary_school (005) : états, accès à toutes les classes, lecture des bilans et des grilles
      "primary.report.read", "primary.class.read_all", "primary.bilan.read", "primary.competency.read",
      // imports (031, O-03) : élèves et tuteurs
      "imports.read", "imports.create", "imports.import.students", "imports.import.guardians", "imports.cancel",
    ],
    reserved: [
      // conseils (006) : planifier, procès-verbaux (pas de révocation)
      "council.read", "council.manage", "council.minutes.generate", "council.minutes.read", "council.minutes.sign",
    ],
  },

  econome: {
    can: [
      // messaging
      "messaging.read", "messaging.send",
      // documents
      "documents.read", "documents.read.restricted", "documents.upload",
      // notifications
      "notifications.read",
      "finance.fee.read", "finance.fee.manage", "finance.invoice.read", "finance.invoice.create", "finance.invoice.cancel",
      "finance.payment.read", "finance.payment.create", "finance.payment.refund", "finance.cashregister.open", "finance.cashregister.close",
      "finance.report.read", "finance.receipt.read",
      "enrollment.funding.update", "enrollment.read",
      "payroll.config.read", "payroll.config.manage", "payroll.rate.read", "payroll.rate.manage", "payroll.period.manage", "payroll.run.calculate",
      "payroll.payslip.read", "payroll.payslip.adjust", "payroll.payslip.notify", "payroll.payslip.pay", "payroll.report.read",
      "student.list", "student.read", "guardian.read", "staff.list", "staff.read",
      "academic.read", "academic.year.read", "academic.program.read", "academic.classroom.read",
      // stateassign (006) : rapprochement, échéances, contrôles, export ; ni enregistrement ni vérification
      "stateassign.read", "stateassign.reconcile", "stateassign.receivable.manage", "stateassign.control.perform", "stateassign.export",
      // imports (031, O-03) : préparation seulement (lancement = direction)
      "imports.read", "imports.create",
    ],
  },

  enseignant: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.announcement.publish_class",
      // documents
      "documents.read", "documents.own.read", "documents.own.upload",
      // notifications
      "notifications.own.manage",
      "assessment.type.read", "assessment.read", "assessment.create", "assessment.update", "grade.read", "grade.enter", "grade.revise.request",
      "appreciation.write",
      "attendance.read", "attendance.take", "attendance.own.read", "attendance.own.record", "attendance.leave.request",
      "student.class.read", "staff.own.read", "staff.own.update",
      "schedule.own.read", "schedule.occurrence.declare",
      "payroll.payslip.read_own", "payroll.my.dispute",
      // schoollife (006) : signaler et noter dans SES classes
      "schoollife.read", "schoollife.incident.write", "schoollife.note.write",
    ],
    reserved: ["council.proposal.write"],
  },

  // Spec 005 pack-template §7 : mêmes clés RÉELLES que l'enseignant (sa classe) + reportcard.read ; `primary.*` réservées.
  instituteur: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.announcement.publish_class",
      "assessment.type.read", "assessment.read", "assessment.create", "assessment.update", "grade.read", "grade.enter", "grade.revise.request",
      "appreciation.write", "reportcard.read",
      "attendance.read", "attendance.take", "attendance.own.read", "attendance.own.record", "attendance.leave.request",
      "student.class.read", "staff.own.read", "staff.own.update",
      "schedule.own.read", "schedule.occurrence.declare",
      "payroll.payslip.read_own", "payroll.my.dispute",
      // primary_school (005) : compétences, banque d'appréciations, conseil des maîtres, référentiel et bilan de SA classe en lecture
      "primary.competency.read", "primary.competency.record", "primary.competency.validate",
      "primary.phrase.read", "primary.council.read", "primary.council.prepare",
      "primary.framework.read", "primary.bilan.read",
    ],
  },

  educateur: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.announcement.publish_class",
      // documents
      "documents.read", "documents.own.read", "documents.own.upload",
      // notifications
      "notifications.own.manage",
      "attendance.read", "attendance.take", "attendance.manage", "attendance.validate", "attendance.justification.submit",
      "attendance.justification.read", "attendance.report.read", "attendance.own.read", "attendance.own.record", "attendance.leave.request",
      "schedule.read", "schedule.occurrence.hold",
      "student.list", "student.read", "guardian.read", "staff.own.read", "staff.own.update",
      "enrollment.read", "academic.classroom.read",
      // schoollife (006) : saisie et instruction, PROPOSITION de mesure ; jamais la validation
      "schoollife.read", "schoollife.read.all", "schoollife.incident.write", "schoollife.incident.review", "schoollife.measure.propose",
      "schoollife.note.write", "schoollife.convocation.manage",
    ],
  },

  responsable_pedagogique: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.announcement.publish_class",
      // documents
      "documents.read",
      "academic.read", "academic.year.read", "academic.period.read", "academic.program.read", "academic.classroom.read",
      "curriculum.read", "curriculum.manage", "enrollment.read",
      "assessment.type.read", "assessment.read", "grade.read", "grade.review", "grade.validate",
      "result.read", "result.explain", "reportcard.read", "reportcard.explain",
      "schedule.read", "teaching.read", "attendance.read", "attendance.report.read",
      "student.list", "student.read", "staff.list", "staff.read",
      "rules.ruleset.read",
    ],
  },

  // Spec 018 / README examinations : toutes les `exam.*` NON sensibles ; la publication, l'application d'un lot, l'approbation
  // d'une révision et la dérogation d'éligibilité (sensibles) restent à la direction.
  responsable_examens: {
    can: [
      "documents.read", "messaging.read", "messaging.send", "notifications.read",
      "exam.type.read", "exam.type.manage", "exam.center.manage", "exam.session.read", "exam.session.manage", "exam.candidate.read",
      "exam.candidate.manage", "exam.eligibility.evaluate", "exam.score.enter", "exam.mock.manage", "exam.import.manage",
      "exam.result.read", "exam.result.enter", "exam.statistics.read", "exam.export.manage", "exam.export.run", "exam.document.issue",
      "academic.read", "academic.year.read", "academic.program.read", "academic.classroom.read",
      "enrollment.read", "student.list", "student.read", "assessment.read",
    ],
  },

  // Spec 007 §11 : « admissions_officer (secrétariat) » : traitement d'un dossier, jamais la décision ni les actes sensibles.
  admissions_officer: {
    can: [
      "messaging.read", "messaging.send",
      "admission.read", "admission.create", "admission.update", "admission.document.upload", "admission.document.review",
      "admission.interview.manage", "admission.offer.manage", "admission.duplicate.resolve", "admission.waitlist.manage",
      "admission.prospect.manage", "admission.enroll", "admission.report.read",
    ],
  },

  personnel: {
    can: [
      "documents.own.read", "documents.own.upload",
      "staff.own.read", "staff.own.update", "attendance.own.read", "attendance.own.record", "attendance.leave.request",
      "payroll.payslip.read_own", "payroll.my.dispute", "schedule.own.read",
      // notifications
      "notifications.own.manage",
    ],
  },

  parent: {
    can: [
      // messaging
      "messaging.child.read", "messaging.child.send",
      // documents
      "documents.child.read", "documents.child.upload",
      // notifications
      "notifications.child.manage",
      "student.child.read", "student.child.update", "enrollment.child.read", "grade.child.read", "result.child.read", "reportcard.child.read",
      "attendance.child.read", "attendance.child.justify", "schedule.child.read", "higher.child.read",
      "finance.child.read", "finance.child.pay",
      // primary_school (005), schoollife et stateassign (006), examinations (018)
      "primary.competency.child.read", "primary.bilan.child.read",
      "schoollife.child.read", "schoollife.child.appeal", "schoollife.child.acknowledge",
      "stateassign.child.read", "exam.document.child.read",
    ],
    reserved: ["council.child.read"],
  },

  eleve: {
    can: [
      // messaging
      "messaging.self.read", "messaging.self.send",
      // documents
      "documents.self.read", "documents.self.upload",
      // notifications
      "notifications.self.manage",
      "student.self.read", "student.self.update", "enrollment.self.read", "enrollment.self.create", "grade.self.read", "result.self.read",
      "reportcard.self.read", "attendance.self.read", "attendance.self.justify", "schedule.self.read", "higher.self.read",
      "finance.self.read", "finance.self.pay",
      // primary_school (005), schoollife (006), examinations (018)
      "primary.competency.self.read", "primary.bilan.self.read", "schoollife.self.read", "schoollife.self.appeal", "exam.document.self.read",
    ],
    reserved: ["council.self.read"],
  },
};

/** Permissions que le rôle doit RÉELLEMENT porter : réelles de l'oracle + réservées dont le module est chargé. */
function expectedOf(role: string): ReadonlySet<string> {
  const e = EXPECTED[role];
  if (!e) throw new Error(`Rôle sans oracle : ${role}`);
  if (e.all) return new Set(real.catalog.keys.filter((k) => !e.except.includes(k)));
  return new Set([...e.can, ...(e.reserved ?? []).filter((k) => real.catalog.byKey.has(k))]);
}

/** Ce que le modèle doit DÉCLARER : réelles + réservées (accordées ou en attente). */
function expectedDeclaredOf(role: string): ReadonlySet<string> {
  const e = EXPECTED[role];
  if (!e) throw new Error(`Rôle sans oracle : ${role}`);
  if (e.all) return expectedOf(role);
  return new Set([...e.can, ...(e.reserved ?? [])]);
}

describe("modèles de rôles système : ensemble des rôles", () => {
  it("quatorze modèles, dont `personnel`, `instituteur` (spec 005), `responsable_examens` (spec 018) et `admissions_officer` (spec 007), clés uniques", () => {
    expect(SYSTEM_ROLE_KEYS).toEqual([
      "owner",
      "directeur",
      "directeur_etudes",
      "secretariat",
      "econome",
      "enseignant",
      "instituteur",
      "educateur",
      "responsable_pedagogique",
      "responsable_examens",
      "admissions_officer",
      "personnel",
      "parent",
      "eleve",
    ]);
    expect(Object.keys(EXPECTED).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
  });

  it("le catalogue réel couvre les modules livrés (chaque module déclarant des permissions est connu de la matrice)", () => {
    const modulesWithPermissions = [...new Set(real.catalog.entries.map((e) => e.moduleKey))].sort();
    // + les modules « à venir » (liste blanche des permissions réservées) dès qu'ils sont chargés : leur matrice
    // rôle × permission est alors vérifiée comme celle des autres (voir `matrice rôle × module`).
    expect(modulesWithPermissions).toEqual(
      [
        "academic", "admissions", "analytics", "assess", "attendance", "audit", "documents", "entitlements", "examinations", "finance", "higher", "iam", "imports", "messaging",
        "notifications", "payroll", "people", "primary_school", "rbac", "reportcards", "results", "rules", "scheduling", "schoollife", "stateassign", "tenancy",
        ...LOADED_UPCOMING_MODULES(),
      ].sort(),
    );
  });
});

describe("aucun motif « en attente » HORS liste blanche contre le catalogue réel", () => {
  for (const template of SYSTEM_ROLE_TEMPLATES) {
    it(`${template.key} : chaque clé/motif d'octroi désigne une permission réelle, ou une permission RÉSERVÉE (module à venir)`, () => {
      const resolved = roles.get(template.key);
      const unexpected = (resolved?.pending ?? []).filter((p) => !isReservedPermission(p));
      expect(
        unexpected,
        `motifs en attente de ${template.key} qui ne figurent pas dans RESERVED_FOR_UPCOMING_MODULES (faute de frappe, permission renommée ? sinon ajoute-les à templates/reserved-permissions.ts avec module et spec)`,
      ).toEqual([]);
    });
  }

  it("les motifs d'exclusion (`except`) désignent aussi de vraies permissions (pas de faute de frappe qui laisserait un droit)", () => {
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      for (const pattern of t.except ?? []) {
        expect(real.catalog.keys.some((k) => matchesPermissionPattern(pattern, k)), `${t.key} except ${pattern}`).toBe(true);
      }
    }
  });

  it("toutes les permissions de l'oracle existent dans le catalogue réel (les `reserved` : dans la liste blanche, ou déjà réelles)", () => {
    const unknown: string[] = [];
    for (const [role, e] of Object.entries(EXPECTED)) {
      const list = e.all ? e.except : e.can;
      for (const k of list) if (!real.catalog.byKey.has(k)) unknown.push(`${role}:${k}`);
      if (!e.all) {
        for (const k of e.reserved ?? []) if (!real.catalog.byKey.has(k) && !isReservedPermission(k)) unknown.push(`${role}:${k} (ni réelle ni réservée)`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("un motif en attente serait bien détecté (le contrôle n'est pas vide)", () => {
    const fake = resolveAgainst(real, [{ key: "faux_role", label: "Faux", description: "d", permissions: ["payroll.own.*", "assessment.*", "grade.enter", "discipline.*"] }]);
    expect(fake.get("faux_role")?.pending).toEqual(["discipline.*", "payroll.own.*"]);
  });

  it("une faute de frappe sur une permission réservée n'est PAS couverte par la liste blanche (le test échouerait)", () => {
    const fake = resolveAgainst(real, [
      { key: "faux_role", label: "Faux", description: "d", permissions: ["primary.competency.read", "primary.competancy.record", "council.proposal.writte"] },
    ]);
    const pending = fake.get("faux_role")?.pending ?? [];
    expect(pending.filter((p) => !isReservedPermission(p))).toEqual(["council.proposal.writte", "primary.competancy.record"]);
  });

  for (const role of SYSTEM_ROLE_KEYS) {
    if (role === "owner" || role === "directeur") continue;
    it(`${role} : le modèle DÉCLARE exactement l'oracle (réelles + réservées), accordées ou en attente`, () => {
      const got = [...declared(role)].sort();
      const want = [...expectedDeclaredOf(role)].sort();
      expect(got.filter((k) => !want.includes(k)), `${role} : clés déclarées en trop`).toEqual([]);
      expect(want.filter((k) => !got.includes(k)), `${role} : clés de l'oracle non déclarées`).toEqual([]);
    });
  }
});

describe("matrice rôle × module : ce que chaque rôle PEUT et NE PEUT PAS faire", () => {
  const modules = (): string[] => [...new Set(real.catalog.entries.map((e) => e.moduleKey))].sort();

  for (const role of SYSTEM_ROLE_KEYS) {
    describe(role, () => {
      it("l'ensemble de permissions résolu est EXACTEMENT celui de l'oracle (ni plus, ni moins)", () => {
        const got = [...granted(role)].sort();
        const want = [...expectedOf(role)].sort();
        expect(got.filter((k) => !want.includes(k)), `${role} : permissions en trop`).toEqual([]);
        expect(want.filter((k) => !got.includes(k)), `${role} : permissions manquantes`).toEqual([]);
      });

      it("module par module : peut / ne peut pas", () => {
        for (const moduleKey of modules()) {
          const inModule = real.catalog.entries.filter((e) => e.moduleKey === moduleKey).map((e) => e.key);
          const can = inModule.filter((k) => expectedOf(role).has(k));
          const cannot = inModule.filter((k) => !expectedOf(role).has(k));
          for (const k of can) expect(granted(role).has(k), `${role} PEUT ${k} (${moduleKey})`).toBe(true);
          for (const k of cannot) expect(granted(role).has(k), `${role} NE PEUT PAS ${k} (${moduleKey})`).toBe(false);
        }
      });
    });
  }
});

describe("interdits notables (moindre privilège, séparation des tâches)", () => {
  /** rôle → [permission interdite, raison] */
  const FORBIDDEN: Record<string, ReadonlyArray<readonly [string, string]>> = {
    directeur_etudes: [
      ["grade.enter", "il valide et publie, il ne saisit pas les notes (saisie ≠ validation)"],
      ["grade.revise.request", "la correction est demandée par l'enseignant et approuvée par lui"],
      ["result.override.approve", "il demande les surcharges ; l'approbation est à la direction (quatre yeux)"],
      ["period.reopen", "il clôture ; la réouverture d'un résultat FINAL est à la direction"],
      ["period.repin", "changer la version de règle d'une période est un acte de direction"],
      ["result.settings.manage", "les réglages (dont la séparation des tâches) sont à la direction"],
      ["reportcard.revoke", "il émet et publie ; la révocation est séparée"],
      ["reportcard.signatory.manage", "identité imprimée = direction"],
      ["higher.award.force", "forcer un octroi non éligible = direction"],
      ["higher.award.revoke", "il octroie ; la révocation est séparée"],
      ["attendance.session.reopen", "il valide ; la réouverture d'un appel est à la direction"],
      ["schedule.accounting.create", "créer des heures sans plage réelle contournerait la validation qu'il effectue"],
      ["schedule.occurrence.hold", "la constatation est faite par l'éducateur, la validation par lui"],
      ["academic.year.close", "clôture d'année = direction"],
      ["student.sensitive.read", "champs sensibles : scolarité et direction"],
      ["staff.contract.read", "les contrats du personnel sont à la direction"],
      ["payroll.payslip.read", "aucune donnée salariale"],
      ["exam.result.publish", "publication des résultats d'examen (sensible, MFA) : direction"],
      ["exam.result.release", "application d'un lot de résultats officiels (immuable) : direction"],
      ["exam.result.revise", "approbation d'une révision de résultat publié : direction"],
      ["exam.eligibility.override", "dérogation d'éligibilité à un examen : direction"],
      ["exam.session.manage", "conduite d'une session d'examen : responsable des examens"],
      ["primary.bilan.seal", "scellé du bilan annuel (sensible) : direction"],
      ["primary.bilan.reissue", "réémission d'un bilan scellé : direction"],
      ["primary.competency.revise", "révision d'une compétence validée (sensible) : direction"],
      ["primary.archive.freeze", "gel de l'archive d'année (irréversible) : direction"],
      ["primary.template.apply", "modèle de pack : direction"],
      ["primary.settings.manage", "réglages du pack Primaire : direction"],
      ["schoollife.measure.validate", "validation d'une sanction : direction"],
      ["schoollife.exclusion.validate", "validation d'une exclusion : direction"],
      ["schoollife.confidential.read", "éléments confidentiels de vie scolaire : direction (MFA)"],
      ["stateassign.verify", "vérification d'un dossier d'affectation : direction"],
      ["stateassign.settings.manage", "réglages des affectations : direction"],
      ["admission.decide", "décision d'admission : direction"],
      ["imports.import.grades", "import des notes : direction (saisie ≠ validation)"],
      ["imports.import.opening_balances", "soldes d'ouverture : direction (sensible)"],
    ],
    secretariat: [
      ["reportcard.publish", "le secrétariat émet, il ne publie pas aux familles"],
      ["reportcard.revoke", "pas de révocation de document"],
      ["attendance.justification.decide", "il reçoit les justificatifs, la décision est à la vie scolaire/direction des études"],
      ["finance.payment.create", "finances en lecture seule"],
      ["finance.invoice.create", "finances en lecture seule"],
      ["student.anonymize", "anonymisation = direction"],
      ["higher.award.revoke", "pas de révocation de diplôme"],
      ["higher.slot.manage", "les signataires sont affectés par la direction"],
      ["enrollment.override", "dérogation = direction"],
      ["enrollment.funding.update", "financement = économe/direction"],
      ["staff.contract.read", "personnel : hors périmètre du secrétariat"],
      ["grade.enter", "aucune note"],
      ["payroll.payslip.read", "aucune donnée salariale"],
      ["stateassign.verify", "vérifier un dossier : direction (le secrétariat l'enregistre)"],
      ["stateassign.manage", "activer/suspendre une affectation : direction"],
      ["stateassign.amend", "avenant d'une affectation : direction"],
      ["stateassign.reconcile", "rapprochement avec la facturation : économe"],
      ["admission.decide", "décision d'admission : direction"],
      ["admission.capacity.override", "dépassement de capacité (sensible) : direction"],
      ["admission.workflow.publish", "publication d'un workflow (sensible) : direction"],
      ["admission.anonymize", "anonymisation (sensible) : direction"],
      ["admission.export", "export d'un dossier : direction"],
      ["admission.settings.manage", "réglages d'admission : direction"],
      ["primary.bilan.seal", "scellé d'un bilan : direction"],
      ["primary.competency.record", "aucune saisie pédagogique"],
      ["primary.bilan.prepare", "préparation des bilans : direction des études"],
      ["schoollife.read", "vie scolaire : personnel d'encadrement"],
      ["exam.candidate.manage", "gestion des candidats : responsable des examens"],
      ["imports.import.opening_balances", "soldes d'ouverture : direction (sensible)"],
      ["imports.import.grades", "import des notes : direction"],
      ["imports.import.staff", "import du personnel : direction"],
      ["imports.manage", "imports des autres utilisateurs et plafonds : direction"],
      ["imports.template.manage", "modèles de mapping : direction"],
    ],
    responsable_examens: [
      ["exam.result.publish", "publication des résultats (sensible) : direction ; il saisit, il ne publie pas"],
      ["exam.result.release", "application d'un lot de résultats officiels (sensible) : direction ; il dépose et valide, il n'applique pas"],
      ["exam.result.revise", "approbation d'une révision (sensible) : direction ; il demande la correction, il ne l'approuve pas"],
      ["exam.eligibility.override", "dérogation d'éligibilité (sensible) : direction ; il évalue, il ne déroge pas"],
      ["exam.document.child.read", "portail parent uniquement"],
      ["exam.document.self.read", "portail élève uniquement"],
      ["grade.enter", "aucune note d'évaluation courante"],
      ["grade.publish", "aucune publication de notes"],
      ["student.update", "lecture seule des élèves"],
      ["student.sensitive.read", "pas de champs sensibles"],
      ["finance.invoice.read", "aucune finance"],
      ["payroll.payslip.read", "aucune donnée salariale"],
      ["reportcard.generate", "bulletins : scolarité"],
      ["admission.read", "admissions : secrétariat et direction"],
    ],
    admissions_officer: [
      ["admission.decide", "décision d'admission : direction"],
      ["admission.capacity.override", "dépassement de capacité (sensible) : direction"],
      ["admission.workflow.publish", "publication d'un workflow (sensible) : direction"],
      ["admission.workflow.manage", "workflows : direction"],
      ["admission.campaign.manage", "campagnes et capacités : direction"],
      ["admission.settings.manage", "réglages : direction"],
      ["admission.anonymize", "anonymisation (sensible) : direction"],
      ["admission.export", "export d'un dossier : direction"],
      ["student.read", "le dossier de l'élève naît à l'acceptation de l'offre : aucun accès aux élèves"],
      ["student.list", "idem"],
      ["finance.invoice.read", "aucune finance"],
      ["grade.read", "aucune note"],
      ["exam.session.read", "aucun examen"],
    ],
    econome: [
      ["payroll.payslip.approve", "calcul et versement sont séparés de l'arrêt du bulletin (quatre yeux de la paie)"],
      ["payroll.payslip.approve_owner", "validation propriétaire"],
      ["payroll.payslip.cancel", "l'annulation relâche les heures : direction"],
      ["payroll.settings.manage", "seuil propriétaire et séparation des tâches : propriétaire"],
      ["student.update", "lecture seule des élèves"],
      ["student.sensitive.read", "pas de champs sensibles"],
      ["staff.contract.read", "jamais les contrats du personnel"],
      ["grade.read", "aucune note"],
      ["schedule.occurrence.validate", "la validation des heures payables n'est pas à celui qui paie"],
      ["imports.import.opening_balances", "il PRÉPARE l'import des soldes d'ouverture, la direction le LANCE (sensible, MFA)"],
      ["imports.import.students", "import des élèves : secrétariat"],
      ["imports.manage", "imports des autres utilisateurs : direction"],
      ["stateassign.record", "enregistrer un dossier d'affectation : secrétariat"],
      ["stateassign.verify", "vérifier un dossier : direction"],
      ["stateassign.manage", "gérer une affectation : direction"],
      ["exam.session.read", "aucun examen"],
    ],
    instituteur: [
      ["grade.review", "relecture/validation/publication = autres rôles (spec 005 : absentes volontairement)"],
      ["grade.validate", "idem"],
      ["grade.publish", "idem"],
      ["grade.revise.approve", "il demande la correction, il ne l'approuve pas"],
      ["period.close", "clôture de période = direction des études / direction"],
      ["period.lock", "idem"],
      ["student.read", "uniquement les élèves de SA classe (`student.class.read`)"],
      ["student.list", "idem"],
      ["assessment.manage", "évaluations d'autrui : direction"],
      ["attendance.manage", "corriger les appels d'autrui : vie scolaire"],
      ["attendance.justification.decide", "pas de décision sur un justificatif"],
      ["schedule.read", "emploi du temps global : direction des études (il voit le sien)"],
      ["reportcard.generate", "l'émission des bulletins est à d'autres rôles"],
      ["reportcard.publish", "idem"],
      ["finance.invoice.read", "aucune permission finance (spec 005)"],
      ["finance.payment.create", "aucune permission finance (spec 005)"],
      ["payroll.payslip.read", "tous les bulletins de paie : économe"],
      ["result.read", "résultats calculés : direction des études"],
      ["primary.bilan.prepare", "préparation des bilans annuels : direction des études / direction"],
      ["primary.council.manage", "présider le conseil des maîtres : direction"],
      ["primary.framework.manage", "référentiels de compétences : direction des études"],
      ["primary.class.read_all", "il n'accède qu'à SA classe (sans cette permission)"],
      ["schoollife.read", "la vie scolaire est un module du secondaire"],
      ["imports.read", "aucun import"],
      ["exam.candidate.read", "aucun examen national"],
    ],
    enseignant: [
      ["student.read", "uniquement les élèves de SES classes (`student.class.read`) — demande de changement de people"],
      ["student.list", "idem"],
      ["grade.review", "relecture/validation/publication = autres rôles"],
      ["grade.validate", "idem"],
      ["grade.publish", "idem"],
      ["grade.revise.approve", "il demande la correction, il ne l'approuve pas"],
      ["assessment.manage", "évaluations des AUTRES enseignants : direction"],
      ["assessment.type.manage", "types d'évaluation : direction"],
      ["attendance.justification.read", "pièces médicales : vie scolaire"],
      ["attendance.justification.decide", "pas de décision sur un justificatif"],
      ["attendance.manage", "corriger les appels d'autrui : vie scolaire"],
      ["schedule.read", "emploi du temps global : direction des études (il voit le sien)"],
      ["payroll.payslip.read", "tous les bulletins de paie : économe"],
      ["payroll.config.read", "aucune gestion de paie"],
      ["payroll.run.calculate", "aucune gestion de paie"],
      ["finance.invoice.read", "aucune finance"],
      ["higher.diploma.read", "aucune permission higher"],
      ["higher.document.read", "aucune permission higher"],
      ["result.read", "résultats calculés : direction des études"],
      ["enrollment.read", "inscriptions : scolarité"],
      ["schoollife.read.all", "vie scolaire de tous les élèves : encadrement (il ne voit que SES classes)"],
      ["schoollife.incident.review", "instruction d'un incident : vie scolaire"],
      ["primary.competency.read", "compétences du primaire : instituteur"],
      ["imports.read", "aucun import"],
      ["exam.candidate.read", "aucun examen national (la consultation par l'enseignant n'est pas bornée à ses classes)"],
    ],
    educateur: [
      ["attendance.justification.decide", "il dépose et lit les justificatifs ; la décision est à la direction des études"],
      ["attendance.session.reopen", "il valide ; la réouverture est à la direction"],
      ["attendance.summary.override", "surcharge de récapitulatif = direction"],
      ["attendance.leave.decide", "congés du personnel : direction"],
      ["attendance.staff.record", "présence du personnel : direction des études"],
      ["attendance.settings.manage", "réglages = direction des études"],
      ["student.update", "lecture seule des élèves"],
      ["schedule.occurrence.validate", "il constate, il ne valide pas pour la paie"],
      ["grade.enter", "aucune note"],
      ["schoollife.measure.validate", "validation d'une sanction : direction (proposition ≠ validation)"],
      ["schoollife.exclusion.validate", "validation d'une exclusion : direction"],
      ["schoollife.exclusion.apply", "effet d'une exclusion sur le statut de l'élève : direction"],
      ["schoollife.measure.revoke", "révocation d'une mesure : direction"],
      ["schoollife.appeal.decide", "trancher un recours : direction"],
      ["schoollife.appeal.file", "recours déposé pour une famille : direction"],
      ["schoollife.restricted.read", "éléments restreints : direction (MFA)"],
      ["schoollife.confidential.read", "éléments confidentiels : direction (MFA)"],
      ["schoollife.confidential.audit", "journal des lectures confidentielles : direction"],
      ["schoollife.conduct.manage", "barèmes de conduite : direction"],
      ["schoollife.conduct.adjust", "ajustement de points de conduite : direction"],
      ["schoollife.settings.manage", "réglages de vie scolaire : direction"],
      ["imports.read", "aucun import"],
    ],
    responsable_pedagogique: [
      ["grade.enter", "il valide, il ne saisit pas"],
      ["grade.publish", "la publication est à la direction des études"],
      ["grade.revise.approve", "idem"],
      ["assessment.manage", "évaluations d'autrui : direction (README assess)"],
      ["curriculum.publish", "publication d'un curriculum : direction des études"],
      ["attendance.take", "il ne fait pas l'appel"],
      ["result.recompute", "résultats en lecture seule"],
      ["reportcard.generate", "aucune émission"],
    ],
    personnel: [
      ["student.read", "aucune donnée d'élève"],
      ["staff.read", "aucune fiche d'autrui"],
      ["payroll.payslip.read", "seulement SES bulletins (`read_own`)"],
      ["attendance.read", "ni appels ni absences des élèves"],
      ["attendance.leave.decide", "il demande, il ne décide pas"],
      ["schedule.read", "seulement son emploi du temps"],
    ],
    parent: [
      ["student.read", "uniquement ses enfants (`student.child.read`)"],
      ["student.list", "idem"],
      ["guardian.manage", "un tuteur ne gère pas les liens"],
      ["grade.read", "uniquement les notes PUBLIÉES de ses enfants"],
      ["grade.self.read", "pas les données d'un élève"],
      ["attendance.read", "idem"],
      ["finance.invoice.read", "factures : lecture de gestion"],
      ["finance.payment.create", "aucune finance de gestion"],
      ["finance.self.read", "pas la situation financière d'un élève (uniquement `finance.child.read`)"],
    ],
    eleve: [
      ["student.read", "uniquement son propre dossier (`student.self.read`)"],
      ["student.child.read", "pas les données d'un enfant"],
      ["grade.child.read", "idem"],
      ["grade.read", "uniquement ses notes publiées"],
      ["attendance.take", "aucune saisie d'appel"],
      ["finance.invoice.read", "factures : lecture de gestion"],
      ["finance.child.read", "pas la situation financière d'un enfant (uniquement `finance.self.read`)"],
    ],
    directeur: [
      ["entitlements.manage", "abonnement : propriétaire"],
      ["rbac.role.manage", "définition des rôles : propriétaire"],
      ["payroll.payslip.approve_owner", "validation propriétaire de la paie"],
      ["payroll.settings.manage", "seuil propriétaire et séparation des tâches de la paie : propriétaire"],
      ["rules.platform.manage", "console plateforme : opérateurs uniquement"],
    ],
    owner: [["rules.platform.manage", "console plateforme : opérateurs uniquement (aucun rôle de tenant)"]],
  };

  it("chaque rôle a sa liste d'interdits", () => {
    expect(Object.keys(FORBIDDEN).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
  });

  for (const [role, list] of Object.entries(FORBIDDEN)) {
    it(`${role} ne peut pas : ${list.length} interdits explicites`, () => {
      for (const [permission, reason] of list) {
        expect(real.catalog.byKey.has(permission), `${permission} est dans le catalogue`).toBe(true);
        expect(granted(role).has(permission), `${role} ne doit pas avoir ${permission} — ${reason}`).toBe(false);
      }
    });
  }

  /**
   * Interdits portant sur des permissions de modules À VENIR : la clé peut ne pas (encore) exister dans le
   * catalogue ; le modèle ne doit jamais la DÉCLARER (accordée ou en attente). Dès que le module est chargé,
   * le même contrôle s'applique à la permission réelle.
   */
  const FORBIDDEN_UPCOMING: Record<string, ReadonlyArray<readonly [string, string]>> = {
    instituteur: [
      ["primary.competency.revise", "révision d'une compétence validée (sensible) : direction (spec 005 : absente volontairement)"],
      ["primary.bilan.seal", "scellé du bilan annuel (sensible) : direction"],
      ["primary.bilan.reissue", "réémission du bilan : direction"],
      ["primary.archive.freeze", "gel de l'archive d'année : direction"],
      ["primary.template.apply", "application d'un modèle de pack : direction"],
      ["primary.settings.manage", "réglages du pack : direction"],
    ],
    enseignant: [
      ["council.decision.record", "la décision du conseil est humaine et à la direction des études ; il PROPOSE"],
      ["council.session.run", "tenue de séance : direction des études"],
      ["schoollife.measure.propose", "propose une mesure : vie scolaire"],
      ["schoollife.measure.validate", "validation d'une sanction : direction"],
      ["schoollife.confidential.read", "éléments confidentiels : MFA, direction"],
    ],
    educateur: [
      ["schoollife.measure.validate", "validation d'une sanction : direction (proposition ≠ validation)"],
      ["schoollife.exclusion.validate", "validation d'une exclusion : direction"],
      ["schoollife.measure.revoke", "révocation d'une mesure : direction"],
      ["schoollife.appeal.decide", "trancher un recours : direction"],
      ["schoollife.confidential.read", "éléments confidentiels : MFA, direction"],
      ["schoollife.conduct.adjust", "ajustement manuel de points de conduite : direction"],
    ],
    directeur_etudes: [
      ["council.unlock.approve", "il DEMANDE un déverrouillage ; l'approbation (MFA) est à la direction"],
      ["council.minutes.revoke", "il signe/émet le procès-verbal ; la révocation est séparée (direction)"],
      ["admission.decide", "admissions : décision et capacité = direction"],
      ["stateassign.verify", "vérification d'un dossier d'affectation : direction"],
      ["stateassign.manage", "activer/suspendre/terminer une affectation : direction"],
    ],
    secretariat: [
      ["admission.decide", "il traite le dossier, la décision (admission/refus) est à la direction"],
      ["admission.capacity.override", "dépassement de capacité (sensible) : direction"],
      ["admission.workflow.publish", "publication d'un workflow (sensible) : direction"],
      ["admission.anonymize", "anonymisation (sensible, MFA) : direction"],
      ["admission.export", "export d'un dossier : direction"],
      ["admission.settings.manage", "réglages d'admission : direction"],
      ["council.minutes.revoke", "émission/signature ≠ révocation d'un procès-verbal"],
      ["council.session.run", "tenue de séance : direction des études"],
      ["council.decision.record", "décision du conseil : direction des études"],
      ["council.unlock.approve", "approbation d'un déverrouillage : direction"],
      ["stateassign.verify", "vérifier un dossier : direction (il l'enregistre)"],
      ["stateassign.manage", "activer/suspendre une affectation : direction"],
      ["stateassign.amend", "avenant : direction"],
    ],
    econome: [
      ["stateassign.record", "enregistrer un dossier : secrétariat"],
      ["stateassign.verify", "vérifier un dossier : direction"],
      ["stateassign.manage", "gérer une affectation : direction"],
      ["admission.read", "admissions : secrétariat et direction"],
    ],
    parent: [
      ["primary.competency.self.read", "pas les données d'un élève (uniquement `*.child.*`)"],
      ["council.self.read", "idem"],
      ["exam.document.self.read", "idem"],
      ["admission.read", "le parent n'a AUCUNE permission d'admission (accès par jeton, spec 007 §11)"],
      ["schoollife.read", "vie scolaire de gestion : personnel"],
      ["council.read", "dossiers de conseil de gestion : personnel"],
      ["stateassign.read", "dossiers d'affectation de gestion : personnel"],
    ],
    eleve: [
      ["primary.competency.child.read", "pas les données d'un enfant (uniquement `*.self.*`)"],
      ["council.child.read", "idem"],
      ["exam.document.child.read", "idem"],
      ["stateassign.child.read", "l'affectation d'État n'a pas de portée `self`"],
      ["admission.read", "aucune permission d'admission"],
      ["schoollife.read", "vie scolaire de gestion : personnel"],
    ],
  };

  for (const [role, list] of Object.entries(FORBIDDEN_UPCOMING)) {
    it(`${role} ne peut pas (modules à venir) : ${list.length} interdits explicites`, () => {
      expect(Object.keys(EXPECTED), role).toContain(role);
      for (const [permission, reason] of list) {
        expect(declared(role).has(permission), `${role} ne doit pas déclarer ${permission} — ${reason}`).toBe(false);
      }
    });
  }

  it("les interdits des modules à venir ne contredisent pas la liste blanche (une clé interdite à un rôle n'est pas réservée POUR lui)", () => {
    for (const [role, list] of Object.entries(FORBIDDEN_UPCOMING)) {
      const reservedForRole = new Set(EXPECTED[role] && !EXPECTED[role]?.all ? ((EXPECTED[role] as { reserved?: string[] }).reserved ?? []) : []);
      for (const [permission] of list) expect(reservedForRole.has(permission), `${role} ${permission}`).toBe(false);
    }
  });

  it("directeur_etudes : la direction détient bien les contreparties qu'il n'a pas", () => {
    for (const k of ["result.override.approve", "period.reopen", "period.repin", "reportcard.revoke", "higher.award.revoke", "attendance.session.reopen"]) {
      expect(granted("directeur").has(k), k).toBe(true);
      expect(granted("owner").has(k), k).toBe(true);
    }
  });
});

describe("séparation des tâches", () => {
  /** Paires de côtés incompatibles : aucun rôle (hors owner/directeur) ne détient une permission de chaque côté. */
  const CONFLICTS: ReadonlyArray<{ name: string; left: string[]; right: string[] }> = [
    { name: "saisie des notes ≠ relecture/validation/publication/approbation", left: ["grade.enter"], right: ["grade.review", "grade.validate", "grade.publish", "grade.revise.approve"] },
    { name: "demande de correction ≠ approbation de correction", left: ["grade.revise.request"], right: ["grade.revise.approve"] },
    { name: "demande de surcharge de résultat ≠ approbation", left: ["result.override.request"], right: ["result.override.approve"] },
    { name: "clôture de période ≠ réouverture / changement de règle", left: ["period.lock", "period.close", "academic.period.close"], right: ["period.reopen", "period.repin", "academic.period.reopen"] },
    { name: "calcul/ajustement de paie ≠ arrêt du bulletin", left: ["payroll.run.calculate", "payroll.payslip.adjust"], right: ["payroll.payslip.approve", "payroll.payslip.approve_owner"] },
    { name: "versement ≠ arrêt/annulation d'un bulletin", left: ["payroll.payslip.pay"], right: ["payroll.payslip.approve", "payroll.payslip.cancel"] },
    { name: "configuration des salaires/tarifs ≠ arrêt du bulletin", left: ["payroll.config.manage", "payroll.rate.manage"], right: ["payroll.payslip.approve"] },
    { name: "paie ≠ réglage de ses garde-fous", left: ["payroll.run.calculate", "payroll.payslip.pay"], right: ["payroll.settings.manage"] },
    { name: "validation des heures payables ≠ constatation/création d'heures", left: ["schedule.occurrence.validate"], right: ["schedule.occurrence.hold", "schedule.accounting.create", "schedule.hours.lock"] },
    { name: "validation des heures payables ≠ calcul de paie", left: ["schedule.occurrence.validate"], right: ["payroll.run.calculate"] },
    { name: "émission/publication d'un bulletin ≠ révocation", left: ["reportcard.generate", "reportcard.publish"], right: ["reportcard.revoke"] },
    { name: "octroi/émission d'un diplôme ≠ forçage/révocation/signataires", left: ["higher.award.create", "higher.document.issue"], right: ["higher.award.force", "higher.award.revoke", "higher.slot.manage"] },
    { name: "validation d'un appel ≠ réouverture/surcharge", left: ["attendance.validate"], right: ["attendance.session.reopen", "attendance.summary.override"] },
    { name: "dépôt d'un justificatif ≠ décision sur un justificatif", left: ["attendance.justification.submit"], right: ["attendance.justification.decide"] },
    { name: "demande de congé ≠ décision de congé", left: ["attendance.leave.request"], right: ["attendance.leave.decide"] },
    { name: "inscription ≠ dérogation d'éligibilité / financement", left: ["enrollment.create", "enrollment.update", "enrollment.cancel"], right: ["enrollment.override", "enrollment.funding.update"] },
    { name: "encaissement/facturation ≠ réglages du catalogue de rôles et accès", left: ["finance.payment.create", "finance.payment.refund"], right: ["rbac.role.manage", "rbac.assignment.manage", "iam.mfa.reset"] },
    // Modules livrés des packs Primary (005), Secondary (006), Admissions (007) et Examinations (018).
    { name: "saisie/validation d'une compétence ≠ révision après validation", left: ["primary.competency.record", "primary.competency.validate"], right: ["primary.competency.revise"] },
    { name: "préparation du bilan annuel ≠ scellé / réémission / gel de l'archive", left: ["primary.bilan.prepare", "primary.council.prepare", "primary.archive.prepare"], right: ["primary.bilan.seal", "primary.bilan.reissue", "primary.archive.freeze"] },
    { name: "enregistrement d'un dossier d'affectation d'État ≠ vérification/gestion/avenant", left: ["stateassign.record"], right: ["stateassign.verify", "stateassign.manage", "stateassign.amend"] },
    { name: "rapprochement/contrôle d'affectation ≠ vérification du dossier", left: ["stateassign.reconcile", "stateassign.control.perform", "stateassign.receivable.manage"], right: ["stateassign.verify"] },
    { name: "proposition/déclaration d'une mesure disciplinaire ≠ validation/révocation/exclusion/recours", left: ["schoollife.measure.propose", "schoollife.incident.write", "schoollife.incident.review"], right: ["schoollife.measure.validate", "schoollife.exclusion.validate", "schoollife.exclusion.apply", "schoollife.measure.revoke", "schoollife.appeal.decide"] },
    { name: "traitement d'un dossier d'admission ≠ décision / dépassement de capacité / anonymisation / publication de workflow", left: ["admission.create", "admission.update", "admission.offer.manage", "admission.enroll"], right: ["admission.decide", "admission.capacity.override", "admission.anonymize", "admission.workflow.publish"] },
    { name: "saisie/dépôt/demande de correction d'un résultat d'examen ≠ publication/application/approbation", left: ["exam.result.enter", "exam.score.enter", "exam.import.manage"], right: ["exam.result.publish", "exam.result.release", "exam.result.revise"] },
    { name: "évaluation/gestion des candidats d'un examen ≠ dérogation d'éligibilité", left: ["exam.eligibility.evaluate", "exam.candidate.manage"], right: ["exam.eligibility.override"] },
    { name: "préparation d'un import de soldes (création) ≠ lancement de l'import des soldes d'ouverture", left: ["imports.create"], right: ["imports.import.opening_balances"] },
  ];

  const EXEMPT = ["owner", "directeur"];

  /**
   * Paires des modules À VENIR (spec 005, 006, 007) : évaluées sur les clés DÉCLARÉES par chaque modèle
   * (accordées ou en attente), donc actives dès aujourd'hui ; les clés ne sont pas contrôlées contre le catalogue
   * tant que le module n'est pas livré.
   */
  const UPCOMING_CONFLICTS: ReadonlyArray<{ name: string; left: string[]; right: string[] }> = [
    { name: "demande de déverrouillage d'un conseil ≠ approbation", left: ["council.unlock.request"], right: ["council.unlock.approve"] },
    { name: "génération/signature d'un procès-verbal ≠ révocation", left: ["council.minutes.generate", "council.minutes.sign"], right: ["council.minutes.revoke"] },
  ];

  it("la liste ne cite que de vraies permissions", () => {
    for (const c of CONFLICTS) {
      for (const k of [...c.left, ...c.right]) expect(real.catalog.byKey.has(k), `${c.name} : ${k}`).toBe(true);
    }
  });

  for (const c of UPCOMING_CONFLICTS) {
    it(`[modules à venir] ${c.name} : aucun rôle (hors direction) ne détient les deux côtés`, () => {
      const offenders: string[] = [];
      for (const role of SYSTEM_ROLE_KEYS) {
        if (EXEMPT.includes(role)) continue;
        const has = declared(role);
        const l = c.left.filter((k) => has.has(k));
        const r = c.right.filter((k) => has.has(k));
        if (l.length > 0 && r.length > 0) offenders.push(`${role} : ${l.join(",")} + ${r.join(",")}`);
      }
      expect(offenders).toEqual([]);
    });
  }

  for (const c of CONFLICTS) {
    it(`${c.name} : aucun rôle (hors direction) ne détient les deux côtés`, () => {
      const offenders: string[] = [];
      for (const role of SYSTEM_ROLE_KEYS) {
        if (EXEMPT.includes(role)) continue;
        const has = granted(role);
        const l = c.left.filter((k) => has.has(k));
        const r = c.right.filter((k) => has.has(k));
        if (l.length > 0 && r.length > 0) offenders.push(`${role} : ${l.join(",")} + ${r.join(",")}`);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("owner et directeur cumulent par construction : la séparation y est imposée PAR PERSONNE à l'exécution (documenté dans le modèle)", () => {
    for (const key of EXEMPT) {
      const t = getSystemRoleTemplate(key);
      expect(t?.permissions).toEqual(["*"]);
    }
    const directeur = getSystemRoleTemplate("directeur");
    expect(directeur?.description).toBeTruthy();
  });
});

describe("permissions sensibles et MFA", () => {
  const humanNonOwner = SYSTEM_ROLE_KEYS.filter((k) => k !== "owner");

  it("owner : toutes les permissions sensibles (sauf plateforme) sont accordées et exigent la MFA", () => {
    for (const k of real.sensitive) {
      if (OWNER_EXCEPT.includes(k)) continue;
      expect(granted("owner").has(k), k).toBe(true);
    }
    expect(getSystemRoleTemplate("owner")?.mfaRecommended).toBe(true);
  });

  for (const role of humanNonOwner) {
    it(`${role} : chaque permission sensible accordée est justifiée explicitement, sans justification périmée`, () => {
      const template = getSystemRoleTemplate(role);
      const justifications = template?.sensitiveJustifications ?? {};
      const sensitiveGranted = [...granted(role)].filter((k) => real.sensitive.has(k)).sort();
      // Permissions RÉSERVÉES sensibles (spec) déclarées mais encore en attente : leur justification est exigée
      // dès maintenant (elle ne doit pas être oubliée quand le module arrive) et n'est pas « périmée ».
      const sensitiveReservedPending = [...declared(role)]
        .filter((k) => getReservedPermission(k)?.sensitive === true && !real.catalog.byKey.has(k))
        .sort();
      const sensitiveAll = [...sensitiveGranted, ...sensitiveReservedPending];

      for (const key of Object.keys(justifications)) {
        expect(key, `${role} : « * » seul n'est pas une justification`).not.toBe("*");
        expect(justifications[key]?.trim().length ?? 0, `${role} : justification de ${key} trop courte`).toBeGreaterThanOrEqual(30);
        // pas de justification périmée : elle doit couvrir au moins une permission sensible réellement accordée
        // (ou réservée sensible, en attente)
        expect(sensitiveAll.some((k) => matchesPermissionPattern(key, k)), `${role} : justification périmée « ${key} »`).toBe(true);
      }
      const unjustified = sensitiveAll.filter((k) => !Object.keys(justifications).some((p) => matchesPermissionPattern(p, k)));
      expect(unjustified, `${role} : permissions sensibles sans justification`).toEqual([]);
    });

    it(`${role} : \`mfaRecommended\` ⇔ le rôle porte au moins une permission sensible`, () => {
      const hasSensitive =
        [...granted(role)].some((k) => real.sensitive.has(k)) ||
        [...declared(role)].some((k) => getReservedPermission(k)?.sensitive === true && !real.catalog.byKey.has(k));
      expect(getSystemRoleTemplate(role)?.mfaRecommended === true, role).toBe(hasSensitive);
    });
  }

  it("les rôles de portail (parent, élève), le personnel, l'enseignant, l'instituteur, l'éducateur, le responsable des examens et le chargé d'admissions n'ont AUCUNE permission sensible", () => {
    for (const role of ["parent", "eleve", "personnel", "enseignant", "instituteur", "educateur", "responsable_examens", "admissions_officer"]) {
      expect([...granted(role)].filter((k) => real.sensitive.has(k)), role).toEqual([]);
      // idem pour les permissions réservées (sensibilité prévue par la spec)
      expect([...declared(role)].filter((k) => getReservedPermission(k)?.sensitive === true), `${role} (réservées)`).toEqual([]);
    }
  });

  it("les permissions sensibles de gestion des accès restent à la direction : rbac.*, iam.mfa.reset, audit.export", () => {
    for (const role of SYSTEM_ROLE_KEYS.filter((k) => !["owner", "directeur"].includes(k))) {
      for (const k of ["rbac.role.manage", "rbac.assignment.manage", "iam.mfa.reset", "audit.export", "entitlements.manage"]) {
        expect(granted(role).has(k), `${role} ${k}`).toBe(false);
      }
    }
  });
});

describe("motif `*` et portails", () => {
  it("aucun rôle système autre que owner/directeur n'a `*` (ni motif couvrant tout un module)", () => {
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      if (t.key === "owner" || t.key === "directeur") continue;
      for (const p of t.permissions) {
        expect(p, `${t.key} : motif générique « ${p} »`).not.toContain("*");
      }
      expect(t.except ?? [], t.key).toEqual([]);
    }
    expect(getSystemRoleTemplate("owner")?.permissions).toEqual(["*"]);
    expect(getSystemRoleTemplate("directeur")?.permissions).toEqual(["*"]);
  });

  it("parent = EXACTEMENT toutes les permissions `child` du catalogue ; élève = EXACTEMENT toutes les `self` (3 ET 4 segments)", () => {
    const child = real.catalog.keys.filter(isChildKey).sort();
    const self = real.catalog.keys.filter(isSelfKey).sort();
    expect([...granted("parent")].sort()).toEqual(child);
    expect([...granted("eleve")].sort()).toEqual(self);
    expect(child.length).toBeGreaterThanOrEqual(8);
    expect(self.length).toBeGreaterThanOrEqual(8);
  });

  it("parent / élève : le modèle DÉCLARE (accordées + réservées en attente) exactement les permissions `child` / `self` — rien de plus, rien d'oublié (spec 006 data-model §11 point 7)", () => {
    const reservedChild = RESERVED_FOR_UPCOMING_MODULES.map((r) => r.key).filter(isChildKey);
    const reservedSelf = RESERVED_FOR_UPCOMING_MODULES.map((r) => r.key).filter(isSelfKey);
    // seul `councils` reste à venir : `council.child.read` / `council.self.read`
    expect(reservedChild).toEqual(["council.child.read"]);
    expect(reservedSelf).toEqual(["council.self.read"]);
    const realChild = real.catalog.keys.filter(isChildKey);
    const realSelf = real.catalog.keys.filter(isSelfKey);
    expect([...declared("parent")].sort()).toEqual([...new Set([...realChild, ...reservedChild])].sort());
    expect([...declared("eleve")].sort()).toEqual([...new Set([...realSelf, ...reservedSelf])].sort());
    // convention de portée : le segment d'une clé réservée dit à quel portail elle appartient
    for (const k of [...declared("parent")]) expect(permissionScopeOf(k), `parent ${k}`).toBe("child");
    for (const k of [...declared("eleve")]) expect(permissionScopeOf(k), `eleve ${k}`).toBe("self");
  });

  it("les permissions `child` / `self` (3 ET 4 segments) ne sont accordées ni déclarées par aucun rôle de gestion (ni à l'autre portail)", () => {
    for (const role of SYSTEM_ROLE_KEYS) {
      if (role === "owner" || role === "directeur" || role === "parent" || role === "eleve") continue;
      const leaked = [...declared(role)].filter((k) => isChildKey(k) || isSelfKey(k));
      expect(leaked, role).toEqual([]);
    }
    expect([...declared("parent")].filter((k) => permissionScopeOf(k) === "self")).toEqual([]);
    expect([...declared("eleve")].filter((k) => permissionScopeOf(k) === "child")).toEqual([]);
  });

  it("toute permission `.own.` / `read_own` du catalogue est portée par `personnel` ; les rôles de fonction (hors enseignant/éducateur) et les portails n'en portent aucune", () => {
    const own = real.catalog.keys.filter((k) => matchesPermissionPattern("*.own.*", k) || k.endsWith(".read_own")).sort();
    expect(own.length).toBeGreaterThanOrEqual(6);
    for (const k of own) expect(granted("personnel").has(k), k).toBe(true);
    for (const role of ["secretariat", "econome", "directeur_etudes", "responsable_pedagogique", "responsable_examens", "admissions_officer", "parent", "eleve"]) {
      expect([...granted(role)].filter((k) => own.includes(k)), role).toEqual([]);
    }
  });

  it("aucun rôle n'accorde `student.read`/`student.list` global à l'enseignant ni à l'instituteur ; ils ont `student.class.read`", () => {
    for (const role of ["enseignant", "instituteur"]) {
      expect(granted(role).has("student.class.read"), role).toBe(true);
      expect(granted(role).has("student.read"), role).toBe(false);
      expect(granted(role).has("student.list"), role).toBe(false);
    }
  });

  it("l'instituteur reprend l'expression de « sa classe » de l'enseignant (mêmes motifs de portée `*.own.*`, `student.class.read`) et porte exactement la liste de la spec 005 §7 (+ patron enseignant)", () => {
    const spec005 = [
      "attendance.take", "attendance.read", "assessment.create", "assessment.update", "grade.enter",
      "primary.competency.read", "primary.competency.record", "primary.competency.validate", "primary.phrase.read",
      "primary.council.read", "primary.council.prepare", "student.class.read", "messaging.read", "messaging.send",
      "messaging.announcement.publish_class", "reportcard.read",
    ];
    for (const k of spec005) expect(declared("instituteur").has(k), `spec 005 §7 : ${k}`).toBe(true);
    // tout ce que l'instituteur déclare en plus de la spec vient du patron enseignant (aucune invention)
    // (sauf deux ajouts de lecture DOCUMENTÉS par la livraison du module : `primary.framework.read` — la grille de compétences
    // s'appuie sur le référentiel — et `primary.bilan.read` — « l'instituteur consulte le bilan de sa classe », spec 005, tableau des écarts d'implémentation, et
    // README `primary_school`)
    const MODULE_ADDITIONS = ["primary.framework.read", "primary.bilan.read"];
    for (const k of MODULE_ADDITIONS) expect(declared("instituteur").has(k), `ajout documenté : ${k}`).toBe(true);
    const extra = [...declared("instituteur")].filter((k) => !spec005.includes(k) && !MODULE_ADDITIONS.includes(k));
    for (const k of extra) expect(declared("enseignant").has(k), `${k} hors spec 005 : doit venir du patron enseignant`).toBe(true);
    // l'enseignant n'a pas été appauvri
    expect(getSystemRoleTemplate("enseignant")?.permissions).toEqual(expect.arrayContaining(["grade.enter", "attendance.take", "student.class.read", "staff.own.read"]));
  });

  it("aucun modèle ne mentionne un ancien nom de permission inexistant (portal.*, comms.*, document.*, report.*, tenant.*, discipline.*)", () => {
    const stale = /^(portal|comms|document|report|tenant|discipline|payment)\./;
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      for (const p of [...t.permissions, ...(t.except ?? [])]) expect(stale.test(p), `${t.key} : ${p}`).toBe(false);
    }
  });
});
