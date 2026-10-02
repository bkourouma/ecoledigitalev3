/**
 * Socle des adaptateurs d'`admissions` (`admissions-*.ts`) : dépendances d'ÉCRITURE de `people`, `academic`, `finance` (avec le
 * vrai audit) et utilitaire d'erreurs. L'acceptation d'une offre appelle les cas d'usage PUBLICS de ces modules dans la
 * transaction du module admissions (même contexte : savepoints de `TenantDb`) : élève, tuteurs, inscription et facture sont créés
 * ENSEMBLE ou pas du tout. Appels SÉQUENTIELS (une transaction = une connexion).
 *
 * Académie : la liste des statuts d'élève inscriptibles est étendue à `INACTIVE` POUR CE SEUL FLUX (l'élève créé par les
 * admissions reste inactif jusqu'à la confirmation de son inscription) ; le comportement par défaut d'`academic` ne change pas.
 */
import { isAppError, type AppError, type Result } from "@ecoledigitale/kernel";
import { academicAuditAdapter, createAcademicDeps, type AcademicDeps, type AcademicPorts } from "../../modules/academic";
import { createFinanceDeps, financeAuditAdapter, type FinanceDeps, type FinancePortSet } from "../../modules/finance";
import { createPeopleDeps, peopleAuditAdapter, type PeopleDeps, type PeoplePortSet } from "../../modules/people";
import type { Clock } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import type { RuntimeAuditPort } from "../runtime";
import type { AdapterKit } from "./kit";

/** Les ports des modules écrits tels que `buildPlatformPorts` les construit (lus paresseusement). */
export interface AdmissionsTargetPorts {
  readonly academic: Partial<AcademicPorts>;
  readonly people: Partial<PeoplePortSet>;
  readonly finance: Partial<FinancePortSet>;
}

export interface AdmissionsWriteEnv {
  readonly people: PeopleDeps;
  readonly academic: AcademicDeps;
  readonly finance: FinanceDeps;
  /** Dépendances de lecture de `tenancy` (`getInstitution`, `listInstitutions`). */
  readonly tenancy: { db: TenantDb; clock: Clock };
  readonly kit: AdapterKit;
}

type AuditRecorder = Pick<RuntimeAuditPort, "record">;
const noAudit: AuditRecorder = { async record() {} };

export function createAdmissionsWriteEnv(kit: AdapterKit, ports: () => AdmissionsTargetPorts, audit: AuditRecorder = noAudit): AdmissionsWriteEnv {
  const common = { db: kit.tenantDb, clock: kit.clock, logger: kit.logger };
  const people = createPeopleDeps({ ...common, audit: peopleAuditAdapter(audit), portsProvider: () => ports().people });
  const academic = createAcademicDeps({
    ...common,
    audit: academicAuditAdapter(audit),
    portsProvider: () => ({ institutions: kit.academic.ports.institutions, ...ports().academic }),
    config: { enrollableStudentStatuses: ["ACTIVE", "INACTIVE"] },
  });
  const finance = createFinanceDeps({ ...common, audit: financeAuditAdapter(audit), portsProvider: () => ports().finance });
  return { people, academic, finance, tenancy: { db: kit.tenantDb, clock: kit.clock }, kit };
}

/** Une erreur de module voisin remonte telle quelle (code stable conservé) : elle annule la saga d'admissions. */
export function unwrapPort<T>(result: Result<T, AppError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export const isAppErr = isAppError;
