/**
 * RuleSets de référence, portage des formules ACTUELLES de l'application :
 *  - BTS / LMD : apps/api/src/services/bulletin-calc.ts
 *  - pile classique : apps/api/src/routes/semester-averages.ts
 * Servent de base aux golden tests.
 */
import { RuleSetSchema, RuleVersionSchema, type RuleDefinition, type RuleSchemaSpec, type RuleSet, type RuleVersion } from '../../src';

/* -------------------------------- BTS / LMD ------------------------------- */

const ECUE_SCHEMA: RuleSchemaSpec = {
  variables: { moyenne_devoirs: 'number?', note_examen: 'number?' },
};

const ECUE_STATUT_SCHEMA: RuleSchemaSpec = {
  variables: { note: 'number?', validation_manuelle: 'boolean' },
};

const ECUE_FINAL_SCHEMA: RuleSchemaSpec = {
  variables: { note: 'number?', ue_validee: 'boolean' },
};

const UE_SCHEMA: RuleSchemaSpec = {
  variables: {
    moyenne: 'number?',
    ecues: { list: { object: { note: 'number?', credits: 'number', validation_manuelle: 'boolean' } } },
  },
};

const SESSION_SCHEMA: RuleSchemaSpec = {
  variables: {
    ues: { list: { object: { moyenne: 'number?', credits: 'number', validee: 'boolean' } } },
  },
};

const THRESHOLDS = {
  seuil_validation: { type: 'number', default: 10, min: 0, max: 20, description: 'Note /20 à partir de laquelle une ECUE / UE est validée' },
  seuil_eliminatoire: { type: 'number', default: 5, min: 0, max: 20, description: 'Une note ECUE strictement inférieure bloque toute l\'UE' },
} as const;

export const BTS_LMD_RULES: RuleDefinition[] = [
  {
    key: 'note_ecue',
    type: 'assessment_aggregation',
    description: 'Note ECUE = moyenne des devoirs × 0,4 + examen × 0,6 (devoirs absents = 0 ; sans examen : pas de note)',
    expression:
      'if(is_null(note_examen), null, coalesce(moyenne_devoirs, 0) * params.poids_devoirs + note_examen * params.poids_examen)',
    parameters: {
      poids_devoirs: { type: 'number', default: 0.4, min: 0, max: 1 },
      poids_examen: { type: 'number', default: 0.6, min: 0, max: 1 },
    },
    inputSchema: ECUE_SCHEMA,
    result: 'number?',
  },
  {
    key: 'ecue_eliminee',
    type: 'eliminatory_grade',
    description: 'Note ECUE strictement inférieure à 5 (testée sur la valeur NON arrondie)',
    expression: '!is_null(note) && note < params.seuil_eliminatoire',
    parameters: { seuil_eliminatoire: THRESHOLDS.seuil_eliminatoire },
    inputSchema: ECUE_STATUT_SCHEMA,
    result: 'boolean',
  },
  {
    key: 'ecue_validee',
    type: 'credit_validation',
    description: 'ECUE validée si note ≥ 10 (valeur non arrondie) ou validation manuelle',
    expression: '(!is_null(note) && note >= params.seuil_validation) || validation_manuelle',
    parameters: { seuil_validation: THRESHOLDS.seuil_validation },
    inputSchema: ECUE_STATUT_SCHEMA,
    result: 'boolean',
  },
  {
    key: 'moyenne_ue',
    type: 'period_average',
    description: 'Moyenne UE = Σ(note ECUE × crédits ECUE) / Σ crédits, sur les ECUE notées',
    expression: 'wavg(ecues.note, ecues.credits)',
    inputSchema: UE_SCHEMA,
    result: 'number?',
  },
  {
    key: 'credits_ue',
    type: 'credit_validation',
    description: 'Crédits de l\'UE = Σ crédits des ECUE',
    expression: 'sum(ecues.credits)',
    inputSchema: UE_SCHEMA,
    result: 'number',
  },
  {
    key: 'ue_validee',
    type: 'credit_validation',
    description:
      'UE validée si moyenne ≥ 10 (non arrondie), aucune ECUE éliminatoire non rattrapée par validation manuelle, toutes les ECUE notées',
    expression:
      '!is_null(moyenne) && moyenne >= params.seuil_validation' +
      ' && !any(ecues, e => !is_null(e.note) && e.note < params.seuil_eliminatoire && !e.validation_manuelle)' +
      ' && !any(ecues, e => is_null(e.note))',
    parameters: { seuil_validation: THRESHOLDS.seuil_validation, seuil_eliminatoire: THRESHOLDS.seuil_eliminatoire },
    inputSchema: UE_SCHEMA,
    result: 'boolean',
  },
  {
    key: 'statut_ecue',
    type: 'compensation',
    description: 'Statut final d\'une ECUE : une ECUE entre 5 et 10 est « compensée » si l\'UE est validée',
    expression:
      'if(is_null(note), "en_cours", if(note < params.seuil_eliminatoire, "eliminatoire", ' +
      'if(note >= params.seuil_validation, "valide", if(ue_validee, "compense", "insuffisant"))))',
    parameters: { seuil_validation: THRESHOLDS.seuil_validation, seuil_eliminatoire: THRESHOLDS.seuil_eliminatoire },
    inputSchema: ECUE_FINAL_SCHEMA,
    result: 'string',
  },
  {
    key: 'moyenne_session',
    type: 'period_average',
    description: 'Moyenne de session = Σ(moyenne UE × crédits UE) / Σ crédits UE',
    expression: 'wavg(ues.moyenne, ues.credits)',
    inputSchema: SESSION_SCHEMA,
    result: 'number?',
  },
  {
    key: 'credits_valides',
    type: 'credit_validation',
    description: 'Crédits acquis = Σ crédits des UE validées',
    expression: 'sum(map(filter(ues, u => u.validee), u => u.credits))',
    inputSchema: SESSION_SCHEMA,
    result: 'number',
  },
  {
    key: 'credits_total',
    type: 'credit_validation',
    description: 'Crédits engagés = Σ crédits des UE',
    expression: 'sum(ues.credits)',
    inputSchema: SESSION_SCHEMA,
    result: 'number',
  },
  {
    key: 'semestre_valide',
    type: 'promotion',
    description: 'Un semestre est validé si au moins 20 crédits sont acquis',
    expression: 'credits >= params.credits_requis',
    parameters: { credits_requis: { type: 'number', default: 20, min: 0 } },
    inputSchema: { variables: { credits: 'number' } },
    result: 'boolean',
  },
  {
    key: 'passage_annee_superieure',
    type: 'promotion',
    description: 'Passage en année supérieure : strictement plus de 48 crédits',
    expression: 'credits > params.credits_exclusifs',
    parameters: { credits_exclusifs: { type: 'number', default: 48, min: 0 } },
    inputSchema: { variables: { credits: 'number' } },
    result: 'boolean',
  },
  {
    key: 'arrondi_affichage',
    type: 'rounding',
    description: 'Arrondi à 2 décimales, UNIQUEMENT pour l\'affichage (jamais pour un seuil)',
    expression: 'if(is_null(valeur), null, round_half_up(valeur, 2))',
    inputSchema: { variables: { valeur: 'number?' } },
    result: 'number?',
  },
];

