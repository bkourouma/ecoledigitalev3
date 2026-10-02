/**
 * Normalisation d'identité : MIROIR exact de `admissions.normalize_name` (SQL, colonne générée `identity_key`) — un test
 * d'intégration compare les deux. Minuscules, accents courants retirés, ponctuation et espaces multiples ramenés à un espace.
 */
const FROM = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ";
const TO = "aaaaaaceeeeiiiinooooouuuuyyoa";

export function normalizeName(value: string | null | undefined): string {
  let out = "";
  for (const ch of (value ?? "").toLowerCase()) {
    const i = FROM.indexOf(ch);
    out += i >= 0 ? TO[i] : ch;
  }
  return out.replace(/[^a-z0-9]+/g, " ").trim();
}

const EPOCH_1900 = Date.UTC(1900, 0, 1);

/** Jours entre le 1900-01-01 et la date `AAAA-MM-JJ` (entier, comme `date - DATE '1900-01-01'`). */
export function daysSince1900(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_1900) / 86_400_000);
}

/** Clé d'identité d'un candidat : nom | prénom | naissance (même formule que la colonne générée). */
export function identityKey(input: { lastName: string; firstName: string; birthDate: string }): string {
  return `${normalizeName(input.lastName)}|${normalizeName(input.firstName)}|${daysSince1900(input.birthDate)}`;
}

/** Naissance plausible : dans le passé et après 1950 (la base refuse avant). Aucune règle d'âge d'entrée n'est codée ici. */
export function isPlausibleBirthDate(isoDate: string, today: string): boolean {
  return isoDate > "1950-01-01" && isoDate <= today;
}
