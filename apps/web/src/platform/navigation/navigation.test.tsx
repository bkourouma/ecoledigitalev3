// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/platform/api/client";
import { createQueryHooks } from "@/platform/api/hooks";
import { PlatformSidebar, iconFor } from "./PlatformSidebar";
import { isPlatformNavEnabled, parsePlatformNavFlag, portalForRole } from "./portal";
import { NavigationResponseSchema, findActiveMenuKey, sortMenuItems, type MenuItem } from "./types";
import { createUseNavigation } from "./useNavigation";

vi.mock("next/navigation", () => ({ usePathname: () => "/teacher/courses/42" }));

const item = (over: Partial<MenuItem> & Pick<MenuItem, "key" | "href">): MenuItem => ({
  label: over.key,
  permission: "x.read",
  portal: "teacher",
  ...over,
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function setup(fetchMock: typeof fetch) {
  const client = createApiClient({ baseUrl: "", getTenant: () => "ipam", getToken: () => "t", fetch: fetchMock, sleep: async () => undefined });
  const hooks = createQueryHooks(client);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  return { useNavigation: createUseNavigation(hooks), wrapper };
}

describe("contrat de navigation", () => {
  it("accepte { items } et un tableau nu ; rejette un href non interne", () => {
    const entry = { key: "a", label: "A", href: "/a", permission: "a.read", portal: "admin" };
    expect(NavigationResponseSchema.parse({ items: [entry] })).toEqual([entry]);
    expect(NavigationResponseSchema.parse([entry])).toEqual([entry]);
    expect(NavigationResponseSchema.safeParse([{ ...entry, href: "https://evil.example" }]).success).toBe(false);
    expect(NavigationResponseSchema.safeParse([{ ...entry, portal: "inconnu" }]).success).toBe(false);
  });

  it("trie par order puis libellé ; entrée active = href le plus spécifique", () => {
    const items = [
      item({ key: "z", href: "/teacher", label: "Zèbre", order: 2 }),
      item({ key: "a", href: "/teacher/courses", label: "Cours", order: 1 }),
      item({ key: "n", href: "/teacher/notes", label: "Notes" }),
    ];
    expect(sortMenuItems(items).map((i) => i.key)).toEqual(["a", "z", "n"]);
    expect(findActiveMenuKey(items, "/teacher/courses/42")).toBe("a");
    expect(findActiveMenuKey(items, "/teacher")).toBe("z");
    expect(findActiveMenuKey(items, "/teachers")).toBeNull();
    expect(findActiveMenuKey(items, null)).toBeNull();
  });
});

describe("drapeau NEXT_PUBLIC_PLATFORM_NAV", () => {
  it("éteint par défaut", () => {
    for (const raw of [undefined, null, "", "0", "false", "bogus"]) {
      expect(parsePlatformNavFlag(raw)).toBeNull();
      expect(isPlatformNavEnabled(raw, "admin")).toBe(false);
    }
  });

  it("1 = tous les portails ; liste = portails nommés", () => {
    expect(isPlatformNavEnabled("1", "owner")).toBe(true);
    expect(isPlatformNavEnabled("admin, teacher", "teacher")).toBe(true);
    expect(isPlatformNavEnabled("admin,teacher", "parent")).toBe(false);
    expect(isPlatformNavEnabled("1", null)).toBe(false);
  });

  it("portail selon le rôle actif", () => {
    expect(portalForRole("Administrateur")).toBe("admin");
    expect(portalForRole("super_admin")).toBe("admin");
    expect(portalForRole("owner")).toBe("owner");
    expect(portalForRole("formateur")).toBeNull();
    expect(portalForRole(undefined)).toBeNull();
  });
});

describe("useNavigation", () => {
  it("charge le menu de l'API, filtré et trié par portail", async () => {
    const fetchMock = vi.fn(async () =>
      json({ items: [item({ key: "b", href: "/teacher/b", order: 2 }), item({ key: "a", href: "/teacher/a", order: 1 }), item({ key: "x", href: "/admin/x", portal: "admin" })] }),
    );
    const { useNavigation, wrapper } = setup(fetchMock);
    const { result } = renderHook(() => useNavigation({ portal: "teacher" }), { wrapper });
    await waitFor(() => expect(result.current.source).toBe("api"));
    expect(result.current.items.map((i) => i.key)).toEqual(["a", "b"]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/v1/rbac/me/navigation?portal=teacher");
  });

  it.each([404, 500, 401])("retombe sur le legacy quand l'endpoint répond %i", async (status) => {
    const fetchMock = vi.fn(async () => json({ message: "x" }, { status }));
    const { useNavigation, wrapper } = setup(fetchMock);
    const { result } = renderHook(() => useNavigation({ portal: "teacher" }), { wrapper });
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.source).toBe("legacy");
    expect(result.current.items).toEqual([]);
  });

  it("retombe sur le legacy si la réponse viole le contrat ou si le menu est vide", async () => {
    const { useNavigation, wrapper } = setup(vi.fn(async () => json({ items: [{ key: "x" }] })));
    const bad = renderHook(() => useNavigation({ portal: "teacher" }), { wrapper });
    await waitFor(() => expect(bad.result.current.isUnavailable).toBe(true));
    expect(bad.result.current.source).toBe("legacy");

    const empty = setup(vi.fn(async () => json({ items: [] })));
    const r = renderHook(() => empty.useNavigation({ portal: "teacher" }), { wrapper: empty.wrapper });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(r.result.current.source).toBe("legacy");
  });

  it("n'émet aucune requête quand il est désactivé", async () => {
    const fetchMock = vi.fn(async () => json({ items: [] }));
    const { useNavigation, wrapper } = setup(fetchMock);
    const { result } = renderHook(() => useNavigation({ portal: "teacher", enabled: false }), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ source: "legacy", isLoading: false });
  });
});

describe("PlatformSidebar", () => {
  const items = [
    item({ key: "courses", href: "/teacher/courses", label: "Mes cours", order: 1, icon: "book" }),
    item({ key: "dash", href: "/teacher/dashboard", label: "Tableau de bord", order: 0, icon: "dashboard" }),
  ];

  it("rend une navigation accessible, triée, avec l'entrée courante marquée", () => {
    render(<PlatformSidebar items={items} />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const links = nav.querySelectorAll("a");
    expect([...links].map((a) => a.textContent)).toEqual(["Tableau de bord", "Mes cours"]);
    expect(screen.getByRole("link", { name: "Mes cours" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Tableau de bord" }).getAttribute("aria-current")).toBeNull();
  });

  it("n'affiche le bouton de fermeture que s'il est demandé et le déclenche", () => {
    const onClose = vi.fn();
    const { rerender } = render(<PlatformSidebar items={items} />);
    expect(screen.queryByRole("button", { name: "Fermer le menu" })).toBeNull();
    rerender(<PlatformSidebar items={items} onClose={onClose} />);
    screen.getByRole("button", { name: "Fermer le menu" }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("appelle onNavigate au clic sur un lien", () => {
    const onNavigate = vi.fn();
    render(<PlatformSidebar items={items} onNavigate={onNavigate} />);
    screen.getByRole("link", { name: "Mes cours" }).addEventListener("click", (e) => e.preventDefault());
    screen.getByRole("link", { name: "Mes cours" }).click();
    expect(onNavigate).toHaveBeenCalled();
  });

  it("annonce le chargement sans liens", () => {
    render(<PlatformSidebar items={[]} isLoading />);
    expect(screen.getByRole("navigation").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("icône inconnue -> repli neutre", () => {
    expect(iconFor("nimporte-quoi")).toBe(iconFor(undefined));
    expect(iconFor("book")).not.toBe(iconFor(undefined));
  });
});
