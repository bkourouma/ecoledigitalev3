/**
 * Abonnés du module `rules` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `rules.apply-pack-bindings`  `tenancy.institution.created` -> liaisons par défaut du pack vers les jeux de règles FICTIFS
 *    (`applyPackPlaceholderBindings`) : PRIMARY -> `CI-PRIMARY-PLACEHOLDER` ; SECONDARY -> `CI-SECONDARY-PLACEHOLDER` et
 *    `CI-EXAM-PLACEHOLDER` (examens nationaux) ; les autres packs n'ont aucune liaison par défaut.
 *
 * Garde-fous :
 *  - AUCUNE règle officielle n'est inventée : ces jeux sont des PLACEHOLDERS (`source_kind = placeholder`) ; tout résultat, bulletin
 *    ou PV qui en dérive porte le filigrane « règles de démonstration » ;
 *  - en PRODUCTION (`RULES_ENV` / `NODE_ENV`, défaut sûr), la liaison d'un jeu fictif exige l'accusé d'un utilisateur (permission
 *    sensible `rules.binding.accept_placeholder`) : l'abonné n'en fournit jamais, le refus `rules.placeholder_requires_ack` est
 *    donc journalisé et IGNORÉ (l'établissement lie lui-même le jeu officiel ou accuse explicitement le jeu fictif) ;
 *  - date d'effet : l'origine des temps de la plateforme (`2000-01-01`), jamais l'horloge. La liaison fictive couvre toute période
 *    tant qu'une liaison OFFICIELLE datée ne la remplace pas ; aucun résultat antérieur n'est recalculé (versions épinglées) ;
 *  - idempotent : même identité de liaison = mise à jour ; `idempotent()` marque l'événement traité.
 */
import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
import { z } from "zod";
import { audit } from "../audit";
import { createRulesDeps } from "./application/deps";
import { applyPackPlaceholderBindings, type PackBindingKey } from "./application/pack-bindings";
import { RulesCode } from "./domain/errors";

const institutionCreated = z.object({ institutionId: z.string().uuid(), pack: z.string() }).passthrough();

/** Origine des temps de la plateforme : date d'effet des liaisons fictives par défaut (voir l'en-tête). */
export const PACK_BINDING_EFFECTIVE_FROM = "2000-01-01";

const PACKS_OF: Readonly<Record<string, readonly PackBindingKey[]>> = Object.freeze({
  PRIMARY: ["PRIMARY"],
  SECONDARY: ["SECONDARY", "EXAMINATIONS"],
});

export default [
  defineSubscriber({
    name: "rules.apply-pack-bindings",
    pattern: "tenancy.institution.created",
    retry: { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 },
    handler: idempotent("rules.apply-pack-bindings", async (event, ctx) => {
      const parsed = institutionCreated.safeParse(event.payload);
      if (!parsed.success) {
        ctx.logger.warn({ eventId: event.id }, "rules : charge utile tenancy.institution.created illisible, ignorée");
        return;
      }
      const packs = PACKS_OF[parsed.data.pack] ?? [];
      if (packs.length === 0) return;
      const deps = createRulesDeps({
        db: ctx.tenantDb,
        systemDb: ctx.systemDb,
        logger: ctx.logger,
        audit: { record: (tx, entry) => audit.record(tx, entry as never), recordPlatform: (tx, entry) => audit.recordPlatform(tx, entry as never) },
      });
      for (const pack of packs) {
        const r = await applyPackPlaceholderBindings(deps, ctx.db.ctx, { pack, institutionId: parsed.data.institutionId, effectiveFrom: PACK_BINDING_EFFECTIVE_FROM });
        if (r.ok) {
          ctx.logger.info({ institutionId: parsed.data.institutionId, pack, bindings: r.value.length }, "rules : liaisons de démonstration du pack posées");
          continue;
        }
        if (r.error.code === RulesCode.PLACEHOLDER_REQUIRES_ACK) {
          ctx.logger.warn({ institutionId: parsed.data.institutionId, pack }, "rules : production, jeu de démonstration non lié sans accusé explicite (à lier par l'établissement)");
          continue;
        }
        throw r.error;
      }
    }),
  }),
];
