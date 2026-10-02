/**
 * Types du domaine des imports (purs) : colonnes, importeurs, problèmes de ligne.
 *
 * Un importeur est une DESCRIPTION (colonnes, alias, schéma, clé naturelle) ; l'écriture est portée par un port
 * (`application/ports.ts`) branché par la plateforme. Rien ici n'importe `pg`, `fastify` ni un autre module.
 */
import type { ZodTypeAny } from "zod";
import type { ImportColumnType, ImportIssue, ImporterKey, ImportOnExisting, ImportOptionDef, ImportRunMode } from "@ecoledigitale/contracts/src/v2/imports";

export type { ImportIssue };

export type ImportOptions = Readonly<Record<string, string | number | boolean>>;

/** Environnement des règles pures : l'horloge est injectée (jamais `new Date()` dans une règle). */
export interface RuleEnv {
  /** Date du jour, `AAAA-MM-JJ` (UTC). */
  readonly today: string;
}

export interface ColumnDef {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly type: ImportColumnType;
  readonly description: string;
  readonly example: string;
  /** Intitulés (français et anglais) reconnus pour ce champ, normalisés à la comparaison. */
  readonly aliases: readonly string[];
  /** Colonne de montant entier (messages dédiés aux décimales). */
  readonly amount?: boolean;
}

export type OptionDef = ImportOptionDef;

/** Valeur typée d'une ligne après mapping, coercion et schéma (JSON sérialisable). */
export type RowValues = Record<string, unknown>;

export interface ImporterDef<Row extends RowValues = RowValues> {
  readonly key: ImporterKey;
  readonly label: string;
  readonly description: string;
  /** Soldes financiers : MFA exigée au lancement. */
  readonly sensitive: boolean;
  /** Type d'entité principale créée (clé de `entity_refs`). */
  readonly entityType: string;
  readonly columns: readonly ColumnDef[];
  readonly options: readonly OptionDef[];
  /** Permission de lancer l'importeur. */
  readonly importPermission: string;
  /** Permissions du module cible exigées dans tous les cas. */
  readonly targetPermissions: readonly string[];
  /** Permissions exigées selon le contenu du fichier ou les options (ex. colonne « classe » mappée). */
  readonly conditionalPermissions: ReadonlyArray<{ permission: string; when: string }>;
  /** Schéma Zod de la ligne coercée (clés = `ColumnDef.key`). Les valeurs absentes sont omises. */
  readonly schema: ZodTypeAny;
  /** Règles métier pures de la ligne (en plus du schéma). */
  rules(row: Row, options: ImportOptions, env: RuleEnv): ImportIssue[];
  /** Clé naturelle normalisée de la ligne (`null` : impossible à calculer). Préfixée par l'importeur, bornée à 500 caractères. */
  naturalKey(row: Row, options: ImportOptions): string | null;
  /** `false` : la politique « mettre à jour » est refusée (documents financiers immuables). */
  readonly supportsUpdate: boolean;
  /**
   * Clés naturelles SUPPLÉMENTAIRES dont le port a besoin (ex. le tuteur d'un lien) : le moteur lit leur référence
   * (`entity_refs`) avant d'appeler le port et enregistre celles que le port renvoie.
   */
  relatedKeys?(row: Row, options: ImportOptions): string[];
  /**
   * Clés d'entités dont la ligne dépend (ex. le noeud parent) : celles déclarées plus haut dans le même fichier sont
   * signalées au port (elles n'existent pas encore en base pendant la validation).
   */
  dependsOnKeys?(row: Row, options: ImportOptions): string[];
  /** Vérifie les options (obligatoires, format) ; les existences se vérifient par le port. */
  validateOptions(options: ImportOptions): ImportIssue[];
  /** Lignes d'exemple du modèle de fichier (fictives). */
  readonly sampleRows: ReadonlyArray<readonly string[]>;
  /** Permissions supplémentaires selon le mapping (colonnes affectées) et la politique « existant ». */
  extraPermissions(input: { mappedColumns: ReadonlySet<string>; onExisting: ImportOnExisting; options: ImportOptions }): readonly string[];
}

/** Réglages d'exécution d'un import. */
export interface RunSettings {
  readonly mode: ImportRunMode;
  readonly onExisting: ImportOnExisting;
  readonly options: ImportOptions;
}

export const issue = (column: string | null, code: string, message: string, severity: "ERROR" | "WARNING" = "ERROR"): ImportIssue => ({ column, code, message, severity });

export const hasErrors = (issues: readonly ImportIssue[]): boolean => issues.some((i) => i.severity === "ERROR");
