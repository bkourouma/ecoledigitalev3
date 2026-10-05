/**
 * Forme des données de départ (catalogue national). DONNÉES versionnées, pas du code de règle : le
 * chargeur (`application/seed.ts`) les insère par la machine d'états, signe leur hash et vérifie que chaque
 * règle compile et satisfait son contrat.
 */
import type { ParameterSpec, ResultTypeSpec, RuleSchemaSpec, RuleSource, RuleType } from "../engine";

export interface SeedRule {
  readonly key: string;
  readonly type: RuleType;
  readonly expression: string;
  readonly description: string;
  readonly parameters?: Readonly<Record<string, ParameterSpec>>;
  /** Absent : le schéma d'entrée du contrat s'applique. */
  readonly inputSchema?: RuleSchemaSpec;
  /** Absent : le type de résultat du contrat s'applique. */
  readonly result?: ResultTypeSpec;
  /** `{ "<CODE>": { "fr": "Libellé" } }` — les libellés ne sont jamais comparés par la logique. */
  readonly labelMap?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly isOptional?: boolean;
}

export interface SeedVersion {
  readonly versionNo: number;
  readonly contractId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly source: RuleSource;
  readonly notes?: string;
  /**
   * Numéro d'une version du même jeu et du même contrat que celle-ci REMPLACE : avant de publier cette version, le chargeur
   * RETIRE (`published -> retired`, tracé) la version remplacée, ce qui évite le chevauchement de période d'effet. La version
   * retirée reste chargeable (rejeu des anciens calculs) ; les calculs qui l'ont épinglée gardent leur règle.
   */
  readonly supersedes?: number;
  readonly rules: readonly SeedRule[];
}

export interface SeedRuleSet {
  readonly code: string;
  readonly name: string;
  readonly countryCode: string;
  readonly regulation?: string;
  readonly educationSystem?: string;
  readonly level?: string;
  readonly versions: readonly SeedVersion[];
}
