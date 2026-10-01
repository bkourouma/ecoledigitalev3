/**
 * `Result<T, E>` : succès ou échec porté par la valeur de retour.
 *
 * Représentation = objets simples (`{ ok: true, value }` / `{ ok: false, error }`),
 * donc sérialisables et discriminables par `ok`. Les use cases renvoient un
 * `Result<T, AppError>` pour les échecs ATTENDUS (métier) ; les exceptions
 * restent réservées aux erreurs inattendues.
 */
import { toAppError, type AppError } from "./errors";

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = AppError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}

export function andThen<T, U, E>(r: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

export async function andThenAsync<T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => Promise<Result<U, E>>,
): Promise<Result<U, E>> {
  return r.ok ? fn(r.value) : r;
}

export function match<T, E, R>(
  r: Result<T, E>,
  handlers: { ok: (value: T) => R; err: (error: E) => R },
): R {
  return r.ok ? handlers.ok(r.value) : handlers.err(r.error);
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

/**
 * Extrait la valeur ou LÈVE l'erreur portée. Si l'erreur n'est pas déjà une
 * `Error`, elle est enveloppée (`toAppError`), pour ne jamais lever une valeur brute.
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error instanceof Error ? r.error : toAppError(r.error);
}

/** Exécute `fn` et convertit toute exception en `Err` (`AppError` normalisée). */
export async function tryCatch<T>(fn: () => Promise<T> | T): Promise<Result<T, AppError>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(toAppError(e));
  }
}

/** Agrège une liste : premier `Err` rencontré, sinon la liste des valeurs. */
export function all<T, E>(results: ReadonlyArray<Result<T, E>>): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}
