/**
 * Renouvellement du jeton d'accès IAM côté NAVIGATEUR (`NEXT_PUBLIC_AUTH_V2=1`).
 *
 * Le refresh token ne quitte jamais le serveur : il vit dans le JWT de session NextAuth (cookie chiffré HttpOnly).
 * Le navigateur demande donc au serveur de faire tourner le refresh par `POST /api/auth/session` (même route que
 * `useSession().update()`), seul endroit où NextAuth peut réécrire le cookie.
 *
 * Deux onglets ne doivent JAMAIS faire tourner le même refresh token en parallèle (le second serait pris pour une
 * réutilisation et révoquerait la session) : toutes les rotations passent par un verrou Web Locks (inter-onglets) ;
 * sous le verrou, on relit d'abord l'état du cookie et on ne tourne que si le jeton est vraiment proche de
 * l'échéance (un autre onglet a pu le faire entre-temps).
 */
import { saveToken } from "./jwt-storage";

export const IAM_REFRESH_LOCK = "ed-iam-refresh";
/** Marge avant échéance au-delà de laquelle on renouvelle (le jeton d'accès vit 15 min). */
export const IAM_REFRESH_SKEW_SEC = 120;

/** Jeton d'accès IAM (en-tête `typ` `at+jwt` / `imp+jwt`) : lecture de l'en-tête seulement, rien n'est vérifié ici. */
export function isIamAccessToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot > 200) return false;
  try {
    const b64 = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const header = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { typ?: unknown };
    return header.typ === "at+jwt" || header.typ === "imp+jwt";
  } catch {
    return false;
  }
}

export interface SessionSnapshot {
  jwtToken?: string;
  jwtExpiresAt?: string;
  iamExpired?: boolean;
  iamError?: { action: string; code: string };
  [key: string]: unknown;
}

export function expiresWithin(snapshot: Pick<SessionSnapshot, "jwtExpiresAt"> | null | undefined, skewSec: number, now = Date.now()): boolean {
  const t = snapshot?.jwtExpiresAt ? Date.parse(snapshot.jwtExpiresAt) : NaN;
  return !Number.isFinite(t) || t - now <= skewSec * 1000;
}

let chain: Promise<unknown> = Promise.resolve();

/** Exécute `fn` en exclusion mutuelle entre onglets (Web Locks) ; à défaut, au moins entre appels du même onglet. */
export async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: { request<R>(name: string, cb: () => Promise<R>): Promise<R> } }).locks : undefined;
  if (locks?.request) return locks.request(IAM_REFRESH_LOCK, fn);
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** Session NextAuth courante, telle que la voit le serveur (aucune rotation). */
export async function readSession(fetchImpl: typeof fetch = fetch): Promise<SessionSnapshot | null> {
  const res = await fetchImpl("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as SessionSnapshot | null;
  return json && Object.keys(json).length > 0 ? json : null;
}

/** `POST /api/auth/session` : déclenche `trigger: "update"` côté serveur (protégé par le jeton CSRF de NextAuth). */
export async function postSessionUpdate(data: unknown, fetchImpl: typeof fetch = fetch): Promise<SessionSnapshot | null> {
  const csrf = await fetchImpl("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
  if (!csrf.ok) return null;
  const { csrfToken } = (await csrf.json()) as { csrfToken?: string };
  if (!csrfToken) return null;
  const res = await fetchImpl("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csrfToken, data }),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as SessionSnapshot | null;
  return json && Object.keys(json).length > 0 ? json : null;
}

let inflight: Promise<string | null> | null = null;

/**
 * Jeton d'accès valide : celui du cookie s'il n'est pas proche de l'échéance, sinon après rotation côté serveur.
 * `null` si la session IAM n'existe plus (l'interface doit alors se déconnecter). Le résultat est aussi écrit dans le
 * stockage lu par le fetch-interceptor.
 */
export function refreshIamAccessToken(options: { rejectedToken?: string; skewSec?: number; fetchImpl?: typeof fetch } = {}): Promise<string | null> {
  if (inflight) return inflight;
  const fetchImpl = options.fetchImpl ?? fetch;
  const skew = options.skewSec ?? IAM_REFRESH_SKEW_SEC;
  inflight = runExclusive(async () => {
    const current = await readSession(fetchImpl);
    if (!current?.jwtToken || current.iamExpired) return null;
    // `rejectedToken` : l'API vient de refuser ce jeton. S'il est toujours celui du cookie, on tourne même s'il paraît
    // valide ; si un autre onglet l'a déjà remplacé, on prend le nouveau sans rotation supplémentaire.
    const stillRejected = options.rejectedToken !== undefined && current.jwtToken === options.rejectedToken;
    if (!stillRejected && !expiresWithin(current, skew)) {
      saveToken(current.jwtToken);
      return current.jwtToken;
    }
    const next = await postSessionUpdate({ action: "refresh" }, fetchImpl);
    if (!next?.jwtToken || next.iamExpired) return null;
    saveToken(next.jwtToken);
    return next.jwtToken;
  })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
