// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accessRoutes, setTestApi } from "@/platform/test/api-mock";
import { json, renderWithProviders } from "@/platform/test/render";
import { category, detail, IDS, page, summary } from "@/app/v2/documents/_test/fixtures";
import { DocumentPicker, type DocumentRef } from "./DocumentPicker";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);

const D = "/api/v1/documents";

function Harness({ upload }: { upload?: Parameters<typeof DocumentPicker>[0]["upload"] }) {
  const [value, setValue] = useState<DocumentRef | null>(null);
  return (
    <div>
      <DocumentPicker label="Justificatif" value={value} onChange={setValue} filter={{ kind: "STUDENT", ownerId: IDS.child }} upload={upload} required />
      <output data-testid="value">{value ? `${value.id}|${value.title}|${value.fileName}` : "none"}</output>
    </div>
  );
}

describe("DocumentPicker : choisir ou déposer un document depuis un autre écran", () => {
  it("choisit un document existant (liste filtrée par l'écran appelant), le retire, le change", async () => {
    const api = setTestApi({
      ...accessRoutes([]),
      [`GET ${D}/documents`]: page([summary(), summary({ id: IDS.doc2, title: "Certificat médical", fileName: "certificat.pdf", categoryLabel: "Dossier médical" })]),
    });
    renderWithProviders(<Harness />);
    expect(screen.getByText("Justificatif")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choisir un document" }));
    const list = await screen.findByRole("listbox", { name: "Documents existants" });
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(2);
    // les filtres de l'écran appelant partent à l'API (qui reste l'autorité sur ce qui est visible)
    const call = api.calls.find((c) => c.path === `${D}/documents`)!;
    expect(call.query).toMatchObject({ kind: "STUDENT", ownerId: IDS.child, status: "ACTIVE" });

    fireEvent.click(options[1]!);
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe(`${IDS.doc2}|Certificat médical|certificat.pdf`));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("picker-selection").textContent).toContain("certificat.pdf");
    expect(screen.getByRole("button", { name: "Changer de document" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retirer le document Certificat médical" }));
    expect(screen.getByTestId("value").textContent).toBe("none");
  });

  it("recherche temporisée : une requête avec `q` par pause de frappe ; aucun résultat annoncé", async () => {
    const api = setTestApi({
      ...accessRoutes([]),
      [`GET ${D}/documents`]: ({ url }) => json(page(url.searchParams.get("q") === "zzz" ? [] : [summary()])),
    });
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Choisir un document" }));
    await screen.findByRole("listbox");
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher" }), { target: { value: "zzz" } });
    expect(await screen.findByText("Aucun document ne correspond.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === `${D}/documents` && c.query.q === "zzz")).toBe(true);
  });

  it("dépôt d'un nouveau document : fichier choisi, titre par défaut, envoi multipart, sélection du document créé", async () => {
    const created = detail({ id: IDS.doc3, title: "scan-cni", fileName: "scan-cni.pdf" });
    const api = setTestApi({
      ...accessRoutes([]),
      [`GET ${D}/documents`]: page([]),
      [`GET ${D}/categories`]: { items: [category()] },
      [`POST ${D}/documents`]: created,
    });
    renderWithProviders(<Harness upload={{ categoryId: IDS.catIdentity, ownerType: "STUDENT", ownerId: IDS.child }} />);
    fireEvent.click(screen.getByRole("button", { name: "Choisir un document" }));
    const dialog = await screen.findByRole("dialog");
    const submit = await within(dialog).findByRole("button", { name: "Déposer et sélectionner" });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // pas de fichier : désactivé
    const input = within(dialog).getByTestId("dropzone-input") as HTMLInputElement;
    // les formats de la catégorie guident la saisie
    await waitFor(() => expect(within(dialog).getByText(/Formats : pdf, jpg, jpeg, png\./)).toBeTruthy());
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(900)], "scan-cni.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe(`${IDS.doc3}|scan-cni|scan-cni.pdf`));
    const post = api.calls.find((c) => c.method === "POST" && c.path === `${D}/documents`)!;
    expect(post.body).toMatchObject({ categoryId: IDS.catIdentity, title: "scan-cni", ownerType: "STUDENT", ownerId: IDS.child, file: { fileName: "scan-cni.pdf", size: 900 } });
    expect(post.headers["content-type"]).toBeUndefined(); // multipart : le navigateur pose la frontière
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("erreur de l'API affichée ; catégorie sans droit de dépôt : message et dépôt désactivé", async () => {
    setTestApi({
      ...accessRoutes([]),
      [`GET ${D}/documents`]: page([]),
      [`GET ${D}/categories`]: { items: [category({ canUpload: false })] },
    });
    renderWithProviders(<Harness upload={{ categoryId: IDS.catIdentity, ownerType: "STUDENT", ownerId: IDS.child }} />);
    fireEvent.click(screen.getByRole("button", { name: "Choisir un document" }));
    expect(await screen.findByText("Vous ne pouvez pas déposer de document dans cette catégorie.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Glissez un fichier ici/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("une erreur de dépôt (doublon) est affichée avec le message de l'API", async () => {
    setTestApi({
      ...accessRoutes([]),
      [`GET ${D}/documents`]: page([]),
      [`GET ${D}/categories`]: { items: [category()] },
      [`POST ${D}/documents`]: () => json({ code: "documents.duplicate", kind: "conflict", message: "Ce fichier existe déjà dans cette catégorie pour cette personne." }, { status: 409 }),
    });
    renderWithProviders(<Harness upload={{ categoryId: IDS.catIdentity, ownerType: "STUDENT", ownerId: IDS.child }} />);
    fireEvent.click(screen.getByRole("button", { name: "Choisir un document" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Formats : pdf/);
    fireEvent.change(within(dialog).getByTestId("dropzone-input"), { target: { files: [new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" })] } });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Déposer et sélectionner" }));
    expect(await within(dialog).findByText("Ce fichier existe déjà dans cette catégorie pour cette personne.")).toBeTruthy();
    expect(screen.getByTestId("value").textContent).toBe("none");
  });
});
