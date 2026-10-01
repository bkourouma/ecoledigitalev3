// Module de démonstration pour les tests de découverte (dev ET bundle).
import { defineSubscriber, idempotent } from "../../../../src/sdk";

export default [
  defineSubscriber({
    name: "demo.record",
    pattern: "demo.thing.happened",
    concurrency: 10,
    retry: { attempts: 3, backoffMs: 20, maxBackoffMs: 200 },
    handler: idempotent("demo.record", async (event, ctx, tx) => {
      await tx.query(
        "INSERT INTO public.wk_effects (id, tenant_id, event_id, subscriber) VALUES (gen_random_uuid(), $1, $2, 'demo.record')",
        [ctx.tenantId, event.id],
      );
    }),
  }),
];
