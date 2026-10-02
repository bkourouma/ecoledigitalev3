import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { IntlProvider } from "@/platform/i18n/IntlProvider";
import { createApiClient, type ApiClient } from "@/platform/api/client";
import { createQueryHooks, type QueryHooks } from "@/platform/api/hooks";

/** Rend un composant avec les traductions `fr-CI` réelles et un cache react-query neuf (aucune nouvelle tentative). */
export function renderWithProviders(ui: ReactElement, queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <IntlProvider>{children}</IntlProvider>
    </QueryClientProvider>
  );
  return { ...render(ui, { wrapper }), queryClient: client };
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

/** Lit un `Blob` en octets (jsdom n'implémente pas toujours `Blob.arrayBuffer`). */
export function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export type RouteHandler =(request: { method: string; url: URL; body: unknown }) => Response | Promise<Response> | undefined;

/**
 * Client API de test : un faux `fetch` qui route par `METHOD /chemin`. Chaque appel est consigné dans `calls`.
 * Une route non déclarée répond 404 (le test échoue alors par un message explicite plutôt qu'un appel réseau réel).
 */
export function createTestApi(routes: Record<string, RouteHandler | unknown>): {
  client: ApiClient;
  hooks: QueryHooks;
  calls: Array<{ method: string; path: string; query: Record<string, string>; body: unknown; headers: Record<string, string> }>;
} {
  const calls: Array<{ method: string; path: string; query: Record<string, string>; body: unknown; headers: Record<string, string> }> = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), "http://test.local");
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (typeof Blob !== "undefined" && init?.body instanceof Blob) {
      // Corps binaire (dépôt de pièce) : octets exacts, pour les vérifier dans les tests.
      body = await readBytes(init.body);
    } else if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const query = Object.fromEntries(url.searchParams.entries());
    calls.push({ method, path: url.pathname, query, body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const handler = routes[`${method} ${url.pathname}`];
    if (handler === undefined) return json({ code: "NOT_FOUND", message: `Route de test absente : ${method} ${url.pathname}` }, { status: 404 });
    if (typeof handler === "function") {
      const out = await (handler as RouteHandler)({ method, url, body });
      if (out) return out;
      return json({ code: "NOT_FOUND", message: "Aucune réponse" }, { status: 404 });
    }
    return json(handler);
  };
  const client = createApiClient({ baseUrl: "", getTenant: () => "ecole-test", getToken: () => "jeton", fetch: fetchMock as unknown as typeof fetch, sleep: async () => undefined, retries: 0 });
  return { client, hooks: createQueryHooks(client), calls };
}
