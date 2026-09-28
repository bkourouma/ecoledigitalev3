import { z } from "zod";
import { OwnerAcademicYearSchema } from "./owner-stats.schema";

/**
 * Charges de l'établissement — le seul endroit de l'espace propriétaire où
 * quelque chose se SAISIT.
 *
 * POURQUOI CET ÉCRAN EXISTE
 *
 * `0098_expenses.sql` a créé la table et ses huit catégories, et
 * `owner-economie.service.ts` les lit depuis toujours. Mais aucune route ne
 * permettait d'y écrire : l'écran Rentabilité ne pouvait afficher qu'un chiffre
 * d'affaires, et refusait — à juste titre — d'appeler « marge » un encaissement
 * dont on n'a retranché aucune charge.
 *
 * LES DEUX DATES, QUI SONT LA MATIÈRE PREMIÈRE DU COMPTABLE
 *
 * `incurred_on` date l'ENGAGEMENT, `paid_on` le DÉCAISSEMENT. Une charge
 * engagée et non payée est une dette fournisseur ; c'est l'écart entre ces deux
 * colonnes qui sépare le compte de résultat du tableau de trésorerie. On ne
 * remplace jamais l'une par l'autre, et `paid_on` reste nullable.
 */

/** Une catégorie de charge, telle que la migration 0098 les a seedées. */
export const OwnerChargeCategorieSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  /** Charge fixe (loyer, amortissement) ou variable (fournitures, marketing). */
  estFixe: z.boolean(),
});
export type OwnerChargeCategorie = z.infer<typeof OwnerChargeCategorieSchema>;

/**
 * Niveau de rattachement d'une charge. Ce n'est pas une colonne : il se déduit
 * de ce qui est renseigné, et l'écran le nomme pour que le lecteur sache ce
 * qu'il regarde.
 *
 *   cohorte       — classe nommée + année : n'impacte QUE cette promotion
 *   classe        — programme seul : impacte toutes les promotions de la classe
 *   etablissement — rien : loyer, énergie… JAMAIS réparti entre les classes
 */
export const OwnerChargeNiveauSchema = z.enum(["cohorte", "classe", "etablissement"]);
export type OwnerChargeNiveau = z.infer<typeof OwnerChargeNiveauSchema>;

export const OwnerChargeSchema = z.object({
  id: z.string().uuid(),
  categorieId: z.string().uuid().nullable(),
  categorieLibelle: z.string().nullable(),
  libelle: z.string(),
  montant: z.number(),
  devise: z.string(),
  /** Date d'engagement, `YYYY-MM-DD`. Toujours présente. */
  engageLe: z.string(),
  /** Date de décaissement. `null` = engagée, pas encore payée. */
  payeLe: z.string().nullable(),
  fournisseur: z.string().nullable(),
  notes: z.string().nullable(),
  programmeId: z.string().uuid().nullable(),
  programmeNom: z.string().nullable(),
  classeNomId: z.string().uuid().nullable(),
  classeNom: z.string().nullable(),
  /** Exercice d'imputation, explicite ou déduit de `engageLe`. */
  anneeScolaire: z.string().nullable(),
  niveau: OwnerChargeNiveauSchema,
});
export type OwnerCharge = z.infer<typeof OwnerChargeSchema>;

/* -------------------------------------------------------------------------- */
/*  Requêtes                                                                   */
/* -------------------------------------------------------------------------- */

/** État de décaissement, pour séparer l'engagement de la caisse. */
export const OwnerChargePayeSchema = z.enum(["tous", "paye", "engage"]);

