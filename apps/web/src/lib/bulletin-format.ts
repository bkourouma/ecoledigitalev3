/**
 * Helpers de mise en forme du relevé de notes (bulletin) — partagés entre
 * l'affichage HTML (BulletinView) et l'export Word (bulletin-docx).
 */

export const MINISTERE = "Ministère de l'Enseignement Supérieur\net de la Recherche Scientifique";
export const REPUBLIQUE = "République de Côte d'Ivoire\nUnion – Discipline – Travail";
export const INSTITUT = "INSTITUT POLYVALENT DES AFFAIRES ET DU MANAGEMENT";
export const INSTITUT_SIGLE = "IPAM";
export const DECISION_TITRE = "Décision finale";
export const VISA_DIRECTEUR = "Visa le Directeur des Études";

/**
 * Introduction du jury : la date de délibération est la date de génération du
 * document (date du jour), au format « 4 Juillet 2026 ».
 */
export function juryIntro(date: Date = new Date()): string {
  const d = date
    .toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    .replace(/ ([a-zà-ú])/i, (m) => m.toUpperCase());
  return `Le Jury d'examen, vu le procès-verbal de délibération en date du ${d}, déclare que l'étudiant(e) :`;
}

/** Textes du jury / délibération affichés sur le relevé. */
export const JURY_RESULTATS =
  "a obtenu, après l'évaluation de ses connaissances, les notes et les résultats suivants.";
export const JURY_NB = "NB : La décision s'obtient par rapport au total des crédits obtenus.";
export const FOOTER_NOTE =
  "Il ne peut être délivré qu'un seul exemplaire du présent relevé de notes. En cas de perte, un duplicata doit être justifié auprès du service des examens IPAM.";
export const FOOTER_ADDRESS =
  "Siège : Abidjan – Cocody, II Plateaux.  Tél. : (225) 27 22-25-49-31  Fax (225) 07-04-63-83-36\n06 BP 2708 Abidjan 06 Côte d'Ivoire   www.ipam.ci / e-mail : info@ipam.ci";

/** « masculin » → « Masculin ». Défaut « Masculin » (comportement de l'app). */
export function genreLabel(g: string | null | undefined): string {
  return g === "feminin" ? "Féminin" : "Masculin";
}

/** Logos (dossier public). */
export const LOGO_INSTITUT = "/logo-ipam.jpeg";
export const LOGO_EMBLEME = "/embleme.png";

/** Palette institutionnelle IPAM (vert). */
export const IPAM_GREEN = "#14532D"; // vert foncé (en-têtes, titres)
export const IPAM_GREEN_LIGHT = "#E8F0EB"; // vert très pâle (zébrage, bandeaux)
export const IPAM_GREEN_RGB: [number, number, number] = [20, 83, 45];
export const IPAM_GREEN_LIGHT_RGB: [number, number, number] = [232, 240, 235];
export const OK_GREEN = "#15803D";
export const BAD_RED = "#B91C1C";

/** Libellés des catégories d'UE (bandeaux du bulletin). */
export const CATEGORIE_LABEL: Record<string, string> = {
  fondamentale: "UNITÉS FONDAMENTALES",
  specialite: "UNITÉS DE SPÉCIALITÉ",
  culture_generale: "UNITÉS DE CULTURE GÉNÉRALE",
  _autres: "AUTRES UNITÉS",
};

/** Note formatée à 2 décimales, virgule française. */
export function fmtNote(x: number | null | undefined): string {
  if (x == null) return "—";
  return Number(x).toFixed(2).replace(".", ",");
}

/** Appréciation académique standard à partir d'une moyenne /20. */
export function appreciation(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m < 10) return "Insuffisant";
  if (m < 12) return "Passable";
  if (m < 14) return "Assez Bien";
  if (m < 16) return "Bien";
  if (m < 18) return "Très Bien";
  return "Excellent";
}

/** Grade dérivé de la filière (« LICENCE » / « MASTER » / « BTS »). */
export function gradeOf(filiereName: string | null | undefined): string {
  const s = String(filiereName ?? "");
  if (/licence/i.test(s)) return "LICENCE";
  if (/master/i.test(s)) return "MASTER";
  if (/bts/i.test(s)) return "BTS";
  if (/doctorat/i.test(s)) return "DOCTORAT";
  return "—";
}

/** Libellé de la décision finale. */
export function decisionLabel(d: string | null | undefined): string {
  switch (d) {
    case "admis":
      return "ADMIS";
    case "rattrapage":
      return "RATTRAPAGE";
    default:
      return "AJOURNÉ";
  }
}

/** Décision par UE. */
export function ueDecision(validee: boolean): string {
  return validee ? "Validé(e)" : "Non validée";
}

/** Libellé de l'état LMD d'une UE : validée / rattrapage / dette. */
export function ueEtatLabel(etat: string | null | undefined): string {
  switch (etat) {
    case "validee":
      return "Validé(e)";
    case "rattrapage":
      return "Rattrapage (S2)";
    case "dette":
      return "En dette";
    default:
      return "Non validée";
  }
}

