/**
 * Validation de l'environnement du web (SERVER ONLY, fail-fast).
 *
 * - `assertWebEnv()` est appelé au démarrage du serveur par `src/instrumentation.ts` :
 *   en production, un `NEXTAUTH_SECRET` absent, trop court ou connu comme faible
 *   fait échouer le démarrage.
 * - `resolveNextAuthSecret()` est utilisé par `auth-options.ts` : il ne renvoie
 *   jamais de constante codée en dur.
 *     production    : le secret de l'environnement, sinon erreur ;
 *     développement : le secret de l'environnement s'il existe, sinon un secret
 *                     aléatoire propre au process (+ avertissement) ; les
 *                     sessions NextAuth ne survivent alors pas à un redémarrage ;
 *     `next build`  : valeur éphémère, jamais utilisée (le build n'a pas les
 *                     secrets d'exécution).
 *
 * Aucune valeur de secret n'est écrite dans les messages d'erreur ou de log.
 */

import { randomBytes } from "crypto";
import { z } from "zod";

export const MIN_SECRET_LENGTH = 32;

/** Même liste que `apps/api/src/config/env.ts` (les deux apps ne partagent pas ce module). */
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

export function isWeakSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  if (WEAK_SECRET_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return true;
  // Placeholder à compléter, tel que <secret-aleatoire> dans .env.example.
  if (/[<>]/.test(normalized)) return true;
  if (new Set(normalized).size <= 4) return true;
  return false;
}

type EnvSource = Record<string, string | undefined>;

const nextAuthSecretSchema = z
  .string({ required_error: "NEXTAUTH_SECRET est requis" })
  .trim()
  .min(MIN_SECRET_LENGTH, `NEXTAUTH_SECRET doit faire au moins ${MIN_SECRET_LENGTH} caractères`)
  .refine((value) => !isWeakSecret(value), "NEXTAUTH_SECRET est une valeur d'exemple ou faible connue");

function isBuildPhase(source: EnvSource): boolean {
  return source.NEXT_PHASE === "phase-production-build";
}

function isProduction(source: EnvSource): boolean {
  const nodeEnv = source.NODE_ENV?.trim();
  return nodeEnv !== undefined && nodeEnv !== "" && nodeEnv !== "development" && nodeEnv !== "test";
}

/** Problèmes de `NEXTAUTH_SECRET` (liste vide si la valeur est acceptable). */
export function nextAuthSecretProblems(source: EnvSource = process.env): string[] {
  const parsed = nextAuthSecretSchema.safeParse(source.NEXTAUTH_SECRET?.trim() || undefined);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

type GlobalWithDevSecret = typeof globalThis & { __ecoledigitaleDevNextAuthSecret?: string };

export function resolveNextAuthSecret(source: EnvSource = process.env): string {
  const problems = nextAuthSecretProblems(source);
  const configured = source.NEXTAUTH_SECRET?.trim();

  if (problems.length === 0 && configured) return configured;

  // `next build` : pas de secrets d'exécution, et la valeur n'est jamais utilisée.
  if (isBuildPhase(source)) return randomBytes(32).toString("base64url");

  if (isProduction(source)) {
    throw new Error(
      `Configuration invalide, démarrage du web refusé : ${problems.join(" ; ")}. ` +
        "Définir NEXTAUTH_SECRET (voir .env.example ; générer : openssl rand -base64 48)."
    );
  }

  // Développement. Une valeur fournie mais faible est tolérée (avertissement) ;
  // une valeur absente est remplacée par un secret aléatoire propre au process,
  // partagé entre les bundles de routes via globalThis (pas de constante).
  if (configured) {
    console.warn(`[env] AVERTISSEMENT ${problems.join(" ; ")} (toléré hors production)`);
    return configured;
  }

  const g = globalThis as GlobalWithDevSecret;
  if (!g.__ecoledigitaleDevNextAuthSecret) {
    g.__ecoledigitaleDevNextAuthSecret = randomBytes(32).toString("base64url");
    console.warn(
      "[env] AVERTISSEMENT NEXTAUTH_SECRET n'est pas défini : secret aléatoire généré pour ce process " +
        "(les sessions seront perdues au redémarrage). Définir NEXTAUTH_SECRET dans apps/web/.env.local."
    );
  }
  return g.__ecoledigitaleDevNextAuthSecret;
}

/**
 * Vérifie l'environnement au démarrage du serveur. Lève une erreur en production
 * si la configuration est invalide ; en développement, ne fait qu'avertir.
 */
export function assertWebEnv(source: EnvSource = process.env): void {
  if (isBuildPhase(source)) return;

  if (isProduction(source)) {
    const problems = nextAuthSecretProblems(source);
    if (problems.length > 0) {
      throw new Error(
        `Configuration invalide, démarrage du web refusé : ${problems.join(" ; ")}. ` +
          "Définir NEXTAUTH_SECRET (voir .env.example ; générer : openssl rand -base64 48)."
      );
    }
    if (source.SHOW_TECHNICAL_ACCOUNTS?.trim().toLowerCase() === "true") {
      throw new Error(
        "Configuration invalide, démarrage du web refusé : SHOW_TECHNICAL_ACCOUNTS=true est interdit en production " +
          "(le panneau de comptes de /login exposerait des identifiants). Retirer la variable ou la mettre à false."
      );
    }
    return;
  }

  // Développement : déclenche l'avertissement éventuel sur NEXTAUTH_SECRET.
  resolveNextAuthSecret(source);
}
