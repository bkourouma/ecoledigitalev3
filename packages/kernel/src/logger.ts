/**
 * Interface de journalisation minimale, compatible pino
 * (`logger.info({ champs }, "message")`). Le kernel ne dépend d'aucune
 * bibliothèque : l'application injecte pino, les tests injectent `noopLogger`.
 *
 * Ce fichier porte aussi le SCHÉMA DE JOURNAL et la REDACTION, en fonctions pures (ADR-009) :
 *   - `sanitizeForLog` / `scrubLogString` : aucune donnée sensible ne sort d'un journal ;
 *   - `buildPinoOptions` : options pino communes à l'API et au worker (sans importer pino) ;
 *   - `findForbiddenLogContent` / `assertNoForbiddenLogContent` : garde-fou des tests.
 */
export interface Logger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Valeur de remplacement d'un champ sensible. */
export const REDACTED = "[REDACTED]";

/** Champs de corrélation du schéma de journal (snake_case, identiques dans l'API et le worker). */
export const LOG_CORRELATION_FIELDS = [
  "request_id",
  "tenant_id",
  "user_id",
  "module",
  "job_id",
  "event_id",
  "trace_id",
  "span_id",
] as const;
export type LogCorrelationField = (typeof LOG_CORRELATION_FIELDS)[number];

/** Clés historiques (camelCase, `reqId` de Fastify) normalisées vers le schéma snake_case. */
const CORRELATION_ALIASES: Readonly<Record<string, LogCorrelationField>> = Object.freeze({
  requestId: "request_id",
  reqId: "request_id",
  tenantId: "tenant_id",
  userId: "user_id",
  jobId: "job_id",
  eventId: "event_id",
  traceId: "trace_id",
  spanId: "span_id",
});

/** Normalisation d'une clé pour la comparaison : minuscules, uniquement lettres et chiffres. */
export function normalizeLogKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Clés dont la valeur est TOUJOURS masquée, quelle qu'elle soit (comparaison exacte après normalisation). */
const FORBIDDEN_EXACT: ReadonlySet<string> = new Set([
  "otp",
  "pan",
  "pin",
  "cvv",
  "cvc",
  "ssn",
  "iban",
  "email",
  "mail",
  "phone",
  "mobile",
  "msisdn",
  "body",
  "rawbody",
  "content",
  "text",
  "html",
  "subject",
  "payload",
  "connectionstring",
  "dsn",
  "auth",
  "jwt",
  "key",
  "salt",
  "passwordhash",
]);

/** Fragments de clé masqués où qu'ils apparaissent (`userPassword`, `x-api-key`, `accessToken`, `contactEmail`…). */
const FORBIDDEN_FRAGMENTS: readonly string[] = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "privatekey",
  "signingkey",
  "encryptionkey",
  "credential",
  "totp",
  "cardnumber",
  "accountnumber",
  "phonenumber",
  "email",
  "messagebody",
  "messagecontent",
  "mailbody",
  "requestbody",
  "responsebody",
  "firstname",
  "lastname",
  "fullname",
  "givenname",
  "familyname",
  "birthdate",
  "dateofbirth",
  "socialsecurity",
  "nationalid",
  "passport",
  "databaseurl",
  "redisurl",
];

