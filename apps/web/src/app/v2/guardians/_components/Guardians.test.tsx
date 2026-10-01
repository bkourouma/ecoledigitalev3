// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { uuid } from "../../_test/fixtures";
import { guardian, studentSummary } from "../../_test/fixtures-people";
import { GuardianDetail, GuardiansScreen } from "./Guardians";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

describe("GuardiansScreen", () => {
  it("liste les tuteurs avec leurs enfants et l'état du compte portail", async () => {
    setTestApi({ ...accessRoutes(["guardian.read"]), "GET /api/v1/people/guardians": { items: [guardian(), guardian({ id: uuid(3001), displayName: "OUATTARA Fanta", portalAccount: "active", childrenCount: 2 })], total: 2, limit: 20, offset: 0 } });
    renderWithProviders(<GuardiansScreen />);
    const table = await screen.findByRole("table", { name: "Liste des tuteurs" });
    expect(await within(table).findByRole("link", { name: "KONE Mariam" })).toBeTruthy();
    expect(within(table).getByText("Sans compte")).toBeTruthy();
    expect(within(table).getByText("Compte actif")).toBeTruthy();
  });

  it("création : doublon signalé par l'API (409), confirmation motivée puis renvoi avec acknowledgeDuplicate", async () => {
    const candidate = { personId: uuid(3100), displayName: "KONE Mariam", birthDate: null, match: "PHONE", roles: ["GUARDIAN"], studentId: null, studentNumber: null };
    let attempts = 0;
    const api = setTestApi({
      ...accessRoutes(["guardian.read", "guardian.manage"]),
      "GET /api/v1/people/guardians": { items: [], total: 0, limit: 20, offset: 0 },
      "POST /api/v1/people/guardians": ({ body }) => {
        attempts += 1;
        if (!(body as { acknowledgeDuplicate?: boolean }).acknowledgeDuplicate) return json({ code: "people.possible_duplicate", message: "Un dossier similaire existe déjà.", details: { candidates: [candidate] } }, { status: 409 });
        return json({ guardian: guardian(), duplicates: [candidate] }, { status: 201 });
      },
    });
    renderWithProviders(<GuardiansScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Nouveau tuteur" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Nom/), { target: { value: "KONE" } });
    fireEvent.change(within(dialog).getByLabelText(/^Prénoms/), { target: { value: "Mariam" } });
    fireEvent.change(within(dialog).getByLabelText(/^Téléphone/), { target: { value: "+2250700000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer" }));
    const warning = await within(dialog).findByRole("region", { name: /ressemble/ });
    expect(within(warning).getByText("Même téléphone")).toBeTruthy();
    fireEvent.click(within(warning).getByRole("checkbox", { name: /créer quand même/ }));
    fireEvent.change(within(warning).getByLabelText(/Motif de la création/), { target: { value: "Deux personnes distinctes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer" }));
    await screen.findByText("Le tuteur KONE Mariam a été créé.");
    expect(attempts).toBe(2);
    expect(api.calls.filter((c) => c.method === "POST").at(-1)!.body).toMatchObject({ person: { lastName: "KONE", firstName: "Mariam", phone: "+2250700000000" }, acknowledgeDuplicate: true, duplicateReason: "Deux personnes distinctes" });
  });
});

describe("GuardianDetail", () => {
  it("fiche : coordonnées et enfants liés (filtre guardianId côté serveur)", async () => {
    const api = setTestApi({
      ...accessRoutes(["guardian.read", "guardian.manage"]),
      [`GET /api/v1/people/guardians/${uuid(3000)}`]: guardian({ occupation: "Commerçante" }),
      "GET /api/v1/people/students": { items: [studentSummary()], total: 1, limit: 50, offset: 0 },
    });
    renderWithProviders(<GuardianDetail id={uuid(3000)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "KONE Mariam" })).toBeTruthy();
    expect(screen.getByText("Commerçante")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "TRAORE Awa" })).toBeTruthy();
    expect(api.calls.find((c) => c.path === "/api/v1/people/students")!.query).toMatchObject({ guardianId: uuid(3000) });
    await waitFor(() => expect(screen.getByRole("button", { name: "Inviter au portail" })).toBeTruthy());
  });
});
