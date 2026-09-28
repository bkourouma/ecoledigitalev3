import { z } from "zod";

import { OwnerAcademicYearSchema } from "./owner-stats.schema";

/* -------------------------------------------------------------------------- */
/*  Scolarité — inscriptions, barème et effectifs inscrits                     */
/* -------------------------------------------------------------------------- */

/**
 * L'écran que le menu administrateur appelle « Scolarité », et dont l'espace
 * propriétaire n'avait aucun pendant.
 *
 * CE QU'IL MESURE, ET POURQUOI CETTE UNITÉ-LÀ
 *
 * L'unité n'est ni l'étudiant ni la commande mais le **lot (étudiant × classe)**.
 * Un étudiant peut suivre deux classes et devoir deux barèmes ; une classe
 * regroupe plusieurs étudiants qui doivent chacun le même. Compter les étudiants
 * sous-facture les premiers, compter les commandes ne dit rien de ce qui aurait
 * dû être commandé. Le lot est la seule unité qui porte une dette.
 *
 * `cycles_frais` donne le barème d'une classe en quatre postes — inscription,
 * scolarité, annexes, autres — qui sont exactement les quatre natures
 * facturables de `professional_orders`. Un lot doit le barème COMPLET de sa
 * classe : c'est la règle déjà en vigueur côté administration.
 *
 * LA RÈGLE DE NON-INVENTION, ICI PLUS QU'AILLEURS
 *
 * Une classe sans ligne de barème ne doit RIEN de mesurable — et surtout pas
 * zéro. Zéro se lirait « cette classe est gratuite » quand la vérité est
 * « personne n'a saisi sa grille tarifaire », c'est-à-dire un trou de
 * facturation : chaque inscrit y est facturé 0 sans que rien ne l'annonce.
 * D'où `duBareme` nullable partout, un écart nullable qui en découle, et une
 * liste nominative des classes concernées. Mesuré au 22/09/2026 sur la base de
 * développement : 40 grilles pour 41 classes, et la classe non tarifée porte
 * 3 inscrits.
 */

/** Les quatre postes du barème, tels que `cycles_frais` les porte. */
export const OwnerScolariteBaremeSchema = z.object({
  inscription: z.number(),
  scolarite: z.number(),
  annexes: z.number(),
  autres: z.number(),
  total: z.number(),
});

/** Une classe, vue comme une ligne de facturation. */
export const OwnerScolariteClasseSchema = z.object({
  filiereId: z.string().uuid(),
  /** Nom de l'ouverture de classe, règle partagée avec les écrans admin. */
  nomClasse: z.string(),
  /** Clé « filiereId|nom », celle du filtre. */
  cleClasse: z.string(),
  filiereName: z.string().nullable(),
  inscrits: z.number().int().nonnegative(),
  /** `null` quand la classe n'a pas de grille tarifaire : voir l'en-tête. */
  bareme: OwnerScolariteBaremeSchema.nullable(),
  /** Barème × inscrits. `null` dès que le barème manque. */
  duBareme: z.number().nullable(),
  /** Ce qui a réellement été commandé, toutes natures facturables. */
  commande: z.number(),
  encaisse: z.number(),
  /** `commande - duBareme`. `null` quand le dû n'est pas mesurable. */
  ecart: z.number().nullable(),
});

/** Une étape de l'entonnoir, de la demande au paiement. */
export const OwnerScolariteEtapeSchema = z.object({
  cle: z.string(),
  libelle: z.string(),
  valeur: z.number().int().nonnegative(),
  /**
   * `false` quand l'étape repose sur une source absente de cet environnement —
   * les demandes en ligne, par exemple, dont la table n'existe nulle part.
   * L'écran affiche alors la mention et non un zéro qui se lirait « aucune
   * demande ».
   */
  mesuree: z.boolean(),
});

