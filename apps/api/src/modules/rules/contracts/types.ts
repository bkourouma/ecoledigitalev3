/**
 * Contrat de règles : la STRUCTURE (clés, types de règle, variables d'entrée, types de résultat, chaînage),
 * versionnée dans le CODE. Les VALEURS (seuils, pondérations, expressions, libellés) sont des RuleVersions en base.
 *
 * Règle d'or (spec 012, rule-contracts.md) : changer une valeur = nouvelle RuleVersion (donnée) ; changer le
 * chaînage ou l'ensemble des variables d'entrée = nouveau contrat (`@2`) = livraison de code.
 */
import type { ResultTypeSpec, RuleSchemaSpec, RuleType } from "../engine";

/** Contrainte posée par le contrat sur un paramètre de règle (utile pour les paramètres « de mode »). */
export interface ContractParameter {
  readonly type: "number" | "string" | "boolean";
  /** Valeurs permises (énumération) ; un paramètre `string` de mode ne prend que ces valeurs. */
  readonly allowed?: readonly (string | number)[];
}

export interface ContractRule {
  /** Clé de la règle dans le RuleSet. */
  readonly key: string;
  /** Type de règle du moteur : une version DOIT déclarer le même. */
  readonly type: RuleType;
  /** `true` : la version peut l'omettre (règle réservée, non appelée en v1). */
  readonly optional: boolean;
  /** Variables d'entrée que le module consommateur fournit (jamais d'identité d'élève). */
  readonly inputs: RuleSchemaSpec;
  /** Type du résultat. */
  readonly result: ResultTypeSpec;
  /** Codes de sortie permis pour une règle à code (mention, décision…) ; vide sinon. */
  readonly outputCodes: readonly string[];
  /** Paramètres contraints par le contrat (les autres sont libres, mais bornés par leur `ParameterSpec`). */
  readonly parameters: Readonly<Record<string, ContractParameter>>;
  readonly description: string;
}

export interface PipelineStage {
  readonly stage: string;
  readonly rules: readonly string[];
  readonly description: string;
}

export interface RuleContract {
  /** `<nom>@<n>` */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly rules: readonly ContractRule[];
  /** Ordre d'appel documenté ; l'exécution est celle du module consommateur (`results`, `higher`). */
  readonly pipeline: readonly PipelineStage[];
}
