/**
 * Garde-fous du seed v2 : la commande REFUSE de s'exécuter si l'une des conditions manque.
 *
 *   1. `ALLOW_SEED=1` (consentement explicite, jamais implicite) ;
 *   2. le nom de la base ciblée finit par `_dev`, `_test` ou `_local` (même règle que `db:v2:create-login-role`) ;
 *   3. `NODE_ENV` n'est pas `production`.
 *
 * Fonctions pures (aucune E/S) : testées sans base de données.
 */
export const SEED_PACKS = ["HIGHER", "PRIMARY", "SECONDARY"] as const;
export type SeedPack = (typeof SEED_PACKS)[number];

export class SeedRefusedError extends Error {
  readonly code: "SEED_NOT_ALLOWED" | "SEED_DATABASE_REFUSED" | "SEED_BAD_ARGS" | "SEED_ENV_MISSING";
  constructor(code: SeedRefusedError["code"], message: string) {
    super(message);
    this.name = "SeedRefusedError";
    this.code = code;
  }
}

const SAFE_DATABASE_SUFFIX = /_(dev|test|local)$/;

/** Nom de la base d'une URL PostgreSQL ; `null` si l'URL est illisible ou sans base. */
export function databaseNameOf(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
    const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
    return name === "" ? null : name;
  } catch {
    return null;
  }
}

export function isSafeSeedDatabase(name: string | null): name is string {
  return name !== null && SAFE_DATABASE_SUFFIX.test(name);
}

/** Lève `SeedRefusedError` si le seed n'est pas explicitement autorisé contre cette base. Renvoie le nom de la base. */
export function assertSeedAllowed(env: NodeJS.ProcessEnv, databaseUrl: string | undefined): string {
  if (env.ALLOW_SEED !== "1") {
    throw new SeedRefusedError("SEED_NOT_ALLOWED", "Seed refusé : définissez ALLOW_SEED=1 pour confirmer que vous voulez créer des données de démonstration.");
  }
  if (env.NODE_ENV === "production") {
    throw new SeedRefusedError("SEED_NOT_ALLOWED", "Seed refusé : NODE_ENV=production.");
  }
  if (!databaseUrl || databaseUrl.trim() === "") {
    throw new SeedRefusedError("SEED_ENV_MISSING", "Seed refusé : V2_DATABASE_URL (URL du rôle applicatif) n'est pas défini.");
  }
  const name = databaseNameOf(databaseUrl.trim());
  if (!isSafeSeedDatabase(name)) {
    throw new SeedRefusedError(
      "SEED_DATABASE_REFUSED",
      `Seed refusé : la base "${name ?? "?"}" n'est pas autorisée. Seules les bases dont le nom finit par _dev, _test ou _local le sont.`,
    );
  }
  return name;
}

export interface SeedArgs {
  pack: SeedPack;
  /** Graine du jeu de données (défaut 20261001) : mêmes graine + date de début = mêmes données. */
  seed: number;
  slug: string;
  /** Début de l'année scolaire (AAAA-MM-JJ) ; `null` = 1er septembre de l'année scolaire en cours. */
  yearStart: string | null;
}

export const DEFAULT_SEED = 20261001;

const SLUG_RE = /^[a-z][a-z0-9-]{2,38}[a-z0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `--pack HIGHER|PRIMARY|SECONDARY` (obligatoire), `--seed <entier>`, `--slug <slug>`, `--year-start AAAA-MM-JJ`. */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const values = new Map<string, string>();
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (!arg.startsWith("--")) throw new SeedRefusedError("SEED_BAD_ARGS", `Argument inattendu : ${arg}`);
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? args[(i += 1)] : arg.slice(eq + 1);
    if (!["pack", "seed", "slug", "year-start"].includes(key)) throw new SeedRefusedError("SEED_BAD_ARGS", `Option inconnue : --${key}`);
    if (value === undefined || value.startsWith("--")) throw new SeedRefusedError("SEED_BAD_ARGS", `Valeur manquante pour --${key}`);
    values.set(key, value);
  }
  const pack = (values.get("pack") ?? "").toUpperCase();
  if (!(SEED_PACKS as readonly string[]).includes(pack)) {
    throw new SeedRefusedError("SEED_BAD_ARGS", `--pack est obligatoire : ${SEED_PACKS.join(" | ")}.`);
  }
  const seedText = values.get("seed");
  const seed = seedText === undefined ? DEFAULT_SEED : Number(seedText);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new SeedRefusedError("SEED_BAD_ARGS", "--seed doit être un entier positif.");
  const slug = values.get("slug") ?? `demo-${pack.toLowerCase()}`;
  if (!SLUG_RE.test(slug)) throw new SeedRefusedError("SEED_BAD_ARGS", `--slug invalide : "${slug}" (minuscules, chiffres, tirets ; 4 à 40 caractères).`);
  const yearStart = values.get("year-start") ?? null;
  if (yearStart !== null && (!DATE_RE.test(yearStart) || Number.isNaN(Date.parse(`${yearStart}T00:00:00Z`)))) {
    throw new SeedRefusedError("SEED_BAD_ARGS", "--year-start doit être une date AAAA-MM-JJ.");
  }
  return { pack: pack as SeedPack, seed, slug, yearStart };
}

/** Variables d'environnement indispensables à une exécution (les secrets doivent être CEUX de l'API qui servira ensuite la base). */
export const REQUIRED_SEED_ENV = ["V2_DATABASE_URL", "REDIS_URL", "IAM_JWT_SECRET", "IAM_MFA_ENCRYPTION_KEY", "AUDIT_HMAC_KEY"] as const;

export function assertSeedEnvironment(env: NodeJS.ProcessEnv): void {
  const missing = REQUIRED_SEED_ENV.filter((k) => !env[k] || env[k]!.trim() === "");
  if (missing.length > 0) {
    throw new SeedRefusedError(
      "SEED_ENV_MISSING",
      `Variables manquantes : ${missing.join(", ")}. Le seed utilise les MÊMES secrets que l'API (les secrets MFA des comptes créés sont chiffrés avec IAM_MFA_ENCRYPTION_KEY) et un Redis pour le worker en processus.`,
    );
  }
}
