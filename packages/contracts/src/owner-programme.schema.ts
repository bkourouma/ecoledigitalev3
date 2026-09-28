import { z } from "zod";

import { OwnerAcademicYearSchema } from "./owner-stats.schema";

/* -------------------------------------------------------------------------- */
/*  Programme — UE, ECUE et maquette                                           */
/* -------------------------------------------------------------------------- */

/**
 * Dernière entrée manquante du miroir du menu administrateur.
 *
 * CE QUE CET ÉCRAN AJOUTE, ET QUI N'EXISTAIT NULLE PART
 *
 * Le catalogue disait ce que l'école propose ; il ne disait pas ce que chaque
 * unité d'enseignement RAPPORTE ni ce qu'elle PÈSE. Une UE est à la fois un
 * produit (un prix, des inscrits) et une brique pédagogique (des crédits, des
 * ECUE) : les deux se lisent ensemble ou pas du tout.
 *
 * L'ÉCART DE MAQUETTE, ET POURQUOI IL COMPTE
 *
 * `professional_ue.nb_uv` est la valeur AFFICHÉE ; la somme des crédits des ECUE
 * est celle réellement UTILISÉE en pondération, et c'est elle qui s'imprime sur
 * les relevés et les diplômes. Quand les deux divergent, l'écran montre autre
 * chose que ce qui est calculé — et le document officiel porte un nombre de
 * crédits faux. Mesuré le 23/09/2026 : 2 UE sur 362 (conduite exclue).
 *
 * Ce n'est pas une anomalie de saisie qu'on signale pour la forme : c'est à
 * corriger AVANT de générer les bulletins d'une promotion, sans quoi il faut
 * réimprimer.
 */

export const OwnerProgrammeUeSchema = z.object({
  ueId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  filiereName: z.string().nullable(),
  categorie: z.string().nullable(),
  /** Crédits déclarés sur l'UE — la valeur affichée. */
  nbUv: z.number().int().nonnegative(),
  /** Σ des crédits des ECUE — la valeur réellement utilisée en pondération. */
  sommeCredits: z.number().int().nonnegative(),
  /** `true` quand les deux divergent : le document officiel porte un faux. */
  ecartMaquette: z.boolean(),
  prix: z.number(),
  ecue: z.number().int().nonnegative(),
  ouvertures: z.number().int().nonnegative(),
  inscrits: z.number().int().nonnegative(),
  /**
   * Volume horaire planifié, en heures. `null` quand aucune séance horodatée
   * n'existe pour cette UE — un zéro se lirait « cette UE ne se donne pas ».
   */
  heuresPlanifiees: z.number().nullable(),
});

export const OwnerProgrammeQuerySchema = z.object({
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
});

export const OwnerProgrammeResponseSchema = z.object({
  computedAt: z.string(),
  kpis: z.object({
    ueActives: z.number().int().nonnegative(),
    /** UE ayant déjà été ouvertes au moins une fois : le programme en production. */
    ueOuvertes: z.number().int().nonnegative(),
    ecueActives: z.number().int().nonnegative(),
    /** UE dont les crédits affichés diffèrent de ceux calculés. */
    ecartsMaquette: z.number().int().nonnegative(),
    /** ECUE sans crédit : elles faussent silencieusement la moyenne d'UE. */
    ecueSansCredit: z.number().int().nonnegative(),
    /** ECUE rattachées à aucune UE : invisibles dans tout parcours. */
    ecueOrphelines: z.number().int().nonnegative(),
    /** Prix moyen d'une UE vendable. `null` si aucune n'est tarifée. */
    prixMoyen: z.number().nullable(),
  }),
  /** Les UE du périmètre, ouvertes d'abord. */
  ue: z.array(OwnerProgrammeUeSchema),
  /** Total réel, la liste étant plafonnée pour l'affichage. */
  ueTotal: z.number().int().nonnegative(),
  /**
   * Le volume horaire est-il exploitable ?
   *
   * Il se calcule sur `professional_ecue_seances.heure_debut/heure_fin`, tous
   * deux nullables et sans colonne de durée. Quand presque aucune séance n'est
   * planifiée, le rapport heures/crédits ne décrit rien — et un nuage de points
   * bâti sur trois séances ferait passer une absence de planning pour une
   * sous-dotation horaire.
   */
  volumeHoraire: z.object({
    mesurable: z.boolean(),
    seances: z.number().int().nonnegative(),
    seancesHorodatees: z.number().int().nonnegative(),
    raison: z.string().nullable(),
  }),
  anneeScolaire: z.string().nullable(),
  filiereIds: z.array(z.string().uuid()),
  nomClasse: z.string().nullable(),
});

export type OwnerProgrammeQuery = z.infer<typeof OwnerProgrammeQuerySchema>;
export type OwnerProgrammeResponse = z.infer<typeof OwnerProgrammeResponseSchema>;
export type OwnerProgrammeUe = z.infer<typeof OwnerProgrammeUeSchema>;
