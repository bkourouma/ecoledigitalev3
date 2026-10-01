/**
 * Erreurs typées du moteur de règles. Tous les messages sont en français et
 * portent, quand elle existe, la position (décalages + ligne/colonne) dans la
 * source de l'expression.
 */

export type RulePhase = 'schema' | 'syntax' | 'check' | 'evaluation';

export type RuleErrorCode =
  // schéma de données fourni à la compilation
  | 'SCHEMA_INVALIDE'
  // analyse lexicale / syntaxique
  | 'SYNTAXE_CARACTERE_INATTENDU'
  | 'SYNTAXE_JETON_INATTENDU'
  | 'SYNTAXE_FIN_INATTENDUE'
  | 'SYNTAXE_NOMBRE_INVALIDE'
  | 'SYNTAXE_TEXTE_NON_TERMINE'
  | 'SYNTAXE_ECHAPPEMENT_INVALIDE'
  | 'SYNTAXE_APPEL_NON_AUTORISE'
  | 'SYNTAXE_NON_SUPPORTE'
  // limites de compilation
  | 'LIMITE_SOURCE_TROP_LONGUE'
  | 'LIMITE_PROFONDEUR'
  | 'LIMITE_NOMBRE_DE_NOEUDS'
  // vérification statique (publication)
  | 'NOM_INCONNU'
  | 'NOM_INTERDIT'
  | 'FONCTION_INCONNUE'
  | 'CHAMP_INCONNU'
  | 'CLE_INCONNUE'
  | 'ARITE_INVALIDE'
  | 'TYPE_INCOMPATIBLE'
  | 'VALEUR_PEUT_ETRE_ABSENTE'
  | 'TYPE_RESULTAT_INVALIDE'
  | 'ARGUMENT_INVALIDE'
  // évaluation
  | 'BUDGET_NOEUDS_DEPASSE'
  | 'BUDGET_TEMPS_DEPASSE'
  | 'DIVISION_PAR_ZERO'
  | 'VALEUR_ABSENTE'
  | 'DONNEE_MANQUANTE'
  | 'CONTEXTE_INVALIDE'
  | 'DOMAINE_INVALIDE'
  | 'LONGUEURS_DIFFERENTES';

export interface SourcePosition {
  /** Décalage (en unités UTF-16) du premier caractère concerné. */
  start: number;
  /** Décalage (exclu) de fin. */
  end: number;
  /** Ligne, à partir de 1. */
  line: number;
  /** Colonne, à partir de 1. */
  column: number;
}

export interface Diagnostic {
  code: RuleErrorCode;
  phase: RulePhase;
  message: string;
  position?: SourcePosition;
  /** Conseil de correction, quand il y en a un. */
  hint?: string;
}

/** Calcule ligne/colonne (à partir de 1) d'un décalage dans une source. */
export function locate(source: string, start: number, end: number = start + 1): SourcePosition {
  const s = Math.max(0, Math.min(start, source.length));
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < s; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lastBreak = i;
    }
  }
  return { start: s, end: Math.max(s, Math.min(end, source.length)), line, column: s - lastBreak };
}

export class RuleError extends Error {
  readonly code: RuleErrorCode;
  readonly phase: RulePhase;
  readonly position?: SourcePosition;
  readonly hint?: string;
  /** Message sans le suffixe de position. */
  readonly detail: string;

  constructor(d: Diagnostic) {
    const where = d.position ? ` (ligne ${d.position.line}, colonne ${d.position.column})` : '';
    super(`${d.message}${where}`);
    this.name = new.target.name;
    this.code = d.code;
    this.phase = d.phase;
    this.detail = d.message;
    if (d.position) this.position = d.position;
    if (d.hint) this.hint = d.hint;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toDiagnostic(): Diagnostic {
    const d: Diagnostic = { code: this.code, phase: this.phase, message: this.detail };
    if (this.position) d.position = this.position;
    if (this.hint) d.hint = this.hint;
    return d;
  }

  toJSON(): Diagnostic & { name: string } {
    return { name: this.name, ...this.toDiagnostic() };
  }
}

/** Le schéma de données fourni à `compile` est invalide. */
export class RuleSchemaError extends RuleError {}

/** Erreur lexicale ou syntaxique (ou dépassement de limite à l'analyse). */
export class RuleSyntaxError extends RuleError {}

/** Une ou plusieurs erreurs de vérification statique (noms, types, fonctions). */
export class RuleCheckError extends RuleError {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    const first = diagnostics[0];
    if (!first) throw new Error('RuleCheckError exige au moins un diagnostic');
    const extra = diagnostics.length > 1 ? ` [+${diagnostics.length - 1} autre(s) erreur(s)]` : '';
    super({ ...first, message: `${first.message}${extra}` });
    this.diagnostics = diagnostics;
  }
}

/** Erreur survenue pendant l'évaluation (données, domaine, budget…). */
export class RuleEvaluationError extends RuleError {}

/** Budget d'évaluation dépassé (nœuds ou temps). */
export class RuleBudgetError extends RuleEvaluationError {}