export const OwnerChargesQuerySchema = z.object({
  /** Contrat de périmètre commun à l'espace propriétaire. */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  nomClasse: z.string().optional(),
  categorieId: z.string().uuid().optional(),
  /** `engage` = sans date de décaissement, donc dette fournisseur. */
  paye: OwnerChargePayeSchema.optional().default("tous"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(50),
});
export type OwnerChargesQuery = z.infer<typeof OwnerChargesQuerySchema>;

export const OwnerChargesResponseSchema = z.object({
  rows: z.array(OwnerChargeSchema),
  /**
   * Totaux sur TOUT le périmètre, pas sur la page affichée.
   *
   * Un total de page se lit comme un total tout court : c'est le défaut qui
   * faisait afficher « 20 cycles » sur un catalogue qui en comptait cinquante.
   */
  totaux: z.object({
    nombre: z.number().int().nonnegative(),
    montant: z.number(),
    /** Part déjà décaissée — ce qui est sorti de la caisse. */
    montantPaye: z.number(),
    /** Part engagée non décaissée : la dette fournisseur à la date du jour. */
    montantEngage: z.number(),
    /** Ventilation par niveau, pour que l'écran nomme ce qu'il ne répartit pas. */
    montantCohorte: z.number(),
    montantClasse: z.number(),
    montantEtablissement: z.number(),
  }),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalCount: z.number().int().nonnegative(),
});
export type OwnerChargesResponse = z.infer<typeof OwnerChargesResponseSchema>;

export const OwnerChargeCategoriesResponseSchema = z.object({
  categories: z.array(OwnerChargeCategorieSchema),
});

/* -------------------------------------------------------------------------- */
/*  Écriture                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Corps de création. `classeNomId` exige `anneeScolaire` ET `programmeId` :
 * c'est la contrainte `expenses_classe_exige_annee_et_programme` (migration
 * 0128), reprise ici pour que l'erreur arrive avant la base, avec un message
 * que le comptable comprend.
 */
const OwnerChargeBaseSchema = z.object({
    categorieId: z.string().uuid().nullable().optional(),
    libelle: z.string().trim().min(1, "Le libellé est obligatoire").max(300),
    montant: z.number().positive("Le montant doit être supérieur à zéro"),
    devise: z.string().trim().min(1).max(8).optional().default("XOF"),
    engageLe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue : AAAA-MM-JJ"),
    payeLe: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue : AAAA-MM-JJ")
      .nullable()
      .optional(),
    fournisseur: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    programmeId: z.string().uuid().nullable().optional(),
    classeNomId: z.string().uuid().nullable().optional(),
    anneeScolaire: OwnerAcademicYearSchema.nullable().optional(),
});

/**
 * Les deux règles qui ne se lisent pas dans les types : la cohérence du
 * rattachement, et l ordre des deux dates. Elles doublent des contraintes de la
 * base (migration 0128) pour que l erreur arrive avec un message lisible plutôt
 * qu en 23514.
 */
export const OwnerChargeCreateBodySchema = OwnerChargeBaseSchema
  .refine((v) => !v.classeNomId || (v.anneeScolaire && v.programmeId), {
    message:
      "Une charge de cohorte doit porter sa classe et son année scolaire : « Master 2 A » sans millésime désigne toutes les promotions.",
    path: ["classeNomId"],
  })
  .refine((v) => !v.payeLe || !v.engageLe || v.payeLe >= v.engageLe, {
    message: "Le décaissement ne peut pas précéder l'engagement.",
    path: ["payeLe"],
  });
export type OwnerChargeCreateBody = z.infer<typeof OwnerChargeCreateBodySchema>;
/**
 * Ce que le CLIENT envoie, par opposition à ce que le schéma produit.
 *
 * "devise" porte un .default("XOF") : il est donc obligatoire en SORTIE de
 * parse, et facultatif en entrée. Un formulaire qui ne le renseigne pas — le
 * cas courant, l établissement n encaissant qu une monnaie — doit pouvoir être
 * typé sans inventer la valeur que le serveur va poser lui-même.
 */
export type OwnerChargeCreateInput = z.input<typeof OwnerChargeCreateBodySchema>;

/** Mise à jour : mêmes règles, tous les champs facultatifs. */
export const OwnerChargePatchBodySchema = OwnerChargeBaseSchema.partial().refine(
  (v) => !v.classeNomId || (v.anneeScolaire && v.programmeId),
  {
    message: "Une charge de cohorte doit porter sa classe et son année scolaire.",
    path: ["classeNomId"],
  }
);
export type OwnerChargePatchBody = z.infer<typeof OwnerChargePatchBodySchema>;

export const OwnerChargeMutationResponseSchema = z.object({
  charge: OwnerChargeSchema,
});

/**
 * Cohortes rattachables d une classe — ce a quoi la cle etrangere peut pointer.
 *
 * Volontairement distinct des « noms de classe » du referentiel de filtres :
 * ceux-la sont derives des ouvertures, celles-ci sont declarees en base. Les
 * deux ensembles ne coincident pas.
 */
export const OwnerChargeCohorteSchema = z.object({
  id: z.string().uuid(),
  nom: z.string(),
  programmeId: z.string().uuid(),
});

export const OwnerChargeCohortesResponseSchema = z.object({
  cohortes: z.array(OwnerChargeCohorteSchema),
});
