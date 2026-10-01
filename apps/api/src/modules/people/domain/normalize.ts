/**
 * Normalisation des noms, clés de recherche et téléphones (fonctions PURES).
 *
 * - `searchKey` reproduit côté application la colonne générée `people.persons.search_key`
 *   (`lower(unaccent(nom || ' ' || prénom || ' ' || autres prénoms))`) : minuscules, sans accents. Les ligatures
 *   (œ, æ) et « ß » sont dépliées comme le fait le dictionnaire `unaccent` de PostgreSQL.
 * - Les noms sont CONSERVÉS tels que saisis à l'affichage (particules, accents, tirets, apostrophes
 *   typographiques) ; seule la recherche et la détection de doublons les normalisent.
 */

const LIGATURES: Readonly<Record<string, string>> = { œ: "oe", Œ: "oe", æ: "ae", Æ: "ae", ß: "ss", ø: "o", Ø: "o", đ: "d", Đ: "d", ł: "l", Ł: "l" };

/** Minuscules sans accents ; apostrophes typographiques ramenées à `'`. */
export function foldText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[œŒæÆßøØđĐłŁ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase();
}

/** Espaces superflus supprimés, casse conservée. */
export function cleanText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Clé de recherche d'une personne (même définition que la colonne `search_key`). */
export function searchKey(lastName: string, firstName: string, otherNames?: string | null): string {
  return foldText(`${lastName} ${firstName} ${otherNames ?? ""}`).replace(/\s+/g, " ").trim();
}

/** Mots significatifs d'un nom (lettres et chiffres), repliés. Sert à la détection de doublons. */
export function nameTokens(...parts: ReadonlyArray<string | null | undefined>): string[] {
  return foldText(parts.filter(Boolean).join(" "))
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** « NOM Prénom » : nom de famille en capitales, prénom tel que saisi. */
export function displayName(lastName: string, firstName: string): string {
  return `${lastName.toLocaleUpperCase("fr")} ${firstName}`.trim();
}

// ---------------------------------------------------------------------------
// Téléphones
// ---------------------------------------------------------------------------

/**
 * Indicatifs téléphoniques par pays (DONNÉE de normalisation, pas une règle métier). `trunk` : le numéro national
 * commence par un « 0 » d'accès qui disparaît en format international (France, Maroc…) ; pour les pays dont les numéros
 * nationaux contiennent le zéro (Côte d'Ivoire depuis 2021), il est conservé.
 */
export const CALLING_CODES: Readonly<Record<string, { code: string; trunk: boolean }>> = Object.freeze({
  CI: { code: "225", trunk: false },
  SN: { code: "221", trunk: false },
  ML: { code: "223", trunk: false },
  BF: { code: "226", trunk: false },
  GN: { code: "224", trunk: false },
  TG: { code: "228", trunk: false },
  BJ: { code: "229", trunk: false },
  NE: { code: "227", trunk: false },
  CM: { code: "237", trunk: false },
  GA: { code: "241", trunk: false },
  CG: { code: "242", trunk: false },
  CD: { code: "243", trunk: true },
  GH: { code: "233", trunk: true },
  NG: { code: "234", trunk: true },
  FR: { code: "33", trunk: true },
  BE: { code: "32", trunk: true },
  CH: { code: "41", trunk: true },
  MA: { code: "212", trunk: true },
  DZ: { code: "213", trunk: true },
  TN: { code: "216", trunk: false },
  CA: { code: "1", trunk: false },
  US: { code: "1", trunk: false },
});

/**
 * Normalise un téléphone saisi :
 *  - supprime espaces, points, tirets, parenthèses ;
 *  - `00…` devient `+…` ; un numéro international (`+`) est conservé s'il compte 8 à 15 chiffres ;
 *  - un numéro national est converti en E.164 SI le pays est connu (`defaultCountry` dans `CALLING_CODES`) ;
 *  - sinon le numéro nettoyé est conservé tel quel (la base exige seulement 5 à 40 caractères).
 * Renvoie `null` si le texte ne contient aucun chiffre.
 */
export function normalizePhone(raw: string, defaultCountry?: string | null): string | null {
  const hasPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D+/g, "");
  if (digits.length === 0) return null;
  let international = hasPlus;
  if (!international && digits.startsWith("00")) {
    digits = digits.slice(2);
    international = true;
  }
  if (international) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : digits.length > 0 ? `+${digits}` : null;
  }
  const country = defaultCountry ? CALLING_CODES[defaultCountry.toUpperCase()] : undefined;
  if (!country) return digits;
  let national = digits;
  if (country.trunk && national.startsWith("0")) national = national.slice(1);
  const full = `${country.code}${national}`;
  return full.length >= 8 && full.length <= 15 ? `+${full}` : digits;
}

/** Normalise une adresse e-mail (minuscules, espaces retirés). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `AAAA-MM-JJ` (UTC) d'un instant. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Vrai pour une date calendaire valide (rejette `2024-02-30`). */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Ajoute `days` jours à une date calendaire. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/**
 * Date de naissance vraisemblable : calendaire, au plus aujourd'hui, postérieure à 1900 (borne de la base). AUCUN seuil
 * d'âge : les âges minimaux ou maximaux relèvent des RuleSets (conventions n° 11).
 */
export function isPlausibleBirthDate(value: string, today: string): boolean {
  return isValidDate(value) && value >= "1900-01-01" && value <= today;
}
