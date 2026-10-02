/**
 * Contrat `exam-national@1` — examens nationaux (module `examinations`).
 *
 * Référence fonctionnelle : specs/v2/018-examinations/rule-contract.md §2. AUCUNE règle d'examen officielle n'est écrite ici
 * (conditions d'éligibilité, épreuves, coefficients, seuil d'admission, mentions, taux de réussite) : les noms viennent du PRD,
 * les formules et seuils officiels sont inconnus. Pour un examen OFFICIEL l'admission est prononcée par l'autorité et importée
 * ou saisie ; le contrat sert à l'éligibilité, aux examens BLANCS et aux statistiques.
 */
import type { ContractRule, RuleContract } from "./types";
import { contractRule as rule } from "./builder";

export const EXAM_NATIONAL_ID = "exam-national@1";

export const EXAM_NATIONAL_RULES = {
  ELIGIBILITE: "eligibilite",
  MOTIF_ELIGIBILITE: "motif_eligibilite",
  NOTE_EPREUVE_SUR_20: "note_epreuve_sur_20",
  MOYENNE_CANDIDAT: "moyenne_candidat",
  RESULTAT_CANDIDAT: "resultat_candidat",
  MENTION_EXAMEN: "mention_examen",
  RANG_CANDIDAT: "rang_candidat",
  TAUX_REUSSITE: "taux_reussite",
  ARRONDI_AFFICHAGE: "arrondi_affichage",
} as const;

export const ELIGIBILITY_CODES = ["ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"] as const;
export const ELIGIBILITY_REASON_CODES = ["NONE", "NOT_IN_EXAM_GRADE", "AGE_NOT_MET", "DOCUMENTS_MISSING", "ATTEMPTS_EXCEEDED", "OTHER"] as const;
/** `DEFERRED` reste réservé à la saisie manuelle : le contrat l'admet mais le jeu fictif ne le produit pas. */
export const CANDIDATE_RESULT_CODES = ["ADMITTED", "FAILED", "ABSENT", "DEFERRED"] as const;
export const EXAM_MENTION_CODES = ["PENDING", "NONE", "PASSABLE", "FAIRLY_GOOD", "GOOD", "VERY_GOOD", "EXCELLENT"] as const;

const R = EXAM_NATIONAL_RULES;
const ELIGIBILITY_INPUTS = {
  variables: { en_classe_examen: "boolean", age_annees: "number?", annee_session: "number", pieces_completes: "boolean", nombre_tentatives: "number" },
} as const;

const rules: readonly ContractRule[] = Object.freeze([
  rule(R.ELIGIBILITE, "promotion", ELIGIBILITY_INPUTS, "string", "Un élève peut-il être candidat ? Les vraies conditions (âge, tentatives…) s'ajoutent comme expression de la version.", { outputCodes: ELIGIBILITY_CODES }),
  rule(R.MOTIF_ELIGIBILITE, "promotion", ELIGIBILITY_INPUTS, "string", "Premier motif bloquant de l'éligibilité (alimente la trace des vérifications).", { outputCodes: ELIGIBILITY_REASON_CODES }),
  rule(R.NOTE_EPREUVE_SUR_20, "grading_scale", { variables: { note: "number", bareme: "number" } }, "number", "Note d'épreuve ramenée sur 20."),
  rule(
    R.MOYENNE_CANDIDAT,
    "period_average",
    { variables: { epreuves: { list: { object: { note: "number?", coef: "number", bareme: "number", facultative: "boolean", absent: "boolean" } } } } },
    "number?",
    "Moyenne d'un candidat (examen blanc) : notes ramenées sur 20 pondérées par les coefficients ; épreuve absente selon `absence_vaut_zero` ; aucune épreuve notée ⇒ absente.",
  ),
  rule(
    R.RESULTAT_CANDIDAT,
    "promotion",
    { variables: { moyenne: "number?", epreuves_absentes: "number", epreuves_eliminatoires_echouees: "number" } },
    "string",
    "Issue d'un candidat d'examen blanc : admis, ajourné ou absent.",
    { outputCodes: CANDIDATE_RESULT_CODES },
  ),
  rule(R.MENTION_EXAMEN, "mention", { variables: { moyenne: "number?" } }, "string", "Mention de l'examen (les examens ont-ils des mentions ? question métier).", { optional: true, outputCodes: EXAM_MENTION_CODES }),
  rule(R.RANG_CANDIDAT, "ranking", { variables: { moyenne: "number?", cohorte: { list: "number?" } } }, "number?", "Rang de compétition dans la cohorte de la session."),
  rule(
    R.TAUX_REUSSITE,
    "period_average",
    { variables: { admis: "number", presents: "number", inscrits: "number" } },
    "number?",
    "Taux de réussite d'un groupe (en %, valeur exacte) : la définition officielle est inconnue, `denominateur` choisit présents ou inscrits ; dénominateur nul ⇒ absent.",
  ),
  rule(R.ARRONDI_AFFICHAGE, "rounding", { variables: { valeur: "number?" } }, "number?", "Arrondi d'AFFICHAGE seul."),
]);

export const examNationalContract: RuleContract = Object.freeze({
  id: EXAM_NATIONAL_ID,
  name: "Examens nationaux",
  description: "Éligibilité des candidats, moyenne, issue et rang d'un examen blanc, taux de réussite d'un groupe.",
  rules,
  pipeline: Object.freeze([
    { stage: "eligibilite", rules: [R.ELIGIBILITE, R.MOTIF_ELIGIBILITE], description: "Par candidat, à l'inscription et à chaque changement de dossier." },
    { stage: "candidat", rules: [R.NOTE_EPREUVE_SUR_20, R.MOYENNE_CANDIDAT, R.RESULTAT_CANDIDAT, R.MENTION_EXAMEN], description: "Examen blanc : note d'épreuve, moyenne, issue, mention." },
    { stage: "classement", rules: [R.RANG_CANDIDAT], description: "Deuxième phase : rang sur la cohorte de la session." },
    { stage: "statistiques", rules: [R.TAUX_REUSSITE, R.ARRONDI_AFFICHAGE], description: "Lecture : taux de réussite d'un groupe, valeurs d'affichage." },
  ]),
});
