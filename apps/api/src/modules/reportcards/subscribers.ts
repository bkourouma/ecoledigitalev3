/**
 * Abonnés du module `reportcards` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `reportcards.render-snapshot`    `reportcards.snapshot.created` -> rendu PDF du bulletin DANS LE WORKER (Puppeteer, JS
 *    désactivé, réseau coupé) depuis le snapshot seul, stockage `StoragePort`, hash du PDF indexé. 3 tentatives (une ligne
 *    `renders` par tentative) ; au-delà, le bulletin passe `FAILED` avec la cause, l'événement `render_failed` est publié et
 *    le lot continue (le bouton de reprise republie une demande). Idempotent : un bulletin déjà rendu est ignoré ;
 *  - `reportcards.render-requested`   `reportcards.report_card.render_requested` -> même traitement (reprise explicite) ;
 *  - `reportcards.combine-batch`      `reportcards.batch.completed` -> PDF combiné de la classe (pdf-lib), clé sur le lot ;
 *  - `reportcards.seed-templates`     `tenancy.tenant.provisioned` -> gabarits de plateforme livrés (idempotent, table globale).
 *
 * Le worker n'a ni la clé de signature (la signature est faite à l'émission, côté API) ni accès réseau pendant le rendu. Les
 * images (logo, signatures) sont lues depuis le stockage objet. Variables : `REPORTCARDS_S3_*`, `REPORTCARDS_VERIFICATION_BASE_URL`
 * (ou `V2_APP_BASE_URL`), `REPORTCARDS_CHROME_PATH`, `REPORTCARDS_CHROME_NO_SANDBOX`, `REPORTCARDS_RENDER_CONCURRENCY`.
 * `puppeteer` n'est pas embarqué dans le bundle : l'image du worker l'installe avec Chromium.
 */
import { defineSubscriber, type EventHandlerContext, type SubscriberDefinition } from "@ecoledigitale/worker/sdk";
import { isUuid, type AppError } from "@ecoledigitale/kernel";
import { createReportcardsDeps, type ReportcardsDeps } from "./application/deps";
import { ensureBuiltinTemplates } from "./application/platform";
import type { PdfMerger, PdfRenderer, StoragePort } from "./application/ports";
import { buildCombinedPdf, renderReportCard } from "./application/render";
import { ConsumedEvents, ReportcardsEvents } from "./domain/events";
import { PdfLibMerger } from "./infrastructure/pdf-merger";
import { puppeteerRendererFromEnv } from "./infrastructure/puppeteer-renderer";
import { s3StorageFromEnv } from "./infrastructure/storage-s3";
import { reportcardsWorkerOverrides } from "./infrastructure/worker-resources";

export const RENDER_ATTEMPTS = 3;

interface WorkerResources {
  storage: StoragePort | null;
  renderer: PdfRenderer;
  merger: PdfMerger;
}

let resources: { value: WorkerResources; version: number } | null = null;

/**
 * Ressources du worker (stockage, Chromium) créées une seule fois par processus. L'assemblage de la plateforme peut injecter
 * le stockage (S3 / MinIO ou repli disque), le moteur PDF ou la fusion (`setReportcardsWorkerResources`) ; sans injection :
 * variables `REPORTCARDS_S3_*` et Chromium local, comme avant.
 */
function workerResources(): WorkerResources {
  const { overrides, version } = reportcardsWorkerOverrides();
  if (!resources || resources.version !== version) {
    resources = {
      version,
      value: {
        storage: overrides.storage !== undefined ? overrides.storage : s3StorageFromEnv(process.env),
        renderer: overrides.renderer ?? puppeteerRendererFromEnv(process.env),
        merger: overrides.merger ?? new PdfLibMerger(),
      },
    };
  }
  return resources.value;
}

/** Dépendances d'un abonné. Injectables : les tests passent leurs propres ports (stockage mémoire, rendu factice). */
export type DepsFactory = (ctx: EventHandlerContext) => ReportcardsDeps;

