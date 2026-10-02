import { expect } from "vitest";
import type { AppError, Result } from "@ecoledigitale/kernel";

/** Attend un échec métier portant ce code stable ; renvoie l'erreur. */
export function expectErr<T>(result: Result<T, AppError>, code: string): AppError {
  if (result.ok) throw new Error(`échec attendu (${code}), succès reçu`);
  expect(result.error.code).toBe(code);
  return result.error;
}

export function must<T>(result: Result<T, AppError>): T {
  if (!result.ok) throw new Error(`succès attendu, échec : ${result.error.code} — ${result.error.message}`);
  return result.value;
}
