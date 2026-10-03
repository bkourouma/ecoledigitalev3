import { afterEach, describe, expect, it } from "vitest";
import { routeForRole, v2RouteForRole } from "@/lib/role-landing";

const saved = process.env.NEXT_PUBLIC_V2_LANDING;
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_V2_LANDING;
  else process.env.NEXT_PUBLIC_V2_LANDING = saved;
});

describe("routeForRole", () => {
  it("garde l'atterrissage historique par défaut", () => {
    delete process.env.NEXT_PUBLIC_V2_LANDING;
    expect(routeForRole("owner")).toBe("/owner/dashboard");
    expect(routeForRole("teacher")).toBe("/teacher/dashboard");
    expect(routeForRole("parent")).toBe("/parent/children");
    expect(routeForRole("student")).toBe("/student/courses");
    expect(routeForRole("directeur")).toBe("/tableau-de-bord");
  });

  it("NEXT_PUBLIC_V2_LANDING=1 : un écran v2 par rôle, repli sur l'accueil de gestion", () => {
    process.env.NEXT_PUBLIC_V2_LANDING = "1";
    expect(routeForRole("owner")).toBe("/v2/direction");
    expect(routeForRole("directeur")).toBe("/v2/direction");
    expect(routeForRole("teacher")).toBe("/v2/teacher");
    expect(routeForRole("instituteur")).toBe("/v2/primary");
    expect(routeForRole("parent")).toBe("/v2/parent");
    expect(routeForRole("student")).toBe("/v2/student");
    expect(routeForRole("econome")).toBe("/v2/finance");
    expect(routeForRole("rôle-inconnu")).toBe("/v2/home");
    expect(routeForRole(undefined)).toBe("/v2/home");
    expect(v2RouteForRole("admissions_officer")).toBe("/v2/admissions");
  });
});
