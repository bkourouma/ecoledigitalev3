/**
 * Compatibilité fastify 4 -> 5 (platform/http-compat.ts) : DELETE / OPTIONS JSON sans corps, paramètre d'URL trop long.
 * Chaque cas est vérifié AVEC le correctif et SANS (documente ce que Fastify 5 fait par défaut).
 */
import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { bodylessMethodsCompat, compatRouterOptions } from "../src/platform/http-compat";

async function build(compat: boolean): Promise<FastifyInstance> {
  const app = Fastify({ ...(compat ? { routerOptions: { ...compatRouterOptions(), maxParamLength: 50 } } : { routerOptions: { maxParamLength: 50 } }) });
  if (compat) await app.register(bodylessMethodsCompat);
  app.delete("/things/:id", async (request) => ({ id: (request.params as { id: string }).id, body: request.body ?? null }));
  app.post("/things", async (request) => ({ body: request.body ?? null }));
  await app.register(
    async (scope) => {
      scope.setNotFoundHandler((_request, reply) => reply.status(404).send({ neutral: true }));
      scope.get("/verify/:code", async () => ({ ok: true }));
    },
    { prefix: "/public" },
  );
  await app.ready();
  return app;
}

describe("DELETE JSON sans corps (comportement de fastify 4)", () => {
  it("sans correctif : fastify 5 répond 400 avant tout handler (raison d'être du plugin)", async () => {
    const app = await build(false);
    const res = await app.inject({ method: "DELETE", url: "/things/1", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("avec le correctif : le handler est atteint, comme en fastify 4", async () => {
    const app = await build(true);
    const res = await app.inject({ method: "DELETE", url: "/things/1", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "1", body: null });
    await app.close();
  });

  it("un corps réellement envoyé est toujours lu ; `Content-Length: 0` + JSON reste refusé (comme en fastify 4)", async () => {
    const app = await build(true);
    const withBody = await app.inject({ method: "DELETE", url: "/things/2", headers: { "content-type": "application/json" }, payload: { reason: "doublon" } });
    expect(withBody.statusCode).toBe(200);
    expect(withBody.json()).toEqual({ id: "2", body: { reason: "doublon" } });
    const zeroLength = await app.inject({ method: "DELETE", url: "/things/3", headers: { "content-type": "application/json", "content-length": "0" } });
    expect(zeroLength.statusCode).toBe(400);
    await app.close();
  });

  it("ne touche pas aux méthodes à corps : un POST JSON vide reste un 400", async () => {
    const app = await build(true);
    const res = await app.inject({ method: "POST", url: "/things", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("paramètre d'URL plus long que maxParamLength", () => {
  const long = "a".repeat(200);

  it("sans correctif : fastify 5.12 répond lui-même 414 (distinguable d'un code inconnu)", async () => {
    const app = await build(false);
    const res = await app.inject({ url: `/public/verify/${long}` });
    expect(res.statusCode).toBe(414);
    await app.close();
  });

  it("avec le correctif : la route « non trouvée » du module répond, comme en fastify 4 (réponse uniforme)", async () => {
    const app = await build(true);
    const res = await app.inject({ url: `/public/verify/${long}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ neutral: true });
    const known = await app.inject({ url: "/public/verify/abc" });
    expect(known.statusCode).toBe(200);
    await app.close();
  });
});
