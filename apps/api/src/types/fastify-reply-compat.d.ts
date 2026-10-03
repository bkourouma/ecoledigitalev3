// Fastify 5 (>= 5.x récents) restreint `reply.code()` / `reply.status()` aux clés de `schema.response` de la route
// (une route qui ne déclare que `201` refuse `reply.status(409)` à la compilation). Ce n'est qu'un contrôle de types :
// à l'exécution tout code de statut reste accepté. L'API legacy (src/routes) déclare des réponses partielles et renvoie
// 400/401/403/404/409/500 sans les décrire ; on rétablit la signature de fastify 4 (`number`) par fusion d'interface,
// plutôt que de réécrire plusieurs centaines d'appels sans gain fonctionnel.
// Les paramètres de type doivent être IDENTIQUES à ceux de `FastifyReply` dans fastify/types/reply.d.ts.
import type {
  ContextConfigDefault,
  FastifySchema,
  FastifyTypeProvider,
  FastifyTypeProviderDefault,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerBase,
  RawServerDefault,
  RouteGenericInterface,
} from "fastify";
import type { FastifyReplyType, ResolveFastifyReplyType } from "fastify/types/type-provider";

declare module "fastify" {
  interface FastifyReply<
    RouteGeneric extends RouteGenericInterface = RouteGenericInterface,
    RawServer extends RawServerBase = RawServerDefault,
    RawRequest extends RawRequestDefaultExpression<RawServer> = RawRequestDefaultExpression<RawServer>,
    RawReply extends RawReplyDefaultExpression<RawServer> = RawReplyDefaultExpression<RawServer>,
    ContextConfig = ContextConfigDefault,
    SchemaCompiler extends FastifySchema = FastifySchema,
    TypeProvider extends FastifyTypeProvider = FastifyTypeProviderDefault,
    ReplyType extends FastifyReplyType = ResolveFastifyReplyType<TypeProvider, SchemaCompiler, RouteGeneric>,
  > {
    code(statusCode: number): this;
    status(statusCode: number): this;
  }
}
