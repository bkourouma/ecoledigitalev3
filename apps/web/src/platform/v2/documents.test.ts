// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildUploadForm } from "./documents";
import { bytesToMiB, mibToBytes, parseAlertDays, parseTags } from "@/app/v2/documents/_components/documents-utils";

describe("buildUploadForm : dépôt multipart conforme à l'API", () => {
  const file = new File([new Uint8Array(10)], "acte.pdf", { type: "application/pdf" });

  it("champs texte, listes en JSON, fichier dans le champ `file` ; rien d'inventé", () => {
    const form = buildUploadForm(
      { categoryId: "c1", title: " CNI ", description: "recto", ownerType: "STUDENT", ownerId: "s1", visibility: "STAFF_ONLY", tags: ["a", "b"], expiresOn: "2027-01-31", alertDays: [30, 7], note: "v1" },
      file,
    );
    expect(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"))).toEqual({
      categoryId: "c1",
      title: " CNI ",
      description: "recto",
      ownerType: "STUDENT",
      ownerId: "s1",
      visibility: "STAFF_ONLY",
      tags: '["a","b"]',
      expiresOn: "2027-01-31",
      alertDays: "[30,7]",
      note: "v1",
    });
    const sent = form.get("file") as File;
    expect(sent.name).toBe("acte.pdf");
    expect(sent.size).toBe(10);
  });

  it("sans propriétaire : aucun ownerId ; champs vides omis", () => {
    const form = buildUploadForm({ categoryId: "c1", title: "Règlement", ownerType: "NONE", ownerId: "ignoré", description: "  " }, file);
    expect([...form.keys()].sort()).toEqual(["categoryId", "file", "ownerType", "title"]);
  });
});

describe("saisies de l'interface", () => {
  it("étiquettes : séparées par des virgules, dédoublonnées sans casse, 20 au plus", () => {
    expect(parseTags(" Identité, identité , 2026,,")).toEqual(["Identité", "2026"]);
    expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(","))).toHaveLength(20);
  });
  it("seuils d'alerte : entiers de 0 à 365, décroissants, sinon refus", () => {
    expect(parseAlertDays("7, 30 1;30")).toEqual([30, 7, 1]);
    expect(parseAlertDays("30, abc")).toBeNull();
    expect(parseAlertDays("400")).toBeNull();
    expect(parseAlertDays("")).toBeNull();
  });
  it("taille en Mo (virgule décimale française) <-> octets", () => {
    expect(mibToBytes("1,5")).toBe(1.5 * 1024 * 1024);
    expect(mibToBytes("0")).toBeNull();
    expect(mibToBytes("abc")).toBeNull();
    expect(bytesToMiB(15 * 1024 * 1024)).toBe("15");
    expect(bytesToMiB(1.5 * 1024 * 1024)).toBe("1,5");
  });
});
