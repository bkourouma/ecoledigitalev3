/**
 * Abonnés du module "zz_gate_13b6ce" pour apps/worker (découverts automatiquement : modules/<key>/subscribers.ts).
 * Le worker consomme l'outbox (kernel.domain_events) : chaque abonné reçoit les événements dont le type correspond
 * à son motif. Aucun abonné par défaut : le tableau vide est valide.
 *
 * En production le worker EMBARQUE les modules dans son bundle : après avoir ajouté ou modifié un abonné,
 * reconstruisez-le (pnpm --filter @ecoledigitale/worker build).
 *
 * Règles : nom STABLE et unique (clé d'idempotence), handler idempotent (idempotent(...) réserve
 * (abonné, id d'événement) dans la même transaction), effets externes (e-mail, HTTP) hors transaction ou avec
 * leur propre clé d'idempotence, aucun import d'un autre module autre que son index.ts.
 */

// import { defineSubscriber, idempotent } from "@ecoledigitale/worker/sdk";
//
// export default [
//   defineSubscriber({
//     name: "zz_gate_13b6ce.on-tenant-provisioned",
//     pattern: "tenancy.tenant.provisioned", // type exact, motif ("tenancy.*", "tenancy.**") ou RegExp
//     retry: { attempts: 5, backoffMs: 1_000, maxBackoffMs: 60_000 },
//     handler: idempotent("zz_gate_13b6ce.on-tenant-provisioned", async (event, ctx, tx) => {
//       // tx : transaction du tenant de l'événement (RLS). ctx.logger, ctx.tenantId, ctx.tenantDb disponibles.
//       await tx.query("SELECT 1");
//     }),
//   }),
// ];

export default [];
