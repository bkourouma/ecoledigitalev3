import { z } from 'zod';
import { compile, type CompiledRule } from './compile';
import { RuleEvaluationError, RuleSchemaError } from './errors';
import type { EvalContext } from './runtime';
import { RuleSchemaSpecSchema, ScalarTypeSpecSchema, isDeclarableName, type RuleSchemaSpec } from './schema';

/**
 * Modèle de données des RuleSets (plan §3.8) : RuleSet -> RuleVersion -> Rule.
 * Types TypeScript dérivés des schémas Zod (source de vérité unique).
 */

/* --------------------------------- dates ---------------------------------- */

/** Date calendaire ISO « AAAA-MM-JJ » (sans heure ni fuseau : comparaison lexicographique sûre). */
export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] as number;
  return d <= days;
}

export const IsoDateSchema = z.string().refine(isValidIsoDate, { message: 'Date invalide (format attendu : AAAA-MM-JJ, jour calendaire existant).' });

/* -------------------------------- statuts --------------------------------- */

export const RULE_STATUSES = ['draft', 'simulated', 'proposed', 'approved', 'published', 'retired'] as const;
export const RuleStatusSchema = z.enum(RULE_STATUSES);
export type RuleStatus = z.infer<typeof RuleStatusSchema>;

export const RULE_TYPES = [
  'grading_scale', // barème
  'assessment_aggregation', // agrégation d'évaluations
  'period_average', // moyenne de période
  'annual_average', // moyenne annuelle
  'ranking', // classement
  'rounding', // arrondi
  'mention', // mention
  'promotion', // passage
  'repetition', // redoublement
  'orientation', // orientation
  'credit_validation', // validation de crédits
  'compensation', // compensation
  'eliminatory_grade', // note éliminatoire
] as const;
export const RuleTypeSchema = z.enum(RULE_TYPES);
export type RuleType = z.infer<typeof RuleTypeSchema>;

/* -------------------------------- portée ---------------------------------- */

export const RuleScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('national') }).strict(),
  z.object({ kind: z.literal('tenant'), tenantId: z.string().min(1) }).strict(),
]);
export type RuleScope = z.infer<typeof RuleScopeSchema>;

/* -------------------------------- source ---------------------------------- */

/**
 * Provenance d'une version : texte réglementaire, décision d'établissement, plateforme (portage fidèle du legacy) ou
 * `placeholder` (jeu FICTIF de démonstration : mécanisme seulement, aucune valeur officielle ; jamais publié comme règlement).
 */
export const RuleSourceSchema = z
  .object({
    kind: z.enum(['regulation', 'institution', 'platform', 'placeholder']),
    /** Référence du texte (arrêté, décret, note interne…). */
    reference: z.string().min(1).optional(),
    url: z.string().url().optional(),
    description: z.string().optional(),
  })
  .strict();
export type RuleSource = z.infer<typeof RuleSourceSchema>;

/* -------------------------------- règles ---------------------------------- */

export const ParameterSpecSchema = z
  .object({
    type: z.enum(['number', 'string', 'boolean']),
    default: z.union([z.number().finite(), z.string(), z.boolean()]),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    description: z.string().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (typeof p.default !== p.type) {
      ctx.addIssue({ code: 'custom', message: `La valeur par défaut doit être de type ${p.type}.` });
    }
    if ((p.min !== undefined || p.max !== undefined) && p.type !== 'number') {
      ctx.addIssue({ code: 'custom', message: 'min/max ne s\'appliquent qu\'aux paramètres numériques.' });
    }
    if (typeof p.default === 'number') {
      if (p.min !== undefined && p.default < p.min) ctx.addIssue({ code: 'custom', message: 'La valeur par défaut est inférieure à min.' });
      if (p.max !== undefined && p.default > p.max) ctx.addIssue({ code: 'custom', message: 'La valeur par défaut dépasse max.' });
    }
  });
export type ParameterSpec = z.infer<typeof ParameterSpecSchema>;

export const RuleDefinitionSchema = z
  .object({
    /** Clé stable de la règle dans le RuleSet (ex. « note_ecue »). */
    key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Clé en minuscules (a-z, 0-9, _), commençant par une lettre.').max(64),
    type: RuleTypeSchema,
    /** Expression du DSL. */
    expression: z.string().min(1).max(10_000),
    description: z.string().optional(),
    /** Schéma de paramètres (exposés dans l'expression sous `params.nom`). */
    parameters: z.record(ParameterSpecSchema).optional(),
    /** Schéma des données d'entrée ; à défaut, fourni par le catalogue du type de règle. */
    inputSchema: RuleSchemaSpecSchema.optional(),
    /** Type de résultat attendu. */
    result: ScalarTypeSpecSchema.optional(),
  })
  .strict();
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

/* ------------------------------ versions & sets --------------------------- */

