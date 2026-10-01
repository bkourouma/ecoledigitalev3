/**
 * Modèles de rôles SYSTÈME (données). Instanciés pour chaque tenant au
 * provisioning (`instantiateSystemRoles`), verrouillés : un tenant ne les édite
 * pas, il les CLONE pour obtenir un rôle personnalisé.
 *
 * Chaque modèle liste des CLÉS exactes et des MOTIFS (cf. `permission-catalog.ts`)
 * résolus contre le catalogue réel des manifestes :
 *   - un motif qui ne correspond encore à rien (module pas encore déployé) reste
 *     « en attente » et est re-résolu à la prochaine synchro — jamais perdu ;
 *   - `except` retire des clés/motifs de l'ensemble octroyé.
 *
 * Conventions de nommage supposées des modules (à respecter dans leurs manifestes) :
 *   - `<ressource>.<action>` : `student.read`, `grade.enter`, `finance.payment.create` ;
 *   - données PROPRES à l'élève   : `<ressource>.self.<action>`  (`grade.self.read`) ;
 *   - données des ENFANTS du parent : `<ressource>.child.<action>` (`grade.child.read`) ;
 *   - données PROPRES au personnel : `<ressource>.own.<action>`   (`payroll.own.read`) ;
 *   - portails : `portal.<portail>.access`.
 * Le contrôle « cet élève est bien l'enfant de ce parent » est une règle de
 * domaine (relation Guardian) appliquée par le module concerné, pas un périmètre RBAC.
 *
 * `label` / `description` : français (donnée de pack, ADR-007).
 */

export interface SystemRoleTemplate {
  /** Clé stable, anglais, snake_case. Réservée : un rôle personnalisé ne peut pas la prendre. */
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** Clés exactes et motifs octroyés. */
  readonly permissions: readonly string[];
  /** Clés/motifs retirés de `permissions`. */
  readonly except?: readonly string[];
  /** Le plan impose la MFA pour ces profils (information pour l'IAM ; l'exigence réelle est portée par `sensitive`). */
  readonly mfaRecommended?: boolean;
}

export const SYSTEM_ROLE_TEMPLATES: readonly SystemRoleTemplate[] = Object.freeze([
  {
    key: "owner",
    label: "Propriétaire",
    description: "Fondateur de l'établissement : tous les droits, y compris l'abonnement et les accès.",
    permissions: ["*"],
    mfaRecommended: true,
  },
  {
    key: "directeur",
    label: "Directeur",
    description: "Direction de l'établissement : tout, sauf la gestion de l'abonnement et la définition des rôles.",
    permissions: ["*"],
    except: ["tenant.billing.*", "tenant.close", "rbac.role.manage"],
    mfaRecommended: true,
  },
  {
    key: "directeur_etudes",
    label: "Directeur des études",
    description: "Pilotage pédagogique : structure académique, emplois du temps, notes, bulletins.",
    permissions: [
      "academic.*",
      "curriculum.*",
      "schedule.*",
      "assessment.*",
      "grade.*",
      "reportcard.*",
      "attendance.*",
      "discipline.*",
      "teaching.*",
      "student.read",
      "student.list",
      "guardian.read",
      "enrollment.read",
      "staff.read",
      "report.read",
      "report.export",
      "document.read",
      "comms.read",
      "comms.send",
    ],
  },
  {
    key: "secretariat",
    label: "Secrétariat",
    description: "Inscriptions, dossiers élèves et parents, documents, communication.",
    permissions: [
      "student.*",
      "guardian.*",
      "enrollment.*",
      "document.*",
      "attendance.read",
      "schedule.read",
      "academic.read",
      "finance.invoice.read",
      "finance.payment.read",
      "comms.read",
      "comms.send",
    ],
  },
  {
    key: "econome",
    label: "Économe",
    description: "Gestion financière : frais, factures, encaissements, rémunération du personnel.",
    permissions: [
      "finance.*",
      "payment.*",
      "payroll.*",
      "report.read",
      "report.export",
      "student.read",
      "guardian.read",
      "enrollment.read",
      "staff.read",
      "document.read",
      "comms.read",
      "comms.send",
    ],
    mfaRecommended: true,
  },
  {
    key: "enseignant",
    label: "Enseignant",
    description: "Enseignement : appel, évaluations et saisie des notes de ses classes.",
    permissions: [
      "attendance.read",
      "attendance.take",
      "assessment.read",
      "assessment.create",
      "assessment.update",
      "grade.read",
      "grade.enter",
      "schedule.read",
      "student.read",
      "student.list",
      "document.read",
      "comms.read",
      "comms.send",
      "payroll.own.*",
    ],
  },
  {
    key: "educateur",
    label: "Éducateur",
    description: "Vie scolaire : présences, discipline, suivi des élèves.",
    permissions: [
      "attendance.*",
      "discipline.*",
      "student.read",
      "student.list",
      "guardian.read",
      "schedule.read",
      "comms.read",
      "comms.send",
    ],
  },
  {
    key: "responsable_pedagogique",
    label: "Responsable pédagogique",
    description: "Coordination d'une filière ou d'un niveau : programmes, évaluations, validation des notes.",
    permissions: [
      "academic.read",
      "curriculum.*",
      "assessment.*",
      "grade.read",
      "grade.validate",
      "reportcard.read",
      "schedule.read",
      "teaching.read",
      "attendance.read",
      "student.read",
      "student.list",
      "staff.read",
      "report.read",
      "comms.read",
      "comms.send",
    ],
  },
  {
    key: "parent",
    label: "Parent",
    description: "Portail parent : suivi de ses enfants (notes, présences, scolarité, communications).",
    permissions: ["portal.parent.access", "*.child.*", "comms.read"],
  },
  {
    key: "eleve",
    label: "Élève",
    description: "Portail élève : ses notes, son emploi du temps, ses documents.",
    permissions: ["portal.student.access", "*.self.*", "comms.read"],
  },
] satisfies readonly SystemRoleTemplate[]);

export const SYSTEM_ROLE_KEYS: readonly string[] = Object.freeze(SYSTEM_ROLE_TEMPLATES.map((t) => t.key));

export function getSystemRoleTemplate(key: string): SystemRoleTemplate | undefined {
  return SYSTEM_ROLE_TEMPLATES.find((t) => t.key === key);
}

export function isReservedRoleKey(key: string, templates: readonly SystemRoleTemplate[] = SYSTEM_ROLE_TEMPLATES): boolean {
  return templates.some((t) => t.key === key);
}
