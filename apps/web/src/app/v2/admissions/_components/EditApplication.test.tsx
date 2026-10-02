// @vitest-environment jsdom
import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { campaign, detail, IDS, lookups, settings } from "../_test/fixtures";
import { ApplicationDetailScreen } from "./ApplicationDetailScreen";
import { buildPatch } from "./EditApplicationDialog";

vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5000 });

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
vi.mock("next/navigation", () => ({ usePathname: () => "/v2/admissions", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const A = "/api/v1/admissions";
const APP = `${A}/applications/${IDS.app1}`;
const routes = (perms: string[], extra: Record<string, unknown> = {}) => ({
  ...accessRoutes(perms),
  [`GET ${A}/campaigns`]: { items: [campaign()] },
  [`GET ${A}/lookups`]: lookups,
  [`GET ${A}/settings`]: settings(),
  [`GET ${APP}`]: detail(),
  ...extra,
});

describe("buildPatch : PATCH minimal", () => {
  const form = { first: "Awa", last: "KONÉ", birth: "2020-03-14", birthPlace: "Abidjan", previous: "", grade: "CP1", funding: "PRIVATE", assignment: "", repeating: false, gender: "FEMALE" };
  it("ne retient que les champs modifiés et efface un champ facultatif vidé", () => {
    const app = detail({ applicantFirstName: "Awa", applicantLastName: "KONÉ", desiredGradeLevelCode: "CP1", fundingTypeRequested: "PRIVATE", applicantBirthPlace: "Abidjan", applicantGender: "FEMALE", isRepeating: false, previousSchool: null, assignmentReference: null });
    expect(buildPatch(app, form)).toEqual({});
    expect(buildPatch(app, { ...form, first: " Awa-Marie ", birthPlace: "", repeating: true })).toEqual({ applicantFirstName: "Awa-Marie", applicantBirthPlace: null, isRepeating: true });
  });
});

describe("EditApplicationDialog : modification d'une candidature", () => {
  it("sans la permission de modification : aucun bouton", async () => {
    setTestApi(routes(["admission.read"]));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Modifier la candidature" })).toBeNull();
  });

  it("validation Zod côté client, puis PATCH minimal avec la version lue", async () => {
    const api = setTestApi(routes(["admission.read", "admission.update"], { [`PATCH ${APP}`]: () => json(detail({ rowVersion: 4 })) }));
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier la candidature" }));
    const dialog = await screen.findByRole("dialog");
    // Rien de modifié : message, aucun appel.
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("Aucune modification à enregistrer.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);
    // Prénom vidé : erreur du contrat, aucun appel.
    fireEvent.change(within(dialog).getByLabelText(/^Prénom/), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText("Libellé obligatoire.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/^Prénom/), { target: { value: "Aïcha" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ applicantFirstName: "Aïcha", rowVersion: 3 });
    expect(await screen.findByText("Candidature mise à jour.")).toBeTruthy();
  });

  it("conflit de version (409) : message explicite et rechargement de la dernière version", async () => {
    const api = setTestApi(
      routes(["admission.read", "admission.update"], {
        [`PATCH ${APP}`]: () => json({ code: "admissions.version_conflict", message: "Le dossier a été modifié par une autre personne : rechargez-le.", details: { rowVersion: 5 } }, { status: 409 }),
      }),
    );
    renderWithProviders(<ApplicationDetailScreen applicationId={IDS.app1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier la candidature" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Nom/), { target: { value: "TRAORÉ" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByText(/modifié par une autre personne depuis son affichage/)).toBeTruthy();
    const before = api.calls.filter((c) => c.method === "GET" && c.path === APP).length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Recharger la dernière version" }));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "GET" && c.path === APP).length).toBeGreaterThan(before));
  });
});
