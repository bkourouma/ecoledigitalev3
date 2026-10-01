// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/platform/test/render";
import { Wizard, type WizardStep } from "./Wizard";

function steps(validate?: () => boolean | Promise<boolean>): WizardStep[] {
  return [
    { id: "one", title: "Identité", content: <p>Contenu 1</p>, validate },
    { id: "two", title: "Classe", content: <p>Contenu 2</p> },
    { id: "three", title: "Récapitulatif", content: <p>Contenu 3</p> },
  ];
}

describe("Wizard", () => {
  it("liste les étapes avec l'étape courante annoncée (aria-current=step)", () => {
    renderWithProviders(<Wizard label="Inscription" steps={steps()} onFinish={() => undefined} finishLabel="Inscrire" />);
    const current = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step");
    expect(current?.textContent).toContain("Identité");
    expect(screen.getByRole("heading", { level: 2, name: "Identité" })).toBeTruthy();
  });

  it("avance, recule, déplace le focus sur le titre de l'étape et termine à la dernière", async () => {
    const onFinish = vi.fn();
    renderWithProviders(<Wizard label="Inscription" steps={steps()} onFinish={onFinish} finishLabel="Inscrire" />);
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(screen.getByText("Contenu 2")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Classe" }));
    fireEvent.click(screen.getByRole("button", { name: "Précédent" }));
    await waitFor(() => expect(screen.getByText("Contenu 1")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => screen.getByText("Contenu 2"));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => screen.getByText("Contenu 3"));
    expect(screen.queryByRole("button", { name: "Suivant" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inscrire" }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
  });

  it("une validation qui échoue bloque la progression", async () => {
    const validate = vi.fn(() => false);
    renderWithProviders(<Wizard label="Inscription" steps={steps(validate)} onFinish={() => undefined} finishLabel="Inscrire" />);
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(validate).toHaveBeenCalled());
    expect(screen.getByText("Contenu 1")).toBeTruthy();
    expect(screen.queryByText("Contenu 2")).toBeNull();
  });

  it("bouton Annuler et message de pied de page", () => {
    const onCancel = vi.fn();
    renderWithProviders(<Wizard label="Inscription" steps={steps()} onFinish={() => undefined} finishLabel="Inscrire" onCancel={onCancel} footerNotice={<p role="alert">Erreur API</p>} />);
    expect(screen.getByRole("alert").textContent).toBe("Erreur API");
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
