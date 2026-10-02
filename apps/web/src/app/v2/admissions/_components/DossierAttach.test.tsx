// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { category, IDS as DOC_IDS } from "../../documents/_test/fixtures";
import { detail, document, IDS } from "../_test/fixtures";
import { DossierAttach } from "./DossierAttach";

vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const A = "/api/v1/admissions";
const ATTACH = `${A}/applications/${IDS.app1}/documents/attach-to-student-file`;
const CATEGORIES = "/api/v1/documents/categories";
const ALLOWED = ["admission.read", "admission.document.attach", "documents.upload"];
const enrolled = (docs = [document({ status: "ACCEPTED" }), document({ requirementId: IDS.app2, requirementLabel: "Photo", status: "REJECTED" })]) => detail({ status: "ENROLLED", documents: docs });
const posts = (api: ReturnType<typeof setTestApi>) => api.calls.filter((c) => c.method === "POST" && c.path === ATTACH);

describe("DossierAttach : rattachement des pièces acceptées au dossier de l'élève", () => {
  it("n'apparaît pas hors dossier ENROLLED, ni sans la permission de rattachement", async () => {
    setTestApi({ ...accessRoutes(ALLOWED), [`GET ${CATEGORIES}`]: { items: [] } });
    const { container } = renderWithProviders(<DossierAttach application={detail({ status: "ACCEPTED" })} />);
    await Promise.resolve();
    expect(container.textContent).toBe("");
    const api = setTestApi({ ...accessRoutes(["admission.read", "documents.upload"]), [`GET ${CATEGORIES}`]: { items: [] } });
    const second = renderWithProviders(<DossierAttach application={enrolled()} />);
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/v1/rbac/me/permissions")).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(second.container.textContent).toBe("");
  });

  it("sans droit de dépôt en GED : action désactivée avec explication", async () => {
    setTestApi({ ...accessRoutes(["admission.read", "admission.document.attach"]), [`GET ${CATEGORIES}`]: { items: [] } });
    renderWithProviders(<DossierAttach application={enrolled()} />);
    expect(await screen.findByText(/exige aussi le droit de déposer/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Rattacher les pièces acceptées au dossier de l'élève" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("aucune pièce acceptée : rien à rattacher", async () => {
    setTestApi({ ...accessRoutes(ALLOWED), [`GET ${CATEGORIES}`]: { items: [] } });
    renderWithProviders(<DossierAttach application={enrolled([document({ status: "SUBMITTED" })])} />);
    expect(await screen.findByText("Aucune pièce acceptée à rattacher.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Rattacher les pièces acceptées/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("catégorie et confirmation obligatoires, puis rapport rattachées / ignorées / en échec", async () => {
    const api = setTestApi({
      ...accessRoutes(ALLOWED),
      [`GET ${CATEGORIES}`]: { items: [category(), category({ id: DOC_IDS.catMedical, label: "Dossier médical", canUpload: false }), category({ id: DOC_IDS.catRegulation, label: "Archivée", status: "ARCHIVED" })] },
      [`POST ${ATTACH}`]: {
        attached: 1,
        failed: 1,
        items: [
          { requirementId: IDS.requirement, outcome: "ATTACHED", documentRef: DOC_IDS.doc, code: null },
          { requirementId: IDS.app2, outcome: "FAILED", documentRef: null, code: "documents.quota_exceeded" },
          { requirementId: IDS.app1, outcome: "ALREADY_PRESENT", documentRef: DOC_IDS.doc2, code: null },
        ],
      },
    });
    renderWithProviders(<DossierAttach application={enrolled()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Rattacher les pièces acceptées/ }));
    const dialog = await screen.findByRole("dialog");
    // Seules les catégories actives où l'on peut déposer sont proposées.
    const select = await within(dialog).findByLabelText(/Catégorie de la gestion documentaire/);
    await within(dialog).findByRole("option", { name: "Pièces d'identité de l'élève" });
    expect(within(dialog).queryByRole("option", { name: "Dossier médical" })).toBeNull();
    expect(within(dialog).queryByRole("option", { name: "Archivée" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Rattacher" }));
    expect(await within(dialog).findByText("Choisissez une catégorie.")).toBeTruthy();
    expect(within(dialog).getByText("Cochez la case pour confirmer.")).toBeTruthy();
    expect(posts(api)).toHaveLength(0);

    fireEvent.change(select, { target: { value: DOC_IDS.catIdentity } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Rattacher" }));
    expect(await screen.findByText("1 rattachée(s), 1 déjà présente(s) ignorée(s), 1 en échec.")).toBeTruthy();
    expect(posts(api)[0]!.body).toEqual({ categoryId: DOC_IDS.catIdentity });
    expect(screen.getByText("Rattachée")).toBeTruthy();
    expect(screen.getByText("Déjà présente")).toBeTruthy();
    expect(screen.getByText("documents.quota_exceeded")).toBeTruthy();
    expect(screen.getByText(/pièces déjà présentes ne sont pas dupliquées/)).toBeTruthy();
  });

  it("erreur de l'API : message dans la fenêtre, qui reste ouverte", async () => {
    setTestApi({
      ...accessRoutes(ALLOWED),
      [`GET ${CATEGORIES}`]: { items: [category()] },
      [`POST ${ATTACH}`]: () => json({ code: "admissions.invalid_input", message: "Seules les pièces d'un dossier inscrit peuvent être rattachées au dossier de l'élève." }, { status: 422 }),
    });
    renderWithProviders(<DossierAttach application={enrolled()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Rattacher les pièces acceptées/ }));
    const dialog = await screen.findByRole("dialog");
    const select = await within(dialog).findByLabelText(/Catégorie de la gestion documentaire/);
    await within(dialog).findByRole("option", { name: "Pièces d'identité de l'élève" });
    fireEvent.change(select, { target: { value: DOC_IDS.catIdentity } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Rattacher" }));
    expect(await within(dialog).findByText(/Seules les pièces d'un dossier inscrit/)).toBeTruthy();
  });
});
