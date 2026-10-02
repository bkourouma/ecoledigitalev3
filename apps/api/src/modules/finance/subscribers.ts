/**
 * Abonnés du module `finance` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `finance.instantiate-pack`  `tenancy.institution.created` -> catégories de frais du modèle de pack (`REGISTRATION` et
 *    `TUITION` pour PRIMARY et SECONDARY ; libellés seulement, AUCUN montant, aucun barème). Idempotent et non destructif
 *    (`instantiateFinancePack` : un frais existant n'est jamais modifié) ; un pack sans modèle (HIGHER, VIRTUAL) ne crée rien.
 *
 * Finance n'écoute rien d'autre : ses autres échanges passent par des ports (adaptateurs de plateforme) ou ses propres jobs.
 */
import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
import { z } from "zod";
import { audit, configureAuditFromEnv } from "../audit";
import { createFinanceDeps } from "./application/deps";
import { instantiateFinancePack } from "./application/pack";
import { financeAuditAdapter } from "./infrastructure/audit-adapter";

const institutionCreated = z.object({ institutionId: z.string().uuid(), pack: z.string() }).passthrough();

let auditConfigured = false;

export default [
  defineSubscriber({
    name: "finance.instantiate-pack",
    pattern: "tenancy.institution.created",
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    handler: idempotent("finance.instantiate-pack", async (event, ctx) => {
      const parsed = institutionCreated.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "finance : charge utile tenancy.institution.created illisible, ignorée");
        return;
      }
      if (!auditConfigured) {
        configureAuditFromEnv(audit, process.env, { logger: ctx.logger });
        auditConfigured = true;
      }
      const deps = createFinanceDeps({
        db: ctx.tenantDb,
        logger: ctx.logger,
        audit: financeAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
      });
      const r = await instantiateFinancePack(deps, ctx.db.ctx, { pack: parsed.data.pack });
      if (!r.ok) throw r.error;
      ctx.logger.info({ institutionId: parsed.data.institutionId, pack: parsed.data.pack, created: r.value.created.length, existing: r.value.existing.length }, "finance : modèle de pack appliqué");
    }),
  }),
];
