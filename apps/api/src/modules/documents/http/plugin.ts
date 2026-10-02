/**
 * Plugin Fastify du module "documents", chargé automatiquement par le registre.
 *
 * Contrat d'assemblage (platform/runtime.ts) :
 *  - export default async function (app, runtime) : routes SANS préfixe ; le registre applique /api/v1/documents
 *    et fournit le gestionnaire d'erreurs (kernel -> JSON) et la garde « request.ctx présent » (401 sinon) ;
 *  - export function setup(app, runtime) : FACULTATIF, appelé avant, sur l'instance RACINE (décorateurs partagés
 *    avec d'autres modules). Inutile pour un module qui n'expose rien aux autres.
 *
 * Une route sans contexte tenant (login, webhook signé) déclare { config: { public: true } } et s'authentifie elle-même.
 */
import type { FastifyInstance } from "fastify";
import { ValidationError } from "@ecoledigitale/kernel";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createItem, listItems } from "../application/items";
import type { ItemsDeps } from "../application/ports";
import { createItemBody } from "./schemas";

// export function setup(app: FastifyInstance, runtime: ModuleRuntime): void {
//   app.decorate("documents", { ... }); // lu par les AUTRES modules à la requête
// }

export default async function modulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  // runtime.auditPort est structurellement un AuditPort (audit.record dans la transaction du use case).
  const deps: ItemsDeps = { tenantDb: runtime.tenantDb, clock: runtime.clock, audit: runtime.auditPort };

  // Gardes : permission du manifeste (rbac), puis éventuellement une feature (entitlements) :
  //   preHandler: [runtime.requirePermission("documents.item.read"), runtime.entitlements.requireFeature("documents.premium")]
  // Un contrôle visant UNE ressource passe son périmètre : runtime.requirePermission(perm, { scope: ... }).
  app.get("/items", { preHandler: runtime.requirePermission("documents.item.read") }, async (request) => ({
    items: await listItems(deps, runtime.resolveContext(request)),
  }));

  app.post("/items", { preHandler: runtime.requirePermission("documents.item.create") }, async (request, reply) => {
    const body = createItemBody.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(
        "Données invalides.",
        body.error.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
      );
    }
    const result = await createItem(deps, runtime.resolveContext(request), body.data);
    if (!result.ok) throw result.error;
    return reply.status(201).send(result.value);
  });
}
