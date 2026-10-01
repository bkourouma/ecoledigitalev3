// @vitest-environment jsdom
import { useState } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/platform/test/render";
import { SelectAsync, type OptionsResult, type SelectOption } from "./SelectAsync";

const ALL: SelectOption[] = [
  { value: "a", label: "Alpha", description: "Première" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie" },
];

function Harness({ spy, initial = null }: { spy?: (search: string, enabled: boolean) => void; initial?: SelectOption | null }) {
  const [value, setValue] = useState<SelectOption | null>(initial);
  const useOptions = (search: string, enabled: boolean): OptionsResult => {
    spy?.(search, enabled);
    return { options: enabled ? ALL.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())) : [], isLoading: false };
  };
  return (
    <div>
      <SelectAsync ariaLabel="Classe" value={value} onChange={setValue} useOptions={useOptions} debounceMs={50} />
      <output data-testid="value">{value?.value ?? "none"}</output>
    </div>
  );
}

describe("SelectAsync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ouvre la liste au focus, expose le motif combobox/listbox et choisit au clavier", () => {
    renderWithProviders(<Harness />);
    const input = screen.getByRole("combobox", { name: "Classe" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.focus(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toMatch(/opt-1$/);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("value").textContent).toBe("b");
    expect((input as HTMLInputElement).value).toBe("Bravo");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("temporise la recherche puis filtre par le serveur", () => {
    const spy = vi.fn();
    renderWithProviders(<Harness spy={spy} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "cha" } });
    // Avant la temporisation, la recherche transmise est encore vide.
    expect(screen.getAllByRole("option")).toHaveLength(3);
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Charlie/ })).toBeTruthy();
    expect(spy).toHaveBeenCalledWith("cha", true);
  });

  it("n'interroge pas quand la liste est fermée (enabled=false)", () => {
    const spy = vi.fn();
    renderWithProviders(<Harness spy={spy} />);
    expect(spy).toHaveBeenCalledWith("", false);
    expect(spy.mock.calls.every(([, enabled]) => enabled === false)).toBe(true);
  });

  it("Échap ferme, efface la sélection au bouton dédié, conserve le libellé choisi", () => {
    renderWithProviders(<Harness initial={{ value: "z", label: "Zulu (hors liste)" }} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("Zulu (hors liste)");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Effacer la sélection" }));
    expect(screen.getByTestId("value").textContent).toBe("none");
  });

  it("affiche « Aucun résultat » sans correspondance", () => {
    renderWithProviders(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyz" } });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByText("Aucun résultat.")).toBeTruthy();
  });
});
