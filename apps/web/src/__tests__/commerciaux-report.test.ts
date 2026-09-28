import { buildCommerciauxReportSpec } from "@/lib/utils/commerciaux-report";
import type { CommercialDto } from "@ecoledigitale/contracts";

/** Export PDF de l'annuaire des commerciaux. */

const commercial = (over: Partial<CommercialDto> = {}): CommercialDto =>
  ({
    id: "c1",
    nom: "Allou Kacou",
    telephone: "0707070707",
    email: null,
    taux_commission: 5,
    actif: true,
    note: null,
    etudiants: 3,
    created_at: "2026-09-01T00:00:00.000Z",
    ...over,
  }) as CommercialDto;

const tableOf = (spec: ReturnType<typeof buildCommerciauxReportSpec>) => {
  const bloc = spec.blocks.find((b) => b.kind === "table");
  if (!bloc || bloc.kind !== "table") throw new Error("tableau absent du rapport");
  return bloc.table;
};

describe("buildCommerciauxReportSpec", () => {
  it("liste les commerciaux, actifs comme inactifs", () => {
    const table = tableOf(
      buildCommerciauxReportSpec([
        commercial(),
        commercial({ id: "c2", nom: "Fatou Bamba", actif: false, etudiants: 0 }),
      ])
    );
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][6]).toBe("Actif");
    expect(table.rows[1][6]).toBe("Inactif");
  });

  it("totalise les étudiants rattachés et compte les actifs", () => {
    const table = tableOf(
      buildCommerciauxReportSpec([
        commercial({ etudiants: 3 }),
        commercial({ id: "c2", etudiants: 4, actif: false }),
      ])
    );
    expect(table.footer?.[5]).toBe("7");
    expect(table.footer?.[6]).toBe("1 actif");
  });

  it("remplace un téléphone ou un email absent par un tiret", () => {
    const table = tableOf(
      buildCommerciauxReportSpec([commercial({ telephone: null, email: null })])
    );
    expect(table.rows[0][2]).toBe("—");
    expect(table.rows[0][3]).toBe("—");
  });

  it("affiche le taux avec son signe pourcent", () => {
    const table = tableOf(buildCommerciauxReportSpec([commercial({ taux_commission: 7.5 })]));
    expect(table.rows[0][4]).toBe("7.5 %");
  });

  it("précise que le taux imprimé n'est qu'une proposition", () => {
    const spec = buildCommerciauxReportSpec([commercial()]);
    const note = spec.blocks.find((b) => b.kind === "note");
    expect(note && note.kind === "note" && note.text).toMatch(/figé sur leur fiche/);
  });

  it("supporte une liste vide sans planter", () => {
    const spec = buildCommerciauxReportSpec([]);
    expect(tableOf(spec).rows).toHaveLength(0);
  });
});
