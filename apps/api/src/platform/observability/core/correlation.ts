/**
 * Corrélation des journaux : `request_id`, `tenant_id`, `user_id`, `module`, `job_id`, `event_id` (+ `trace_id`, `span_id`).
 *
 * Un `AsyncLocalStorage` porte ces champs le long de l'arbre asynchrone d'une requête HTTP ou d'un job ; le `mixin` pino
 * (`correlationMixin`) les ajoute à CHAQUE ligne, y compris celles des modules qui journalisent via `runtime.logger`
 * ou `ctx.logger` — aucun module n'est modifié. Quand le magasin ne connaît pas encore le tenant ou l'utilisateur
 * (authentification postérieure au hook d'entrée), un résolveur paresseux les lit au moment d'écrire la ligne.
 *
 * Jamais d'e-mail ni de nom : `user_id` est l'identifiant d'identité (UUID).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getRequestContext, LOG_CORRELATION_FIELDS, setAmbientRequestIdProvider, type LogCorrelationField } from "@ecoledigitale/kernel";
import { isSpanContextValid, trace } from "@opentelemetry/api";

export type CorrelationFields = Partial<Record<Exclude<LogCorrelationField, "trace_id" | "span_id">, string>>;

export interface CorrelationStore extends CorrelationFields {
  /** Lu à l'écriture de chaque ligne : valeurs connues tardivement (tenant, utilisateur après authentification). */
  resolve?: () => CorrelationFields;
}

const als = new AsyncLocalStorage<CorrelationStore>();

const FIELD_SET: ReadonlySet<string> = new Set(LOG_CORRELATION_FIELDS);

function clean(fields: CorrelationFields | undefined): CorrelationFields {
  const out: CorrelationFields = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    if (FIELD_SET.has(k) && typeof v === "string" && v !== "") (out as Record<string, string>)[k] = v;
  }
  return out;
}

/** Exécute `fn` avec ces champs de corrélation (fusionnés avec ceux du contexte parent). */
export function runWithCorrelation<T>(fields: CorrelationFields & { resolve?: () => CorrelationFields }, fn: () => T): T {
  const parent = als.getStore();
  const store: CorrelationStore = { ...(parent ?? {}), ...clean(fields) };
  const resolvers = [parent?.resolve, fields.resolve].filter((r): r is () => CorrelationFields => typeof r === "function");
  if (resolvers.length > 0) store.resolve = () => Object.assign({}, ...resolvers.map((r) => clean(r())));
  return als.run(store, fn);
}

/** Variante pour les hooks Fastify à rappel : le reste du cycle de vie de la requête s'exécute DANS le contexte. */
export function enterCorrelation(fields: CorrelationFields & { resolve?: () => CorrelationFields }, done: () => void): void {
  runWithCorrelation(fields, done);
}

/** Ajoute des champs au contexte courant (no-op hors contexte). */
export function setCorrelation(patch: CorrelationFields): void {
  const store = als.getStore();
  if (store) Object.assign(store, clean(patch));
}

/** Champs de corrélation du contexte courant (magasin, résolveur, puis contexte de requête du kernel). */
export function getCorrelation(): CorrelationFields {
  const store = als.getStore();
  const fromKernel = getRequestContext();
  const out: CorrelationFields = {};
  if (fromKernel) {
    out.request_id = fromKernel.requestId;
    out.tenant_id = fromKernel.tenantId;
    if (fromKernel.userId) out.user_id = fromKernel.userId;
  }
  if (store) {
    let resolved: CorrelationFields = {};
    try {
      resolved = clean(store.resolve?.());
    } catch {
      /* un résolveur défaillant ne doit jamais faire échouer une ligne de journal */
    }
    const { resolve: _ignored, ...own } = store;
    Object.assign(out, resolved, clean(own));
  }
  return out;
}

/** Identifiants de trace du span actif (vide si le traçage est inactif). */
export function activeTraceFields(): { trace_id?: string; span_id?: string } {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const sc = span.spanContext();
  return isSpanContextValid(sc) ? { trace_id: sc.traceId, span_id: sc.spanId } : {};
}

/** `mixin` pino : à passer à `buildPinoOptions({ mixin })`. */
export function correlationMixin(): Record<string, unknown> {
  return { ...getCorrelation(), ...activeTraceFields() };
}

/**
 * Branche le `request_id` ambiant sur les contextes créés sans identifiant explicite (voir `setAmbientRequestIdProvider`) :
 * un événement émis par un abonné du worker garde le `request_id` de la requête HTTP d'origine. Idempotent.
 */
export function enableAmbientRequestId(): void {
  setAmbientRequestIdProvider(() => getCorrelation().request_id);
}
