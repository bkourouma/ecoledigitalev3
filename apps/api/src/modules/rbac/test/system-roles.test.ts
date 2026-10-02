/**
 * Rôles système contre le catalogue RÉEL (manifestes de TOUS les modules découverts).
 *
 *  1. Aucun motif « en attente » : tout motif d'un modèle désigne au moins une vraie permission.
 *  2. Pour CHAQUE rôle et CHAQUE module : ce que le rôle PEUT et NE PEUT PAS faire, énuméré ici
 *     indépendamment des modèles (oracle). Un nouveau module ou une nouvelle permission sans décision
 *     explicite fait échouer le test.
 *  3. Interdits notables, expliqués (séparation des tâches, moindre privilège).
 *  4. Paires de tâches incompatibles : aucun rôle autre que owner/directeur ne détient les deux côtés.
 *  5. Permissions sensibles : justifiées ; `mfaRecommended` cohérent.
 *  6. `*` réservé à owner/directeur ; parent/élève : exactement `*.child.*` / `*.self.*`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { matchesPermissionPattern } from "../domain/permission-catalog";
import { SYSTEM_ROLE_KEYS, SYSTEM_ROLE_TEMPLATES, getSystemRoleTemplate } from "../templates/system-roles";
import { loadRealCatalog, resolveAgainst, type RealCatalog } from "./real-catalog";

let real: RealCatalog;
let roles: ReturnType<typeof resolveAgainst>;
beforeAll(async () => {
  real = await loadRealCatalog();
  roles = resolveAgainst(real, SYSTEM_ROLE_TEMPLATES);
});

const granted = (role: string): ReadonlySet<string> => roles.get(role)?.permissions ?? new Set();

/** Exclusions des deux rôles à motif `*`. */
const OWNER_EXCEPT = ["rules.platform.manage"];
const DIRECTEUR_EXCEPT = ["entitlements.manage", "rbac.role.manage", "payroll.payslip.approve_owner", "payroll.settings.manage", "rules.platform.manage"];

/**
 * ORACLE : permissions exactes de chaque rôle, indépendantes des modèles. `"ALL"` = tout le catalogue
 * moins `except`.
 */
const EXPECTED: Record<string, { all: true; except: string[] } | { all?: false; can: string[] }> = {
  owner: { all: true, except: OWNER_EXCEPT },
  directeur: { all: true, except: DIRECTEUR_EXCEPT },

  directeur_etudes: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.send.any", "messaging.announcement.publish", "messaging.announcement.manage",
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
    ],
  },

  secretariat: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.announcement.publish",
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
    ],
  },

  econome: {
    can: [
      // messaging
      "messaging.read", "messaging.send",
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
    ],
  },

  enseignant: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.announcement.publish_class",
      // notifications
      "notifications.own.manage",
      "assessment.type.read", "assessment.read", "assessment.create", "assessment.update", "grade.read", "grade.enter", "grade.revise.request",
      "appreciation.write",
      "attendance.read", "attendance.take", "attendance.own.read", "attendance.own.record", "attendance.leave.request",
      "student.class.read", "staff.own.read", "staff.own.update",
      "schedule.own.read", "schedule.occurrence.declare",
      "payroll.payslip.read_own", "payroll.my.dispute",
    ],
  },

  educateur: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.announcement.publish_class",
      // notifications
      "notifications.own.manage",
      "attendance.read", "attendance.take", "attendance.manage", "attendance.validate", "attendance.justification.submit",
      "attendance.justification.read", "attendance.report.read", "attendance.own.read", "attendance.own.record", "attendance.leave.request",
      "schedule.read", "schedule.occurrence.hold",
      "student.list", "student.read", "guardian.read", "staff.own.read", "staff.own.update",
      "enrollment.read", "academic.classroom.read",
    ],
  },

  responsable_pedagogique: {
    can: [
      // messaging
      "messaging.read", "messaging.send", "messaging.announcement.publish_class",
      "academic.read", "academic.year.read", "academic.period.read", "academic.program.read", "academic.classroom.read",
      "curriculum.read", "curriculum.manage", "enrollment.read",
      "assessment.type.read", "assessment.read", "grade.read", "grade.review", "grade.validate",
      "result.read", "result.explain", "reportcard.read", "reportcard.explain",
      "schedule.read", "teaching.read", "attendance.read", "attendance.report.read",
      "student.list", "student.read", "staff.list", "staff.read",
      "rules.ruleset.read",
    ],
  },

  personnel: {
    can: [
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
      // notifications
      "notifications.child.manage",
      "student.child.read", "student.child.update", "enrollment.child.read", "grade.child.read", "result.child.read", "reportcard.child.read",
      "attendance.child.read", "attendance.child.justify", "schedule.child.read", "higher.child.read",
      "finance.child.read", "finance.child.pay",
    ],
  },

  eleve: {
    can: [
      // messaging
      "messaging.self.read", "messaging.self.send",
      // notifications
      "notifications.self.manage",
      "student.self.read", "student.self.update", "enrollment.self.read", "enrollment.self.create", "grade.self.read", "result.self.read",
      "reportcard.self.read", "attendance.self.read", "attendance.self.justify", "schedule.self.read", "higher.self.read",
      "finance.self.read", "finance.self.pay",
    ],
  },
};

