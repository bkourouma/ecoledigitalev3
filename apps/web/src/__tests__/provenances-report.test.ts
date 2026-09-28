import { buildProvenancesReportSpec } from "@/lib/utils/provenances-report";
import type { ProvenanceRowDto } from "@ecoledigitale/contracts";

/**
 * Export PDF des étudiants amenés par un commercial.
 * Le document reprend les lignes affichées sans les recalculer : les montants
 * viennent de l'API, l'export ne fait que les mettre en page.
 */

const ligne = (over: Partial<ProvenanceRowDto> = {}): ProvenanceRowDto =>
  ({
    student_id: "s1",
    student_nom: "Awa Aka",
    matricule: "IPAM-L1GL-0027",
    canal: "commercial",
    commercial_id: "c1",
    commercial_nom: "Allou Kacou",
    taux_commission: 5,
    referent_nom: null,
    referent_student_id: null,
    referent_student_nom: null,
    media_detail: null,
    note: null,
    total_paye: 270_000,
    commission: 13_500,
    enregistre_le: null,
    ...over,
  }) as ProvenanceRowDto;

const tableOf = (spec: ReturnType<typeof buildProvenancesReportSpec>) => {
  const bloc = spec.blocks.find((b) => b.kind === "table");
  if (!bloc || bloc.kind !== "table") throw new Error("tableau absent du rapport");
  return bloc.table;
};

describe("buildProvenancesReportSpec", () => {
  it("produit une ligne par étudiant, numérotée", () => {
    const spec = buildProvenancesReportSpec(
      [ligne(), ligne({ student_id: "s2", student_nom: "Moussa Aka" })],
      { commercial: "Tous les commerciaux" }
    );
    const table = tableOf(spec);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][0]).toBe("1");
    expect(table.rows[1][0]).toBe("2");
  });

  it("affiche le matricule IPAM, pas celui de la fiche scolaire", () => {
    const table = tableOf(buildProvenancesReportSpec([ligne()], { commercial: "Allou Kacou" }));
    expect(table.rows[0][1]).toBe("IPAM-L1GL-0027");
  });

  it("totalise la scolarité et la commission en pied de tableau", () => {
    const table = tableOf(
      buildProvenancesReportSpec(
        [ligne(), ligne({ student_id: "s2", total_paye: 130_000, commission: 6_500 })],
        { commercial: "Allou Kacou" }
      )
    );
    expect(table.footer?.[5]).toBe("400 000 FCFA");
    expect(table.footer?.[6]).toBe("20 000 FCFA");
  });

  it("reprend les montants de l'API sans les recalculer", () => {
    // Commission incohérente avec le taux : l'export doit l'afficher telle
    // quelle, sinon le PDF et l'écran diraient deux choses différentes.
    const table = tableOf(
      buildProvenancesReportSpec([ligne({ taux_commission: 5, commission: 99_999 })], {
        commercial: "Allou Kacou",
      })
    );
    expect(table.rows[0][6]).toBe("99 999 FCFA");
  });

  it("rappelle la recherche en cours dans le périmètre", () => {
    const spec = buildProvenancesReportSpec([ligne()], {
      commercial: "Tous les commerciaux",
      recherche: "Aka",
    });
    const entete = spec.blocks.find((b) => b.kind === "keyValues");
    expect(entete && entete.kind === "keyValues" && entete.items).toContainEqual([
      "Recherche",
      "« Aka »",
    ]);
  });

  it("supporte une sélection vide sans planter", () => {
    const spec = buildProvenancesReportSpec([], { commercial: "Tous les commerciaux" });
    expect(tableOf(spec).rows).toHaveLength(0);
    expect(spec.filename).toMatch(/^commerciaux-etudiants-/);
  });
});
