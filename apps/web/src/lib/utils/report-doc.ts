/**
 * Modèle de rapport commun aux exports PDF et Word de l'application.
 *
 * Un rapport est décrit ici comme une simple structure de données (titre,
 * métadonnées, suite de blocs) ; `report-pdf.ts` et `report-docx.ts` savent la
 * dessiner. Les deux documents partent donc du même contenu et portent la même
 * charte : en-tête institutionnel sur la première page, titre encadré vert,
 * tableaux à en-tête vert et lignes zébrées, pied de page avec l'adresse du
 * siège et la pagination.
 *
 * Ajouter un export à un écran revient à construire un `ReportSpec` : aucune
 * mise en page à réécrire.
 */

export type ReportAlign = "left" | "center" | "right";

export interface ReportColumn {
  header: string;
  /** Largeur en millimètres. Omise, la colonne se partage la place restante. */
  width?: number;
  align?: ReportAlign;
}

export interface ReportTable {
  columns: ReportColumn[];
  /** Lignes de cellules déjà formatées en texte. */
  rows: string[][];
  /** Ligne de synthèse en pied de tableau (totaux). */
  footer?: string[];
}

export type ReportBlock =
  /** Titre de section (niveau 1) ou sous-section (niveau 2). */
  | { kind: "heading"; text: string; level?: 1 | 2; note?: string }
  /** Bloc d'informations « Libellé : valeur », réparties sur `columns` colonnes. */
  | { kind: "keyValues"; items: Array<[string, string]>; columns?: 1 | 2 | 3 }
  | { kind: "table"; table: ReportTable }
  /** Paragraphe en italique gris (mention, absence de données…). */
  | { kind: "note"; text: string }
  | { kind: "pageBreak" };

export interface ReportSpec {
  /** Titre encadré, sous le nom de l'institut. */
  title: string;
  /** Précision affichée sous le titre (filière, période, filtres appliqués…). */
  subtitle?: string;
  /** Mentions encadrant le filet vert : date d'édition à gauche, effectif à droite. */
  metaLeft?: string;
  metaRight?: string;
  orientation?: "landscape" | "portrait";
  /** Nom de fichier, sans extension. */
  filename: string;
  blocks: ReportBlock[];
}

/* ------------------------------ Mise en page ---------------------------- */

/** Dimensions A4 en millimètres, selon l'orientation. */
export function pageSize(orientation: "landscape" | "portrait" = "landscape") {
  return orientation === "portrait" ? { w: 210, h: 297 } : { w: 297, h: 210 };
}

export const PAGE_MARGIN_MM = 12;
/** Hauteur réservée à l'en-tête institutionnel (première page uniquement). */
export const HEADER_H_MM = 56;
/** Marge haute des pages suivantes : le contenu y reprend directement. */
export const CONTINUATION_TOP_MM = 14;
/** Hauteur réservée au pied de page (adresse + pagination). */
export const FOOTER_H_MM = 20;

/** Laize utile pour une orientation donnée. */
export function usableWidth(orientation: "landscape" | "portrait" = "landscape"): number {
  return pageSize(orientation).w - 2 * PAGE_MARGIN_MM;
}

/**
 * Largeurs définitives des colonnes, en millimètres : les largeurs fournies
 * sont conservées, les autres se partagent la place restante. Le total occupe
 * toujours exactement la laize utile, pour que PDF et Word se superposent.
 */
export function resolveWidths(columns: ReportColumn[], usable: number): number[] {
  const fixed = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  const libres = columns.filter((c) => c.width == null).length;
  if (libres === 0) {
    // Largeurs toutes imposées : on les met à l'échelle si elles ne tombent pas juste.
    const facteur = fixed > 0 ? usable / fixed : 1;
    return columns.map((c) => (c.width ?? 0) * facteur);
  }
  const reste = Math.max(usable - fixed, libres * 15);
  const part = reste / libres;
  return columns.map((c) => c.width ?? part);
}

/* ------------------------------- Formatage ------------------------------ */

