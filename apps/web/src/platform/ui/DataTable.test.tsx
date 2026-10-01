// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/platform/api/errors";
import { renderWithProviders } from "@/platform/test/render";
import { DataTable, type DataTableColumn } from "./DataTable";

interface Row {
  id: string;
  name: string;
  status: string;
}
const rows: Row[] = [
  { id: "1", name: "Awa Traoré", status: "ACTIVE" },
  { id: "2", name: "Koffi Yao", status: "SUSPENDED" },
];
const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "Nom", headerLabel: "Nom", cell: (r) => r.name, sortable: true, rowHeader: true },
  { id: "status", header: "Statut", cell: (r) => r.status, className: "hidden md:table-cell" },
];

describe("DataTable", () => {
  it("rend un tableau nommé avec en-têtes de colonne et en-tête de ligne", () => {
    renderWithProviders(<DataTable caption="Liste des élèves" columns={columns} rows={rows} getRowId={(r) => r.id} />);
    expect(screen.getByRole("region", { name: "Liste des élèves" })).toBeTruthy();
    const table = screen.getByRole("table", { name: "Liste des élèves" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(within(table).getByRole("rowheader", { name: "Awa Traoré" })).toBeTruthy();
  });

  it("tri côté serveur : aria-sort et cycle asc -> desc -> aucun, sans réordonner les lignes", () => {
    const onSortChange = vi.fn();
    const { rerender } = renderWithProviders(<DataTable caption="t" columns={columns} rows={[...rows].reverse()} getRowId={(r) => r.id} onSortChange={onSortChange} />);
    const header = screen.getByRole("columnheader", { name: /Nom/ });
    expect(header.getAttribute("aria-sort")).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: /Trier par Nom, ordre croissant/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: "name", direction: "asc" });
    // L'ordre des lignes reçues est conservé tel quel (le serveur trie).
    const firstBodyRow = screen.getAllByRole("row")[1]!;
    expect(within(firstBodyRow).getByText("Koffi Yao")).toBeTruthy();

    rerender(<DataTable caption="t" columns={columns} rows={rows} getRowId={(r) => r.id} sort={{ id: "name", direction: "asc" }} onSortChange={onSortChange} />);
    expect(screen.getByRole("columnheader", { name: /Nom/ }).getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: /ordre décroissant/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: "name", direction: "desc" });
  });

  it("pagination : plage, page courante, boutons désactivés aux bornes, changement de page", () => {
    const onPageChange = vi.fn();
    renderWithProviders(<DataTable caption="t" columns={columns} rows={rows} getRowId={(r) => r.id} pagination={{ page: 1, pageSize: 2, total: 5, onPageChange }} />);
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getByText("1–2 sur 5")).toBeTruthy();
    expect(within(nav).getByText("Page 1 sur 3")).toBeTruthy();
    expect((within(nav).getByRole("button", { name: /Précédent/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(nav).getByRole("button", { name: /Suivant/ }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("chargement initial : lignes de chargement et région annoncée", () => {
    renderWithProviders(<DataTable caption="t" columns={columns} rows={[]} getRowId={(r) => r.id} isLoading />);
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(3);
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
  });

  it("état vide avec message et action", () => {
    renderWithProviders(<DataTable caption="t" columns={columns} rows={[]} getRowId={(r) => r.id} emptyTitle="Aucun élève" emptyAction={<button>Créer</button>} />);
    expect(screen.getByText("Aucun élève")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Créer" })).toBeTruthy();
  });

  it("erreur : message de l'API et bouton Réessayer", () => {
    const onRetry = vi.fn();
    renderWithProviders(<DataTable caption="t" columns={columns} rows={[]} getRowId={(r) => r.id} error={new ApiError({ code: "FORBIDDEN", message: "Accès refusé à la liste.", status: 403 })} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Accès refusé à la liste.");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
