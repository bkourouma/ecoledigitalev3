/**
 * Moteur de calcul des notes et moyennes — Module Professionnel (feature 030).
 *
 * Fonctions PURES (aucune I/O, aucune dépendance base) implémentant les
 * formules officielles de l'établissement :
 *
 *   Note ECUE     = moyenneDevoirs × 0,4 + noteExamen × 0,6
 *   Moyenne UE    = Σ(NoteECUE × créditsECUE) / Σ créditsECUE   (compensation)
 *   Moyenne Sess. = Σ(MoyenneUE × créditsUE) / Σ créditsUE
 *
 * Règles de validation :
 *   - ECUE validée si NoteECUE ≥ 10 (ou override manuel géré côté service).
 *   - Note éliminatoire : une NoteECUE < 5 bloque la validation de TOUTE l'UE
 *     (verrou), quelle que soit la moyenne de l'UE (pas de compensation).
 *   - UE validée si moyenneUE ≥ 10 ET aucune ECUE éliminatoire (< 5).
 *   - Semestre validé = 20 crédits acquis. Année supérieure = > 48 crédits.
 *
 * IMPORTANT : tous les tests de seuil (< 5, < 10) se font sur la valeur NON
 * arrondie. L'arrondi (`arrondi`) ne sert QU'À l'affichage.
 */

/* ----------------------------- Constantes ------------------------------ */

export const POIDS_DEVOIRS = 0.4;
export const POIDS_EXAMEN = 0.6;
export const SEUIL_VALIDATION = 10; // /20 — ECUE / UE validée
export const SEUIL_ELIMINATOIRE = 5; // NoteECUE < 5 → verrou, non compensable
export const SEMESTRE_CREDITS_REQUIS = 20;
export const ANNEE_SUP_CREDITS = 48; // strictement supérieur

/* ------------------------------ Types ---------------------------------- */

export type EcueStatut =
  | "valide" // NoteECUE ≥ 10
  | "compense" // 5 ≤ NoteECUE < 10, rattrapée par la compensation de l'UE
  | "insuffisant" // 5 ≤ NoteECUE < 10, UE non validée
  | "eliminatoire" // NoteECUE < 5 (verrou)
  | "en_cours"; // note incomplète (examen manquant)

export interface EcueInput {
  /** Moyenne (arithmétique simple) des devoirs, déjà ramenée sur /20. */
  moyenneDevoirs: number | null;
  /** Note d'examen /20 (une seule par ECUE/semestre). null si non saisie. */
  noteExamen: number | null;
  /** Crédits (UV) de l'ECUE. NULL/0 = poids nul dans la moyenne UE. */
  credits: number;
  /** Override manuel de validation (responsable) — force la validation ECUE. */
  validationManuelle?: boolean;
}

export interface EcueCalcule extends EcueInput {
  /** Note ECUE finale /20 (null tant que l'examen n'est pas saisi). */
  note: number | null;
  eliminee: boolean;
  validee: boolean;
  statut: EcueStatut;
}

export type MotifEchecUe = "NOTE_ELIMINATOIRE" | "MOYENNE_INSUFFISANTE" | "INCOMPLET";

export interface UeResultat {
  moyenne: number | null;
  validee: boolean;
  motifs: MotifEchecUe[];
  /** Σ des crédits des ECUE de l'UE (= crédits de l'UE pour la pondération). */
  credits: number;
  ecues: EcueCalcule[];
}

/* ---------------------------- Calculs de base -------------------------- */

/** Ramène une note brute sur l'échelle /20. */
export function normaliserNote(note: number, noteMax: number): number {
  if (!noteMax || noteMax <= 0) return 0;
  return (note / noteMax) * 20;
}

/** Moyenne arithmétique simple d'une liste de devoirs (déjà /20). */
export function moyenneDevoirs(devoirs: number[]): number | null {
  if (devoirs.length === 0) return null;
  return devoirs.reduce((s, n) => s + n, 0) / devoirs.length;
}

/**
 * Note d'une ECUE : moyenneDevoirs × 0,4 + noteExamen × 0,6.
 * - Sans examen → null (ECUE non calculable, en attente).
 * - Sans devoir mais avec examen → moyenneDevoirs traitée comme 0 (le continu
 *   compte pour 0). Décision d'implémentation par défaut.
 */
export function noteEcue(moyDevoirs: number | null, noteExamen: number | null): number | null {
  if (noteExamen == null) return null;
  const dev = moyDevoirs == null ? 0 : moyDevoirs;
  return dev * POIDS_DEVOIRS + noteExamen * POIDS_EXAMEN;
}

/* --------------------------- Évaluation ECUE --------------------------- */

