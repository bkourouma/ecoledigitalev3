// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UnauthorizedPage from "../../unauthorized/page";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

describe("page /unauthorized", () => {
  it("affiche le refus et le retour a l'accueil avec les jetons de theme (lisible en theme sombre)", () => {
    const { container } = render(<UnauthorizedPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Accès refusé" }).className).toContain("text-foreground");
    expect(screen.getByRole("link", { name: "Retour à l'accueil" }).getAttribute("href")).toBe("/");
    // Aucune teinte fixe claire (gray-900 / gray-600 / purple-600) : invisible sur le fond sombre.
    expect(container.innerHTML).not.toMatch(/text-gray-|text-purple-/);
  });
});
