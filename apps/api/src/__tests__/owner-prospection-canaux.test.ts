import {
  OWNER_PROSPECTION_CANAL_LABELS,
  OwnerProspectionCanalSchema,
  OwnerProspectionResponseSchema,
  PROVENANCE_CANAUX,
} from "@ecoledigitale/contracts";

/**
 * Le contrat de l'écran propriétaire « Prospection » emprunte ses canaux au
 * module d'exploitation et y ajoute « provenance inconnue ».
 *
 * Ce qui est vérifié ici n'est pas un calcul mais une SOUDURE : le jour où un
 * canal est ajouté à `PROVENANCE_CANAUX`, l'écran propriétaire doit soit
 * l'afficher avec son libellé, soit casser ici. Sans ce garde-fou, il
 * l'afficherait sous sa clé technique (« autre_media ») ou, pire, le laisserait
 * tomber de la répartition — un canal manquant dans un camembert ne se voit
 * pas, il se déduit d'un total qui ne tombe plus juste.
 */
describe("canaux de prospection côté propriétaire", () => {
  it("reprend tous les canaux du module d'exploitation, plus l'inconnu", () => {
    expect(OwnerProspectionCanalSchema.options).toEqual([
      ...PROVENANCE_CANAUX,
      "non_renseigne",
    ]);
  });

  it("donne un libellé lisible à chaque canal", () => {
    for (const canal of OwnerProspectionCanalSchema.options) {
      const libelle = OWNER_PROSPECTION_CANAL_LABELS[canal];
      expect(typeof libelle).toBe("string");
      expect(libelle.trim().length).toBeGreaterThan(0);
      // Un libellé égal à la clé serait un oubli déguisé en traduction.
      expect(libelle).not.toBe(canal);
    }
  });
});

/**
 * Un établissement qui n'a encore rien saisi doit produire une réponse VALIDE,
 * pas une erreur 500. C'est l'état de départ de tout déploiement.
 */
describe("réponse vide", () => {
  it("passe la validation avec des compteurs à zéro", () => {
    const vide = {
      anneeScolaire: null,
      filiereIds: [],
      kpis: {
        etudiants: 0,
        couverture: 0,
        viaCommercial: 0,
        scolariteEncaissee: 0,
        commissionAcquise: 0,
        commissionVersee: 0,
        commissionDue: 0,
        // Un taux sans assiette n'existe pas : il est nul, pas égal à zéro.
        tauxEffectif: null,
      },
      couverture: {
        etudiants: 0,
        renseignes: 0,
        nonRenseignes: 0,
        representative: false,
        scolariteNonRattachee: 0,
      },
      parCanal: [],
      parMois: [],
      commerciaux: [],
      dette: {
        total: 0,
        lignes: 0,
        plusAncienne: null,
        ageJours: null,
        commerciaux: 0,
      },
      etudiantsSansDate: 0,
    };

    expect(() => OwnerProspectionResponseSchema.parse(vide)).not.toThrow();
  });
});