/** Couleur (hex) de l'état d'une UE. */
export function ueEtatColor(etat: string | null | undefined): string {
  if (etat === "validee") return OK_GREEN;
  if (etat === "rattrapage") return "#B45309"; // ambre
  return BAD_RED;
}

/** Statut LMD de l'étudiant sur le semestre. */
export function statutEtudiantLabel(s: string | null | undefined): string {
  switch (s) {
    case "valide":
      return "Validé";
    case "session2":
      return "Non validé — Session 2";
    case "dette":
      return "En dette";
    default:
      return "—";
  }
}

/** « Session 1 » / « Session 2 » depuis le numéro (1|2). Null → « — ». */
export function sessionLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  return `Session ${n}`;
}

/** « Semestre 1 » → « S1 ». */
export function semShort(libelle: string | null | undefined): string {
  const m = String(libelle ?? "").match(/(\d+)/);
  return m ? `S${m[1]}` : String(libelle ?? "—");
}

/** « Semestre 1 » → « RELEVE DE NOTES SEMESTRE 1 » (titre encadré). */
export function releveSemestreTitre(libelle: string | null | undefined): string {
  const m = String(libelle ?? "").match(/(\d+)/);
  return `RELEVE DE NOTES SEMESTRE ${m ? m[1] : ""}`.trim();
}

/** « Semestre 1 » → « 1ER SEMESTRE » (titre). */
export function semestreOrdinalFr(libelle: string | null | undefined): string {
  const m = String(libelle ?? "").match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : null;
  if (!n) return String(libelle ?? "SEMESTRE").toUpperCase();
  return `${n === 1 ? "1ER" : `${n}E`} SEMESTRE`;
}

/** « Semestre 1 » → « 1er Semestre ». */
export function semestreLabelShort(libelle: string | null | undefined): string {
  const m = String(libelle ?? "").match(/(\d+)/);
  const n = m ? parseInt(m[1], 10) : null;
  if (!n) return String(libelle ?? "Semestre");
  return `${n === 1 ? "1er" : `${n}e`} Semestre`;
}

/** Niveau dérivé du nom de la filière (« LICENCE 1 … » → « Licence 1 »). */
export function niveauOf(filiereName: string | null | undefined): string {
  const s = String(filiereName ?? "");
  const lic = s.match(/licence\s*(\d)/i);
  if (lic) return `Licence ${lic[1]}`;
  const mas = s.match(/master\s*(\d)/i);
  if (mas) return `Master ${mas[1]}`;
  if (/bts/i.test(s)) return "BTS";
  return "—";
}

/**
 * Appréciation générale du conseil (phrase libre pour le visa), reprend le
 * libellé déjà utilisé côté « moyennes semestre » (semester-averages.ts).
 */
export function appreciationGenerale(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m < 8) return "Travail insuffisant.";
  if (m < 10) return "Travail fragile.";
  if (m < 12) return "Travail passable.";
  if (m < 14) return "Travail assez bon.";
  if (m < 16) return "Bon travail.";
  if (m < 18) return "Très bon travail.";
  return "Excellent travail.";
}

/** Vrai si la filière est une Licence 1 ou Licence 2 (seules éligibles au bulletin BTS). */
export function isLicenceUnOuDeux(filiereName: string | null | undefined): boolean {
  return /licence\s*[12]\b/i.test(String(filiereName ?? ""));
}

/*
 * Identité imprimée sur le bulletin de mise en page « BTS ».
 *
 * Les Licence 1 et 2 utilisent volontairement ce gabarit : c'est une MISE EN
 * PAGE, pas un diplôme. Les anciens helpers en tiraient pourtant l'identité du
 * titulaire — « Spécialité BTS GENIE LOGICIEL », « Niveau BTS 1 » — pour un
 * étudiant inscrit en Licence. La forme du document avait déteint sur ce qu'il
 * atteste. Ces deux fonctions impriment le niveau et la spécialité réels.
 */

/** Spécialité réelle : « LICENCE 1 GENIE LOGICIEL » → « GENIE LOGICIEL » (casse d'origine). */
export function specialiteBulletin(filiereName: string | null | undefined): string {
  const raw = String(filiereName ?? "").trim();
  const sansGrade = raw.replace(/^\s*(licence|master|bts|doctorat)\s*\d*\s*/i, "").trim();
  return sansGrade || raw || "—";
}

/** Niveau réel : « LICENCE 1 … » → « LICENCE 1 ». */
export function niveauBulletin(filiereName: string | null | undefined): string {
  const m = String(filiereName ?? "").match(/\b(licence|master|bts|doctorat)\s*(\d)/i);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : gradeOf(filiereName);
}

/** Rang français : 1 → « 1er », n → « nème ». null → « — ». */
export function rangLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  return n === 1 ? "1er" : `${n}ème`;
}

/** Date « 25 Janvier 1998 » à partir d'une date ISO. */
export function fmtDateLongFr(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const s = d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return s.replace(/ ([a-zà-ú])/i, (m) => m.toUpperCase());
}
