import { buildCommissionsHistoriqueReportSpec } from "@/lib/utils/commissions-historique-report";
import type { LigneCommissionDto } from "@ecoledigitale/contracts";

/**
 * Export PDF des paiements de commissions — une ligne par commission due.
 * Le montant de scolarité qui la déclenche ne doit PAS y figurer : cet écran
 * ne capture que la rémunération du commercial.
 */

const ligne = (over: Partial<LigneCommissionDto> = {}): LigneCommissionDto =>
  ({
    payment_id: "p1",
    montant_scolarite: 300_000,
    paiement_le: "2026-09-10T09:00:00.000Z",
    mode_scolarite: "especes",
    receipt_number: "R-001",
    student_id: "s1",
    student_nom: "Awa Aka",
    matricule: "IPAM-L1GL-0027",
    commercial_id: "c1",
    commercial_nom: "Allou Kacou",
    taux_commission: 5,
    commission: 15_000,
    statut: "impaye",
    reglement_id: null,
    regle_le: null,
    mode_reglement: null,
    reference_reglement: null,
    regle_par: null,
    ...over,
  }) as LigneCommissionDto;

const options = { commercial: "Tous les commerciaux", statut: "Commissions à payer" };

const tables = (spec: ReturnType<typeof buildCommissionsHistoriqueReportSpec>) =>
  spec.blocks.filter((b) => b.kind === "table").map((b) => (b as any).table);

describe("buildCommissionsHistoriqueReportSpec", () => {
  it("ne produit qu'UN tableau, celui des commissions dues", () => {
    const t = tables(buildCommissionsHistoriqueReportSpec([ligne()], options));
    expect(t).toHaveLength(1);
    expect(t[0].rows[0][2]).toBe("Allou Kacou");
    expect(t[0].rows[0][3]).toBe("Awa Aka");
  });

  it("distingue une ligne payée d'une ligne impayée", () => {
    const [detail] = tables(
      buildCommissionsHistoriqueReportSpec(
        [ligne(), ligne({ payment_id: "p2", statut: "regle", regle_le: "2026-09-12T00:00:00.000Z" })],
        options
      )
    );
    expect(detail.rows[0][5]).toBe("Impayé");
    expect(detail.rows[0][6]).toBe("—");
    expect(detail.rows[1][5]).toBe("Payé");
    expect(detail.rows[1][6]).toBe("12/09/2026");
  });

  it("sépare la commission acquise de ce qui est déjà payé", () => {
    const spec = buildCommissionsHistoriqueReportSpec(
      [ligne(), ligne({ payment_id: "p2", commission: 5_000, statut: "regle" })],
      options
    );
    const entete = spec.blocks.find((b) => b.kind === "keyValues");
    const items = entete && entete.kind === "keyValues" ? entete.items : [];
    expect(items.some(([k]) => k === "Scolarité encaissée")).toBe(false);
    expect(items).toContainEqual(["Commission acquise", "20 000 FCFA"]);
    expect(items).toContainEqual(["Déjà payé", "5 000 FCFA"]);
    expect(items).toContainEqual(["Reste à payer", "15 000 FCFA"]);
    expect(items).toContainEqual(["Lignes impayées", "1 / 2"]);
  });

  it("remplace le tableau par une note quand il n'y a aucune ligne", () => {
    const spec = buildCommissionsHistoriqueReportSpec([], options);
    expect(tables(spec)).toHaveLength(0);
    const notes = spec.blocks.filter((b) => b.kind === "note").map((b) => (b as any).text);
    expect(notes).toContain("Aucune commission sur ce périmètre.");
  });

  it("totalise les commissions en pied du détail", () => {
    const [detail] = tables(
      buildCommissionsHistoriqueReportSpec(
        [ligne(), ligne({ payment_id: "p2", montant_scolarite: 100_000, commission: 5_000 })],
        options
      )
    );
    expect(detail.footer?.[4]).toBe("20 000 FCFA");
  });

  it("ne laisse filtrer aucun montant de scolarité dans le document", () => {
    const spec = buildCommissionsHistoriqueReportSpec(
      [ligne({ montant_scolarite: 300_000, commission: 15_000 })],
      options
    );
    // 300 000 est ce que l'étudiant a versé : il n'a rien à faire ici.
    expect(JSON.stringify(spec)).not.toContain("300 000");
    expect(JSON.stringify(spec)).toContain("15 000 FCFA");
  });

  it("supporte un périmètre entièrement vide", () => {
    const spec = buildCommissionsHistoriqueReportSpec([], options);
    expect(tables(spec)).toHaveLength(0);
    expect(spec.filename).toMatch(/^commissions-paiements-/);
  });
});
