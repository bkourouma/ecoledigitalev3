/**
 * Compatibilité fastify 4 -> 5 : deux comportements de transport que Fastify 5 a durcis et dont dépendent l'API legacy,
 * les clients web et les routes publiques « à réponse uniforme » des modules (reportcards, admissions).
 *
 * 1. `DELETE` / `OPTIONS` portant `Content-Type: application/json` SANS corps.
 *    Fastify 4 ne lisait le corps de ces deux méthodes que si `Content-Length` ou `Transfer-Encoding` était présent.
 *    Fastify 5 les range parmi les méthodes « avec corps » : un `DELETE` JSON vide répond 400 (`FST_ERR_CTP_EMPTY_JSON_BODY`)
 *    AVANT toute garde d'authentification. Beaucoup de clients (fetch enveloppé, proxys) posent ce type de contenu par défaut.
 *    `bodylessMethodsCompat` retire l'en-tête `Content-Type` dans ce seul cas (exactement la condition de Fastify 4) :
 *    un corps réellement présent (Content-Length / Transfer-Encoding, même 0) est traité comme avant.
 *
 * 2. Paramètre d'URL plus long que `maxParamLength`.
 *    Fastify <= 5.0 invoquait la route « non trouvée » (404, y compris le `setNotFoundHandler` d'un module) ; Fastify 5.12
 *    répond lui-même 414 `FST_ERR_MAX_PARAM_LENGTH` (en faisant écho au chemin), ce qui distinguerait un code mal formé d'un code
 *    inconnu sur les routes publiques (AC4.5 de reportcards, réponses neutres d'admissions). `compatRouterOptions` rétablit le 404 :
 *    une clé `onMaxParamLength` explicitement `undefined` désactive le gestionnaire par défaut de Fastify.
 */
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

/** Options `routerOptions` à fusionner dans `Fastify({ ... })` (ex. `{ ...compatRouterOptions(), maxParamLength: 1024 }`). */
export function compatRouterOptions(): { onMaxParamLength: undefined } {
  return { onMaxParamLength: undefined };
}

function bodylessMethodsCompatPlugin(app: FastifyInstance, _options: FastifyPluginOptions, done: () => void): void {
  app.addHook("onRequest", (request, _reply, hookDone) => {
    const method = request.method;
    if (method === "DELETE" || method === "OPTIONS") {
      const headers = request.headers;
      if (headers["content-type"] !== undefined && headers["content-length"] === undefined && headers["transfer-encoding"] === undefined) {
        delete headers["content-type"];
      }
    }
    hookDone();
  });
  done();
}

/** Plugin sans encapsulation : à enregistrer en tête de l'application (avant les routes). */
export const bodylessMethodsCompat = fp(bodylessMethodsCompatPlugin, { name: "bodyless-methods-compat", fastify: "5.x" });
