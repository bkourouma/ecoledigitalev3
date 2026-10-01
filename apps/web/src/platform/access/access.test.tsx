// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/platform/api/client";
import { createQueryHooks } from "@/platform/api/hooks";
import { createAccessHooks } from "./hooks";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function setup(handler: (url: string) => Response) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => handler(String(url)));
  const client = createApiClient({
    baseUrl: "",
    getTenant: () => "ipam",
    getToken: () => "tok",
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  const access = createAccessHooks(createQueryHooks(client));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { access, wrapper, fetchMock };
}

describe("usePermission", () => {
  const handler = (url: string) =>
    url.endsWith("/rbac/me/permissions") ? json({ permissions: ["grade.read", "finance.*"] }) : json({}, { status: 404 });

  it("accorde / refuse selon /rbac/me/permissions (jokers inclus)", async () => {
    const { access, wrapper } = setup(handler);
    const read = renderHook(() => access.usePermission("grade.read"), { wrapper });
    const enter = renderHook(() => access.usePermission("grade.enter"), { wrapper });
    const pay = renderHook(() => access.usePermission("finance.payment.create"), { wrapper });

    expect(read.result.current).toMatchObject({ allowed: false, isLoading: true });
    await waitFor(() => expect(read.result.current.allowed).toBe(true));
    await waitFor(() => expect(enter.result.current.isLoading).toBe(false));
    expect(enter.result.current.allowed).toBe(false);
    expect(pay.result.current.allowed).toBe(true);
  });

  it("une seule requête partagée entre tous les composants", async () => {
    const { access, wrapper, fetchMock } = setup(handler);
    const a = renderHook(() => access.usePermission("grade.read"), { wrapper });
    renderHook(() => access.usePermission("finance.x.y"), { wrapper });
    await waitFor(() => expect(a.result.current.allowed).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fail-closed : endpoint indisponible => refus + isUnavailable", async () => {
    const { access, wrapper } = setup(() => json({ message: "nope" }, { status: 404 }));
    const { result } = renderHook(() => access.usePermission("grade.read"), { wrapper });
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current).toMatchObject({ allowed: false, isLoading: false });
  });

  it("fail-closed : réponse non conforme au contrat", async () => {
    const { access, wrapper } = setup(() => json({ permissions: "grade.read" }));
    const { result } = renderHook(() => access.usePermission("grade.read"), { wrapper });
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.allowed).toBe(false);
  });
});

describe("useFeature", () => {
  it("lit /entitlements/me", async () => {
    const { access, wrapper } = setup((url) =>
      url.endsWith("/entitlements/me") ? json({ features: ["finance.online-payment"], plan: "pro" }) : json({}, { status: 404 }),
    );
    const on = renderHook(() => access.useFeature("finance.online-payment"), { wrapper });
    const off = renderHook(() => access.useFeature("virtual.live"), { wrapper });
    await waitFor(() => expect(on.result.current.allowed).toBe(true));
    await waitFor(() => expect(off.result.current.isLoading).toBe(false));
    expect(off.result.current.allowed).toBe(false);
    expect(off.result.current.isUnavailable).toBe(false);
  });

  it("indisponible => feature désactivée", async () => {
    const { access, wrapper } = setup(() => json({}, { status: 500 }));
    const { result } = renderHook(() => access.useFeature("x.y"), { wrapper });
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.allowed).toBe(false);
  });
});