/** Calcule note + statut d'une ECUE (hors contexte UE). */
export function evaluerEcue(e: EcueInput): EcueCalcule {
  const note = noteEcue(e.moyenneDevoirs, e.noteExamen);
  const eliminee = note != null && note < SEUIL_ELIMINATOIRE;
  const autoValide = note != null && note >= SEUIL_VALIDATION;
  const validee = autoValide || e.validationManuelle === true;
  let statut: EcueStatut;
  if (note == null) statut = "en_cours";
  else if (eliminee) statut = "eliminatoire";
  else if (validee) statut = "valide";
  else statut = "insuffisant"; // 5 ≤ note < 10, statut affiné au niveau UE
  return { ...e, note, eliminee, validee, statut };
}

/* ---------------------------- Moyenne UE ------------------------------- */

/**
 * Moyenne pondérée d'une UE par les crédits des ECUE, sur les ECUE ayant une
 * note. null si aucune ECUE calculée. (Valeur NON arrondie.)
 */
export function moyenneUe(ecues: EcueCalcule[]): number | null {
  let somme = 0;
  let credits = 0;
  for (const e of ecues) {
    if (e.note == null) continue;
    const c = e.credits > 0 ? e.credits : 0;
    somme += e.note * c;
    credits += c;
  }
  if (credits === 0) return null;
  return somme / credits;
}

/**
 * Évalue une UE : moyenne + validation avec compensation et verrou
 * éliminatoire. Renseigne le statut définitif de chaque ECUE (compense vs
 * insuffisant selon que l'UE est validée).
 */
export function evaluerUe(inputs: EcueInput[]): UeResultat {
  const ecues = inputs.map(evaluerEcue);
  const moyenne = moyenneUe(ecues);
  const credits = ecues.reduce((s, e) => s + (e.credits > 0 ? e.credits : 0), 0);

  const motifs: MotifEchecUe[] = [];
  // Une ECUE éliminatoire rescapée par une validation manuelle ne verrouille
  // plus l'UE.
  const aEliminatoire = ecues.some((e) => e.eliminee && !e.validee);
  const incomplet = ecues.some((e) => e.note == null);

  if (aEliminatoire) motifs.push("NOTE_ELIMINATOIRE");
  if (moyenne == null || moyenne < SEUIL_VALIDATION) motifs.push("MOYENNE_INSUFFISANTE");
  if (incomplet) motifs.push("INCOMPLET");

  // Validation : moyenne ≥ 10, aucune éliminatoire, toutes les ECUE calculées.
  const validee =
    moyenne != null && moyenne >= SEUIL_VALIDATION && !aEliminatoire && !incomplet;

  // Statut définitif des ECUE : une ECUE 5≤note<10 est « compensée » si l'UE
  // est validée, sinon « insuffisante ».
  for (const e of ecues) {
    if (e.note == null || e.eliminee || e.note >= SEUIL_VALIDATION) continue;
    e.statut = validee ? "compense" : "insuffisant";
  }

  return { moyenne, validee, motifs, credits, ecues };
}

/* -------------------------- Moyenne de session ------------------------- */

export interface UePondere {
  moyenne: number | null;
  credits: number;
  validee: boolean;
}

/** Moyenne d'une session : Σ(moyenneUE × créditsUE) / Σ créditsUE. */
export function moyenneSession(ues: UePondere[]): number | null {
  let somme = 0;
  let credits = 0;
  for (const u of ues) {
    if (u.moyenne == null) continue;
    const c = u.credits > 0 ? u.credits : 0;
    somme += u.moyenne * c;
    credits += c;
  }
  if (credits === 0) return null;
  return somme / credits;
}

/** Total des crédits (UV) validés = Σ créditsUE des UE validées. */
export function creditsValides(ues: UePondere[]): number {
  return ues.filter((u) => u.validee).reduce((s, u) => s + (u.credits > 0 ? u.credits : 0), 0);
}

/** Total des crédits (UV) engagés = Σ créditsUE. */
export function creditsTotal(ues: UePondere[]): number {
  return ues.reduce((s, u) => s + (u.credits > 0 ? u.credits : 0), 0);
}

/** Un semestre est validé si ≥ 20 crédits sont acquis. */
export function semestreValide(credits: number): boolean {
  return credits >= SEMESTRE_CREDITS_REQUIS;
}

/** Passage en année supérieure : strictement plus de 48 crédits. */
export function peutPasserAnneeSuperieure(creditsTotalAnnee: number): boolean {
  return creditsTotalAnnee > ANNEE_SUP_CREDITS;
}

/* ------------------------------ Affichage ------------------------------ */

/** Arrondi à 2 décimales — UNIQUEMENT pour l'affichage, jamais pour un seuil. */
export function arrondi(x: number | null): number | null {
  if (x == null) return null;
  return Math.round(x * 100) / 100;
}
