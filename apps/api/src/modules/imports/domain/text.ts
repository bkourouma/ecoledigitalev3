/**
 * Utilitaires de texte du module imports (purs) : normalisation d'en-têtes, clés naturelles, neutralisation des
 * valeurs écrites dans un fichier de rapport (injection de formule, INV-S7).
 */

/** Supprime les marques diacritiques (« é » -> « e »), sans toucher aux autres caractères. */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Caractères de contrôle (hors tabulation et sauts de ligne), NUL compris : jamais conservés dans une cellule. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Nettoie une cellule lue : contrôles retirés, espaces insécables normalisés, bords rognés. Longueur non bornée ici. */
export function cleanCell(value: string): string {
  return value.replace(CONTROL_CHARS, "").replace(/[   ]/g, " ").trim();
}

/** En-tête normalisé : minuscules, sans accents, ponctuation -> espace, espaces réduits. */
export function normalizeHeader(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[_\-./\\:;,()[\]{}'"`’°#*?!+=|<>@&%$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function headerTokens(value: string): string[] {
  const n = normalizeHeader(value);
  return n === "" ? [] : n.split(" ");
}

/** Forme canonique d'un nom propre pour une clé naturelle : sans accents, majuscules, un seul espace. */
export function keyPart(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return stripAccents(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Chiffres seuls (téléphone). */
export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * `true` si un tableur interpréterait la valeur comme une formule (début `=`, `+`, `-`, `@`, tabulation ou retour
 * chariot). Un nombre négatif légitime (`-12`) est reconnu et NON neutralisé par `neutralizeCell`.
 */
export function isFormulaLike(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value);
}

const PLAIN_NUMBER = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/;

/**
 * Valeur sûre à écrire dans un CSV / XLSX de rapport : toute chaîne susceptible d'être une formule est précédée d'une
 * apostrophe (le tableur l'affiche en texte). Les nombres simples (`-12`, `+3,5`) restent lisibles : ils ne peuvent pas
 * déclencher de fonction ; `-2+3`, `=1+1`, `@SUM(...)`, `+cmd|' /C calc'!A0` sont neutralisés.
 */
export function neutralizeCell(value: string): string {
  if (value === "") return value;
  if (/^[+-]/.test(value) && PLAIN_NUMBER.test(value)) return value;
  return isFormulaLike(value) ? `'${value}` : value;
}

/** Limite une valeur affichée dans un message (jamais de donnée personnelle longue dans une erreur). */
export function clip(value: string, max = 60): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
