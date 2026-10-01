// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/platform/api/client";
import { createQueryHooks } from "@/platform/api/hooks";
import { useTenantTheme } from "./TenantTheme";
import { DEFAULT_BRAND, buildBrandVariables, hexToRgbTriplet, sanitizeColor, sanitizeLogoUrl } from "./theme";

describe("sanitize", () => {
  it("couleurs : hex strict normalisé, le reste refusé", () => {
    expect(sanitizeColor("#ABC")).toBe("#aabbcc");
    expect(sanitizeColor(" #0A1B2C ")).toBe("#0a1b2c");
    for (const bad of ["red", "#12", "#12345g", "rgb(0,0,0)", "#fff; background:url(x)", "", null, undefined]) {
      expect(sanitizeColor(bad as string)).toBeNull();
    }
  });

  it("logo : https ou chemin interne uniquement, sans caractère dangereux pour url()", () => {
    expect(sanitizeLogoUrl("https://cdn.exemple.ci/logo.png")).toBe("https://cdn.exemple.ci/logo.png");
    expect(sanitizeLogoUrl("/logos/ipam.png")).toBe("/logos/ipam.png");
    for (const bad of [
      "http://exemple.ci/l.png",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,AAAA",
      "//evil.example/l.png",
      'https://x.ci/a.png");background:red;("',
      "https://x.ci/a b.png",
      "",
      null,
    ]) {
      expect(sanitizeLogoUrl(bad as string)).toBeNull();
    }
  });

  it("hexToRgbTriplet", () => {
    expect(hexToRgbTriplet("#2563eb")).toBe("37 99 235");
  });
});

describe("buildBrandVariables", () => {
  it("valeurs par défaut EcoleDigitale sans profil", () => {
    expect(buildBrandVariables(null)).toEqual({
      "--brand-primary": DEFAULT_BRAND.primary,
      "--brand-secondary": DEFAULT_BRAND.secondary,
      "--brand-primary-rgb": "37 99 235",
      "--brand-secondary-rgb": "5 150 105",
      "--brand-logo-url": "none",
    });
  });

  it("applique le profil, valeur par valeur, avec repli sur les défauts si invalide", () => {
    const vars = buildBrandVariables({ theme: { primaryColor: "#112233", secondaryColor: "pas-une-couleur", logoUrl: "https://cdn.ci/l.svg" } });
    expect(vars["--brand-primary"]).toBe("#112233");
    expect(vars["--brand-secondary"]).toBe(DEFAULT_BRAND.secondary);
    expect(vars["--brand-logo-url"]).toBe('url("https://cdn.ci/l.svg")');
  });

  it("ne touche jamais aux variables du thème par rôle", () => {
    expect(Object.keys(buildBrandVariables(null)).some((k) => k.includes("role"))).toBe(false);
  });
});

function setup(handler: () => Response) {
  const client = createApiClient({ baseUrl: "", getTenant: () => "ipam", getToken: () => "t", fetch: (async () => handler()) as unknown as typeof fetch, sleep: async () => undefined });
  const hooks = createQueryHooks(client);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { hooks, wrapper };
}

describe("useTenantTheme", () => {
  const root = document.documentElement;

  it("pose les défauts, puis le profil de l'API ; laisse [data-role] tranquille", async () => {
    root.setAttribute("data-role", "admin");
    root.style.setProperty("--role-primary", "37 99 235");
    const { hooks, wrapper } = setup(
      () => new Response(JSON.stringify({ theme: { primaryColor: "#c0ffee" } }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const { unmount } = renderHook(() => useTenantTheme(hooks, true), { wrapper });
    expect(root.style.getPropertyValue("--brand-primary")).toBe(DEFAULT_BRAND.primary);

    await waitFor(() => expect(root.style.getPropertyValue("--brand-primary")).toBe("#c0ffee"));
    expect(root.style.getPropertyValue("--brand-secondary")).toBe(DEFAULT_BRAND.secondary);
    expect(root.style.getPropertyValue("--role-primary")).toBe("37 99 235");
    expect(root.getAttribute("data-role")).toBe("admin");

    unmount();
    expect(root.style.getPropertyValue("--brand-primary")).toBe("");
    root.removeAttribute("data-role");
    root.style.removeProperty("--role-primary");
  });

  it("endpoint indisponible : les défauts restent en place", async () => {
    const fetchSpy = vi.fn(() => new Response("{}", { status: 404 }));
    const { hooks, wrapper } = setup(fetchSpy);
    renderHook(() => useTenantTheme(hooks, true), { wrapper });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(root.style.getPropertyValue("--brand-primary")).toBe(DEFAULT_BRAND.primary);
  });

  it("non connecté : aucune requête", async () => {
    const fetchSpy = vi.fn(() => new Response("{}", { status: 200 }));
    const { hooks, wrapper } = setup(fetchSpy);
    renderHook(() => useTenantTheme(hooks, false), { wrapper });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(root.style.getPropertyValue("--brand-primary")).toBe(DEFAULT_BRAND.primary);
  });
});
