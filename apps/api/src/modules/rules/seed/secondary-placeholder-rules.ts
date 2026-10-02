/**
 * Règles FICTIVES du secondaire (`CI-SECONDARY-PLACEHOLDER`).
 *
 * Référence : specs/v2/006-secondary/spec.md §6.4. Le jeu COPIE la forme et les valeurs de démonstration de
 * `CI-CLASSIC-SEMESTRE` v1 (pratique d'établissement du legacy) À TITRE D'EXEMPLE FONCTIONNEL UNIQUEMENT. Il n'invente AUCUNE
 * règle officielle (passage, redoublement, orientation, BEPC, BAC) et ne contient AUCUNE règle d'orientation : la décision
 * d'orientation est humaine, sans suggestion. Deux versions d'un même jeu, une par contrat :
 *   - v1 `coef-semester@1` (établissements à deux périodes) : copie de `coefSemesterRules`, marquée fictive ;
 *   - v2 `secondary-annual@1` (N périodes) : mêmes règles, `moyenne_annuelle` sur toutes les périodes pondérées et
 *     `decision_fin_annee` sur `derniere_periode`.
 */
import { coefSemesterRules } from "./coef-semester-rules";
import { labels } from "./helpers";
import type { SeedRule } from "./types";

const MARK = "(fictif) ";

const mark = (rules: readonly SeedRule[]): SeedRule[] => rules.map((r) => ({ ...r, description: `${MARK}${r.description}` }));

export const secondaryCoefSemesterPlaceholderRules: readonly SeedRule[] = Object.freeze(
  mark(coefSemesterRules).map((r) =>
    r.key === "decision_fin_annee"
      ? {
          ...r,
          labelMap: labels({
            PENDING: "Décision en attente (fictif)",
            EXAM_REFERRAL: "Renvoi à l'examen terminal (fictif)",
            PROMOTED: "Passage en classe supérieure (fictif)",
            REPEAT: "Redoublement (fictif)",
          }),
        }
      : r,
  ),
);

export const secondaryAnnualPlaceholderRules: readonly SeedRule[] = Object.freeze(
  mark(coefSemesterRules).map((r): SeedRule => {
    if (r.key === "moyenne_annuelle") {
      return {
        key: r.key,
        type: r.type,
        description: `${MARK}Moyenne des périodes notées de l'année pondérée par le poids de période (plan de périodes), pour un nombre quelconque de périodes.`,
        expression: "wavg(periodes.moyenne, periodes.poids)",
      };
    }
    if (r.key === "decision_fin_annee") {
      return {
        key: r.key,
        type: r.type,
        description: `${MARK}Décision de fin d'année (suggestion) : en attente sans moyenne ; renvoi à l'examen terminal à la dernière période quand il est requis ; sinon passage au seuil, redoublement en dessous.`,
        expression:
          'if(is_null(moyenne), "PENDING", if(derniere_periode && examen_terminal_requis, "EXAM_REFERRAL", if(moyenne >= params.passage, "PROMOTED", "REPEAT")))',
        ...(r.parameters ? { parameters: r.parameters } : {}),
        labelMap: labels({
          PENDING: "Décision en attente (fictif)",
          EXAM_REFERRAL: "Renvoi à l'examen terminal (fictif)",
          PROMOTED: "Passage en classe supérieure (fictif)",
          REPEAT: "Redoublement (fictif)",
        }),
      };
    }
    return r;
  }),
);
