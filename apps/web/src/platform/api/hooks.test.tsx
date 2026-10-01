// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApiClient } from "./client";
import { buildQueryKey, createQueryHooks } from "./hooks";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function setup(tenant: string | null, fetchMock: typeof fetch) {
  let current = tenant;
  const client = createApiClient({
    baseUrl: "",
    getTenant: () => current,
    getToken: () => "tok",
    fetch: fetchMock,
    sleep: async () => undefined,
  });
  const hooks = createQueryHooks(client);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { hooks, queryClient, wrapper, setTenant: (t: string | null) => (current = t) };
}

describe("buildQueryKey", () => {
  it("inclut le tenant, de façon stable", () => {
    expect(buildQueryKey("ipam", ["students", { page: 1 }])).toEqual(["api", "ipam", "students", { page: 1 }]);
    expect(buildQueryKey(null, ["x"])).toEqual(["api", "no-tenant", "x"]);
    expect(buildQueryKey("  ", ["x"])).toEqual(["api", "no-tenant", "x"]);
  });
});

describe("createQueryHooks", () => {
  it("useApiQuery : requête, validation Zod, clé de cache avec tenant", async () => {
    const fetchMock = vi.fn(async () => json({ items: [1, 2] }));
    const { hooks, queryClient, wrapper } = setup("ipam", fetchMock);
    const schema = z.object({ items: z.array(z.number()) });

    const { result } = renderHook(() => hooks.useApiQuery(["list"], "/api/v1/things", { schema, query: { page: 1 } }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ items: [1, 2] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["api", "ipam", "list", { page: 1 }])).toEqual({ items: [1, 2] });
  });

  it("deux tenants ne partagent pas de cache", async () => {
    const fetchMock = vi.fn(async () => json({ v: 1 }));
    const a = setup("a", fetchMock);
    const b = setup("b", fetchMock);
    expect(a.hooks.queryKey("k")).toEqual(["api", "a", "k"]);
    expect(b.hooks.queryKey("k")).toEqual(["api", "b", "k"]);
  });

  it("n'émet aucune requête quand le tenant est inconnu", async () => {
    const fetchMock = vi.fn(async () => json({}));
    const { hooks, wrapper } = setup(null, fetchMock);
    const { result } = renderHook(() => hooks.useApiQuery(["list"], "/api/v1/things"), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("expose l'erreur normalisée", async () => {
    const fetchMock = vi.fn(async () => json({ code: "FORBIDDEN", message: "Non." }, { status: 403 }));
    const { hooks, wrapper } = setup("ipam", fetchMock);
    const { result } = renderHook(() => hooks.useApiQuery(["list"], "/api/v1/things", { retry: false }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("useApiMutation : envoie le corps et invalide les requêtes liées", async () => {
    const fetchMock = vi.fn(async () => json({ id: "n1" }, { status: 201 }));
    const { hooks, queryClient, wrapper } = setup("ipam", fetchMock);
    queryClient.setQueryData(["api", "ipam", "list"], [1]);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => hooks.useApiMutation<{ id: string }, { name: string }>({ path: "/api/v1/things", invalidate: [["list"]] }),
      { wrapper },
    );
    result.current.mutate({ name: "x" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/things");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"name":"x"}');
    expect(spy).toHaveBeenCalledWith({ queryKey: ["api", "ipam", "list"] });
  });
});