/** Un poste de facturation, par nature de commande. */
export const OwnerScolariteNatureSchema = z.object({
  nature: z.string(),
  libelle: z.string(),
  commandes: z.number().int().nonnegative(),
  montant: z.number(),
  encaisse: z.number(),
});

/** Une classe qui accueille des inscrits sans grille tarifaire. */
export const OwnerScolariteTrouSchema = z.object({
  filiereId: z.string().uuid(),
  filiereName: z.string().nullable(),
  inscrits: z.number().int().nonnegative(),
  /** Ce qui a tout de même été commandé sur cette classe, à la main. */
  commande: z.number(),
});

export const OwnerScolariteQuerySchema = z.object({
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  /** Ouverture de classe, clé « filiereId|nom ». */
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
});

export const OwnerScolariteResponseSchema = z.object({
  computedAt: z.string(),
  kpis: z.object({
    /** Couples (étudiant × classe) : l'unité qui porte une dette. */
    lots: z.number().int().nonnegative(),
    lotsAvecBareme: z.number().int().nonnegative(),
    etudiants: z.number().int().nonnegative(),
    classes: z.number().int().nonnegative(),
    /** Σ des barèmes des lots tarifés. `null` si aucun ne l'est. */
    duBareme: z.number().nullable(),
    commande: z.number(),
    encaisse: z.number(),
    resteDu: z.number(),
    /**
     * `commande - duBareme` sur le seul périmètre tarifé — jamais sur
     * l'ensemble, sans quoi les lots non tarifés gonfleraient l'écart d'un
     * montant qui n'a aucun dû en face.
     */
    ecartBaremeCommande: z.number().nullable(),
  }),
  parClasse: z.array(OwnerScolariteClasseSchema),
  parNature: z.array(OwnerScolariteNatureSchema),
  entonnoir: z.array(OwnerScolariteEtapeSchema),
  trousFacturation: z.array(OwnerScolariteTrouSchema),
  anomalies: z.object({
    /**
     * Commandes rattachées à aucune inscription d'UE. Ce sont normalement les
     * frais — inscription, scolarité, annexes — et leur nombre n'est pas un
     * défaut en soi ; c'est leur montant qui doit être visible, parce que
     * deux JOIN internes le faisaient disparaître des écrans d'argent.
     */
    commandesSansInscription: z.number().int().nonnegative(),
    montantSansInscription: z.number(),
    /** Inscriptions d'UE que ne finance aucune commande. */
    inscritsSansCommande: z.number().int().nonnegative(),
    /** Lots sans grille tarifaire : le trou de facturation, en nombre. */
    lotsSansBareme: z.number().int().nonnegative(),
  }),
  couverture: z.object({
    /**
     * Part des lots dont la classe porte une grille tarifaire. `null` quand il
     * n'y a aucun lot : une couverture ne se calcule pas sur rien.
     */
    partTarifee: z.number().nullable(),
    /**
     * `false` tant qu'un lot au moins échappe au barème : l'écran doit alors
     * dire « commandé » et non « dû », faute de pouvoir mesurer la dette.
     */
    duInterpretable: z.boolean(),
  }),
  /** Périmètre appliqué, renvoyé pour l'en-tête des exports. */
  anneeScolaire: z.string().nullable(),
  filiereIds: z.array(z.string().uuid()),
  nomClasse: z.string().nullable(),
});

export type OwnerScolariteQuery = z.infer<typeof OwnerScolariteQuerySchema>;
export type OwnerScolariteResponse = z.infer<typeof OwnerScolariteResponseSchema>;
export type OwnerScolariteClasse = z.infer<typeof OwnerScolariteClasseSchema>;
export type OwnerScolariteNature = z.infer<typeof OwnerScolariteNatureSchema>;
export type OwnerScolariteEtape = z.infer<typeof OwnerScolariteEtapeSchema>;
export type OwnerScolariteTrou = z.infer<typeof OwnerScolariteTrouSchema>;
