// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "@/platform/api/errors";
import { renderWithProviders } from "@/platform/test/render";
import { FormField, slugOfLabel, TextControl } from "./FormField";
import { apiErrorToFieldErrors, compact, nullifyEmpty, validateWith } from "./validation";

describe("FormField", () => {
  it("relie le libellé, l'aide et l'erreur au contrôle (aria-describedby / aria-invalid)", () => {
    renderWithProviders(
      <FormField label="Nom" hint="Tel qu'à l'état civil" error="Obligatoire" required>
        {(c) => <TextControl value="" onChange={() => undefined} {...c} />}
      </FormField>,
    );
    const input = screen.getByLabelText(/Nom/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby")!.split(" ");
    expect(describedBy).toHaveLength(2);
    expect(document.getElementById(describedBy[0]!)!.textContent).toBe("Tel qu'à l'état civil");
    expect(screen.getByRole("alert").textContent).toBe("Obligatoire");
    expect(screen.getByText("(obligatoire)")).toBeTruthy();
  });

  it("identifiant dérivé du libellé (stable entre serveur et client, indépendant de la position dans l'arbre)", () => {
    expect(slugOfLabel("Année académique (obligatoire) é")).toBe("annee-academique-obligatoire-e");
    expect(slugOfLabel("***")).toBe("champ");
    renderWithProviders(<FormField label="Étudiant">{(c) => <TextControl value="" onChange={() => undefined} {...c} />}</FormField>);
    expect(screen.getByLabelText("Étudiant").id).toBe("f-etudiant");
  });

  it("deux champs de même libellé restent uniques après montage", async () => {
    renderWithProviders(
      <>
        <FormField label="Montant">{(c) => <TextControl value="" onChange={() => undefined} {...c} />}</FormField>
        <FormField label="Montant">{(c) => <TextControl value="" onChange={() => undefined} {...c} />}</FormField>
      </>,
    );
    const inputs = await screen.findAllByLabelText("Montant");
    expect(inputs).toHaveLength(2);
    expect(new Set(inputs.map((i) => i.id)).size).toBe(2);
  });

  it("sans erreur : champ valide, pas d'alerte", () => {
    renderWithProviders(<FormField label="Nom">{(c) => <TextControl value="x" onChange={() => undefined} {...c} />}</FormField>);
    expect(screen.getByLabelText("Nom").getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("validation", () => {
  const schema = z.object({ person: z.object({ lastName: z.string().min(1, "Nom requis") }).strict(), code: z.string().regex(/^[A-Z]+$/, "Majuscules") }).strict();

  it("validateWith : erreurs indexées par chemin pointé", () => {
    const r = validateWith(schema, { person: { lastName: "" }, code: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ "person.lastName": "Nom requis", code: "Majuscules" });
    expect(validateWith(schema, { person: { lastName: "Y" }, code: "AB" }).ok).toBe(true);
  });

  it("apiErrorToFieldErrors : lit details.issues de l'API, ignore le reste", () => {
    const err = new ApiError({ code: "VALIDATION_FAILED", message: "Données invalides.", status: 400, details: { issues: [{ path: ["person", "sex"], message: "Le sexe est obligatoire." }, { path: [], message: "Global" }, { nope: 1 }] } });
    expect(apiErrorToFieldErrors(err)).toEqual({ "person.sex": "Le sexe est obligatoire.", "": "Global" });
    expect(apiErrorToFieldErrors(new Error("x"))).toEqual({});
    expect(apiErrorToFieldErrors(new ApiError({ code: "X", message: "m" }))).toEqual({});
  });

  it("compact / nullifyEmpty", () => {
    expect(compact({ a: "x", b: "", c: undefined, d: 0, e: false })).toEqual({ a: "x", d: 0, e: false });
    expect(nullifyEmpty({ a: "x", b: "", c: undefined })).toEqual({ a: "x", b: null });
  });
});
