/**
 * Outils de test des écrans d'administration (non exécuté seul : pas de suffixe `.test`).
 *
 *   const h = vi.hoisted(() => ({ fetchMock: vi.fn() }));
 *   vi.mock("@/platform/api/default-client", async () => (await import("@/platform/admin/test-utils")).defaultClientModule(h.fetchMock));
 *
 *   routes(h.fetchMock, { "GET /api/v1/audit/logs": () => json({ items: [], nextCursor: null }) });
 *   renderScreen(<AuditPage />);
 *
 * Aucune requête réseau réelle : tout passe par `fetchMock` (le vrai client API, avec sa validation Zod, tourne).
 */

import { createElement, type ReactElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import { createApiClient } from "@/platform/api/client";
import { createQueryHooks } from "@/platform/api/hooks";
import { IntlProvider } from "@/platform/i18n/IntlProvider";

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function apiError(status: number, code: string, message: string, details?: unknown): Response {
  return json({ code, message, ...(details !== undefined ? { details } : {}) }, { status });
}

export function text(body: string, contentType = "text/csv; charset=utf-8"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

/** Module de remplacement de `@/platform/api/default-client` (client réel, `fetch` simulé). */
export function defaultClientModule(fetchMock: Mock, tenant: string | null = "ipam") {
  const platformApi = createApiClient({
    baseUrl: "",
    getTenant: () => tenant,
    getToken: () => "test-token",
    requireToken: true,
    fetch: (input, init) => fetchMock(input, init),
    retries: 0,
    sleep: async () => undefined,
  });
  return { platformApi, platformHooks: createQueryHooks(platformApi) };
}

/** Module de remplacement de `@/platform/admin/operator` (client sans tenant, jeton factice). */
export async function operatorModule(fetchMock: Mock) {
  const actual = await vi.importActual<typeof import("@/platform/admin/operator")>("@/platform/admin/operator");
  const operatorApi = actual.createOperatorClient({
    fetch: (input, init) => fetchMock(input, init),
    getToken: () => "operator-token",
    retries: 0,
    sleep: async () => undefined,
    onUnauthorized: () => undefined,
  });
  return { ...actual, operatorApi, operatorHooks: createQueryHooks(operatorApi) };
}

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}

export type RouteHandler = Response | ((call: RecordedCall) => Response | Promise<Response>);

/**
 * Programme `fetchMock` : clés `"METHOD /chemin"` (chemin exact, sans requête) ou `"METHOD /chemin/*"` (préfixe).
 * Route inconnue -> 404 `NOT_FOUND` (le test voit l'appel inattendu dans `calls`).
 */
export function routes(fetchMock: Mock, table: Record<string, RouteHandler>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = typeof init?.body === "string" ? init.body : undefined;
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const call: RecordedCall = { method, path: url.pathname, query: url.searchParams, body, headers: new Headers(init?.headers as HeadersInit) };
    calls.push(call);
    const exact = table[`${method} ${url.pathname}`];
    const prefixKey = Object.keys(table).find((k) => k.endsWith("/*") && `${method} ${url.pathname}`.startsWith(k.slice(0, -1)));
    const handler = exact ?? (prefixKey ? table[prefixKey] : undefined);
    if (!handler) return apiError(404, "NOT_FOUND", "Ressource introuvable.");
    return typeof handler === "function" ? handler(call) : handler.clone();
  });
  return calls;
}

export function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } } });
}

export function Providers({ children, client }: { children?: ReactNode; client?: QueryClient }) {
  return createElement(QueryClientProvider, { client: client ?? newQueryClient() }, createElement(IntlProvider, null, children));
}

export function renderScreen(ui: ReactElement, client?: QueryClient): RenderResult {
  return render(ui, { wrapper: ({ children }: { children: ReactNode }) => createElement(Providers, { client }, children) });
}