/** Date du jour en toutes lettres : « 20 août 2026 ». */
export function dateEdition(d: Date = new Date()): string {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/** Suffixe de nom de fichier : « 2026-08-20 ». */
export function stampFichier(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Texte prêt à être dessiné dans un PDF.
 *
 * `toLocaleString("fr-FR")` sépare les milliers par une espace insécable
 * ÉTROITE (U+202F) que les polices standard de jsPDF ne savent pas encoder : le
 * glyphe sort faux (« 75/000 ») et, comme ce n'est pas une espace ordinaire, le
 * texte ne peut plus être coupé — il déborde de sa cellule au lieu de passer à
 * la ligne. Même piège avec l'insécable normale (U+00A0), qu'on récupère des
 * saisies utilisateur ou des libellés venus de l'API.
 *
 * Toute chaîne dessinée passe donc par ici.
 */
/** Espaces qu'aucune police standard de jsPDF n'encode : insécable, chiffre, fine, insécable étroite. */
const ESPACES_EXOTIQUES = /[\u00a0\u2007\u2009\u202f]/g;

export function texteImprimable(v: unknown): string {
  return String(v ?? "").replace(ESPACES_EXOTIQUES, " ");
}

/** Nombre à la française sans espace insécable : 75000 → « 75 000 ». */
export function nombreFr(v: number | null | undefined, decimales = 0): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0";
  const fixe = decimales > 0 ? n.toFixed(decimales) : String(Math.round(n));
  const [entier, frac] = fixe.split(".");
  // Groupage par milliers avec une espace ORDINAIRE (voir `texteImprimable`).
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac ? `${groupe},${frac}` : groupe;
}

/**
 * Fragment de nom de fichier tiré d'un libellé : sans accent ni ponctuation.
 * « Semestre 1 — Génie logiciel » → « semestre-1-genie-logiciel ».
 */
export function slugFichier(libelle: string, longueurMax = 60): string {
  return (libelle || "sans-titre")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, longueurMax) || "sans-titre";
}

/**
 * Découpe le contenu d'une cellule en lignes qui tiennent toutes dans
 * `largeur`, `mesurer` donnant la largeur d'un texte dans la police courante.
 *
 * Le retour à la ligne ordinaire ne coupe qu'aux espaces : un nom composé
 * (« DIARRASSOUBA-KONATÉ ») ou une adresse électronique sortent alors de leur
 * colonne. On coupe donc aussi après les séparateurs naturels (trait d'union,
 * arobase, point, barre oblique, souligné) et, en dernier recours, au
 * caractère — mieux vaut un mot coupé qu'un mot qui déborde sur le voisin.
 *
 * Renvoie `null` quand le texte tient tel quel : l'appelant laisse alors le
 * moteur de tableau faire son propre retour à la ligne.
 */
export function decouperCellule(
  mesurer: (t: string) => number,
  texte: string,
  largeur: number
): string[] | null {
  const t = texteImprimable(texte);
  if (largeur <= 0 || mesurer(t) <= largeur) return null;

  const mots = t.split(/\s+/).filter(Boolean);
  // Tant que chaque mot tient, le moteur de tableau s'en sort seul.
  if (mots.every((m) => mesurer(m) <= largeur)) return null;

  const lignes: string[] = [];
  let courante = "";
  const pousser = () => {
    if (courante) lignes.push(courante);
    courante = "";
  };
  /** Ajoute `bout` à la ligne courante ; `colle` = sans espace de séparation. */
  const ajouter = (bout: string, colle: boolean) => {
    const essai = courante && !colle ? `${courante} ${bout}` : courante + bout;
    if (!courante || mesurer(essai) <= largeur) {
      courante = essai;
      return;
    }
    pousser();
    courante = bout;
  };

  for (const mot of mots) {
    if (mesurer(mot) <= largeur) {
      ajouter(mot, false);
      continue;
    }
    // Mot trop large : on le coupe après ses séparateurs naturels, sans jamais
    // introduire d'espace — le texte reste celui de la donnée.
    let premier = true;
    for (const bout of mot.split(/(?<=[-@./_])/)) {
      let reste = bout;
      while (mesurer(reste) > largeur) {
        let i = 1;
        while (i < reste.length && mesurer(reste.slice(0, i + 1)) <= largeur) i += 1;
        pousser();
        lignes.push(reste.slice(0, i));
        reste = reste.slice(i);
      }
      if (reste) {
        ajouter(reste, !premier);
        premier = false;
      }
    }
  }
  pousser();
  return lignes;
}

/** « 12 » / « 12 éléments » — accord automatique. */
export function effectif(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${n} ${n === 1 ? singulier : pluriel}`;
}
