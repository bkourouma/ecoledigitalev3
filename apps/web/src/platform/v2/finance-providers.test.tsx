// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setTestApi } from "@/platform/test/api-mock";
import { json } from "@/platform/test/render";
import { PROVIDERS_BASE, useClearProviderCredentials, useFinanceProviders, useRotateProviderSecrets, useSaveProvider, useSetProviderEnabled, useTestProvider } from "./finance-providers";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const AT = "2026-10-01T09:30:00.000Z";
const provider = {
  provider: "wave",
  label: "Wave",
  description: "Paiement Wave.",
  enabled: false,
  configured: true,
  complete: true,
  missing: [],
  mode: "sandbox",
  sandboxAllowed: true,
  supportsRefund: true,
  webhookAuth: "signature",
  webhookUrl: null,
  fields: [{ key: "api_key", label: "Clé API", secret: true, required: true, kind: "text", generated: false, isSet: true, value: null }],
  lastTest: null,
  updatedAt: AT,
  activeAccount: "TENANT",
  platformFallbackReady: false,
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return { client, wrap: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}

describe("client typé des fournisseurs de paiement", () => {
  it("GET /providers : liste validée par le contrat", async () => {
    const api = setTestApi({ "GET /api/v1/finance/providers": { items: [provider], secretsAvailable: true, environment: "test" } });
    const { wrap } = wrapper();
    const { result } = renderHook(() => useFinanceProviders(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.provider).toBe("wave");
    expect(api.calls[0]).toMatchObject({ method: "GET", path: PROVIDERS_BASE });
  });

  it("réponse non conforme au contrat (mode inconnu) : refusée", async () => {
    setTestApi({ "GET /api/v1/finance/providers": { items: [{ ...provider, mode: "demo" }], secretsAvailable: true, environment: "test" } });
    const { wrap } = wrapper();
    const { result } = renderHook(() => useFinanceProviders(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("PUT /providers/:provider : corps transmis tel quel, identifiant seulement dans le chemin ; variables libérées après reset", async () => {
    const api = setTestApi({ "PUT /api/v1/finance/providers/wave": provider });
    const { wrap, client } = wrapper();
    const { result } = renderHook(() => useSaveProvider(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ provider: "wave", body: { mode: "sandbox", secrets: { api_key: "TOP-SECRET" } } });
    });
    expect(api.calls[0]).toMatchObject({ method: "PUT", path: "/api/v1/finance/providers/wave", body: { mode: "sandbox", secrets: { api_key: "TOP-SECRET" } } });
    // Une fois l'observateur libéré (`reset()` de l'écran), gcTime: 0 retire la mutation (et donc ses secrets) du cache.
    act(() => result.current.reset());
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });

  it("PATCH /providers/:provider/status", async () => {
    const api = setTestApi({ "PATCH /api/v1/finance/providers/wave/status": { ...provider, enabled: true } });
    const { wrap } = wrapper();
    const { result } = renderHook(() => useSetProviderEnabled(), { wrapper: wrap });
    await act(async () => {
      const dto = await result.current.mutateAsync({ provider: "wave", enabled: true });
      expect(dto.enabled).toBe(true);
    });
    expect(api.calls[0]).toMatchObject({ method: "PATCH", path: "/api/v1/finance/providers/wave/status", body: { enabled: true } });
  });

  it("POST /providers/:provider/test : résultat { ok, code, at }", async () => {
    const api = setTestApi({ "POST /api/v1/finance/providers/wave/test": { ok: false, code: "credentials_rejected", at: AT } });
    const { wrap } = wrapper();
    const { result } = renderHook(() => useTestProvider(), { wrapper: wrap });
    await act(async () => {
      expect(await result.current.mutateAsync({ provider: "wave" })).toEqual({ ok: false, code: "credentials_rejected", at: AT });
    });
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "/api/v1/finance/providers/wave/test" });
    expect(api.calls[0]!.body).toBeUndefined();
  });

  it("DELETE /providers/:provider/credentials", async () => {
    const api = setTestApi({ "DELETE /api/v1/finance/providers/wave/credentials": { ...provider, configured: false } });
    const { wrap } = wrapper();
    const { result } = renderHook(() => useClearProviderCredentials(), { wrapper: wrap });
    await act(async () => {
      await result.current.mutateAsync({ provider: "wave" });
    });
    expect(api.calls[0]).toMatchObject({ method: "DELETE", path: "/api/v1/finance/providers/wave/credentials" });
  });

  it("POST /providers/rotate-secrets : { rotated, keyId }", async () => {
    const api = setTestApi({ "POST /api/v1/finance/providers/rotate-secrets": () => json({ rotated: 2, keyId: "k2" }) });
    const { wrap } = wrapper();
    const { result } = renderHook(() => useRotateProviderSecrets(), { wrapper: wrap });
    await act(async () => {
      expect(await result.current.mutateAsync()).toEqual({ rotated: 2, keyId: "k2" });
    });
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "/api/v1/finance/providers/rotate-secrets" });
  });
});
