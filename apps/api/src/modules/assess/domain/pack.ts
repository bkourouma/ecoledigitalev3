/**
 * Modèles de pack des types d'évaluation (DONNÉES instanciées au provisioning, PRD §17, data-model §1.1).
 * Les `aggregationGroup` sont des données du tenant : les règles et le module `results` les lisent ; aucun type n'est
 * câblé en code (le legacy figeait `["devoir","controle","examen","projet","qcm","autre"]`).
 */
import type { PublicationMode } from "./types";

export interface TypeTemplate {
  readonly code: string;
  readonly label: string;
  readonly aggregationGroup: string;
  readonly defaultScaleMax: string;
  readonly defaultWeight: string;
  readonly publicationMode: PublicationMode;
  readonly visibleToStudents: boolean;
  readonly allowsSession2: boolean;
  readonly position: number;
}

export type PackTemplateKey = "classic" | "higher";

const t = (position: number, code: string, label: string, aggregationGroup: string, extra: Partial<Omit<TypeTemplate, "code" | "label" | "aggregationGroup" | "position">> = {}): TypeTemplate => ({
  code,
  label,
  aggregationGroup,
  defaultScaleMax: "20",
  defaultWeight: "1",
  publicationMode: "MANUAL",
  visibleToStudents: true,
  allowsSession2: false,
  position,
  ...extra,
});

export const PACK_TYPE_TEMPLATES: Readonly<Record<PackTemplateKey, readonly TypeTemplate[]>> = Object.freeze({
  // primaire / secondaire (pile « classique »)
  classic: Object.freeze([
    t(10, "INTERROGATION", "Interrogation", "CONTINUOUS"),
    t(20, "DEVOIR", "Devoir", "CONTINUOUS"),
    t(30, "COMPOSITION", "Composition", "EXAM"),
    t(40, "EXAMEN_BLANC", "Examen blanc", "EXAM", { visibleToStudents: false }),
    t(50, "PROJET", "Projet", "PROJECT"),
    t(60, "ORAL", "Oral", "ORAL"),
    t(70, "TP", "Travaux pratiques", "PRACTICAL"),
    t(80, "AUTRE", "Autre", "OTHER"),
    // Q-35 : moyenne saisie par matière = une NOTE ordinaire, soumise au même circuit de validation
    t(90, "MOYENNE_SAISIE", "Moyenne saisie", "ENTERED_AVERAGE"),
  ]),
  // supérieur à crédits (UE / ECUE) : contrôle continu et examen avec rattrapage
  higher: Object.freeze([
    t(10, "DEVOIR", "Devoir", "CONTINUOUS"),
    t(20, "EXAMEN", "Examen", "EXAM", { allowsSession2: true }),
    t(30, "TP", "Travaux pratiques", "CONTINUOUS"),
    t(40, "PROJET", "Projet", "CONTINUOUS"),
  ]),
});

/** Pack de modèles pour un pack produit (`PRIMARY`, `SECONDARY`, `HIGHER`, `VIRTUAL`). */
export function templateKeyForPack(pack: string | null | undefined): PackTemplateKey {
  return pack === "HIGHER" ? "higher" : "classic";
}
