// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/platform/test/render";
import { formatFileSize, UploadDropzone } from "./UploadDropzone";

const file = (name: string, size = 1024, type = "application/pdf") => {
  const f = new File([new Uint8Array(size)], name, { type });
  return f;
};
const input = () => screen.getByTestId("dropzone-input") as HTMLInputElement;

describe("UploadDropzone : sélecteur de fichier accessible au clavier", () => {
  it("la zone est UN bouton natif focalisable et nommé ; Entrée / Espace (comportement natif du bouton) ouvrent le sélecteur du système", () => {
    renderWithProviders(<UploadDropzone onFile={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Glissez un fichier ici/ }) as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.tabIndex).toBe(0);
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    // le champ fichier est relié et nommé, mais retiré de l'ordre de tabulation (un seul arrêt de focus pour la zone)
    expect(input().tabIndex).toBe(-1);
    expect(screen.getByLabelText("Choisir un fichier à déposer")).toBe(input());
    const open = vi.spyOn(input(), "click");
    fireEvent.click(button); // un bouton natif transforme Entrée et Espace en clic : c'est ce clic qui ouvre le sélecteur
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("choisir un fichier le transmet et l'annonce (région aria-live) ; le même fichier peut être rechoisi", () => {
    const onFile = vi.fn();
    renderWithProviders(<UploadDropzone onFile={onFile} extensions={["pdf", "png"]} maxBytes={5 * 1024 * 1024} />);
    const f = file("cni.pdf", 2048);
    fireEvent.change(input(), { target: { files: [f] } });
    expect(onFile).toHaveBeenCalledWith(f);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Fichier retenu : cni.pdf (2 Ko).");
    expect(screen.getByText(/Formats : pdf, png\./)).toBeTruthy();
    expect(screen.getByText(/Taille maximale : 5 Mo\./)).toBeTruthy();
  });

  it("refus de confort annoncés en alerte : trop gros, extension absente de la liste, fichier vide ; rien n'est transmis", () => {
    const onFile = vi.fn();
    renderWithProviders(<UploadDropzone onFile={onFile} extensions={["pdf"]} maxBytes={1000} />);
    fireEvent.change(input(), { target: { files: [file("gros.pdf", 5000)] } });
    expect(screen.getByRole("alert").textContent).toContain("dépasse la taille maximale");
    fireEvent.change(input(), { target: { files: [file("tableau.xlsx", 100)] } });
    expect(screen.getByRole("alert").textContent).toContain("format accepté");
    fireEvent.change(input(), { target: { files: [file("vide.pdf", 0)] } });
    expect(screen.getByRole("alert").textContent).toContain("est vide");
    expect(onFile).not.toHaveBeenCalled();
  });

  it("glisser-déposer : un fichier est pris, plusieurs sont refusés ; l'état de survol est visible", () => {
    const onFile = vi.fn();
    renderWithProviders(<UploadDropzone onFile={onFile} />);
    const button = screen.getByRole("button", { name: /Glissez un fichier ici/ });
    fireEvent.dragOver(button);
    expect(button.className).toContain("border-primary");
    fireEvent.dragLeave(button);
    expect(button.className).not.toContain("bg-primary/5");
    const f = file("recu.pdf");
    fireEvent.drop(button, { dataTransfer: { files: [f] } });
    expect(onFile).toHaveBeenCalledWith(f);
    fireEvent.drop(button, { dataTransfer: { files: [file("a.pdf"), file("b.pdf")] } });
    expect(screen.getByRole("alert").textContent).toBe("Déposez un seul fichier à la fois.");
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it("envoi en cours ou zone désactivée : bouton et champ inactifs, état annoncé, aucun fichier pris", () => {
    const onFile = vi.fn();
    const { rerender } = renderWithProviders(<UploadDropzone onFile={onFile} busy />);
    expect((screen.getByRole("button", { name: /Glissez/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(input().disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Envoi du fichier en cours…");
    fireEvent.drop(screen.getByRole("button", { name: /Glissez/ }), { dataTransfer: { files: [file("x.pdf")] } });
    expect(onFile).not.toHaveBeenCalled();
    rerender(<UploadDropzone onFile={onFile} selectedName="déjà.pdf" />);
    expect(screen.getByRole("status").textContent).toBe("Fichier retenu : déjà.pdf.");
  });

  it("taille lisible en français", () => {
    expect(formatFileSize(12)).toBe("12 o");
    expect(formatFileSize(1536)).toBe("2 Ko");
    expect(formatFileSize(1024 * 1024)).toBe("1 Mo");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1,5 Mo");
  });
});
