// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/platform/test/render";
import { TreeEditor } from "./TreeEditor";

interface N {
  id: string;
  label: string;
  children: N[];
}
const data: N[] = [
  {
    id: "ue1",
    label: "UE 1",
    children: [
      { id: "e1", label: "ECUE 1.1", children: [] },
      { id: "e2", label: "ECUE 1.2", children: [] },
    ],
  },
  { id: "ue2", label: "UE 2", children: [] },
];
const getId = (n: N) => n.id;
const getChildren = (n: N) => n.children;

function Harness({ defaultExpanded = "all" as const, roots = data }: { defaultExpanded?: "all" | "roots" | "none"; roots?: N[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <TreeEditor roots={roots} getId={getId} getChildren={getChildren} renderLabel={(n) => n.label} selectedId={selected} onSelect={setSelected} ariaLabel="Curriculum" defaultExpanded={defaultExpanded} />
      <output data-testid="sel">{selected ?? "none"}</output>
    </>
  );
}

describe("TreeEditor", () => {
  it("expose le motif ARIA tree : niveaux, taille d'ensemble, état déplié", () => {
    renderWithProviders(<Harness />);
    const tree = screen.getByRole("tree", { name: "Curriculum" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual(["UE 1", "ECUE 1.1", "ECUE 1.2", "UE 2"]);
    expect(items[0]!.getAttribute("aria-level")).toBe("1");
    expect(items[1]!.getAttribute("aria-level")).toBe("2");
    expect(items[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(items[3]!.getAttribute("aria-expanded")).toBeNull();
    expect(items[1]!.getAttribute("aria-setsize")).toBe("2");
    expect(items[2]!.getAttribute("aria-posinset")).toBe("2");
  });

  it("un seul arrêt de tabulation (roving tabindex)", () => {
    renderWithProviders(<Harness />);
    const stops = screen.getAllByRole("treeitem").filter((i) => i.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
  });

  it("clavier : flèches, repli/dépli, Début/Fin, Entrée sélectionne", () => {
    renderWithProviders(<Harness />);
    const first = screen.getByRole("treeitem", { name: /UE 1$/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("ECUE 1.1");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement?.textContent).toContain("UE 1");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
    expect(screen.getByRole("treeitem", { name: /UE 1$/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.textContent).toContain("UE 2");
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(screen.getByTestId("sel").textContent).toBe("ue2");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement?.textContent).toContain("UE 1");
  });

  it("clic sélectionne ; le bouton de pliage ne sélectionne pas", () => {
    renderWithProviders(<Harness defaultExpanded="none" />);
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Déplier" }));
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
    expect(screen.getByTestId("sel").textContent).toBe("none");
    fireEvent.click(screen.getByRole("treeitem", { name: /ECUE 1.2/ }));
    expect(screen.getByTestId("sel").textContent).toBe("e2");
  });

  it("arbre vide : message", () => {
    renderWithProviders(<Harness roots={[]} />);
    expect(screen.getByText("Aucun élément.")).toBeTruthy();
  });
});
