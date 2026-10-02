/**
 * Socle des adaptateurs d'import (`imports-*.ts`) : dépendances d'ÉCRITURE des modules cibles (avec le vrai audit) et
 * traduction des erreurs des modules cibles en problèmes de ligne.
 *
 * Contrairement au kit de lecture (`kit.ts`, audit no-op), un import ÉCRIT : chaque ligne passe par les cas d'usage publics
 * du module cible, avec son audit (`runtime.auditPort` dans l'API ; le service d'audit du processus dans le worker), ses
 * événements d'outbox et ses règles. Les ports de ces modules sont ceux de la plateforme (`buildPlatformPorts`).
 *
 * Règle d'or : appels SÉQUENTIELS (une transaction de lot = une connexion).
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, isAppError, type AppError, type RequestContext } from "@ecoledigitale/kernel";
import { createAcademicDeps, academicAuditAdapter, type AcademicDeps, type AcademicPorts } from "../../modules/academic";
import { createAssessDeps, type AssessDeps, type AssessPorts } from "../../modules/assess";
import { createFinanceDeps, financeAuditAdapter, type FinanceDeps, type FinancePortSet } from "../../modules/finance";
import type { ImportIssue } from "../../modules/imports";
import { createPeopleDeps, peopleAuditAdapter, type PeopleDeps, type PeoplePortSet } from "../../modules/people";
import type { RuntimeAuditPort } from "../runtime";
import type { AdapterKit } from "./kit";

/** Les ports des modules cibles tels que `buildPlatformPorts` les construit (lus paresseusement). */
export interface TargetPorts {
  readonly academic: Partial<AcademicPorts>;
  readonly people: Partial<PeoplePortSet>;
  readonly assess: Partial<AssessPorts>;
  readonly finance: Partial<FinancePortSet>;
}

/** Dépendances d'écriture des modules cibles, construites une fois par tenantDb. */
export interface ImportWriteEnv {
  readonly people: PeopleDeps;
  readonly academic: AcademicDeps;
  readonly assess: AssessDeps;
  readonly finance: FinanceDeps;
  readonly kit: AdapterKit;
}

type AuditRecorder = Pick<RuntimeAuditPort, "record">;

const noAudit: AuditRecorder = { async record() {} };

/**
 * `ports` est lu PARESSEUSEMENT (les ports des autres modules sont construits par `buildPlatformPorts` APRÈS) : les
 * dépendances ne figent jamais un port.
 */
export function createImportWriteEnv(kit: AdapterKit, ports: () => TargetPorts, audit: AuditRecorder = noAudit): ImportWriteEnv {
  const db = kit.tenantDb;
  const common = { db, clock: kit.clock, logger: kit.logger };
  const people = createPeopleDeps({ ...common, audit: peopleAuditAdapter(audit), portsProvider: () => ports().people });
  const academic = createAcademicDeps({ ...common, audit: academicAuditAdapter(audit), portsProvider: () => ({ institutions: kit.academic.ports.institutions, ...ports().academic }) });
  const assess = createAssessDeps({ ...common, audit, portsProvider: () => ports().assess });
  const finance = createFinanceDeps({ ...common, audit: financeAuditAdapter(audit), portsProvider: () => ports().finance });
  return { people, academic, assess, finance, kit };
}

export const issue = (column: string | null, code: string, message: string, severity: "ERROR" | "WARNING" = "ERROR"): ImportIssue => ({ column, code, message, severity });

/** Dernier élément de chemin de champ d'un module cible (`person.birthDate` -> `birthDate`). */
const fieldOf = (path: ReadonlyArray<string | number>): string | null => {
  for (let i = path.length - 1; i >= 0; i -= 1) if (typeof path[i] === "string") return String(path[i]);
  return null;
};

/** Traduit une erreur d'un module cible en problèmes de ligne (code stable du module cible conservé). */
export function issuesFromError(e: unknown): ImportIssue[] {
  if (!isAppError(e)) return [issue(null, "imports.write_failed", "L'écriture de cette ligne a échoué (erreur interne).")];
  const err: AppError = e;
  if (err instanceof ValidationError && err.issues.length > 0) {
    return err.issues.map((i) => issue(fieldOf(i.path), i.code ?? err.code, i.message));
  }
  if (err.code === "people.possible_duplicate") {
    const candidates = (err.details?.["candidates"] as Array<{ displayName?: string; studentNumber?: string | null }> | undefined) ?? [];
    const names = candidates.slice(0, 3).map((c) => `${c.displayName ?? "?"}${c.studentNumber ? ` (${c.studentNumber})` : ""}`).join(", ");
    return [issue(null, err.code, `Doublon probable avec une fiche existante${names ? ` : ${names}` : ""}. Vérifiez ou choisissez « créer malgré le doublon ».`)];
  }
  if (err instanceof NotFoundError || err instanceof ConflictError || err instanceof ForbiddenError) return [issue(null, err.code, err.message)];
  return [issue(null, err.code, err.message)];
}

export const hasError = (issues: readonly ImportIssue[]): boolean => issues.some((i) => i.severity === "ERROR");

export type { RequestContext };