/* ---------------------------- pile classique ------------------------------ */

export const CLASSIQUE_RULES: RuleDefinition[] = [
  {
    key: 'moyenne_ponderee',
    type: 'period_average',
    description: 'Moyenne pondérée par coefficient sur les matières notées',
    expression: 'wavg(matieres.score, matieres.coef)',
    inputSchema: { variables: { matieres: { list: { object: { score: 'number?', coef: 'number' } } } } },
    result: 'number?',
  },
  {
    key: 'moyenne_annuelle',
    type: 'annual_average',
    description: 'Moyenne annuelle = (S1 + 2 × S2) / 3 au 2e semestre quand S1 et S2 existent ; sinon moyenne du semestre',
    expression:
      'if(second_semestre && !is_null(s1) && !is_null(s2), ' +
      '(s1 * params.poids_s1 + s2 * params.poids_s2) / (params.poids_s1 + params.poids_s2), s2)',
    parameters: {
      poids_s1: { type: 'number', default: 1, min: 0 },
      poids_s2: { type: 'number', default: 2, min: 0 },
    },
    inputSchema: { variables: { s1: 'number?', s2: 'number?', second_semestre: 'boolean' } },
    result: 'number?',
  },
  {
    key: 'mention',
    type: 'mention',
    description: 'Mention par seuils 16 / 14 / 12 / 10 / 8',
    expression:
      'if(is_null(moyenne), "En attente", ' +
      'if(moyenne >= params.excellent, "Excellent", ' +
      'if(moyenne >= params.tres_bien, "Très bien", ' +
      'if(moyenne >= params.bien, "Bien", ' +
      'if(moyenne >= params.assez_bien, "Assez bien", ' +
      'if(moyenne >= params.passable, "Passable", "Insuffisant"))))))',
    parameters: {
      excellent: { type: 'number', default: 16 },
      tres_bien: { type: 'number', default: 14 },
      bien: { type: 'number', default: 12 },
      assez_bien: { type: 'number', default: 10 },
      passable: { type: 'number', default: 8 },
    },
    inputSchema: { variables: { moyenne: 'number?' } },
    result: 'string',
  },
  {
    key: 'decision_conseil',
    type: 'promotion',
    description: 'Décision du conseil de période',
    expression:
      'if(is_null(moyenne), "Notes incompletes", if(moyenne >= params.validation, "Periode validee", ' +
      'if(moyenne >= params.renforcement, "Renforcement recommande", "Periode non validee")))',
    parameters: {
      validation: { type: 'number', default: 10 },
      renforcement: { type: 'number', default: 8 },
    },
    inputSchema: { variables: { moyenne: 'number?' } },
    result: 'string',
  },
  {
    key: 'decision_fin_annee',
    type: 'repetition',
    description: 'Décision de fin d\'année (passage / redoublement ; BTS 2e année : renvoi à l\'examen)',
    expression:
      'if(is_null(moyenne), "Décision en attente", ' +
      'if(second_semestre && bts_deuxieme_annee, "Redouble en cas d\'échec au BTS", ' +
      'if(moyenne >= params.passage, "Admis(e) en année supérieure", "Redoublement")))',
    parameters: { passage: { type: 'number', default: 10 } },
    inputSchema: { variables: { moyenne: 'number?', second_semestre: 'boolean', bts_deuxieme_annee: 'boolean' } },
    result: 'string',
  },
  {
    key: 'distinction',
    type: 'mention',
    description: 'Distinctions de fin d\'année (tableau d\'honneur)',
    expression:
      'if(is_null(moyenne), "", if(moyenne >= params.felicitations, "Tableau d\'honneur + félicitations", ' +
      'if(moyenne >= params.encouragement, "Tableau d\'honneur + Encouragement", ' +
      'if(moyenne >= params.honneur, "Tableau d\'honneur", ""))))',
    parameters: {
      felicitations: { type: 'number', default: 17 },
      encouragement: { type: 'number', default: 15 },
      honneur: { type: 'number', default: 12 },
    },
    inputSchema: { variables: { moyenne: 'number?' } },
    result: 'string',
  },
  {
    key: 'rang',
    type: 'ranking',
    description: 'Classement de compétition (ex æquo partagés), égalité jugée à 4 décimales',
    expression: 'rank(moyenne, cohorte, 4)',
    inputSchema: { variables: { moyenne: 'number?', cohorte: { list: 'number?' } } },
    result: 'number?',
  },
];

