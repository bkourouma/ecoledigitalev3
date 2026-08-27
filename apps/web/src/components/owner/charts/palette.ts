/**
 * Palette des graphiques de l'espace owner.
 *
 * Les valeurs sont des références à des variables CSS déclarées dans globals.css
 * (`:root` et `.dark`) — et non des hex en dur — pour que le passage en thème
 * sombre bascule les huit teintes en un seul point. Les SVG de recharts acceptent
 * `var(--x)` dans `fill` et `stroke`.
 *
 * Règles non négociables, vérifiées par le validateur de palette :
 *  - l'ordre des slots EST le mécanisme de sûreté daltonisme : on assigne dans
 *    l'ordre, jamais en cyclant ;
 *  - la couleur suit l'ENTITÉ, jamais son rang : filtrer des filières ne doit pas
 *    repeindre les survivantes (d'où `seriesColorFor`, indexé sur un identifiant) ;
 *  - au-delà de 8 séries, on regroupe en « Autres » — on ne génère pas de 9e teinte ;
 *  - les couleurs de statut sont réservées aux états et toujours doublées d'un
 *    libellé.
 */

export const VIZ_SERIES = [
  "var(--viz-series-1)",
  "var(--viz-series-2)",
  "var(--viz-series-3)",
  "var(--viz-series-4)",
  "var(--viz-series-5)",
  "var(--viz-series-6)",
  "var(--viz-series-7)",
  "var(--viz-series-8)",
] as const;

export const VIZ_MAX_SERIES = VIZ_SERIES.length;

export const VIZ_STATUS = {
  good: "var(--viz-good)",
  warning: "var(--viz-warning)",
  serious: "var(--viz-serious)",
  critical: "var(--viz-critical)",
} as const;

export const VIZ_CHROME = {
  grid: "var(--viz-grid)",
  axis: "var(--viz-axis)",
  muted: "var(--viz-muted)",
} as const;

export const VIZ_SEQUENTIAL = [
  "var(--viz-seq-100)",
  "var(--viz-seq-300)",
  "var(--viz-seq-500)",
  "var(--viz-seq-700)",
] as const;

/**
 * Couleur stable d'une série, indexée sur une clé d'entité.
 *
 * `keys` doit être l'ordre de référence complet (toutes filières connues), pas la
 * liste filtrée : c'est ce qui garantit qu'une filière conserve sa teinte quand
 * l'utilisateur en masque d'autres.
 */
export function seriesColorFor(key: string, keys: readonly string[]): string {
  const i = keys.indexOf(key);
  if (i < 0 || i >= VIZ_MAX_SERIES) return VIZ_CHROME.muted;
  return VIZ_SERIES[i];
}

/**
 * Seuils métier de recouvrement, déjà en vigueur dans l'espace owner
 * (autrefois RecoveryByCycleChart) : vert >= 80 %, ambre >= 60 %, rouge en deçà.
 * Couleur de statut — toujours accompagnée de la valeur chiffrée à l'écran.
 */
export function recoveryColor(rate: number): string {
  if (rate >= 80) return VIZ_STATUS.good;
  if (rate >= 60) return VIZ_STATUS.warning;
  return VIZ_STATUS.critical;
}

/** Formatage monétaire homogène. En base la devise est XOF, l'affichage est FCFA. */
export function formatFcfa(n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " FCFA";
}

/** Formatage monétaire compact, pour les axes où la place manque. */
export function formatFcfaCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)} k`;
  return String(n);
}

/**
 * Pourcentage affiché. `null` / `undefined` → « Non mesuré », jamais « 0 % » :
 * un zéro ferait passer une absence de dénominateur pour un recouvrement nul.
 */
export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "Non mesuré";
  return `${n.toFixed(1)} %`;
}