const defaultDeps: DepsFactory = (ctx) => {
  const r = workerResources();
  const base = (process.env.REPORTCARDS_VERIFICATION_BASE_URL ?? process.env.V2_APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return createReportcardsDeps({
    db: ctx.tenantDb,
    systemDb: ctx.systemDb,
    logger: ctx.logger,
    ports: { ...(r.storage ? { storage: r.storage } : {}), renderer: r.renderer, merger: r.merger },
    config: { verificationBaseUrl: base || null },
  });
};

/** Lit un identifiant UUID dans une charge d'événement (`reportCardId`, `batchId`). Exporté pour le test de contrat. */
export function pickUuid(payload: unknown, key: string): string | undefined {
  const v = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" && isUuid(v) ? v : undefined;
}

function handleRender(depsOf: DepsFactory) {
  return async (event: { id: string; payload: unknown }, ctx: EventHandlerContext): Promise<void> => {
    const reportCardId = pickUuid(event.payload, "reportCardId");
    if (!reportCardId) return ctx.logger.warn({ eventId: event.id }, "reportcards : reportCardId absent du payload") as unknown as void;
    const result = await renderReportCard(depsOf(ctx), ctx.db.ctx, { reportCardId, attempt: ctx.attempt, maxAttempts: RENDER_ATTEMPTS });
    if (result.ok) return;
    const error: AppError = result.error;
    const final = (error.details as { final?: boolean } | undefined)?.final === true;
    if (error.kind === "not_found") return ctx.logger.warn({ reportCardId }, "reportcards : bulletin introuvable, rendu ignoré") as unknown as void;
    if (final) {
      // Échec définitif déjà enregistré (renders FAILED, bulletin FAILED, événement render_failed) : pas de dead-letter, reprise explicite.
      ctx.logger.error({ reportCardId, code: error.code }, "reportcards : rendu définitivement en échec");
      return;
    }
    throw error; // transitoire : la file rejoue (backoff)
  };
}

export function buildSubscribers(depsOf: DepsFactory): SubscriberDefinition[] {
  const retry = { attempts: RENDER_ATTEMPTS, backoffMs: 2_000, maxBackoffMs: 60_000 };
  return [
    defineSubscriber({ name: "reportcards.render-snapshot", pattern: ReportcardsEvents.SNAPSHOT_CREATED, retry, concurrency: 2, timeoutMs: 120_000, handler: handleRender(depsOf) }),
    defineSubscriber({ name: "reportcards.render-requested", pattern: ReportcardsEvents.RENDER_REQUESTED, retry, concurrency: 2, timeoutMs: 120_000, handler: handleRender(depsOf) }),
    defineSubscriber({
      name: "reportcards.combine-batch",
      pattern: ReportcardsEvents.BATCH_COMPLETED,
      retry: { attempts: 3, backoffMs: 5_000, maxBackoffMs: 60_000 },
      concurrency: 1,
      timeoutMs: 300_000,
      handler: async (event, ctx) => {
        const batchId = pickUuid(event.payload, "batchId");
        if (!batchId) return;
        const result = await buildCombinedPdf(depsOf(ctx), ctx.db.ctx, { batchId });
        if (result.ok) return;
        if (result.error.code === "reportcards.not_rendered" || result.error.kind === "not_found") {
          ctx.logger.warn({ batchId, code: result.error.code }, "reportcards : pas de PDF combiné (aucun rendu dans le lot)");
          return;
        }
        throw result.error;
      },
    }),
    defineSubscriber({
      name: "reportcards.seed-templates",
      pattern: ConsumedEvents.TENANT_PROVISIONED,
      retry: { attempts: 5, backoffMs: 1_000, maxBackoffMs: 60_000 },
      handler: async (_event, ctx) => {
        const result = await ensureBuiltinTemplates(depsOf(ctx));
        if (!result.ok) throw result.error;
        if (result.value.published.length) ctx.logger.info({ templates: result.value.published }, "reportcards : gabarits de plateforme publiés");
      },
    }),
  ];
}

export default buildSubscribers(defaultDeps);
