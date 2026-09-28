import { z } from "zod";

import { OwnerAcademicYearSchema } from "./owner-stats.schema";

/* -------------------------------------------------------------------------- */
/*  Documents officiels — diplômes, signataires, complétude des dossiers       */
/* -------------------------------------------------------------------------- */

/**
 * Trois entrées au menu administrateur, aucune couverture propriétaire jusqu'ici.
 *
 * CE QUE CET ÉCRAN SERT À DÉCIDER
 *
 * Un étudiant **éligible mais jamais diplômé** est un dossier fini et un client
 * mécontent : il a payé, il a validé, et il attend un papier. Le pipeline le
 * rend visible par diplôme, du candidat à l'octroi.
 *
 * L'inverse existe aussi, et il est plus grave : un diplôme **octroyé sans que
 * les UV requises soient acquises**. Ce n'est pas une erreur de saisie, c'est un
 * titre délivré à tort — mesuré le 23/09/2026 sur la base de développement,
 * 2 octrois pour 0 éligible.
 *
 * ⚠ CE QUI N'EST PAS MESURABLE, ET QUI NE LE SERA PAS SANS MIGRATION
 *
 * Il n'existe **aucune table d'attestations** : elles sont recalculées à chaque
 * génération, sans date d'émission ni compteur. Le volume émis est donc hors de
 * portée, et l'écran le dit plutôt que d'afficher un zéro qui se lirait
 * « aucune attestation n'a jamais été délivrée ».
 */

/** Une ligne du pipeline de diplomation, par diplôme. */
export const OwnerDiplomePipelineSchema = z.object({
  diplomaId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  filiereName: z.string().nullable(),
  /** UV exigées par le diplôme. */
  uvRequises: z.number().int().nonnegative(),
  /** Inscrits de la filière : le vivier. */
  candidats: z.number().int().nonnegative(),
  /** Candidats ayant acquis au moins `uvRequises` UV validées. */
  eligibles: z.number().int().nonnegative(),
  /** Octrois en vigueur, révocations exclues. */
  octroyes: z.number().int().nonnegative(),
  revoques: z.number().int().nonnegative(),
  /**
   * Éligibles non diplômés : des dossiers finis qui attendent un papier.
   * C'est la seule ligne de cet écran qui se traduit en action immédiate.
   */
  eligiblesNonDiplomes: z.number().int().nonnegative(),
  /**
   * Octrois dont le titulaire n'atteint pas les UV requises.
   *
   * Un titre délivré à tort, pas une faute de frappe. `0` est ici un bon
   * chiffre, et c'est pourquoi il est affiché même à zéro.
   */
  octroyesSansUv: z.number().int().nonnegative(),
});

/**
 * État d'un signataire de document officiel.
 *
 * `estValeurParDefaut` est le champ qui justifie ce bloc. Les quatre signataires
 * livrés avec l'application sont des **noms de personnes réelles**. Tant qu'un
 * établissement ne les a pas remplacés, ses diplômes et ses attestations portent
 * la signature de gens qui n'ont jamais vu ses étudiants — et personne ne le
 * sait, puisque le document sort correctement formé.
 */
export const OwnerSignataireEtatSchema = z.object({
  cle: z.string(),
  nom: z.string(),
  fonction: z.string().nullable(),
  /** Le nom correspond exactement à celui livré par défaut dans le code. */
  estValeurParDefaut: z.boolean(),
  /** La ligne existe en base, ou elle est servie par le repli du code. */
  enregistre: z.boolean(),
});

export const OwnerDocumentsQuerySchema = z.object({
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
});

export const OwnerDocumentsResponseSchema = z.object({
  computedAt: z.string(),
  kpis: z.object({
    diplomesDefinis: z.number().int().nonnegative(),
    candidats: z.number().int().nonnegative(),
    eligibles: z.number().int().nonnegative(),
    octroyes: z.number().int().nonnegative(),
    /** Total des éligibles qui n'ont pas leur diplôme. */
    eligiblesNonDiplomes: z.number().int().nonnegative(),
    /** Total des octrois sans les UV requises. */
    octroyesSansUv: z.number().int().nonnegative(),
  }),
  pipeline: z.array(OwnerDiplomePipelineSchema),
  signataires: z.array(OwnerSignataireEtatSchema),
  /** Nombre de signataires encore aux valeurs livrées par défaut. */
  signatairesParDefaut: z.number().int().nonnegative(),
  /**
   * Complétude des dossiers : un champ manquant, c'est un diplôme non
   * imprimable le jour de la cérémonie.
   */
  dossiers: z.object({
    etudiants: z.number().int().nonnegative(),
    sansDateNaissance: z.number().int().nonnegative(),
    sansLieuNaissance: z.number().int().nonnegative(),
    sansMatricule: z.number().int().nonnegative(),
  }),
  /**
   * Attestations : volume NON MESURABLE, faute de table.
   *
   * Le champ existe pour que l'écran l'annonce explicitement. Il vaut toujours
   * `false` aujourd'hui ; il passera à `true` le jour où une migration créera la
   * table, sans que l'écran change.
   */
  attestations: z.object({
    mesurable: z.boolean(),
    raison: z.string().nullable(),
  }),
  anneeScolaire: z.string().nullable(),
  filiereIds: z.array(z.string().uuid()),
  nomClasse: z.string().nullable(),
});

export type OwnerDocumentsQuery = z.infer<typeof OwnerDocumentsQuerySchema>;
export type OwnerDocumentsResponse = z.infer<typeof OwnerDocumentsResponseSchema>;
export type OwnerDiplomePipeline = z.infer<typeof OwnerDiplomePipelineSchema>;
export type OwnerSignataireEtat = z.infer<typeof OwnerSignataireEtatSchema>;
