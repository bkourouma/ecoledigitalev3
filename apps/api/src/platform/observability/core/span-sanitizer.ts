/**
 * Dernière ligne de défense du traçage : un exportateur ENVELOPPANT qui filtre chaque span avant export (ADR-009).
 *
 *  - attributs et événements : clés sensibles masquées, chaînes filtrées (e-mail, JWT, Bearer, carte, IBAN…) ;
 *  - URL (`url.full`, `http.url`, `http.target`…) : chaîne de requête retirée (jetons, URL signées) ;
 *  - SQL (`db.query.text`, `db.statement`) : littéraux remplacés par `?`, aplati, tronqué ;
 *  - spans de contrôle transactionnel (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `set_config`) écartés : ils
 *    multiplieraient par cinq le nombre de spans sans apporter d'information.
 *
 * On reconstruit un objet `ReadableSpan` plutôt que de muter l'original (immuable par contrat).
 */
import { isForbiddenLogKey, REDACTED, scrubLogString } from "@ecoledigitale/kernel";
import type { Attributes, AttributeValue } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

const SQL_KEYS = new Set(["db.query.text", "db.statement"]);
const URL_KEYS = new Set(["url.full", "http.url", "http.target", "url.query", "http.route.raw", "url.path.raw"]);
const MAX_SQL = 200;

/** Remplace les littéraux d'un SQL par `?`, aplati et tronqué (aucune valeur ne doit survivre). */
export function obfuscateSql(text: string): string {
  const flat = text
    .replace(/'(?:[^']|'')*'/g, "'?'")
    .replace(/\$\d+/g, "?")
    .replace(/\b\d{4,}\b/g, "?")
    .replace(/\s+/g, " ")
    .trim();
  return scrubLogString(flat.length > MAX_SQL ? `${flat.slice(0, MAX_SQL)}…` : flat);
}

/** Retire la chaîne de requête et le fragment d'une URL (ou d'un chemin) ; masque les identifiants intégrés. */
export function stripUrlQuery(value: string): string {
  const noCreds = value.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1");
  const cut = noCreds.search(/[?#]/);
  return cut === -1 ? noCreds : `${noCreds.slice(0, cut)}${noCreds[cut] === "?" ? "?[REDACTED]" : ""}`;
}

function scrubValue(key: string, value: AttributeValue): AttributeValue {
  if (typeof value === "string") {
    if (SQL_KEYS.has(key)) return obfuscateSql(value);
    if (URL_KEYS.has(key)) return scrubLogString(stripUrlQuery(value));
    return scrubLogString(value);
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => (typeof v === "string" ? scrubValue(key, v) : v)) as AttributeValue;
  }
  return value;
}

export function scrubSpanAttributes(attributes: Attributes | undefined): Attributes {
  const out: Attributes = {};
  if (!attributes) return out;
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    out[key] = isForbiddenLogKey(key) ? REDACTED : scrubValue(key, value);
  }
  return out;
}

const CONTROL_SQL = /^\s*(begin|commit|rollback|savepoint|release|start transaction)\b|set_config\s*\(|^\s*set\s+(local\s+)?[a-z_]+\s*(=|to)\b/i;

/** `true` pour un span SQL de contrôle transactionnel, sans intérêt pour le diagnostic. */
export function isNoiseSpan(span: ReadableSpan): boolean {
  const attrs = span.attributes;
  const sql = attrs["db.query.text"] ?? attrs["db.statement"];
  if (typeof sql === "string") return CONTROL_SQL.test(sql);
  return false;
}

function sanitizeSpan(span: ReadableSpan): ReadableSpan {
  const status = span.status.message ? { ...span.status, message: scrubLogString(span.status.message) } : span.status;
  const sanitized: ReadableSpan = {
    name: scrubLogString(span.name),
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    status,
    attributes: scrubSpanAttributes(span.attributes),
    links: span.links,
    events: span.events.map((e) => ({ ...e, name: scrubLogString(e.name), ...(e.attributes ? { attributes: scrubSpanAttributes(e.attributes) } : {}) })),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
  return sanitized;
}

/** Enveloppe un exportateur : filtre puis délègue. */
export class SanitizingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const cleaned = spans.filter((s) => !isNoiseSpan(s)).map(sanitizeSpan);
    if (cleaned.length === 0) {
      resultCallback({ code: 0 });
      return;
    }
    this.inner.export(cleaned, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
