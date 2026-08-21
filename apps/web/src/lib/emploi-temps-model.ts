/**
 * Modèle de l'emploi du temps — logique partagée par les exports Word
 * (`emploi-temps-docx.ts`) et PDF (`emploi-temps-pdf.ts`).
 *
 * Les deux documents doivent donner exactement la même grille : mêmes heures
 * affichées, mêmes fusions de créneaux, mêmes couleurs par UE. Cette logique
 * vit donc ici, et non dans l'un des deux générateurs.
 */

export const JOURS = ["", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"];
export const DAY_KEYS = [1, 2, 3, 4, 5, 6];

/* Couleurs alignées sur la grille de l'interface (consultation). */
export const INDIGO = "4F46E5"; // indigo-600 (en-têtes)
export const INDIGO_LIGHT = "EEF2FF"; // indigo-50 (colonne HORAIRES)
export const INDIGO_DARK = "312E81"; // indigo-900 (texte HORAIRES)
export const GRID_BORDER = "D1D5DB"; // gray-300
export const ROUGE_ENSEIGNANT = "C00000";
export const GRIS_NON_AFFECTE = "808080";
export const BLEU_SALLE = "1F4E79";

/** Palette de fond par UE (identique au composant EmploiTempsGrid). */
export const UE_PALETTE = [
  { bg: "E0E7FF", border: "A5B4FC" },
  { bg: "DCFCE7", border: "86EFAC" },
  { bg: "FEF9C3", border: "FDE047" },
  { bg: "FCE7F3", border: "F9A8D4" },
  { bg: "E0F2FE", border: "7DD3FC" },
  { bg: "F3E8FF", border: "D8B4FE" },
  { bg: "FFEDD5", border: "FDBA74" },
  { bg: "CCFBF1", border: "5EEAD4" },
  { bg: "FEE2E2", border: "FCA5A5" },
  { bg: "E2E8F0", border: "CBD5E1" },
];

export function ueColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return UE_PALETTE[h % UE_PALETTE.length];
}

/** « #A5B4FC » ou « A5B4FC » → [165, 180, 252], pour jsPDF. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export const MINISTERE =
  "Ministère de l'enseignement supérieur et\nde la recherche scientifique";
export const REPUBLIQUE = "République de Côte d'Ivoire\nUnion – Discipline - Travail";
export const INSTITUT = "INSTITUT POLYVALENT DES AFFAIRES ET DU MANAGEMENT";

export function hourOf(t?: string | null): number | null {
  if (!t) return null;
  const h = parseInt(String(t).slice(0, 2), 10);
  return Number.isFinite(h) ? h : null;
}

export function teacherName(s: any): string {
  return `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
}

export function roomLabel(s: any): string {
  return s.classroom_name || s.classroom_code || "";
}

export function fmtDateFr(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const s = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function academicYear(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/** Case de la grille : début d'un cours (avec sa hauteur), suite, ou vide. */
export type Occupation =
  | { kind: "start"; slots: any[]; span: number }
  | { kind: "cont" }
  | undefined;

/** Grille : pour chaque jour, occupation horaire — plusieurs ECUE par case possibles. */
export function buildOccupancy(slots: any[]): Record<number, Record<number, Occupation>> {
  // Regroupe par (jour, heure de début).
  const starts: Record<number, Record<number, any[]>> = {};
  for (let d = 1; d <= 6; d++) starts[d] = {};
  for (const s of slots) {
    const d = Number(s.jour);
    if (d < 1 || d > 6) continue;
    const start = hourOf(s.heure_debut);
    let end = hourOf(s.heure_fin);
    if (start == null || end == null) continue;
    if (end <= start) end = start + 1;
    (starts[d][start] ??= []).push({ ...s, _end: end });
  }
  const byDay: Record<number, Record<number, Occupation>> = {};
  for (let d = 1; d <= 6; d++) byDay[d] = {};
  for (let d = 1; d <= 6; d++) {
    for (const startStr of Object.keys(starts[d])) {
      const start = Number(startStr);
      const group = starts[d][start];
      const maxEnd = Math.max(...group.map((g) => g._end));
      byDay[d][start] = { kind: "start", slots: group, span: Math.max(1, maxEnd - start) };
      for (let h = start + 1; h < maxEnd; h++) if (!byDay[d][h]) byDay[d][h] = { kind: "cont" };
    }
  }
  return byDay;
}

/**
 * Plage horaire affichée : par défaut 08H → 18H (dernière ligne 17H–18H).
 * On étend la plage (avant 08H ou après 18H) seulement si un créneau dépasse.
 */
export function displayedHours(slots: any[]): number[] {
  let minStart = 8;
  let maxEnd = 18;
  for (const s of slots) {
    const st = hourOf(s.heure_debut);
    let en = hourOf(s.heure_fin);
    if (st == null || en == null) continue;
    if (en <= st) en = st + 1;
    if (st < minStart) minStart = st;
    if (en > maxEnd) maxEnd = en;
  }
  const hours: number[] = [];
  for (let h = minStart; h < maxEnd; h++) hours.push(h);
  return hours;
}

/** Libellé d'une ligne : « 08H – 09H ». */
export const plageHoraire = (h: number) =>
  `${String(h).padStart(2, "0")}H – ${String(h + 1).padStart(2, "0")}H`;

/** En-tête du document : titres, période, année, filière. */
export function enTeteEmploiTemps(data: any) {
  const slots: any[] = data?.slots ?? [];
  const titreFiliere = `${data?.filiere_nom ?? ""}`.trim();
  // Période : min/max des dates des créneaux, sinon période du semestre.
  const debuts = slots.map((s) => s.date_debut).filter(Boolean).sort();
  const fins = slots.map((s) => s.date_fin).filter(Boolean).sort();
  const dDebut = debuts[0] ?? data?.date_debut;
  const dFin = fins[fins.length - 1] ?? data?.date_fin;
  return {
    slots,
    titreFiliere,
    periode: `Du ${fmtDateFr(dDebut)} au ${fmtDateFr(dFin)}`,
    annee: academicYear(dDebut),
    semestre: data?.libelle ?? "Semestre",
  };
}
