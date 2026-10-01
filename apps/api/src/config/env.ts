/**
 * Validation de l'environnement de l'API (fail-fast).
 *
 * Ce module est importé tout en haut de `src/index.ts`, juste après
 * `dotenv/config` : si la configuration est invalide, le process s'arrête avant
 * qu'une route, une connexion base de données ou un service JWT ne soit chargé.
 *
 * Règles
 *   - `JWT_SECRET` est obligatoire dans tous les environnements (sauf `test`).
 *   - En `NODE_ENV=production`, les secrets doivent faire au moins 32 caractères
 *     et ne pas être une valeur d'exemple / faible connue (voir `isWeakSecret`).
 *     Hors production, une valeur faible produit un avertissement seulement.
 *   - `DATABASE_URL` est obligatoire (plus aucune URL par défaut dans le code).
 *
 * Aucune valeur de secret n'est jamais écrite dans les messages d'erreur.
 */

import { z } from "zod";

export const MIN_SECRET_LENGTH = 32;

/**
 * Fragments qui trahissent une valeur d'exemple, un placeholder ou un secret
 * historiquement présent dans le dépôt. Comparaison insensible à la casse, en
 * sous-chaîne.
 */
const WEAK_SECRET_FRAGMENTS = [
  "change-in-production",
  "change-this",
  "change_me",
  "change-me",
  "changeme",
  "replace-with",
  "replace-me",
  "replace_me",
  "your-secret",
  "your-super-secret",
  "your-nextauth",
  "your-jwt",
  "your-rso",
  "secret-key-here",
  "secret-here",
  "test-jwt-secret",
  "dev-secret",
  "default-secret",
  "mysecret",
  "supersecret",
  "password",
  "passw0rd",
  "minioadmin",
  "123456",
];

/** Vrai si la valeur est manifestement un placeholder ou un secret trivial. */
export function isWeakSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  if (WEAK_SECRET_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return true;
  // Placeholder à compléter, tel que <secret-aleatoire> dans .env.example.
  if (/[<>]/.test(normalized)) return true;
  // Un seul caractère répété ("aaaaaaaa…"), ou une très faible diversité.
  if (new Set(normalized).size <= 4) return true;
  return false;
}

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const envSchema = z.object({
  // Toute valeur autre que development / test (production, staging…) est traitée comme production.
  NODE_ENV: optionalString,
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL est requis" })
    .trim()
    .min(1, "DATABASE_URL est requis")
    .refine((value) => /^postgres(ql)?:\/\//i.test(value), "DATABASE_URL doit commencer par postgres:// ou postgresql://"),
  JWT_SECRET: z.string({ required_error: "JWT_SECRET est requis" }).trim().min(1, "JWT_SECRET est requis"),
  SUPER_ADMIN_JWT_SECRET: optionalString,
  RSO_JWT_SECRET: optionalString,
  // Mot de passe commun des comptes techniques (un par rôle et par tenant).
  // Absent : un mot de passe aléatoire est généré à la création (voir
  // `tenant-provisioning.service.ts`) et affiché une seule fois dans les logs.
  TECHNICAL_ACCOUNT_PASSWORD: optionalString,
});

export type ApiEnv = z.infer<typeof envSchema>;

export type EnvValidationResult =
  | { ok: true; env: ApiEnv; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/**
 * Valide un objet d'environnement. Pure : ne lit pas `process.env` et ne quitte
 * pas le process, pour rester testable.
 */
export function validateEnv(source: Record<string, string | undefined>): EnvValidationResult {
  const parsed = envSchema.safeParse(source);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".") || "env"} : ${issue.message}`);
    }
    return { ok: false, errors, warnings };
  }

  const env = parsed.data;
  const isTest = env.NODE_ENV === "test";
  const isProduction = env.NODE_ENV !== undefined && env.NODE_ENV !== "development" && !isTest;

  const secrets: Array<[string, string | undefined]> = [
    ["JWT_SECRET", env.JWT_SECRET],
    ["SUPER_ADMIN_JWT_SECRET", env.SUPER_ADMIN_JWT_SECRET],
    ["RSO_JWT_SECRET", env.RSO_JWT_SECRET],
    ["TECHNICAL_ACCOUNT_PASSWORD", env.TECHNICAL_ACCOUNT_PASSWORD],
  ];

  for (const [name, value] of secrets) {
    if (value === undefined) continue;
    // Le mot de passe technique n'est pas une clé de signature : on n'exige pas
    // 32 caractères, mais il ne doit pas être trivial en production.
    const minLength = name === "TECHNICAL_ACCOUNT_PASSWORD" ? 12 : MIN_SECRET_LENGTH;
    const problems: string[] = [];
    if (value.length < minLength) problems.push(`moins de ${minLength} caractères`);
    if (isWeakSecret(value)) problems.push("valeur d'exemple ou faible connue");
    if (problems.length === 0) continue;

    const message = `${name} : ${problems.join(" et ")}`;
    if (isProduction) errors.push(message);
    else if (!isTest) warnings.push(`${message} (toléré hors production)`);
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, env, warnings };
}

/**
 * Valide `process.env` ; en cas d'échec, journalise les erreurs (sans valeurs)
 * puis arrête le process avec le code 1.
 */
export function loadEnvOrExit(source: Record<string, string | undefined> = process.env): ApiEnv {
  const result = validateEnv(source);

  for (const warning of result.warnings) {
    console.warn(`[env] AVERTISSEMENT ${warning}`);
  }

  if (!result.ok) {
    console.error("[env] Configuration invalide, démarrage de l'API refusé :");
    for (const error of result.errors) {
      console.error(`[env]   - ${error}`);
    }
    console.error("[env] Voir .env.example. Générer un secret : openssl rand -base64 48");
    process.exit(1);
  }

  return result.env;
}

