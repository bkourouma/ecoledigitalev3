/**
 * Ports du module imports : ce que l'application attend de l'extérieur, décrit structurellement.
 *
 * Le module n'écrit JAMAIS dans un autre module : chaque importeur délègue l'écriture à un PORT CIBLE (`ImportTargetPort`)
 * que `apps/api/src/platform/adapters/imports-*.ts` branche sur l'API publique (`index.ts`) du module visé — avec ses
 * règles, son audit, ses événements et ses permissions. Un port non branché fait échouer l'import FERMÉ
 * (`imports.port_unavailable`).
 *
 * Contrat d'un port :
 *  - `plan` : LECTURE SEULE (exécuté dans une transaction `READ ONLY`). Pour chaque ligne valide, dit ce qui arriverait
 *    (créer, mettre à jour, ignorer, refuser) et pourquoi. Aucune écriture, aucun effet de bord.
 *  - `apply` : écrit UNE ligne par l'API publique du module cible, dans la transaction de lot déjà ouverte (le `db.run`
 *    du module cible s'y imbrique en SAVEPOINT) ; un refus est un résultat `FAILED` avec ses codes, jamais une exception
 *    (une exception inattendue annule le lot).
 *  - Tous les appels sont SÉQUENTIELS (jamais de `Promise.all` : une transaction = une connexion).
 */
import type { Tx } from "@ecoledigitale/database";
import type { RequestContext } from "@ecoledigitale/kernel";
import type { ImportChoice, ImporterKey, ImportOnExisting, ImportPlannedAction, ImportRunMode } from "@ecoledigitale/contracts/src/v2/imports";
import type { ImportIssue, ImportOptions, RowValues } from "../domain/types";

/** Entrée d'audit : tenant, acteur et requête sont dérivés du contexte de la transaction. */
export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
}

export interface AuditPort {
  record(tx: Tx, entry: AuditEntry): Promise<unknown>;
}

export const noopAudit: AuditPort = { async record() {} };

/** Enregistreur de test : conserve les entrées dans l'ordre. */
export class RecordingAudit implements AuditPort {
  readonly entries: AuditEntry[] = [];
  async record(_tx: Tx, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/** Stockage d'objets (fichiers importés) : sous-ensemble du `StoragePort` de la plateforme. */
export interface ImportStoragePort {
  put(key: string, bytes: Uint8Array, options: { contentType: string }): Promise<unknown>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType?: string | null } | null>;
  delete(key: string): Promise<void>;
}

/** Réglages communs d'une exécution (validation ou import). */
export interface PlanRun {
  readonly jobId: string;
  readonly options: ImportOptions;
  readonly onExisting: ImportOnExisting;
  readonly mode: ImportRunMode;
}

export interface PlanItem<Row extends RowValues = RowValues> {
  readonly rowNo: number;
  readonly key: string | null;
  readonly row: Row;
  /** Entité déjà créée par un import précédent pour cette clé (table d'idempotence), sinon `null`. */
  readonly knownEntityId: string | null;
  /** Références des clés annexes demandées par l'importeur (`relatedKeys`) : clé -> identifiant d'entité. */
  readonly related: Readonly<Record<string, string>>;
  /** Clés dont la ligne dépend (`dependsOnKeys`) déclarées PLUS HAUT dans le fichier (absentes de la base à ce stade). */
  readonly inFileDependencies: ReadonlySet<string>;
}

export interface PlanResult {
  readonly rowNo: number;
  readonly action: ImportPlannedAction;
  readonly entityId?: string | null;
  readonly issues: ImportIssue[];
}

export interface ApplyItem<Row extends RowValues = RowValues> extends PlanItem<Row> {
  /** Action décidée à la validation (`CREATE` ou `UPDATE`). */
  readonly action: "CREATE" | "UPDATE";
}

export interface ApplyRef {
  readonly key: string;
  readonly entityType: string;
  readonly entityId: string;
}

export interface ApplyResult {
  readonly rowNo: number;
  readonly outcome: "CREATED" | "UPDATED" | "SKIPPED" | "FAILED";
  readonly entityId?: string | null;
  readonly issues: ImportIssue[];
  /** Références d'idempotence à enregistrer (la clé de la ligne l'est déjà avec `entityId`). */
  readonly refs?: readonly ApplyRef[];
}

export interface ImportTargetPort<Row extends RowValues = RowValues> {
  plan(ctx: RequestContext, items: readonly PlanItem<Row>[], run: PlanRun): Promise<PlanResult[]>;
  apply(ctx: RequestContext, item: ApplyItem<Row>, run: PlanRun): Promise<ApplyResult>;
  /** Écriture d'un lot en un appel (notes : `saveGrades`) ; l'implémentation retombe sur `apply` ligne à ligne en cas d'échec. */
  applyBatch?(ctx: RequestContext, items: readonly ApplyItem<Row>[], run: PlanRun): Promise<ApplyResult[]>;
  /** Valeurs proposées pour une option de type « choix » (années, classes, évaluations...). */
  choices?(ctx: RequestContext, optionKey: string, query?: string): Promise<ImportChoice[]>;
  /** Vérifie que les options désignent des objets existants (année, évaluation, version...). */
  checkOptions?(ctx: RequestContext, options: ImportOptions): Promise<ImportIssue[]>;
}

/** Nom d'affichage de l'auteur d'un import (annuaire des comptes, fourni par `people`). */
export interface ImportActorNamePort {
  displayName(ctx: RequestContext, userId: string): Promise<string | null>;
}

export interface ImportPorts {
  readonly targets: Partial<Record<ImporterKey, ImportTargetPort<any>>>;
  readonly storage: ImportStoragePort;
  /** Audit du worker (l'API passe `runtime.auditPort` par `createImportsDeps({ audit })`). */
  readonly audit?: AuditPort;
  readonly names?: ImportActorNamePort;
}
