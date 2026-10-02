import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateWith } from "./validation";

describe("validateWith — messages Zod en français", () => {
  const schema = z
    .object({
      name: z.string().trim().min(1),
      reason: z.string().min(10, "Le motif doit faire au moins 10 caractères."),
      id: z.string().uuid(),
      mail: z.string().email(),
      kind: z.enum(["A", "B"]),
      count: z.number().min(2),
      items: z.array(z.string()).min(1),
    })
    .strict();

  it("traduit les messages générés par Zod et garde ceux des contrats", () => {
    const r = validateWith(schema, { name: "", reason: "court", id: "x", mail: "x", kind: "C", count: 1, items: [], extra: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({
      name: "Ce champ est obligatoire.",
      reason: "Le motif doit faire au moins 10 caractères.", // message du contrat : prioritaire
      id: "Choix invalide.",
      mail: "Adresse électronique invalide.",
      kind: "Choix invalide.",
      count: "La valeur doit être supérieure ou égale à 2.",
      items: "Sélectionnez au moins un élément.",
    });
  });

  it("un champ absent est « obligatoire »", () => {
    const r = validateWith(z.object({ a: z.string() }), {});
    expect(r.ok === false && r.errors.a).toBe("Ce champ est obligatoire.");
  });
});