/* -------------------------------- versions -------------------------------- */

export function makeVersion(partial: Partial<RuleVersion> & Pick<RuleVersion, 'id' | 'ruleSetId' | 'rules'>): RuleVersion {
  return RuleVersionSchema.parse({
    version: 1,
    status: 'published',
    effectiveFrom: '2024-09-01',
    effectiveTo: null,
    source: { kind: 'platform', description: 'Portage des formules historiques' },
    ...partial,
  });
}

export const btsLmdVersion: RuleVersion = makeVersion({
  id: 'ver-bts-lmd-1',
  ruleSetId: 'rs-bts-lmd',
  rules: BTS_LMD_RULES,
  source: { kind: 'platform', reference: 'apps/api/src/services/bulletin-calc.ts', description: 'BTS / LMD (feature 030)' },
});

export const classiqueVersion: RuleVersion = makeVersion({
  id: 'ver-classique-1',
  ruleSetId: 'rs-classique',
  rules: CLASSIQUE_RULES,
  source: { kind: 'platform', reference: 'apps/api/src/routes/semester-averages.ts', description: 'Pile classique' },
});

export const btsLmdRuleSet: RuleSet = RuleSetSchema.parse({
  id: 'rs-bts-lmd',
  code: 'BTS_LMD',
  name: 'BTS / LMD — ECUE, UE, crédits',
  scope: { kind: 'national' },
  countryCode: 'CI',
  educationSystem: 'HIGHER',
  versions: [btsLmdVersion],
});

export const classiqueRuleSet: RuleSet = RuleSetSchema.parse({
  id: 'rs-classique',
  code: 'CLASSIQUE',
  name: 'Pile classique — moyennes pondérées, mentions',
  scope: { kind: 'national' },
  countryCode: 'CI',
  educationSystem: 'SECONDARY',
  versions: [classiqueVersion],
});