export const RuleVersionSchema = z
  .object({
    id: z.string().min(1),
    ruleSetId: z.string().min(1),
    version: z.number().int().min(1),
    status: RuleStatusSchema,
    /** Premier jour d'application (inclus). */
    effectiveFrom: IsoDateSchema,
    /** Dernier jour d'application (INCLUS) ; absent ou null = sans fin. */
    effectiveTo: IsoDateSchema.nullable().optional(),
    source: RuleSourceSchema,
    rules: z.array(RuleDefinitionSchema).max(500),
    createdAt: z.string().optional(),
    createdBy: z.string().optional(),
    approvedBy: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.effectiveTo != null && v.effectiveTo < v.effectiveFrom) {
      ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'effectiveTo doit être postérieure ou égale à effectiveFrom.' });
    }
    const seen = new Set<string>();
    v.rules.forEach((r, i) => {
      if (seen.has(r.key)) ctx.addIssue({ code: 'custom', path: ['rules', i, 'key'], message: `Clé de règle en double : « ${r.key} ».` });
      seen.add(r.key);
    });
  });
export type RuleVersion = z.infer<typeof RuleVersionSchema>;

export const RuleSetSchema = z
  .object({
    id: z.string().min(1),
    /** Code stable de la famille de règles (ex. « BTS_LMD », « CLASSIQUE »). */
    code: z.string().min(1),
    name: z.string().min(1),
    scope: RuleScopeSchema,
    /** Pays (ISO 3166-1 alpha-2). */
    countryCode: z.string().regex(/^[A-Z]{2}$/, 'Code pays ISO 3166-1 alpha-2 en majuscules.'),
    regulation: z.string().optional(),
    educationSystem: z.string().optional(),
    level: z.string().optional(),
    versions: z.array(RuleVersionSchema),
  })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set<number>();
    s.versions.forEach((v, i) => {
      if (v.ruleSetId !== s.id) ctx.addIssue({ code: 'custom', path: ['versions', i, 'ruleSetId'], message: 'ruleSetId ne correspond pas au RuleSet parent.' });
      if (seen.has(v.version)) ctx.addIssue({ code: 'custom', path: ['versions', i, 'version'], message: `Numéro de version en double : ${v.version}.` });
      seen.add(v.version);
    });
  });
export type RuleSet = z.infer<typeof RuleSetSchema>;

/* ---------------------- paramètres et compilation d'une règle ------------- */

/** Schéma complet d'une règle : schéma d'entrée + variable `params` issue des paramètres. */
export function effectiveRuleSchema(rule: RuleDefinition, fallback?: RuleSchemaSpec): RuleSchemaSpec {
  const base = rule.inputSchema ?? fallback ?? { variables: {} };
  const variables: Record<string, unknown> = { ...(base.variables ?? {}) };
  if (rule.parameters && Object.keys(rule.parameters).length > 0) {
    const fields: Record<string, 'number' | 'string' | 'boolean'> = {};
    for (const [name, p] of Object.entries(rule.parameters)) {
      if (!isDeclarableName(name)) {
        throw new RuleSchemaError({
          code: 'SCHEMA_INVALIDE',
          phase: 'schema',
          message: `Nom de paramètre interdit ou invalide : « ${name} ».`,
        });
      }
      fields[name] = p.type;
    }
    variables.params = { object: fields };
  }
  return { ...base, variables } as RuleSchemaSpec;
}

/** Compile une règle d'un RuleVersion (vérifie noms/types/résultat attendu). */
export function compileRule(rule: RuleDefinition, fallbackSchema?: RuleSchemaSpec): CompiledRule {
  return compile(rule.expression, effectiveRuleSchema(rule, fallbackSchema), rule.result ? { expect: rule.result } : {});
}

/**
 * Fusionne les paramètres de la règle (valeurs par défaut, éventuellement
 * surchargées) dans le contexte, sous `variables.params`. Ne modifie jamais le
 * contexte fourni.
 */
export function contextWithParameters(
  rule: RuleDefinition,
  context: EvalContext,
  overrides: Readonly<Record<string, number | string | boolean>> = {},
): EvalContext {
  if (!rule.parameters || Object.keys(rule.parameters).length === 0) return context;
  const params: Record<string, number | string | boolean> = {};
  for (const [name, spec] of Object.entries(rule.parameters)) {
    const raw = Object.hasOwn(overrides, name) ? (overrides[name] as number | string | boolean) : spec.default;
    if (typeof raw !== spec.type) {
      throw new RuleEvaluationError({
        code: 'CONTEXTE_INVALIDE',
        phase: 'evaluation',
        message: `Le paramètre « ${name} » de la règle « ${rule.key} » doit être de type ${spec.type}.`,
      });
    }
    if (typeof raw === 'number' && ((spec.min !== undefined && raw < spec.min) || (spec.max !== undefined && raw > spec.max))) {
      throw new RuleEvaluationError({
        code: 'DOMAINE_INVALIDE',
        phase: 'evaluation',
        message: `Le paramètre « ${name} » (${raw}) est hors de l'intervalle autorisé [${spec.min ?? '-∞'} ; ${spec.max ?? '+∞'}].`,
      });
    }
    params[name] = raw;
  }
  return { ...context, variables: { ...(context.variables ?? {}), params } };
}