function expectedOf(role: string): ReadonlySet<string> {
  const e = EXPECTED[role];
  if (!e) throw new Error(`Rôle sans oracle : ${role}`);
  if (e.all) return new Set(real.catalog.keys.filter((k) => !e.except.includes(k)));
  return new Set(e.can);
}

describe("modèles de rôles système : ensemble des rôles", () => {
  it("onze modèles, dont le NOUVEAU rôle `personnel`, clés uniques", () => {
    expect(SYSTEM_ROLE_KEYS).toEqual([
      "owner",
      "directeur",
      "directeur_etudes",
      "secretariat",
      "econome",
      "enseignant",
      "educateur",
      "responsable_pedagogique",
      "personnel",
      "parent",
      "eleve",
    ]);
    expect(Object.keys(EXPECTED).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
  });

  it("le catalogue réel couvre les modules livrés (chaque module déclarant des permissions est connu de la matrice)", () => {
    const modulesWithPermissions = [...new Set(real.catalog.entries.map((e) => e.moduleKey))].sort();
    expect(modulesWithPermissions).toEqual([
      "academic", "analytics", "assess", "attendance", "audit", "entitlements", "finance", "higher", "iam", "messaging", "notifications", "payroll", "people", "rbac",
      "reportcards", "results", "rules", "scheduling", "tenancy",
    ]);
  });
});

describe("aucun motif « en attente » contre le catalogue réel", () => {
  for (const template of SYSTEM_ROLE_TEMPLATES) {
    it(`${template.key} : chaque clé/motif d'octroi désigne au moins une permission réelle`, () => {
      const resolved = roles.get(template.key);
      expect(resolved?.pending, `motifs en attente de ${template.key}`).toEqual([]);
    });
  }

  it("les motifs d'exclusion (`except`) désignent aussi de vraies permissions (pas de faute de frappe qui laisserait un droit)", () => {
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      for (const pattern of t.except ?? []) {
        expect(real.catalog.keys.some((k) => matchesPermissionPattern(pattern, k)), `${t.key} except ${pattern}`).toBe(true);
      }
    }
  });

  it("toutes les permissions de l'oracle existent dans le catalogue réel", () => {
    const unknown: string[] = [];
    for (const [role, e] of Object.entries(EXPECTED)) {
      const list = e.all ? e.except : e.can;
      for (const k of list) if (!real.catalog.byKey.has(k)) unknown.push(`${role}:${k}`);
    }
    expect(unknown).toEqual([]);
  });

  it("un motif en attente serait bien détecté (le contrôle n'est pas vide)", () => {
    const fake = resolveAgainst(real, [{ key: "faux_role", label: "Faux", description: "d", permissions: ["payroll.own.*", "assessment.*", "grade.enter", "discipline.*"] }]);
    expect(fake.get("faux_role")?.pending).toEqual(["discipline.*", "payroll.own.*"]);
  });
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
  ];

  const EXEMPT = ["owner", "directeur"];

  it("la liste ne cite que de vraies permissions", () => {
    for (const c of CONFLICTS) {
      for (const k of [...c.left, ...c.right]) expect(real.catalog.byKey.has(k), `${c.name} : ${k}`).toBe(true);
    }
  });

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

      for (const key of Object.keys(justifications)) {
        expect(key, `${role} : « * » seul n'est pas une justification`).not.toBe("*");
        expect(justifications[key]?.trim().length ?? 0, `${role} : justification de ${key} trop courte`).toBeGreaterThanOrEqual(30);
        // pas de justification périmée : elle doit couvrir au moins une permission sensible réellement accordée
        expect(sensitiveGranted.some((k) => matchesPermissionPattern(key, k)), `${role} : justification périmée « ${key} »`).toBe(true);
      }
      const unjustified = sensitiveGranted.filter((k) => !Object.keys(justifications).some((p) => matchesPermissionPattern(p, k)));
      expect(unjustified, `${role} : permissions sensibles sans justification`).toEqual([]);
    });

    it(`${role} : \`mfaRecommended\` ⇔ le rôle porte au moins une permission sensible`, () => {
      const hasSensitive = [...granted(role)].some((k) => real.sensitive.has(k));
      expect(getSystemRoleTemplate(role)?.mfaRecommended === true, role).toBe(hasSensitive);
    });
  }

  it("les rôles de portail (parent, élève) et le personnel n'ont AUCUNE permission sensible", () => {
    for (const role of ["parent", "eleve", "personnel", "enseignant", "educateur"]) {
      expect([...granted(role)].filter((k) => real.sensitive.has(k)), role).toEqual([]);
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

  it("parent = EXACTEMENT toutes les permissions `*.child.*` du catalogue ; élève = EXACTEMENT toutes les `*.self.*`", () => {
    const child = real.catalog.keys.filter((k) => matchesPermissionPattern("*.child.*", k)).sort();
    const self = real.catalog.keys.filter((k) => matchesPermissionPattern("*.self.*", k)).sort();
    expect([...granted("parent")].sort()).toEqual(child);
    expect([...granted("eleve")].sort()).toEqual(self);
    expect(child.length).toBeGreaterThanOrEqual(8);
    expect(self.length).toBeGreaterThanOrEqual(8);
  });

  it("les permissions `*.child.*` / `*.self.*` ne sont accordées à aucun rôle de gestion (ni à l'autre portail)", () => {
    for (const role of SYSTEM_ROLE_KEYS) {
      if (role === "owner" || role === "directeur" || role === "parent" || role === "eleve") continue;
      const leaked = [...granted(role)].filter((k) => matchesPermissionPattern("*.child.*", k) || matchesPermissionPattern("*.self.*", k));
      expect(leaked, role).toEqual([]);
    }
    expect([...granted("parent")].filter((k) => k.includes(".self."))).toEqual([]);
    expect([...granted("eleve")].filter((k) => k.includes(".child."))).toEqual([]);
  });

  it("toute permission `.own.` / `read_own` du catalogue est portée par `personnel` ; les rôles de fonction (hors enseignant/éducateur) et les portails n'en portent aucune", () => {
    const own = real.catalog.keys.filter((k) => matchesPermissionPattern("*.own.*", k) || k.endsWith(".read_own")).sort();
    expect(own.length).toBeGreaterThanOrEqual(6);
    for (const k of own) expect(granted("personnel").has(k), k).toBe(true);
    for (const role of ["secretariat", "econome", "directeur_etudes", "responsable_pedagogique", "parent", "eleve"]) {
      expect([...granted(role)].filter((k) => own.includes(k)), role).toEqual([]);
    }
  });

  it("aucun rôle n'accorde `student.read`/`student.list` global à l'enseignant ; il a `student.class.read`", () => {
    expect(granted("enseignant").has("student.class.read")).toBe(true);
    expect(granted("enseignant").has("student.read")).toBe(false);
    expect(granted("enseignant").has("student.list")).toBe(false);
  });

  it("aucun modèle ne mentionne un ancien nom de permission inexistant (portal.*, comms.*, document.*, report.*, tenant.*, discipline.*)", () => {
    const stale = /^(portal|comms|document|report|tenant|discipline|payment)\./;
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      for (const p of [...t.permissions, ...(t.except ?? [])]) expect(stale.test(p), `${t.key} : ${p}`).toBe(false);
    }
  });
});
