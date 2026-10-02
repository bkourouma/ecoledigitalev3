// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { renderWithProviders } from "@/platform/test/render";
import { mariam, yao, MARIAM, YAO } from "@/app/v2/_test/fixtures-family";
import { ChildHeader } from "./ChildScope";
import { buildPortalMenu, childIdFromPath, childSectionHref, PORTAL_GUARD, switchChildPath, visibleChildSections } from "./menus";
import { isUuid } from "./ids";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const push = vi.fn();
let pathname = `/v2/parent/children/${MARIAM}/results`;
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push, replace: vi.fn() }) }));

const label = (k: string) => k;
const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe("menus des portails", () => {
  it("élève : seulement les entrées permises par ses droits (fail-closed sans permissions)", () => {
    expect(buildPortalMenu({ portal: "student", permissions: null, features: null, labelOf: label })).toEqual([]);
    const items = buildPortalMenu({ portal: "student", permissions: ["student.self.read", "grade.self.read", "schedule.self.read"], features: [], labelOf: label });
    expect(keys(items)).toEqual(["student.home", "student.results", "student.schedule", "student.upcoming", "student.profile"]);
    expect(items.find((i) => i.key === "student.finance")).toBeUndefined();
  });

  it("enseignant : « congés et présence » exige la fonction de présence du personnel", () => {
    const perms = ["schedule.own.read", "staff.own.read", "attendance.own.read", "payroll.payslip.read_own"];
    expect(keys(buildPortalMenu({ portal: "teacher", permissions: perms, features: [], labelOf: label }))).not.toContain("teacher.leaves");
    expect(keys(buildPortalMenu({ portal: "teacher", permissions: perms, features: ["attendance.staff"], labelOf: label }))).toContain("teacher.leaves");
  });

  it("messagerie : entrées montrées par la permission du module messaging, propre à chaque portail", () => {
    const perms = ["student.child.read"];
    expect(keys(buildPortalMenu({ portal: "parent", permissions: perms, features: [], labelOf: label }))).toEqual(["parent.children", "parent.account"]);
    const on = buildPortalMenu({ portal: "parent", permissions: [...perms, "messaging.child.read"], features: [], labelOf: label });
    expect(on.map((i) => i.href)).toEqual(["/v2/parent", "/v2/messages", "/v2/announcements", "/v2/parent/account"]);
    // Les permissions des autres portails n'ouvrent pas l'entrée.
    expect(keys(buildPortalMenu({ portal: "parent", permissions: [...perms, "messaging.read", "messaging.self.read"], features: [], labelOf: label }))).toEqual(["parent.children", "parent.account"]);
    const student = buildPortalMenu({ portal: "student", permissions: ["student.self.read", "messaging.self.read"], features: [], labelOf: label });
    expect(keys(student)).toEqual(expect.arrayContaining(["student.messages", "student.announcements"]));
    const teacher = buildPortalMenu({ portal: "teacher", permissions: ["staff.own.read", "messaging.read"], features: [], labelOf: label });
    expect(keys(teacher)).toEqual(expect.arrayContaining(["teacher.messages", "teacher.announcements"]));
    expect(keys(buildPortalMenu({ portal: "teacher", permissions: ["staff.own.read"], features: [], labelOf: label }))).not.toContain("teacher.messages");
    // Permissions inconnues : aucune entrée de messagerie (fermé par défaut).
    expect(keys(buildPortalMenu({ portal: "student", permissions: null, features: null, labelOf: label })).some((k) => k.includes("messages"))).toBe(false);
  });

  it("garde de portail : chaque portail n'est ouvert que par sa propre permission", () => {
    expect(PORTAL_GUARD.parent).toEqual(["student.child.read"]);
    expect(PORTAL_GUARD.student).toEqual(["student.self.read"]);
    expect(PORTAL_GUARD.teacher).toContain("staff.own.read");
    // aucun portail ne partage la permission d'un autre
    expect(PORTAL_GUARD.parent.some((p) => PORTAL_GUARD.student.includes(p))).toBe(false);
  });

  it("chemins d'un enfant : identifiant extrait, changement d'enfant dans la même section", () => {
    expect(childIdFromPath(`/v2/parent/children/${MARIAM}/finance`)).toBe(MARIAM);
    expect(childIdFromPath("/v2/parent")).toBeNull();
    expect(childIdFromPath("/v2/student/results")).toBeNull();
    expect(switchChildPath(`/v2/parent/children/${MARIAM}/results`, YAO)).toBe(`/v2/parent/children/${YAO}/results`);
    expect(switchChildPath(`/v2/parent/children/${MARIAM}`, YAO)).toBe(`/v2/parent/children/${YAO}`);
    // une sous-page de détail (reçu) revient à la section de l'autre enfant
    expect(switchChildPath(`/v2/parent/children/${MARIAM}/finance/receipts/abc`, YAO)).toBe(`/v2/parent/children/${YAO}/finance`);
    expect(childSectionHref(MARIAM, "")).toBe(`/v2/parent/children/${MARIAM}`);
  });

  it("onglets d'un enfant : suivent les permissions du parent", () => {
    const all = visibleChildSections(["student.child.read", "grade.child.read", "finance.child.read"], []);
    expect(all.map((s) => s.key)).toEqual(["dashboard", "results", "finance", "documents", "emergency"]);
    expect(visibleChildSections(null, null)).toEqual([]);
  });

  it("identifiants d'URL : seuls les UUID sont acceptés", () => {
    expect(isUuid(MARIAM)).toBe(true);
    expect(isUuid("../../etc")).toBe(false);
    expect(isUuid(`${MARIAM}/x`)).toBe(false);
  });
});

describe("ChildHeader", () => {
  const routes = (children = [mariam, yao]) => ({
    ...accessRoutes(["student.child.read", "grade.child.read", "attendance.child.read"]),
    "GET /api/v1/people/children": { items: children },
  });

  it("plusieurs enfants : sélecteur qui conserve la section ; onglets selon les permissions ; onglet actif annoncé", async () => {
    pathname = `/v2/parent/children/${MARIAM}/results`;
    setTestApi(routes());
    renderWithProviders(<ChildHeader childId={MARIAM} />);
    const select = (await screen.findByLabelText("Enfant")) as HTMLSelectElement;
    expect(select.value).toBe(MARIAM);
    fireEvent.change(select, { target: { value: YAO } });
    expect(push).toHaveBeenCalledWith(`/v2/parent/children/${YAO}/results`);
    const tabs = await screen.findByRole("navigation", { name: "Sections de l'enfant" });
    expect(Array.from(tabs.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Tableau de bord", "Résultats", "Absences", "Dossier et contacts"]);
    expect(tabs.querySelector('[aria-current="page"]')?.textContent).toBe("Résultats");
  });

  it("un seul enfant : pas de sélecteur ; enfant non lié : ni sélecteur actif ni onglets", async () => {
    setTestApi(routes([mariam]));
    const { unmount } = renderWithProviders(<ChildHeader childId={MARIAM} />);
    await screen.findByRole("navigation", { name: "Sections de l'enfant" });
    expect(screen.queryByLabelText("Enfant")).toBeNull();
    unmount();
    pathname = `/v2/parent/children/${YAO}/results`;
    setTestApi(routes([mariam, mariam].slice(0, 1)));
    renderWithProviders(<ChildHeader childId={YAO} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("navigation", { name: "Sections de l'enfant" })).toBeNull();
  });
});
