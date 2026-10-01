import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, ClientErrorCode, isApiError, normalizeErrorResponse } from "./errors";
import { buildQueryString, createApiClient, joinUrl, type ApiClientOptions } from "./client";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function rejectOnAbort(signal: AbortSignal | null | undefined, reject: (e: unknown) => void) {
  const fail = () => reject(new DOMException("Aborted", "AbortError"));
  if (signal?.aborted) fail();
  else signal?.addEventListener("abort", fail);
}

function makeClient(fetchMock: ApiClientOptions["fetch"], extra: Partial<ApiClientOptions> = {}) {
  return createApiClient({
    baseUrl: "https://api.test/",
    getTenant: () => "ipam",
    getToken: () => "tok",
    fetch: fetchMock,
    sleep: async () => undefined,
    random: () => 0.5,
    ...extra,
  });
}

describe("createApiClient — en-têtes et URL", () => {
  it("ajoute X-Tenant, Authorization et la query string", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    const client = makeClient(fetchMock);
    await client.get("/api/v1/students", { query: { page: 2, ids: ["a", "b"], q: undefined, d: null } });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/students?page=2&ids=a&ids=b");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ "X-Tenant": "ipam", Authorization: "Bearer tok", Accept: "application/json" });
  });

  it("sérialise le corps JSON des POST", async () => {
    const fetchMock = vi.fn(async () => json({ id: 1 }, { status: 201 }));
    const client = makeClient(fetchMock);
    await client.post("/x", { a: 1 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("refuse d'appeler l'API sans tenant (état explicite, aucun repli)", async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock, { getTenant: () => null });
    await expect(client.get("/x")).rejects.toMatchObject({ code: ClientErrorCode.TENANT_UNKNOWN });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("une requête anonymous n'exige ni tenant ni jeton", async () => {
    const fetchMock = vi.fn(async () => json({ ok: 1 }));
    const client = makeClient(fetchMock, { getTenant: () => null });
    await client.get("/public", { anonymous: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("X-Tenant");
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("renvoie undefined sur 204", async () => {
    const client = makeClient(async () => new Response(null, { status: 204 }));
    await expect(client.delete("/x")).resolves.toBeUndefined();
  });

  it("buildQueryString / joinUrl", () => {
    expect(buildQueryString({ d: new Date("2026-01-02T03:04:05Z") })).toBe("?d=2026-01-02T03%3A04%3A05.000Z");
    expect(buildQueryString({})).toBe("");
    expect(joinUrl("", "/a")).toBe("/a");
    expect(joinUrl("http://h/", "a")).toBe("http://h/a");
    expect(joinUrl("http://h", "https://autre/x")).toBe("https://autre/x");
  });
});

describe("createApiClient — erreurs normalisées", () => {
  it("format kernel { code, message, details }", async () => {
    const client = makeClient(async () =>
      json({ code: "finance.invoice_already_paid", message: "Déjà payée.", details: { invoiceId: "i1" } }, { status: 409 }),
    );
    const error = await client.get("/x").catch((e) => e);
    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ code: "finance.invoice_already_paid", message: "Déjà payée.", status: 409, details: { invoiceId: "i1" } });
  });

  it("enveloppe { error: { ... } } et requestId en en-tête", async () => {
    const client = makeClient(async () =>
      json({ error: { code: "FORBIDDEN", message: "Non." } }, { status: 403, headers: { "x-request-id": "r-1", "content-type": "application/json" } }),
    );
    const error = (await client.get("/x").catch((e) => e)) as ApiError;
    expect(error).toMatchObject({ code: "FORBIDDEN", message: "Non.", status: 403, requestId: "r-1" });
    expect(error.isForbidden).toBe(true);
  });

  it("anciens formats de l'API legacy", () => {
    expect(normalizeErrorResponse(404, { error: "Introuvable" })).toMatchObject({ code: "NOT_FOUND", message: "Introuvable" });
    expect(normalizeErrorResponse(400, { message: "Mauvais" })).toMatchObject({ code: "VALIDATION_FAILED", message: "Mauvais" });
    expect(normalizeErrorResponse(500, "<html>boom</html>")).toMatchObject({ code: "INTERNAL", status: 500 });
    expect(normalizeErrorResponse(401, undefined)).toMatchObject({ code: "UNAUTHORIZED", message: "Authentification requise." });
  });

  it("issues de validation regroupées dans details", () => {
    const e = normalizeErrorResponse(400, { code: "VALIDATION_FAILED", message: "KO", issues: [{ path: ["a"], message: "m" }] });
    expect(e.details).toEqual({ issues: [{ path: ["a"], message: "m" }] });
  });

  it("appelle onUnauthorized sur 401 sans réessayer", async () => {
    const fetchMock = vi.fn(async () => json({ code: "UNAUTHORIZED", message: "Expirée." }, { status: 401 }));
    const onUnauthorized = vi.fn();
    const client = makeClient(fetchMock, { onUnauthorized });
    await expect(client.get("/x")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createApiClient — validation Zod des réponses", () => {
  const schema = z.object({ id: z.string(), total: z.number() });

  it("renvoie les données typées et validées", async () => {
    const client = makeClient(async () => json({ id: "a", total: 3, extra: "ignoré" }));
    const data = await client.get("/x", { schema });
    expect(data).toEqual({ id: "a", total: 3 });
  });

  it("échoue avec RESPONSE_INVALID si la réponse ne respecte pas le contrat", async () => {
    const fetchMock = vi.fn(async () => json({ id: 1 }));
    const client = makeClient(fetchMock);
    const error = (await client.get("/x", { schema }).catch((e) => e)) as ApiError;
    expect(error.code).toBe(ClientErrorCode.RESPONSE_INVALID);
    expect((error.details as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // pas de retry sur un contrat violé
  });
});

describe("createApiClient — retries", () => {
  it("réessaie un GET sur 503 puis réussit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: "KO" }, { status: 503 }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = makeClient(fetchMock);
    await expect(client.get("/x")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("réessaie sur erreur réseau puis abandonne après `retries`", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = makeClient(fetchMock, { retries: 2 });
    await expect(client.get("/x")).rejects.toMatchObject({ code: ClientErrorCode.NETWORK });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ne réessaie pas un POST sans clé d'idempotence", async () => {
    const fetchMock = vi.fn(async () => json({ message: "KO" }, { status: 503 }));
    const client = makeClient(fetchMock);
    await expect(client.post("/x", {})).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("réessaie un POST avec idempotencyKey et envoie l'en-tête", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, { status: 502 }))
      .mockResolvedValueOnce(json({ id: 1 }, { status: 201 }));
    const client = makeClient(fetchMock);
    await client.post("/x", {}, { idempotencyKey: "k-1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k-1");
  });

  it("ne réessaie pas une erreur 4xx métier", async () => {
    const fetchMock = vi.fn(async () => json({ code: "CONFLICT", message: "x" }, { status: 409 }));
    const client = makeClient(fetchMock);
    await expect(client.get("/x")).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("respecte Retry-After (plafonné)", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    const client = makeClient(fetchMock, { sleep });
    await client.get("/x");
    expect(sleep).toHaveBeenCalledWith(2000, undefined);
  });

  it("backoff exponentiel avec jitter", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("x"));
    const client = makeClient(fetchMock, { sleep, retryDelayMs: 100, random: () => 0 });
    await client.get("/x").catch(() => undefined);
    // random=0 -> facteur 0.5 : 100*1*0.5 puis 100*2*0.5
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([50, 100]);
  });
});

describe("createApiClient — annulation et délai", () => {
  it("rejette immédiatement si le signal est déjà annulé", async () => {
    const fetchMock = vi.fn();
    const client = makeClient(fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(client.get("/x", { signal: controller.signal })).rejects.toMatchObject({ code: ClientErrorCode.ABORTED });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("annule la requête en vol (ABORTED, sans retry)", async () => {
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          rejectOnAbort(init?.signal, reject);
        }),
    );
    const client = makeClient(fetchMock as unknown as typeof fetch);
    const controller = new AbortController();
    const promise = client.get("/x", { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: ClientErrorCode.ABORTED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("TIMEOUT quand le serveur ne répond pas à temps", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            rejectOnAbort(init?.signal, reject);
          }),
      );
      const client = makeClient(fetchMock as unknown as typeof fetch, { timeoutMs: 1000, retries: 0 });
      const promise = client.get("/x").catch((e) => e);
      await vi.advanceTimersByTimeAsync(1001);
      await expect(promise).resolves.toMatchObject({ code: ClientErrorCode.TIMEOUT });
    } finally {
      vi.useRealTimers();
    }
  });
});