/** `true` si la valeur portée par cette clé ne doit jamais apparaître dans un journal. */
export function isForbiddenLogKey(key: string): boolean {
  const k = normalizeLogKey(key);
  if (k === "") return false;
  if (FORBIDDEN_EXACT.has(k)) return true;
  return FORBIDDEN_FRAGMENTS.some((f) => k.includes(f));
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const URL_CREDENTIALS_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;
const QUERY_PARAM_RE = /([?&;])([A-Za-z0-9_.%-]{1,40})=([^&\s"'#]*)/g;
const CARD_RE = /(?<![A-Za-z0-9-])[3-6](?:[ -]?\d){12,18}(?![A-Za-z0-9-])/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function ibanValid(raw: string): boolean {
  const s = raw.replace(/ /g, "");
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

const MAX_STRING = 2000;

/**
 * Masque, dans une chaîne libre, ce qui ressemble à une donnée sensible : e-mail, JWT, `Bearer …`,
 * identifiants d'une URL de connexion, paramètres de requête sensibles, numéro de carte (Luhn), IBAN (mod 97).
 * Idempotente. Tronque à 2 000 caractères.
 */
export function scrubLogString(value: string): string {
  let s = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  s = s.replace(URL_CREDENTIALS_RE, (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`);
  s = s.replace(QUERY_PARAM_RE, (m, sep: string, name: string) => {
    let decoded = name;
    try {
      decoded = decodeURIComponent(name);
    } catch {
      /* nom non décodable : comparaison sur la forme brute */
    }
    return isForbiddenLogKey(decoded) ? `${sep}${name}=${REDACTED}` : m;
  });
  s = s.replace(JWT_RE, "[JWT]");
  s = s.replace(BEARER_RE, (_m, kind: string) => `${kind} ${REDACTED}`);
  s = s.replace(EMAIL_RE, "[EMAIL]");
  s = s.replace(IBAN_RE, (m) => (ibanValid(m) ? "[IBAN]" : m));
  s = s.replace(CARD_RE, (m) => {
    const digits = m.replace(/[ -]/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? "[CARD]" : m;
  });
  return s;
}

export interface SanitizeOptions {
  /** Profondeur maximale (défaut 8) ; au-delà : `[…]`. */
  maxDepth?: number;
  /** Éléments conservés par tableau (défaut 50). */
  maxArray?: number;
  /** Clés conservées par objet (défaut 100). */
  maxKeys?: number;
}

/** Représentation sûre d'une erreur : jamais `detail`, `query`, `parameters`, `where` (erreurs `pg`), ni les propriétés libres. */
export function safeErrorForLog(err: Error): Record<string, unknown> {
  const e = err as Error & { code?: unknown; statusCode?: unknown; status?: unknown };
  const out: Record<string, unknown> = {
    type: typeof err.name === "string" && err.name ? err.name : "Error",
    message: scrubLogString(String(err.message ?? "")),
  };
  if (typeof e.code === "string" || typeof e.code === "number") out.code = typeof e.code === "string" ? scrubLogString(e.code) : e.code;
  if (typeof e.statusCode === "number") out.statusCode = e.statusCode;
  if (typeof err.stack === "string") out.stack = scrubLogString(err.stack);
  return out;
}

/**
 * Copie « sûre » d'une valeur de journal : clés sensibles masquées, chaînes filtrées, erreurs réduites,
 * profondeur et tailles bornées, cycles coupés. Ne modifie jamais l'objet d'origine.
 */
export function sanitizeForLog(value: unknown, options: SanitizeOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 8;
  const maxArray = options.maxArray ?? 50;
  const maxKeys = options.maxKeys ?? 100;
  const seen = new WeakSet<object>();

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    switch (typeof v) {
      case "string":
        return scrubLogString(v);
      case "number":
      case "boolean":
        return v;
      case "bigint":
        return v.toString();
      case "symbol":
      case "function":
        return undefined;
      default:
        break;
    }
    const obj = v as object;
    if (obj instanceof Error) return safeErrorForLog(obj);
    if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(obj)) return `[binaire ${obj.length} octets]`;
    if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) return "[binaire]";
    if (obj instanceof Map || obj instanceof Set || obj instanceof WeakMap || obj instanceof WeakSet) return `[${obj.constructor.name}]`;
    if (seen.has(obj)) return "[circulaire]";
    if (depth >= maxDepth) return "[…]";
    seen.add(obj);
    try {
      if (Array.isArray(obj)) {
        const items = obj.slice(0, maxArray).map((x) => walk(x, depth + 1));
        if (obj.length > maxArray) items.push(`[+${obj.length - maxArray} éléments]`);
        return items;
      }
      const toJSON = (obj as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === "function") {
        try {
          return walk((toJSON as () => unknown).call(obj), depth + 1);
        } catch {
          return "[toJSON en échec]";
        }
      }
      const out: Record<string, unknown> = {};
      let n = 0;
      for (const key of Object.keys(obj)) {
        if (n >= maxKeys) {
          out["…"] = `[+${Object.keys(obj).length - maxKeys} clés]`;
          break;
        }
        n += 1;
        let raw: unknown;
        try {
          raw = (obj as Record<string, unknown>)[key];
        } catch {
          raw = "[illisible]";
        }
        out[key] = isForbiddenLogKey(key) && raw !== undefined && raw !== null ? REDACTED : walk(raw, depth + 1);
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  };

  return walk(value, 0);
}

/** Renomme les clés de corrélation camelCase vers le schéma snake_case (la forme snake_case explicite l'emporte). */
export function normalizeCorrelationKeys(obj: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> | undefined;
  for (const [alias, canonical] of Object.entries(CORRELATION_ALIASES)) {
    if (!(alias in obj)) continue;
    out ??= { ...obj };
    if (!(canonical in out)) out[canonical] = out[alias];
    delete out[alias];
  }
  return out ?? obj;
}

/** Objet de journal prêt à écrire : normalisé puis sanitisé. */
export function sanitizeLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeForLog(obj);
  return normalizeCorrelationKeys((sanitized ?? {}) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Options pino communes (API et worker)
// ---------------------------------------------------------------------------

export interface PinoOptionsInput {
  /** `api`, `worker`… : champ `service` de chaque ligne. */
  service: string;
  /** Niveau (`fatal`…`trace`, `silent`). */
  level?: string;
  /** Champs ajoutés à chaque ligne (corrélation : lus dans un AsyncLocalStorage, identifiants de trace). */
  mixin?: () => Record<string, unknown>;
  /** Champs fixes supplémentaires (version, environnement). */
  base?: Record<string, unknown>;
}

/** Forme minimale des options pino (le kernel n'importe pas pino) : à passer à `pino()` / `Fastify({ logger })`. */
export interface PinoOptionsLike {
  level: string;
  base: Record<string, unknown>;
  messageKey: string;
  timestamp: () => string;
  formatters: {
    level: (label: string) => { level: string };
    bindings: (bindings: Record<string, unknown>) => Record<string, unknown>;
  };
  mixin: () => Record<string, unknown>;
  hooks: { logMethod: (this: unknown, args: unknown[], method: (...a: unknown[]) => void) => void };
}

/**
 * Remplace les arguments d'un appel `log.info(obj?, msg?, ...interpolations)` par leur version sûre.
 * Une `Error` passée seule devient `{ err }` + son message filtré.
 */
export function sanitizeLogArguments(args: readonly unknown[]): unknown[] {
  if (args.length === 0) return [];
  const [first, ...rest] = args;
  const cleanRest = rest.map((a) => (typeof a === "string" ? scrubLogString(a) : sanitizeForLog(a)));
  if (typeof first === "string") return [scrubLogString(first), ...cleanRest];
  if (first instanceof Error) {
    const safe = safeErrorForLog(first);
    const msg = typeof rest[0] === "string" ? (cleanRest.shift() as string) : (safe.message as string);
    return [{ err: safe }, msg, ...cleanRest];
  }
  if (first !== null && typeof first === "object") return [sanitizeLogObject(first as Record<string, unknown>), ...cleanRest];
  return [sanitizeForLog(first), ...cleanRest];
}

export function buildPinoOptions(input: PinoOptionsInput): PinoOptionsLike {
  return {
    level: input.level ?? "info",
    base: { service: input.service, ...(input.base ?? {}) },
    messageKey: "msg",
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
      // Bindings des loggers enfants (`logger.child({ jobId })`) : même normalisation et même redaction que les lignes.
      bindings: (bindings) => sanitizeLogObject(bindings),
    },
    mixin: () => input.mixin?.() ?? {},
    hooks: {
      logMethod(args, method) {
        method.apply(this, sanitizeLogArguments(args));
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Garde-fou des tests
// ---------------------------------------------------------------------------

export interface LogViolation {
  /** Chemin de la valeur dans la ligne (`a.b[2].password`). */
  path: string;
  reason: "forbidden_key" | "sensitive_value";
  /** Extrait NON sensible : jamais la valeur d'origine. */
  detail: string;
}

/**
 * Cherche dans une ligne de journal (objet ou JSON) tout ce qui ne devrait pas y être : une clé interdite dont la valeur
 * n'est pas `[REDACTED]`, ou une valeur de chaîne qui contient encore un e-mail, un JWT, un `Bearer`, une carte, un IBAN,
 * des identifiants d'URL ou un paramètre de requête sensible.
 */
export function findForbiddenLogContent(line: unknown): LogViolation[] {
  let parsed: unknown = line;
  if (typeof line === "string") {
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = { raw: line };
    }
  }
  const violations: LogViolation[] = [];
  const walk = (v: unknown, path: string, depth: number): void => {
    if (depth > 12 || v === null || v === undefined) return;
    if (typeof v === "string") {
      if (scrubLogString(v) !== v) violations.push({ path, reason: "sensitive_value", detail: `valeur sensible dans « ${path} »` });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k;
        if (isForbiddenLogKey(k) && x !== REDACTED && x !== null && x !== undefined) {
          violations.push({ path: p, reason: "forbidden_key", detail: `clé interdite « ${k} » non masquée` });
          continue;
        }
        walk(x, p, depth + 1);
      }
    }
  };
  walk(parsed, "", 0);
  return violations;
}

/** Lève si une des lignes contient un champ interdit (message sans aucune valeur sensible). */
export function assertNoForbiddenLogContent(lines: readonly unknown[]): void {
  const all: string[] = [];
  lines.forEach((line, i) => {
    for (const v of findForbiddenLogContent(line)) all.push(`ligne ${i} : ${v.detail}`);
  });
  if (all.length > 0) {
    throw new Error(`Journal : ${all.length} fuite(s) de données sensibles détectée(s) :\n  - ${all.slice(0, 20).join("\n  - ")}`);
  }
}

// ---------------------------------------------------------------------------
// Implémentations simples
// ---------------------------------------------------------------------------

const noop = (): void => undefined;

export const noopLogger: Logger = Object.freeze<Logger>({
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
});

const consoleLine = (level: string, obj: Record<string, unknown>, msg?: string): string =>
  JSON.stringify({ level, msg: msg === undefined ? undefined : scrubLogString(msg), ...sanitizeLogObject(obj) });

/** Logger JSON sur la console (développement, scripts, CLI). La redaction s'applique comme pour pino. */
export const consoleLogger: Logger = Object.freeze<Logger>({
  debug: (obj, msg) => console.debug(consoleLine("debug", obj, msg)),
  info: (obj, msg) => console.info(consoleLine("info", obj, msg)),
  warn: (obj, msg) => console.warn(consoleLine("warn", obj, msg)),
  error: (obj, msg) => console.error(consoleLine("error", obj, msg)),
});
