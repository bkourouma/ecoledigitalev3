import { PaymentReportQuerySchema, PaymentCalculationScopeSchema } from "@ecoledigitale/contracts";

/**
 * Tests — filtre d'origine des rapports (feature 031, US4 / FR-030).
 *
 * L'invariant de ventilation est la propriété qui rend le filtre fiable :
 * un gestionnaire doit pouvoir additionner les postes et retomber sur le total.
 */

/** Réplique de la règle appliquée par la route `/summary`. */
function ventiler(totalAmount: number, details: Array<{ source: string; amount: number }>) {
  const academique = details
    .filter((d) => d.source === "academique")
    .reduce((s, d) => s + d.amount, 0);
  const professionnel = details
    .filter((d) => d.source === "professionnel")
    .reduce((s, d) => s + d.amount, 0);
  return {
    academique,
    professionnel,
    // Ce que le détail horaire ne justifie pas : les salaires, qui ne
    // dépendent d'aucune séance.
    nonVentile: totalAmount - academique - professionnel,
  };
}

describe("Ventilation par origine — invariant (SC-007 révisé)", () => {
  it("académique + professionnel + nonVentilé = total", () => {
    const details = [
      { source: "academique", amount: 40000 },
      { source: "professionnel", amount: 36000 },
    ];
    const total = 76000;
    const v = ventiler(total, details);

    expect(v.academique).toBe(40000);
    expect(v.professionnel).toBe(36000);
    expect(v.nonVentile).toBe(0);
    expect(v.academique + v.professionnel + v.nonVentile).toBe(total);
  });

  it("un salaire pur alimente uniquement le poste non ventilé", () => {
    // Un enseignant salarié n'a AUCUNE ligne de détail : son montant ne
    // provient d'aucune heure. C'est pourquoi le troisième poste existe —
    // sans lui, académique + professionnel serait inférieur au total et
    // l'écart passerait pour une erreur de calcul.
    const v = ventiler(450000, []);

    expect(v.academique).toBe(0);
    expect(v.professionnel).toBe(0);
    expect(v.nonVentile).toBe(450000);
    expect(v.academique + v.professionnel + v.nonVentile).toBe(450000);
  });

  it("un bulletin mixte se ventile sur les trois postes", () => {
    // Salaire 450 000 + 5 h académiques + 5 h professionnelles.
    const details = [
      { source: "academique", amount: 50000 },
      { source: "professionnel", amount: 60000 },
    ];
    const total = 560000;
    const v = ventiler(total, details);

    expect(v.academique).toBe(50000);
    expect(v.professionnel).toBe(60000);
    expect(v.nonVentile).toBe(450000);
    expect(v.academique + v.professionnel + v.nonVentile).toBe(total);
  });

  it("l'invariant tient sur un jeu de plusieurs paiements", () => {
    const paiements = [
      { total: 144000, details: [{ source: "professionnel", amount: 144000 }] },
      { total: 450000, details: [] },
      {
        total: 560000,
        details: [
          { source: "academique", amount: 50000 },
          { source: "professionnel", amount: 60000 },
        ],
      },
    ];

    const totalGlobal = paiements.reduce((s, p) => s + p.total, 0);
    const agrege = paiements.reduce(
      (acc, p) => {
        const v = ventiler(p.total, p.details);
        return {
          academique: acc.academique + v.academique,
          professionnel: acc.professionnel + v.professionnel,
          nonVentile: acc.nonVentile + v.nonVentile,
        };
      },
      { academique: 0, professionnel: 0, nonVentile: 0 }
    );

    expect(agrege.academique + agrege.professionnel + agrege.nonVentile).toBe(totalGlobal);
    expect(agrege.professionnel).toBe(204000);
  });
});

describe("Contrat du filtre d'origine", () => {
  it("accepte les trois valeurs et rien d'autre", () => {
    for (const v of ["all", "academique", "professionnel"]) {
      expect(PaymentCalculationScopeSchema.safeParse(v).success).toBe(true);
    }
    expect(PaymentCalculationScopeSchema.safeParse("pro").success).toBe(false);
    expect(PaymentCalculationScopeSchema.safeParse("").success).toBe(false);
  });

  it("le défaut du filtre des rapports est « all » (aucune donnée masquée par défaut)", () => {
    const parsed = PaymentReportQuerySchema.parse({});
    expect(parsed.source).toBe("all");
  });

  it("le filtre est transmissible aux requêtes de rapport", () => {
    const parsed = PaymentReportQuerySchema.parse({ source: "professionnel" });
    expect(parsed.source).toBe("professionnel");
  });
});
