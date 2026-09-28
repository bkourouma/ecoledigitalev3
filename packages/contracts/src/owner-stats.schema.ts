import { z } from "zod";
import { PROVENANCE_CANAL_LABELS, PROVENANCE_CANAUX } from "./prospection";

/**
 * Statistiques propriétaire du Module Professionnel (LMD : filière → semestre → UE → ECUE).
 *
 * Complète owner.schema.ts, qui ne couvre que le module académique classique
 * (classes / courses / payment_transactions).
 *
 * Toutes les agrégations sont faites en SQL côté API : ces schémas décrivent
 * des données déjà agrégées, jamais des lignes brutes à recalculer côté client.
 */

/* -------------------------------------------------------------------------- */
/*  Filtres communs                                                            */
/* -------------------------------------------------------------------------- */

/** Catégorie d'UE (colonne `professional_ue.categorie`, nullable en base). */
export const OwnerUeCategorieSchema = z.enum([
  "fondamentale",
  "specialite",
  "culture_generale",
]);

/**
 * Année scolaire au format `2025-2026`, dérivée par pivot septembre sur
 * `professional_ue_sessions.date_debut`. Ce n'est PAS une colonne en base.
 */
export const OwnerAcademicYearSchema = z
  .string()
  .regex(/^\d{4}-\d{4}$/, "Format attendu : 2025-2026");


/**
 * Sur quoi porte une comparaison avec l'année précédente.
 *
 * Le « à la même date » n'est légitime que pour un indicateur daté par un fait
 * daté. Côté module professionnel, les encaissements ne sont PAS datés par
 * `paid_at` mais par le début de l'ouverture de classe : sur une base reprise,
 * `paid_at` porte le même jour sur cinq années. Comparer « au 22 septembre
 * contre au 22 septembre de l'an dernier » un montant attaché à une date
 * d'ouverture ne veut rien dire — d'où ces trois bases, nommées et publiées.
 */
export const OwnerComparaisonBasisSchema = z.enum([
  /** Exercice entier contre exercice entier : l'indicateur est daté par l'ouverture. */
  "annee_complete",
  /** Arrêté au même jour de l'exercice : l'indicateur est daté par un fait daté. */
  "a_meme_date",
  /** L'an dernier n'existe pas, ou le périmètre choisi n'y existait pas. */
  "non_comparable",
]);
export type OwnerComparaisonBasis = z.infer<typeof OwnerComparaisonBasisSchema>;

/**
 * Variation d'un indicateur par rapport à la même dimension de l'année N-1.
 *
 * TROIS FAÇONS DE NE PAS MENTIR, et elles sont distinctes :
 *
 *   - `measured: false` — l'an dernier n'a rien à mesurer sur ce périmètre.
 *     L'écran écrit « pas d'historique », jamais « -100 % ». C'est le cas d'une
 *     classe qui n'avait pas ouvert.
 *   - `deltaPct: null` — l'an dernier valait zéro : le rapport n'existe pas.
 *     Seul l'écart absolu est affiché. Un « +100 % » sur base nulle est une
 *     invention.
 *   - `basis` — sur quoi porte la comparaison, pour que le lecteur sache s'il
 *     lit un exercice entier ou un arrêté à date.
 *
 * `measured: true` avec `previousValue: 0` est donc un zéro VÉRIDIQUE — de
 * l'activité existait, elle n'a rien rapporté — là où `measured: false` dit
 * qu'il n'y avait rien à mesurer. Les confondre ferait passer une absence de
 * données pour une contre-performance.
 */
export const OwnerComparaisonSchema = z.object({
  /** Millésime comparé, `2024-2025`. `null` si aucune année n'est demandée. */
  anneePrecedente: z.string().nullable(),
  previousValue: z.number().nullable(),
  /** Phrase toute faite pour l'écran, y compris quand rien n'est mesurable. */
  previousLabel: z.string(),
  /** Écart absolu, dans l'unité de l'indicateur. */
  delta: z.number().nullable(),
  /** Écart relatif en points de pourcentage. `null` si la base est nulle. */
  deltaPct: z.number().nullable(),
  basis: OwnerComparaisonBasisSchema,
  measured: z.boolean(),
});
export type OwnerComparaison = z.infer<typeof OwnerComparaisonSchema>;
/* -------------------------------------------------------------------------- */
/*  5.A — /owner/pedagogie                                                     */
/* -------------------------------------------------------------------------- */

export const OwnerPedagogieQuerySchema = z.object({
  /** Année scolaire `YYYY-YYYY` (pivot septembre). Absente ⇒ toutes années. */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  /** Filières (= `programmes.id`). Vide ou absent ⇒ toutes filières. */
  filiereIds: z.array(z.string().uuid()).optional(),
  semestreId: z.string().uuid().optional(),
  /** Statut des sessions d'UE du périmètre. */
  statut: z.enum(["en_cours", "termine", "tous"]).optional().default("tous"),
  categorie: OwnerUeCategorieSchema.optional(),
  /** Ouverture de classe, cle « filiereId|nom » — contrat owner-perimetre.sql. */
  nomClasse: z.string().optional(),
});

export const OwnerPedagogieKpisSchema = z.object({
  /** Nombre de bulletins du périmètre — dénominateur de tous les taux ci-dessous. */
  bulletinCount: z.number().int().nonnegative(),
  /** count(decision='admis') / count(*) — en %. */
  successRate: z.number(),
  /** avg((data->>'moyenne_session')::float8) — sur 20. */
  averageGrade: z.number(),
  /** Σ credits_valides / Σ credits_total — en %. */
  creditsRate: z.number(),
  creditsValidated: z.number().int().nonnegative(),
  creditsTotal: z.number().int().nonnegative(),
  /** count(decision='rattrapage') / count(*) — en %. */
  retakeRate: z.number(),
  /** count(statut='definitif') / count(*) — en %. */
  finalBulletinRate: z.number(),
});

export const OwnerPedagogieDecisionRowSchema = z.object({
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  admis: z.number().int().nonnegative(),
  rattrapage: z.number().int().nonnegative(),
  ajourne: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const OwnerPedagogieSemestreAverageSchema = z.object({
  semestreId: z.string().uuid(),
  semestreLabel: z.string(),
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  averageGrade: z.number(),
  studentCount: z.number().int().nonnegative(),
});

export const OwnerPedagogieFailedEcueSchema = z.object({
  ecueId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  /** Résultats avec une moyenne renseignée (ECUE non commencées exclues). */
  evaluated: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Sous-ensemble de `failed` : moyenne < 5 (`eliminee = true`). */
  eliminated: z.number().int().nonnegative(),
  failRate: z.number(),
});

export const OwnerPedagogieUeHealthSchema = z.object({
  ueId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  filiereName: z.string(),
  categorie: OwnerUeCategorieSchema.nullable(),
  studentCount: z.number().int().nonnegative(),
  averageGrade: z.number().nullable(),
  validationRate: z.number(),
  eliminatedRate: z.number(),
  /** Part des validations obtenues en session 2 (`session_obtention = 2`). */
  session2Rate: z.number(),
});

/** Tranches figées côté SQL — l'ordre porte le sens, il est conservé. */
export const OwnerPedagogieGradeBucketSchema = z.object({
  bucket: z.enum(["<5", "5-8", "8-10", "10-12", "12-14", "14-16", ">16"]),
  count: z.number().int().nonnegative(),
});

export const OwnerPedagogieSession2Schema = z.object({
  validatedTotal: z.number().int().nonnegative(),
  validatedSession2: z.number().int().nonnegative(),
  rate: z.number(),
});

/**
 * Le rattrapage, vu comme un chantier et non comme un taux.
 *
 * `session2` répond déjà à « quelle part des validations vient du rattrapage ».
 * Ce bloc-ci répond à la question d'avant : **qui est en rattrapage, et
 * est-ce que ça marche ?**
 *
 * La session est portée par `professional_ecue_notes.session` : 1 pour la
 * session normale, 2 pour le rattrapage. Comparer les deux moyennes est le seul
 * moyen de savoir si une session de rattrapage sert à quelque chose — mesuré le
 * 23/09/2026 sur la base de développement, 11,33 en session 1 contre 9,67 en
 * session 2.
 */
export const OwnerRattrapageSchema = z.object({
  /** Étudiants portant au moins une note de session 2. */
  etudiantsConcernes: z.number().int().nonnegative(),
  notesSession2: z.number().int().nonnegative(),
  /** `null` quand aucune note de session 2 n'existe : pas de moyenne sur rien. */
  moyenneSession2: z.number().nullable(),
  /** Moyenne des mêmes natures en session 1, pour la comparaison. */
  moyenneSession1: z.number().nullable(),
  /** ECUE où le rattrapage est le plus demandé — le vrai goulot. */
  ecueLesPlusReprises: z.array(
    z.object({
      ecueId: z.string().uuid(),
      code: z.string(),
      libelle: z.string(),
      filiereName: z.string().nullable(),
      etudiants: z.number().int().nonnegative(),
      moyenne: z.number().nullable(),
    })
  ),
});

/**
 * L'état de la chaîne des bulletins.
 *
 * CE QU'IL FAUT VOIR, ET QUI NE SE VOYAIT NULLE PART
 *
 * Un semestre **clôturé sans aucun bulletin** est un blocage sec : la clôture
 * dit « c'est fini », et les étudiants n'ont pourtant aucun relevé. Sans
 * bulletin définitif, ni diplôme ni attestation ni réinscription ne peuvent
 * suivre. Mesuré le 23/09/2026 : 121 semestres, 16 clôturés, et **15 de ces 16
 * n'ont aucun bulletin**.
 *
 * Ce n'est pas un défaut de saisie mais un état de la production pédagogique —
 * c'est pourquoi il vit ici, sur l'écran des résultats, et non dans un panneau
 * d'anomalies.
 */
export const OwnerBulletinsEtatSchema = z.object({
  generes: z.number().int().nonnegative(),
  provisoires: z.number().int().nonnegative(),
  definitifs: z.number().int().nonnegative(),
  semestres: z.number().int().nonnegative(),
  semestresClotures: z.number().int().nonnegative(),
  /** Clôturés sans aucun bulletin : la chaîne s'arrête là. */
  semestresCloturesSansBulletin: z.number().int().nonnegative(),
  parSemestre: z.array(
    z.object({
      semestreId: z.string().uuid(),
      libelle: z.string(),
      filiereName: z.string().nullable(),
      clotureLe: z.string().nullable(),
      bulletins: z.number().int().nonnegative(),
      definitifs: z.number().int().nonnegative(),
    })
  ),
});

export const OwnerPedagogieResponseSchema = z.object({
  /** Filtres réellement appliqués, ré-exposés pour l'affichage. */
  anneeScolaire: OwnerAcademicYearSchema.nullable(),
  filiereIds: z.array(z.string().uuid()),
  semestreId: z.string().uuid().nullable(),
  statut: z.enum(["en_cours", "termine", "tous"]),
  categorie: OwnerUeCategorieSchema.nullable(),
  kpis: OwnerPedagogieKpisSchema,
  decisionsByFiliere: z.array(OwnerPedagogieDecisionRowSchema),
  averagesBySemestre: z.array(OwnerPedagogieSemestreAverageSchema),
  topFailedEcue: z.array(OwnerPedagogieFailedEcueSchema),
  ueHealth: z.array(OwnerPedagogieUeHealthSchema),
  gradeDistribution: z.array(OwnerPedagogieGradeBucketSchema),
  session2: OwnerPedagogieSession2Schema,
  /** Le rattrapage comme chantier : qui est concerné, et est-ce que ça marche. */
  rattrapage: OwnerRattrapageSchema,
  /** L'état de la chaîne des bulletins, clôtures comprises. */
  bulletins: OwnerBulletinsEtatSchema,
});

/* -------------------------------------------------------------------------- */
/*  5.B — /owner/finances/professionnel                                        */
/* -------------------------------------------------------------------------- */

export const OwnerFinancesProPeriodSchema = z.enum([
  "month",
  "quarter",
  "year",
  "academic_year",
  "custom",
]);

export const OwnerFinancesProModeSchema = z.enum([
  "especes",
  "mobile_money",
  "virement",
  "autre",
]);

export const OwnerFinancesProQuerySchema = z.object({
  period: OwnerFinancesProPeriodSchema.optional().default("year"),
  /** Requis (et seulement lus) quand period = 'custom'. Format `YYYY-MM-DD`. */
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  semestreId: z.string().uuid().optional(),
  mode: OwnerFinancesProModeSchema.optional(),
  /**
   * Nom de classe « filiereId|nom », repris de l'écran admin Paiements.
   * Restreint TOUT l'écran, comme la filière — pas seulement un tableau.
   */
  nomClasse: z.string().optional(),
  /** État de règlement de l'étudiant, appliqué au tableau des impayés. */
  etat: z.enum(["non_regle", "partiel", "solde", "tous"]).optional().default("tous"),
  /**
   * Recherche nom / prénom / matricule, appliquée au SEUL tableau des impayés —
   * exactement comme le champ « Étudiant… » de la page admin Paiements, qui ne
   * touche pas non plus les totaux de l'écran.
   */
  recherche: z.string().optional(),
});

export const OwnerFinancesProTotalsSchema = z.object({
  /** Σ professional_orders.montant_total, hors commandes `annulee`. */
  expected: z.number(),
  /** Σ professional_payments.montant WHERE statut = 'confirme'. */
  collected: z.number(),
  /**
   * collected / expected, en %. `null` quand rien n'est attendu : un zéro
   * afficherait 0 % de recouvrement sur un périmètre intégralement payé.
   */
  recoveryRate: z.number().nullable(),
  /** max(0, expected − collected). */
  outstanding: z.number(),
  /** Étudiants dont le reste dû dépasse 0,5 FCFA (tolérance d'arrondi). */
  unsettledStudents: z.number().int().nonnegative(),
  /**
   * PART DES UE DE CONDUITE dans les deux totaux ci-dessus.
   *
   * L'écran admin Paiements écarte ces UE de son périmètre : il ne les affiche
   * pas, ne les compte pas, ne les facture pas. Le propriétaire, lui, ne peut
   * pas les écarter — sur cette base elles portent 10 200 000 FCFA de commandes
   * INTÉGRALEMENT ENCAISSÉES, et les retirer ferait disparaître de l'argent
   * réellement entré en caisse, en plus de désaccorder cet écran du tableau de
   * bord et de Rentabilité, qui les comptent.
   *
   * Ces deux montants sont donc publiés pour que l'écart entre les deux écrans
   * soit LISIBLE plutôt que subi : « attendu ici, moins la conduite, égale
   * l'attendu de la page Paiements ».
   */
  conduite: z.object({
    expected: z.number(),
    collected: z.number(),
  }),
});

export const OwnerFinancesProMonthlySchema = z.object({
  /** `YYYY-MM`. */
  month: z.string(),
  amount: z.number(),
  /**
   * Transactions *métier*, groupées par (student_id, paid_at) :
   * un règlement unique produit N lignes payments, une par commande touchée.
   */
  transactionCount: z.number().int().nonnegative(),
});

export const OwnerFinancesProModeRowSchema = z.object({
  mode: OwnerFinancesProModeSchema,
  amount: z.number(),
  count: z.number().int().nonnegative(),
});

export const OwnerFinancesProRecoveryRowSchema = z.object({
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  expected: z.number(),
  collected: z.number(),
  recoveryRate: z.number(),
});

export const OwnerFinancesProUnpaidRowSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  matricule: z.string().nullable(),
  filiereNames: z.string().nullable(),
  due: z.number(),
  paid: z.number(),
  outstanding: z.number(),
  /** Date de la plus ancienne commande non soldée (`YYYY-MM-DD`). */
  oldestUnpaidAt: z.string().nullable(),
});

export const OwnerFinancesProUeRevenueSchema = z.object({
  ueId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  filiereName: z.string(),
  confirmedEnrollments: z.number().int().nonnegative(),
  revenue: z.number(),
});

export const OwnerFinancesProFunnelSchema = z.object({
  created: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});

export const OwnerFinancesProResponseSchema = z.object({
  period: OwnerFinancesProPeriodSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  filiereIds: z.array(z.string().uuid()),
  /** Nom de classe retenu (« filiereId|nom »), ou `null` pour toutes. */
  nomClasse: z.string().nullable(),
  semestreId: z.string().uuid().nullable(),
  mode: OwnerFinancesProModeSchema.nullable(),
  etat: z.enum(["non_regle", "partiel", "solde", "tous"]),
  /**
   * Décision produit : les UE « Conduite » sont INCLUSES ici (c'est du CA réel),
   * alors que l'écran admin /professionnel/admin/paiements les exclut.
   * Le front affiche cet écart en note de bas de tableau.
   */
  includesConduite: z.literal(true),
  totals: OwnerFinancesProTotalsSchema,
  monthlyCollections: z.array(OwnerFinancesProMonthlySchema),
  byPaymentMode: z.array(OwnerFinancesProModeRowSchema),
  recoveryByFiliere: z.array(OwnerFinancesProRecoveryRowSchema),
  topUnpaid: z.array(OwnerFinancesProUnpaidRowSchema),
  revenueByUe: z.array(OwnerFinancesProUeRevenueSchema),
  enrollmentFunnel: OwnerFinancesProFunnelSchema,
});

/* -------------------------------------------------------------------------- */
/*  Référentiel des filtres (alimente les sélecteurs des pages owner)          */
/* -------------------------------------------------------------------------- */

/**
 * Années scolaires où l'option porte de l'activité, millésimes « AAAA-AAAA+1 ».
 *
 * Sert à faire commander la liste par l'année choisie, comme sur l'écran
 * Paiements du module professionnel : une classe ouverte en 2021-2022 n'a rien
 * à faire dans le sélecteur quand on regarde 2023-2024, et la proposer promet
 * un croisement qui ne ramènera jamais rien.
 *
 * LES DEUX MOTEURS Y SONT : ouvertures de sessions professionnelles ET classes
 * de la scolarité rattachées à une année académique. Un tableau vide dit donc
 * « cette entrée n'a jamais porté d'activité, nulle part » — une ligne de
 * catalogue jamais ouverte. Le sélecteur la masque dès qu'une année est retenue,
 * puisqu'elle ne peut rien ramener.
 */
const OwnerOptionAnneesSchema = z.array(z.string()).default([]);

export const OwnerStatsFiliereOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  /** Cycle de rattachement. `null` quand le cycle a été supprimé. */
  cycleId: z.string().uuid().nullable(),
  cycleName: z.string().nullable(),
  annees: OwnerOptionAnneesSchema,
});

export const OwnerStatsSemestreOptionSchema = z.object({
  id: z.string().uuid(),
  libelle: z.string(),
  filiereId: z.string().uuid(),
  annees: OwnerOptionAnneesSchema,
});

/**
 * NOM DE CLASSE — la dimension par laquelle l'administration filtre réellement.
 *
 * Ce n'est pas la filière : une même filière peut porter plusieurs classes
 * (« LICENCE 1 TRANSPORT LOGISTIQUE » et « … B » existent sur la même). Les
 * écrans admin Paiements et Étudiants inscrits le dérivent du libellé de
 * l'ouverture, amputé de son suffixe « — CODE UE ». On reprend ici la MÊME
 * règle, au caractère près, sans quoi les deux écrans proposeraient des listes
 * différentes pour la même école.
 *
 * `value` porte « filiereId|nom », la clé de sélection de la page Paiements :
 * deux filières peuvent avoir donné le même nom à une classe.
 */
export const OwnerStatsNomClasseOptionSchema = z.object({
  value: z.string(),
  nom: z.string(),
  filiereId: z.string().uuid(),
  annees: OwnerOptionAnneesSchema,
  /** Semestres atteignables depuis cette classe — dernier maillon de la cascade. */
  semestreIds: z.array(z.string().uuid()).default([]),
});

export const OwnerStatsCycleOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
});

/**
 * Année académique du module ACADÉMIQUE — une vraie ligne en base, à ne pas
 * confondre avec `anneesScolaires`, qui est une chaîne dérivée par pivot septembre
 * pour le module professionnel.
 */
export const OwnerStatsAcademicYearOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
});

export const OwnerStatsFiltersResponseSchema = z.object({
  filieres: z.array(OwnerStatsFiliereOptionSchema),
  nomsDeClasse: z.array(OwnerStatsNomClasseOptionSchema).default([]),
  semestres: z.array(OwnerStatsSemestreOptionSchema),
  anneesScolaires: z.array(OwnerAcademicYearSchema),
  cycles: z.array(OwnerStatsCycleOptionSchema),
  academicYears: z.array(OwnerStatsAcademicYearOptionSchema),
});

/* -------------------------------------------------------------------------- */
/*  5.D — /owner/referentiel                                                   */
/* -------------------------------------------------------------------------- */

export const OwnerReferentielQuerySchema = z.object({
  cycleId: z.string().uuid().optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  categorie: OwnerUeCategorieSchema.optional(),
});

export const OwnerReferentielKpisSchema = z.object({
  activeCycles: z.number().int().nonnegative(),
  activeFilieres: z.number().int().nonnegative(),
  activeUe: z.number().int().nonnegative(),
  activeEcue: z.number().int().nonnegative(),
  /** Moyenne de Σ crédits des ECUE par semestre. `null` si aucun semestre. */
  avgCreditsPerSemestre: z.number().nullable(),
});

export const OwnerReferentielFiliereRowSchema = z.object({
  filiereId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  cycleName: z.string().nullable(),
  domaine: z.string().nullable(),
  semestreCount: z.number().int().nonnegative(),
  ueCount: z.number().int().nonnegative(),
  ecueCount: z.number().int().nonnegative(),
  /** Σ professional_ue.nb_uv — valeur déclarée. */
  sumNbUv: z.number().int().nonnegative(),
  /** Σ professional_ecue.credits — valeur réellement utilisée en pondération. */
  sumCredits: z.number().int().nonnegative(),
  studentCount: z.number().int().nonnegative(),
  /*
   * LA CLASSE COMME LIGNE ÉCONOMIQUE.
   *
   * Un catalogue ne dit pas ce qu'il rapporte. Ces quatre colonnes répondent à
   * la question qu'un fondateur pose devant une liste de classes : laquelle
   * tourne, laquelle dort, laquelle facture.
   *
   * Les COQUILLES VIDES se lisent ici, et non dans un panneau d'alertes : une
   * classe à 0 ouverture et 0 inscrit se voit dans son propre tableau. Le
   * catalogue d'incohérences a été retiré de l'espace Propriétaire le
   * 23/09/2026 — un contrôle de saisie s'adresse à qui corrige, pas à qui
   * décide.
   */
  /** Ouvertures de classe jamais annulées, toutes années confondues. */
  ouvertureCount: z.number().int().nonnegative(),
  /**
   * Lots facturables : inscrits NON ANNULÉS — l'assiette du CA théorique.
   *
   * Diverge de `studentCount`, qui ne compte que les confirmés : un étudiant en
   * attente de paiement n'est pas confirmé, mais c'est justement lui qui porte
   * la dette. Mesuré le 23/09/2026, LICENCE 1 GENIE LOGICIEL a 0 confirmé et
   * 1 non annulé — bâtir le CA théorique sur les confirmés annonçait « 0 FCFA
   * attendu » sur une classe tarifée 960 000 qui avait déjà encaissé 100 000.
   */
  lotsFacturables: z.number().int().nonnegative(),
  /**
   * Barème complet d'un lot — inscription + scolarité + annexes + autres.
   * `null` quand la classe n'a pas de grille tarifaire : elle n'est pas
   * gratuite, elle n'est pas tarifée. C'est un trou de facturation, et le
   * détail nominatif en vit sur `/owner/scolarite`.
   */
  baremeTotal: z.number().nullable(),
  /**
   * Détail du barème, tel que le saisit l'écran Scolarité
   * (`/admin/finances/scolarite`). `null` dans les mêmes cas que `baremeTotal`.
   */
  bareme: z
    .object({
      inscription: z.number(),
      scolarite: z.number(),
      annexes: z.number(),
      autres: z.number(),
      currency: z.string(),
    })
    .nullable(),
  /** `baremeTotal × lotsFacturables`. `null` dès que le barème l'est. */
  caTheorique: z.number().nullable(),
  /** Règlements confirmés rattachés à cette classe, par commande ou inscription. */
  caEncaisse: z.number(),
});

/**
 * Portée d'une incohérence — ce qui décide si elle appelle une action ce matin.
 *
 * POURQUOI CETTE DISTINCTION EXISTE
 *
 * Le catalogue de cette école porte 41 classes et 121 semestres ; deux classes
 * seulement ont une ouverture réelle. Les 119 semestres « sans session » ne sont
 * donc pas des défauts : ce sont les classes qu'on n'a pas encore ouvertes, et
 * il est normal qu'un semestre jamais ouvert n'ait aucune séance.
 *
 * Les additionner aux vraies alertes noyait le seul point actionnable — huit
 * ECUE obligatoires sans enseignant, sur des ouvertures portant six étudiants —
 * sous 92 % de lignes sans enjeu. Un écran qui annonce « 110 incohérences »
 * quand dix comptent n'est pas alarmiste : il est ignoré.
 *
 * `ouverture` — l'objet touche une ouverture de classe existante. Des étudiants
 *   peuvent déjà en dépendre : à traiter maintenant.
 * `catalogue` — l'objet décrit une maquette qui n'a jamais ouvert. À corriger
 *   AVANT d'ouvrir la classe, jamais dans l'urgence.
 */
export const OwnerReferentielPorteeSchema = z.enum(["ouverture", "catalogue"]);

/**
 * Une incohérence structurelle détectée dans le catalogue.
 * `kind` identifie la règle violée, `label` nomme l'objet, `detail` chiffre l'écart.
 */
export const OwnerReferentielIssueSchema = z.object({
  kind: z.enum([
    "ue_nb_uv_zero",
    "ue_nb_uv_mismatch",
    "ecue_credits_null",
    "ecue_orphan",
    "ue_without_ecue",
    "ue_price_zero",
    "semestre_without_session",
    "ecue_without_teacher",
    "course_orphan",
  ]),
  id: z.string().uuid(),
  label: z.string(),
  detail: z.string().nullable(),
  filiereName: z.string().nullable(),
  /** Voir `OwnerReferentielPorteeSchema` : ce qui appelle une action ce matin. */
  portee: OwnerReferentielPorteeSchema,
});

export const OwnerReferentielMutualisationSchema = z.object({
  ecueId: z.string().uuid(),
  code: z.string(),
  libelle: z.string(),
  ueCount: z.number().int().nonnegative(),
});

export const OwnerReferentielResponseSchema = z.object({
  cycleId: z.string().uuid().nullable(),
  filiereIds: z.array(z.string().uuid()),
  categorie: OwnerUeCategorieSchema.nullable(),
  kpis: OwnerReferentielKpisSchema,
  filieres: z.array(OwnerReferentielFiliereRowSchema),
  /** Échantillon affichable, plafonné par type. Voir `issueCounts` pour le vrai nombre. */
  issues: z.array(OwnerReferentielIssueSchema),
  /**
   * Compte RÉEL par type d'incohérence, sans plafond.
   *
   * Il valait auparavant `issues.length` par type, donc au plus 50 : l'écran
   * annonçait « 110 au total » là où la base en portait 129, et affichait
   * « 50+ » sans jamais pouvoir dire combien. Un total qui paraît exact tout en
   * sous-estimant est pire qu'un total absent — on décide dessus.
   */
  issueCounts: z.record(z.string(), z.number().int().nonnegative()),
  /**
   * Part de chaque type qui porte sur une ouverture réelle — **comptée en SQL,
   * pas estimée**.
   *
   * Un type se répartit parfois sur les deux portées : 118 UE à prix zéro dont
   * une poignée sont déjà ouvertes. Ventiler au prorata des 50 lignes
   * rapportées reproduirait, sur le résumé, l'inexactitude que `issueCounts`
   * vient de corriger sur le total.
   */
  issueOuvertureCounts: z.record(z.string(), z.number().int().nonnegative()),
  /** Comptes réels par portée, pour trancher d'un coup d'œil ce qui presse. */
  porteeCounts: z.object({
    ouverture: z.number().int().nonnegative(),
    catalogue: z.number().int().nonnegative(),
  }),
  ecueMutualisation: z.array(OwnerReferentielMutualisationSchema),
});

/* -------------------------------------------------------------------------- */
/*  5.C — /owner/assiduite                                                     */
/* -------------------------------------------------------------------------- */

export const OwnerAssiduiteQuerySchema = z.object({
  /** Format `YYYY-MM-DD`. Par défaut : 12 dernières semaines. */
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  semestreId: z.string().uuid().optional(),
  building: z.string().optional(),
  /**
   * Périmètre — contrat de owner-perimetre.sql. L'écran Présences affichait
   * déjà la filière et le semestre ; il ignorait l'année scolaire et
   * l'ouverture de classe, que sa barre de filtres propose pourtant.
   */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  nomClasse: z.string().optional(),
});

export const OwnerAssiduiteKpisSchema = z.object({
  /** present / total sur professional_ecue_attendance. Retards inclus au présent. */
  presenceRate: z.number(),
  absenceHours: z.number(),
  /** Séances passées ayant au moins un pointage / total des séances passées. */
  callRate: z.number(),
  /** Heures planifiées / (heures ouvrables × salles actives). */
  roomOccupancyRate: z.number(),
  plannedHours: z.number(),
});

export const OwnerAssiduiteWeekCellSchema = z.object({
  /** Lundi de la semaine, `YYYY-MM-DD`. */
  weekStart: z.string(),
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  presentRate: z.number(),
  totalRecords: z.number().int().nonnegative(),
});

export const OwnerAssiduiteAbsentStudentSchema = z.object({
  studentId: z.string().uuid(),
  studentName: z.string(),
  matricule: z.string().nullable(),
  absenceHours: z.number(),
  excusedHours: z.number(),
  absenceCount: z.number().int().nonnegative(),
});

export const OwnerAssiduiteRoomSlotSchema = z.object({
  /** 1 = lundi … 7 = dimanche (convention de professional_emploi_temps.jour). */
  jour: z.number().int().min(1).max(7),
  /** Heure de début du créneau, 8 → 19. */
  hour: z.number().int().min(0).max(23),
  occupiedRooms: z.number().int().nonnegative(),
  rate: z.number(),
});

export const OwnerAssiduiteTeacherLoadSchema = z.object({
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  weeklyHours: z.number(),
  ecueCount: z.number().int().nonnegative(),
  filiereCount: z.number().int().nonnegative(),
  /** teachers.user_id est nullable : un enseignant peut n'avoir aucun compte. */
  hasUserAccount: z.boolean(),
});

export const OwnerAssiduiteRoomUsageSchema = z.object({
  classroomId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  capacity: z.number().int().nonnegative(),
  building: z.string().nullable(),
  weeklyHours: z.number(),
  occupancyRate: z.number(),
});

export const OwnerAssiduiteUnassignedSchema = z.object({
  ueSessionId: z.string().uuid(),
  ueCode: z.string(),
  ecueId: z.string().uuid(),
  ecueCode: z.string(),
  ecueLibelle: z.string(),
  filiereName: z.string(),
});

export const OwnerAssiduiteTrendSchema = z.object({
  weekStart: z.string(),
  presentRate: z.number(),
  totalRecords: z.number().int().nonnegative(),
});

/**
 * Conduite — une note, pas une présence, mais elle se lit avec elles.
 *
 * Elle se note sur une ECUE dédiée, sans enseignant ni prix : elle ne
 * s'enseigne pas et ne se vend pas, l'administration l'attribue. Sa place est
 * sur l'écran des présences parce qu'elle sanctionne le même comportement — la
 * tenue et l'assiduité — et qu'un fondateur les lit ensemble.
 *
 * `sansNote` est le seul chiffre actionnable du bloc : un étudiant inscrit sans
 * note de conduite empêche la génération de son bulletin. Ce n'est pas une
 * anomalie de saisie qu'on signale pour la forme, c'est un relevé qui ne
 * sortira pas.
 */
export const OwnerConduiteClasseSchema = z.object({
  filiereId: z.string().uuid().nullable(),
  filiereName: z.string(),
  inscrits: z.number().int().nonnegative(),
  notes: z.number().int().nonnegative(),
  /** `null` quand la classe n'a aucune note : pas de moyenne sur rien. */
  moyenne: z.number().nullable(),
  mini: z.number().nullable(),
  maxi: z.number().nullable(),
  sousLaMoyenne: z.number().int().nonnegative(),
  /** Inscrits sans aucune note de conduite : autant de bulletins bloqués. */
  sansNote: z.number().int().nonnegative(),
});

export const OwnerAssiduiteResponseSchema = z.object({
  dateDebut: z.string(),
  dateFin: z.string(),
  filiereIds: z.array(z.string().uuid()),
  semestreId: z.string().uuid().nullable(),
  building: z.string().nullable(),
  /** Heures ouvrables retenues pour le taux d'occupation, pour rendre le calcul lisible. */
  openingHoursPerWeek: z.number(),
  kpis: OwnerAssiduiteKpisSchema,
  attendanceByWeek: z.array(OwnerAssiduiteWeekCellSchema),
  topAbsentStudents: z.array(OwnerAssiduiteAbsentStudentSchema),
  roomOccupancy: z.array(OwnerAssiduiteRoomSlotSchema),
  teacherLoad: z.array(OwnerAssiduiteTeacherLoadSchema),
  roomUsage: z.array(OwnerAssiduiteRoomUsageSchema),
  unassignedEcue: z.array(OwnerAssiduiteUnassignedSchema),
  presenceTrend: z.array(OwnerAssiduiteTrendSchema),
  /** Conduite : la note de tenue, et les bulletins qu'elle bloque. */
  conduite: z.object({
    parClasse: z.array(OwnerConduiteClasseSchema),
    notesTotal: z.number().int().nonnegative(),
    /** Total des inscrits sans note — autant de bulletins qui ne sortiront pas. */
    etudiantsSansNote: z.number().int().nonnegative(),
  }),
});

/* -------------------------------------------------------------------------- */
/*  5.E — /owner/personnes                                                     */
/* -------------------------------------------------------------------------- */

export const OwnerPersonnesQuerySchema = z.object({
  /**
   * Année scolaire `YYYY-YYYY` (pivot septembre), dérivée des ouvertures de
   * classe. Remplace l'ancien `academicYearId` : il portait sur
   * `student_enrollments.academic_year_id`, et cette table n'est pas alimentée.
   */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  /** Ouverture de classe, cle « filiereId|nom » — contrat owner-perimetre.sql. */
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
});

export const OwnerPersonnesKpisSchema = z.object({
  activeStudents: z.number().int().nonnegative(),
  activeTeachers: z.number().int().nonnegative(),
  parents: z.number().int().nonnegative(),
  /** Étudiants actifs / enseignants actifs. `null` si aucun enseignant. */
  studentTeacherRatio: z.number().nullable(),
  /**
   * Comptes sans mot de passe initial généré, PARMI LES PERSONNES DU PÉRIMÈTRE
   * — étudiants, leurs parents, enseignants. Il comptait auparavant tous les
   * utilisateurs du tenant, propriétaire et comptes d'administration inclus,
   * sur un écran qui ne parle pas d'eux.
   *
   * ⚠️ Aucune colonne ne trace l'ENVOI des identifiants : on ne mesure que la
   * présence de `users.initial_password`, pas leur transmission effective.
   */
  accountsWithoutCredentials: z.number().int().nonnegative(),
});

export const OwnerPersonnesGenderRowSchema = z.object({
  /** Valeur normalisée en minuscules ; `null` si non renseignée. */
  gender: z.string().nullable(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesAgeRowSchema = z.object({
  /** Borne basse de la tranche de 2 ans (18 ⇒ « 18-19 ans »). */
  bucketStart: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesHeadcountRowSchema = z.object({
  filiereId: z.string().uuid(),
  filiereName: z.string(),
  cycleName: z.string().nullable(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesContractRowSchema = z.object({
  contractType: z.string(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesTeacherRowSchema = z.object({
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  contractType: z.string(),
  status: z.string(),
  hireDate: z.string().nullable(),
  /** Ancienneté en années révolues. `null` si `hire_date` absente. */
  seniorityYears: z.number().nullable(),
  ecueCount: z.number().int().nonnegative(),
  filiereCount: z.number().int().nonnegative(),
  hasUserAccount: z.boolean(),
});

export const OwnerPersonnesNationalityRowSchema = z.object({
  nationality: z.string(),
  count: z.number().int().nonnegative(),
});

export const OwnerPersonnesCoverageSchema = z.object({
  studentsWithoutParent: z.number().int().nonnegative(),
  parentsWithoutChild: z.number().int().nonnegative(),
  teachersWithoutAccount: z.number().int().nonnegative(),
  studentsWithoutBirthDate: z.number().int().nonnegative(),
});

/**
 * Les deux files de relance nominatives de l'écran Personnes.
 *
 * Elles répondent à la même question sous deux angles : **qui, nommément,
 * représente de l'argent qu'on ne fait pas travailler ?**
 *
 * - Un ancien étudiant non réinscrit sur l'année active, c'est du chiffre
 *   d'affaires récupérable à coût quasi nul : il connaît l'école, elle le
 *   connaît, et un appel suffit parfois.
 * - Un enseignant sans affectation sous contrat **permanent**, c'est un coût
 *   fixe dormant. Le même sans affectation en **freelance** ne coûte rien : la
 *   distinction fait toute la valeur de la liste, et c'est pourquoi le type de
 *   contrat y figure au même rang que le nom.
 */
export const OwnerRelanceEtudiantSchema = z.object({
  studentId: z.string().uuid(),
  nom: z.string(),
  matricule: z.string().nullable(),
  telephone: z.string().nullable(),
  email: z.string().nullable(),
  /** Dernière classe suivie, pour savoir vers quoi le rappeler. */
  derniereClasse: z.string().nullable(),
  /** Millésime de sa dernière inscription. */
  derniereAnnee: z.string().nullable(),
});

export const OwnerEnseignantInactifSchema = z.object({
  teacherId: z.string().uuid(),
  nom: z.string(),
  contractType: z.string().nullable(),
  /**
   * Coût mensuel. `null` quand il n'est pas saisi — ce qui est le cas de TOUS
   * les enseignants sur la base de développement au 23/09/2026 : ni
   * `teachers.hourly_rate` ni `teacher_payment_configs.monthly_salary` ne sont
   * renseignés. Un zéro se lirait « cet enseignant est gratuit ».
   */
  coutMensuel: z.number().nullable(),
});

export const OwnerPersonnesResponseSchema = z.object({
  /** Année retenue, ou `null` quand l'écran cumule toutes les années. */
  anneeScolaire: z.string().nullable(),
  filiereIds: z.array(z.string().uuid()),
  kpis: OwnerPersonnesKpisSchema,
  genderDistribution: z.array(OwnerPersonnesGenderRowSchema),
  agePyramid: z.array(OwnerPersonnesAgeRowSchema),
  headcountByFiliere: z.array(OwnerPersonnesHeadcountRowSchema),
  teachersByContract: z.array(OwnerPersonnesContractRowSchema),
  teachers: z.array(OwnerPersonnesTeacherRowSchema),
  topNationalities: z.array(OwnerPersonnesNationalityRowSchema),
  coverage: OwnerPersonnesCoverageSchema,
  /** Anciens étudiants non réinscrits sur l'année active. */
  aRelancer: z.array(OwnerRelanceEtudiantSchema),
  /** Enseignants sans aucune affectation d'ECUE. */
  enseignantsInactifs: z.array(OwnerEnseignantInactifSchema),
  relances: z.object({
    /** Total réel, la liste pouvant être tronquée pour l'affichage. */
    etudiantsARelancer: z.number().int().nonnegative(),
    enseignantsSansAffectation: z.number().int().nonnegative(),
    /** Dont le contrat est permanent : le seul coût fixe dormant. */
    permanentsSansAffectation: z.number().int().nonnegative(),
    /**
     * `false` tant qu'aucun tarif n'est saisi : l'écran affiche alors les noms
     * sans chiffrer le coût, plutôt qu'un total à zéro.
     */
    coutMesure: z.boolean(),
  }),
});

/* -------------------------------------------------------------------------- */
/*  5.F — /owner/recrutement                                                   */
/* -------------------------------------------------------------------------- */

export const OwnerRecrutementAccountTypeSchema = z.enum(["student", "parent"]);
export const OwnerRecrutementStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const OwnerRecrutementQuerySchema = z.object({
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  accountType: OwnerRecrutementAccountTypeSchema.optional(),
  status: OwnerRecrutementStatusSchema.optional(),
});

export const OwnerRecrutementKpisSchema = z.object({
  received: z.number().int().nonnegative(),
  /** approved / (approved + rejected) — les demandes en attente sont hors ratio. */
  approvalRate: z.number(),
  /** Moyenne de `reviewed_at − created_at`, en jours. `null` si rien de traité. */
  avgProcessingDays: z.number().nullable(),
  pending: z.number().int().nonnegative(),
});

export const OwnerRecrutementFunnelSchema = z.object({
  received: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  accountsCreated: z.number().int().nonnegative(),
  /** Comptes créés disposant d'un mot de passe initial généré. */
  credentialsIssued: z.number().int().nonnegative(),
});

export const OwnerRecrutementWeeklyRowSchema = z.object({
  weekStart: z.string(),
  student: z.number().int().nonnegative(),
  parent: z.number().int().nonnegative(),
});

export const OwnerRecrutementStatusRowSchema = z.object({
  status: OwnerRecrutementStatusSchema,
  count: z.number().int().nonnegative(),
});

export const OwnerRecrutementDelayRowSchema = z.object({
  bucket: z.enum(["<24h", "1-3j", "3-7j", ">7j"]),
  count: z.number().int().nonnegative(),
});

export const OwnerRecrutementReasonRowSchema = z.object({
  reason: z.string(),
  count: z.number().int().nonnegative(),
});

export const OwnerRecrutementLevelRowSchema = z.object({
  level: z.string(),
  count: z.number().int().nonnegative(),
});

export const OwnerRecrutementResponseSchema = z.object({
  dateDebut: z.string(),
  dateFin: z.string(),
  accountType: OwnerRecrutementAccountTypeSchema.nullable(),
  status: OwnerRecrutementStatusSchema.nullable(),
  kpis: OwnerRecrutementKpisSchema,
  funnel: OwnerRecrutementFunnelSchema,
  weekly: z.array(OwnerRecrutementWeeklyRowSchema),
  byStatus: z.array(OwnerRecrutementStatusRowSchema),
  processingDelays: z.array(OwnerRecrutementDelayRowSchema),
  rejectionReasons: z.array(OwnerRecrutementReasonRowSchema),
  desiredLevels: z.array(OwnerRecrutementLevelRowSchema),
});

/* -------------------------------------------------------------------------- */
/*  Économie                                                                   */
/* -------------------------------------------------------------------------- */

export const OwnerEconomieQuerySchema = z.object({
  /**
   * Année scolaire `YYYY-YYYY` (pivot septembre), dérivée des ouvertures de
   * classe. Absente ⇒ toutes années cumulées.
   */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  /** Ouverture de classe, clé « filiereId|nom » — contrat owner-perimetre.sql. */
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
  /**
   * Base de l'exercice du compte de résultat : scolaire (1er sept → 31 août)
   * ou civile (1er janv → 31 déc).
   *
   * ELLE N'EST PAS DANS LA BARRE DE FILTRES, et c'est délibéré : un résultat
   * porte sur UN exercice, là où la barre accepte « toutes années ». Le
   * sélecteur vit sur l'écran, à côté du tableau qu'il commande.
   */
  baseExercice: z.enum(["scolaire", "civil"]).optional().default("scolaire"),
});

/**
 * Couverture des sources de coût.
 *
 * Sans elle, une marge de 80 % se lit comme une performance alors qu'elle ne
 * traduit qu'une comptabilité absente. Ces champs permettent à l'écran de
 * refuser d'employer le mot « marge » tant que rien n'est saisi.
 */
export const OwnerEconomieCouvertureSchema = z.object({
  coutEnseignantSaisi: z.boolean(),
  chargesSaisies: z.boolean(),
  nombreCharges: z.number().int().nonnegative(),
  chargesAffectees: z.number().int().nonnegative(),
  /** Date depuis laquelle l'historique des statuts élève existe (migration 0099). */
  historiqueStatutsDepuis: z.string().nullable(),
  /** `false` = le chiffre affiché est un chiffre d'affaires, pas une marge. */
  margeInterpretable: z.boolean(),
});

/**
 * Charges d ETABLISSEMENT : loyer, energie, amortissements.
 *
 * Elles ne sont rattachees a aucune classe et ne le seront JAMAIS par une cle
 * inventee — ni au prorata des effectifs, ni a celui du chiffre d affaires.
 * Elles vivent donc hors du tableau des marges, en pied, sous leur propre nom.
 * Le resultat apres charges d etablissement est un chiffre GLOBAL : il n existe
 * pas de version « par filiere », et c est le seul moyen de ne pas transformer
 * une convention de repartition en verite comptable.
 */
export const OwnerChargesEtablissementSchema = z.object({
  montant: z.number(),
  nombre: z.number().int().nonnegative(),
  /** Marge brute pedagogique totale MOINS les charges d etablissement. */
  resultatApresChargesEtablissement: z.number(),
});

export const OwnerMargeFiliereSchema = z.object({
  filiereId: z.string(),
  filiereName: z.string(),
  encaisse: z.number(),
  coutEnseignant: z.number(),
  /** Charges explicitement rattachées à la filière. Jamais de répartition automatique. */
  chargesAffectees: z.number(),
  margeBrute: z.number(),
  tauxMarge: z.number().nullable(),
  etudiants: z.number().int().nonnegative(),
  margeParEtudiant: z.number().nullable(),
});

export const OwnerFamilleSchema = z.object({
  parentId: z.string(),
  parentNom: z.string(),
  enfants: z.number().int().nonnegative(),
  /** LTV RÉALISÉE : ce qui a été encaissé, pas une projection. */
  encaisseTotal: z.number(),
  anneesPresence: z.number().nullable(),
  revenuAnnuelMoyen: z.number().nullable(),
});

export const OwnerRetentionSchema = z.object({
  filiereId: z.string(),
  filiereName: z.string(),
  cohorte: z.number().int().nonnegative(),
  poursuivis: z.number().int().nonnegative(),
  tauxRetention: z.number().nullable(),
});

/**
 * Compte de résultat à deux colonnes : engagement et caisse.
 *
 * POURQUOI DEUX COLONNES
 *
 * C'est la lecture d'un expert-comptable, et les deux dates de chaque fait sont
 * déjà en base : `incurred_on`/`paid_on` côté charges, la commande et le
 * règlement côté produits, `approved_at`/`paid_at` côté salaires. Une seule
 * colonne obligerait à choisir entre « ce que l'école a gagné » et « ce qui est
 * passé par la banque », alors que l'écart entre les deux EST l'information :
 * il se lit dans les trois soldes de clôture.
 *
 * UNE LIGNE NON MESURÉE N'EST PAS UNE LIGNE À ZÉRO
 *
 * `mesuree: false` quand la source est vide — aucune charge saisie, aucun
 * bulletin de paie calculé. Les montants sortent alors `null` et non 0, et la
 * ligne n'entre dans aucun total. Un résultat qui additionne des charges
 * absentes comme si elles valaient zéro annonce un bénéfice qui n'existe pas :
 * c'est l'erreur que cet écran doit rendre impossible.
 */
export const OwnerResultatLigneSchema = z.object({
  cle: z.string(),
  libelle: z.string(),
  /** `produit` s'ajoute au résultat, `charge` s'en retranche. */
  sens: z.enum(["produit", "charge"]),
  /** Daté au fait générateur : commande émise, charge engagée, paie approuvée. */
  engagement: z.number().nullable(),
  /** Daté au mouvement d'argent : règlement encaissé, charge décaissée, paie versée. */
  caisse: z.number().nullable(),
  mesuree: z.boolean(),
  /** Ce que le lecteur doit savoir pour interpréter la ligne. */
  note: z.string().nullable(),
});

/**
 * Les trois soldes qui expliquent l'écart entre les deux colonnes.
 *
 * Chacun est un décalage de trésorerie, pas une perte : de l'argent dû à
 * l'école, ou par elle. `null` quand la source n'est pas alimentée.
 */
export const OwnerResultatSoldesSchema = z.object({
  /** Facturé, non encaissé. */
  creancesClients: z.number().nullable(),
  /** Paie approuvée, non versée. */
  salairesDus: z.number().nullable(),
  /** Charges engagées, non décaissées. */
  dettesFournisseurs: z.number().nullable(),
});

export const OwnerCompteDeResultatSchema = z.object({
  base: z.enum(["scolaire", "civil"]),
  /** Bornes effectivement retenues, en ISO — l'écran ne les recalcule pas. */
  debut: z.string(),
  fin: z.string(),
  libelle: z.string(),
  lignes: z.array(OwnerResultatLigneSchema),
  soldes: OwnerResultatSoldesSchema,
  resultat: z.object({
    engagement: z.number().nullable(),
    caisse: z.number().nullable(),
    /**
     * `false` tant qu'une ligne de charge n'est pas mesurée. L'écran doit alors
     * écrire « produits » et non « résultat » : un résultat amputé de ses
     * charges n'est pas un résultat prudent, c'est un résultat faux.
     */
    interpretable: z.boolean(),
  }),
});

export const OwnerEconomieResponseSchema = z.object({
  computedAt: z.string(),
  /** Année retenue, ou `null` quand l'écran cumule toutes les années. */
  anneeScolaire: z.string().nullable(),
  couverture: OwnerEconomieCouvertureSchema,
  /** Ce que l ecran affiche en pied de tableau, hors colonnes des marges. */
  chargesEtablissement: OwnerChargesEtablissementSchema,
  kpis: z.object({
    encaisseTotal: z.number(),
    coutTotal: z.number(),
    margeBruteTotale: z.number(),
    tauxMargeBrute: z.number().nullable(),
    famillesSuivies: z.number().int().nonnegative(),
    fratries: z.number().int().nonnegative(),
  }),
  marges: z.array(OwnerMargeFiliereSchema),
  familles: z.array(OwnerFamilleSchema),
  retention: z.array(OwnerRetentionSchema),
  /** Compte de résultat à deux colonnes — la lecture d'un expert-comptable. */
  compteDeResultat: OwnerCompteDeResultatSchema,
});

/* -------------------------------------------------------------------------- */
/*  Qualité & risque                                                           */
/* -------------------------------------------------------------------------- */

export const OwnerRisqueQuerySchema = z.object({
  filiereIds: z.array(z.string().uuid()).optional(),
  /** Contrat de perimetre commun a l espace proprietaire. */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
});

/** Les quatre signaux du score de décrochage. */
export const OwnerRisqueSignalKeySchema = z.enum([
  "absence",
  "resultats",
  "impaye",
  "supports",
]);

export const OwnerRisqueStudentSchema = z.object({
  studentId: z.string(),
  nom: z.string(),
  matricule: z.string().nullable(),
  email: z.string().nullable(),
  telephone: z.string().nullable(),
  filiereName: z.string().nullable(),
  /** 0 à 100, calculé sur les seuls signaux mesurables. */
  score: z.number().int(),
  motifDominant: z.string(),
  /**
   * Signaux réellement pris en compte. Un score fondé sur deux signaux ne vaut
   * pas un score fondé sur quatre : l'écran doit pouvoir le dire.
   */
  signauxMesures: z.array(OwnerRisqueSignalKeySchema),
  heuresAbsence: z.number(),
  heuresTotal: z.number(),
  tauxAbsence: z.number().nullable(),
  moyenne: z.number().nullable(),
  nbEliminees: z.number().int().nonnegative(),
  resteDu: z.number(),
  joursRetardPaiement: z.number().nullable(),
  /** Séances sans horaire saisi, donc invisibles du calcul d'absence. */
  seancesSansHoraire: z.number().int().nonnegative(),
});

export const OwnerRisqueTeacherSchema = z.object({
  teacherId: z.string(),
  nom: z.string(),
  notesAttendues: z.number().int().nonnegative(),
  notesSaisies: z.number().int().nonnegative(),
  tauxSaisie: z.number().nullable(),
  seances30j: z.number().int().nonnegative(),
  seancesPointees30j: z.number().int().nonnegative(),
  tauxAppels: z.number().nullable(),
});

export const OwnerRisquePresenceSchema = z.object({
  filiereId: z.string(),
  filiereName: z.string(),
  taux30j: z.number().nullable(),
  taux7j: z.number().nullable(),
  /** Points d'écart entre la semaine écoulée et le mois. Négatif = chute. */
  ecart: z.number().nullable(),
});

export const OwnerRisqueCorrelationPointSchema = z.object({
  studentId: z.string(),
  heuresAbsence: z.number(),
  moyenne: z.number(),
  filiereName: z.string().nullable(),
});

export const OwnerRisqueResponseSchema = z.object({
  computedAt: z.string(),
  kpis: z.object({
    etudiantsSuivis: z.number().int().nonnegative(),
    aRisque: z.number().int().nonnegative(),
    aSurveiller: z.number().int().nonnegative(),
    seuilRisque: z.number().int(),
    /**
     * `false` quand l'établissement ne dépose aucun support ou qu'aucune
     * consultation n'a jamais été enregistrée : le signal est alors retiré du
     * score, et l'écran doit l'annoncer plutôt que de laisser croire à quatre
     * signaux sur quatre.
     */
    supportsMesurables: z.boolean(),
    enseignantsEnRetardSaisie: z.number().int().nonnegative(),
    enseignantsSousAppel: z.number().int().nonnegative(),
  }),
  students: z.array(OwnerRisqueStudentSchema),
  enseignants: z.array(OwnerRisqueTeacherSchema),
  presence: z.array(OwnerRisquePresenceSchema),
  correlation: z.array(OwnerRisqueCorrelationPointSchema),
  /**
   * Périmètre effectivement appliqué, renvoyé pour que l'export CSV porte en
   * en-tête ce qu'il contient réellement. Un fichier nominatif qui annonce
   * « toutes filières » alors qu'il ne liste qu'une classe se lit comme un
   * état de l'école entière, et la relance téléphonique part de travers.
   */
  filiereIds: z.array(z.string().uuid()),
  /** Ouverture de classe, clé « filiereId|nom ». */
  nomClasse: z.string().nullable(),
});

/* -------------------------------------------------------------------------- */
/*  Remplissage & planning                                                     */
/* -------------------------------------------------------------------------- */

export const OwnerRemplissageQuerySchema = z.object({
  /**
   * Année scolaire `YYYY-YYYY` (pivot septembre), dérivée des ouvertures de
   * classe. Absente ⇒ toutes années cumulées.
   */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  /** Ouverture de classe, clé « filiereId|nom » — contrat owner-perimetre.sql. */
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
});

/**
 * Un taux vaut `null` quand la capacité n'est pas renseignée — jamais 0.
 * Afficher « 0 % de remplissage » sur une cohorte sans capacité déclarée
 * ferait passer une donnée manquante pour un échec commercial.
 */
const TauxSchema = z.number().nullable();

export const OwnerRemplissageKpisSchema = z.object({
  cohortesActives: z.number().int().nonnegative(),
  cohortesVides: z.number().int().nonnegative(),
  /** Cohortes exclues du taux global, faute de `capacite_max`. */
  cohortesSansCapacite: z.number().int().nonnegative(),
  tauxRemplissageCohortes: TauxSchema,
  /** Cohortes du périmètre encore ouvertes — celles qui appellent un arbitrage. */
  cohortesOuvertes: z.number().int().nonnegative(),
  conflitsPlanning: z.number().int().nonnegative(),
  creneauxTotal: z.number().int().nonnegative(),
  creneauxSansSalle: z.number().int().nonnegative(),
  creneauxSansEnseignant: z.number().int().nonnegative(),
  /**
   * Heures de grille déroulées sur LE PÉRIMÈTRE DE L'ÉCRAN — l'année choisie,
   * ou toutes années cumulées. Auparavant une fenêtre glissante de 30 jours,
   * qui ne couvrait que 24 des 1 326 séances tenues et ignorait tout filtre.
   */
  heuresPlanifiees: z.number(),
  heuresTenues: z.number(),
  /** Heures tenues rapportées aux heures planifiées, même périmètre. */
  tauxRespectPlanning: TauxSchema,
  /**
   * Séances du périmètre sans horaire saisi : elles ne comptent pas dans les
   * heures tenues, ce qui minore mécaniquement le taux de respect.
   */
  seancesSansHoraire: z.number().int().nonnegative(),
});

export const OwnerCohorteRowSchema = z.object({
  sessionId: z.string(),
  libelle: z.string(),
  ueCode: z.string(),
  ueLibelle: z.string(),
  filiereName: z.string().nullable(),
  statut: z.string(),
  dateDebut: z.string().nullable(),
  dateFin: z.string().nullable(),
  joursAvantDebut: z.number().nullable(),
  capacite: z.number().nullable(),
  inscrits: z.number().int().nonnegative(),
  tauxRemplissage: TauxSchema,
  /*
   * L'OUVERTURE COMME LIGNE ÉCONOMIQUE.
   *
   * C'est la décision go/no-go d'un fondateur : ouvrir, fusionner ou annuler.
   * Elle ne se prend pas sur un taux de remplissage seul — une classe à 40 %
   * dont les inscrits ont payé vaut mieux qu'une classe pleine qui ne règle
   * pas. Les trois colonnes se lisent ensemble.
   */
  /** Σ des prix d'inscription à cette ouverture, hors annulées. */
  caAttendu: z.number(),
  /** Règlements confirmés sur les commandes qui financent cette ouverture. */
  caEncaisse: z.number(),
  resteDu: z.number(),
  /**
   * Coût enseignant imputé à cette ouverture. `null` quand il n'est pas
   * mesurable — voir `couvertureEconomique`.
   *
   * Il n'est JAMAIS remplacé par une répartition au prorata : une marge par
   * classe bâtie sur une clé inventée n'est pas une marge, c'est une opinion.
   */
  coutEnseignant: z.number().nullable(),
  /** `caEncaisse - coutEnseignant`. `null` dès que le coût ne l'est pas. */
  solde: z.number().nullable(),
});

export const OwnerPlanningConflitSchema = z.object({
  type: z.enum(["salle", "enseignant"]),
  /** Salle ou enseignant en double réservation. */
  ressource: z.string(),
  jour: z.string(),
  plageA: z.string(),
  plageB: z.string(),
  coursA: z.string(),
  coursB: z.string(),
});

export const OwnerCouvertureRowSchema = z.object({
  semestreId: z.string(),
  libelle: z.string(),
  filiereName: z.string().nullable(),
  ecueTotal: z.number().int().nonnegative(),
  ecueProgrammees: z.number().int().nonnegative(),
  taux: TauxSchema,
});

export const OwnerRemplissageResponseSchema = z.object({
  computedAt: z.string(),
  /** Année retenue, ou `null` quand l'écran cumule toutes les années. */
  anneeScolaire: z.string().nullable(),
  kpis: OwnerRemplissageKpisSchema,
  cohortes: z.array(OwnerCohorteRowSchema),
  conflits: z.array(OwnerPlanningConflitSchema),
  couverture: z.array(OwnerCouvertureRowSchema),
  /**
   * Ce que la colonne économique peut, ou ne peut pas, mesurer.
   *
   * Le coût enseignant par ouverture passe par
   * `payment_hour_details.seance_id` → `professional_ecue_seances.ue_session_id`.
   * Ce chemin existe et est direct, mais la table peut être entièrement vide —
   * elle l'est sur la base de développement au 23/09/2026, comme l'était déjà
   * le chemin académique que la migration 0103 documente (défaut E4 : la clé
   * étrangère rejetait les insertions et l'erreur était avalée).
   *
   * Quand elle l'est, le coût sort `null` et le solde avec lui. **Pas de repli
   * sur une répartition au prorata** : c'est exactement la clé inventée que ce
   * chantier supprime ailleurs.
   */
  couvertureEconomique: z.object({
    coutEnseignantMesure: z.boolean(),
    /** Pourquoi il ne l'est pas. `null` quand il l'est. */
    raison: z.string().nullable(),
    /** Ouvertures dont le CA attendu est chiffrable, sur le total du périmètre. */
    ouverturesValorisees: z.number().int().nonnegative(),
  }),
});

/* -------------------------------------------------------------------------- */
/*  Trésorerie & recouvrement                                                  */
/* -------------------------------------------------------------------------- */

/** Pas de la courbe de trésorerie. */
export const OwnerTresorerieGranularitySchema = z.enum(["day", "week", "month"]);

export const OwnerTresorerieQuerySchema = z.object({
  /** Bornes incluses, format `YYYY-MM-DD`. Par défaut : 90 derniers jours. */
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  granularity: OwnerTresorerieGranularitySchema.optional().default("week"),
  /**
   * Périmètre — le contrat commun de `owner-perimetre.sql`.
   *
   * L'écran Impayés affichait déjà ces trois sélecteurs, mais cette requête-ci
   * n'en connaissait qu'un : la page dégradait donc la classe en filière pour
   * la balance âgée, la courbe et le journal. Choisir « LICENCE 1 A »
   * restreignait le haut de l'écran et pas le bas, sans que rien ne le dise.
   */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  /** Clé `filiereId|nom` de l'ouverture de classe. */
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
});

/**
 * Tranche d'ancienneté d'un impayé.
 *
 * `a_echoir` n'est PAS un impayé : c'est du dû à venir. Le confondre avec du
 * retard gonfle artificiellement la dette et fait paniquer pour rien.
 */
export const OwnerAgedBucketSchema = z.enum(["a_echoir", "j0_30", "j31_60", "j61_90", "j90_plus"]);

export const OwnerAgedByFiliereRowSchema = z.object({
  filiereId: z.string().nullable(),
  filiereName: z.string(),
  aEchoir: z.number(),
  j0_30: z.number(),
  j31_60: z.number(),
  j61_90: z.number(),
  j90Plus: z.number(),
  /** Somme des tranches échues uniquement (hors `a_echoir`). */
  totalEchu: z.number(),
});

export const OwnerCashflowPointSchema = z.object({
  /** Début de la tranche, format `YYYY-MM-DD`. */
  date: z.string(),
  label: z.string(),
  scolaire: z.number(),
  professionnel: z.number(),
  total: z.number(),
  /** Même tranche décalée d'un an, pour comparer à saison égale. */
  totalAnneePrecedente: z.number(),
});

export const OwnerPaymentModeRowSchema = z.object({
  mode: z.string(),
  label: z.string(),
  amount: z.number(),
  count: z.number().int().nonnegative(),
});

/**
 * Écarts de caisse : des situations qui ne devraient pas exister et que
 * personne ne voit aujourd'hui.
 */
export const OwnerCashAnomaliesSchema = z.object({
  /** Commandes marquées « payée » sans aucune ligne de paiement. */
  ordersPaidWithoutPayment: z.object({ count: z.number().int(), amount: z.number() }),
  /** Paiements encaissés depuis plus de 48 h sans numéro de reçu. */
  paymentsWithoutReceipt: z.object({ count: z.number().int(), amount: z.number() }),
});

export const OwnerTresorerieTotalsSchema = z.object({
  collected: z.number(),
  expected: z.number(),
  outstanding: z.number(),
  /** Part échue du reste à recouvrer. */
  outstandingEchu: z.number(),
  /**
   * `null` quand RIEN n'est attendu sur la période — à ne pas confondre avec
   * « rien n'est recouvré ». Un zéro affichait 0 % de recouvrement sur un
   * établissement intégralement payé, sur l'écran même des impayés.
   */
  recoveryRate: z.number().nullable(),
});

/**
 * Délai entre l'inscription et le premier règlement, par classe.
 *
 * À QUOI IL SERT
 *
 * Au-delà d'une trentaine de jours, ce n'est plus un retard de paiement, c'est
 * une politique d'acompte qui ne tient pas : l'école a livré des heures de
 * cours avant d'avoir vu le premier franc. Le délai par classe dit laquelle
 * renégocier, et c'est une décision qu'un fondateur peut prendre seul.
 *
 * POURQUOI IL PEUT ÊTRE NON MESURABLE, ET POURQUOI C'EST CAPITAL
 *
 * Il se calcule entre `professional_enrollments.created_at` et le premier
 * `professional_payments.paid_at` — deux dates d'ÉCRITURE DE LIGNE. Sur une
 * base alimentée par reprise de données, elles portent toutes l'horodatage du
 * chargement : le délai vaut alors 0 pour tout le monde, et ce zéro se lirait
 * « tout le monde paie le jour même », c'est-à-dire l'inverse exact de ce que
 * l'indicateur doit détecter.
 *
 * D'où un test de fiabilité plutôt qu'un chiffre brut : si les inscriptions du
 * périmètre se concentrent sur un ou deux jours distincts alors qu'elles sont
 * nombreuses, les dates décrivent une reprise et non des faits. L'indicateur
 * sort alors `mesure: false` avec sa raison, et n'affiche AUCUN délai.
 */
export const OwnerDelaiClasseSchema = z.object({
  filiereId: z.string().uuid().nullable(),
  filiereName: z.string(),
  lots: z.number().int().nonnegative(),
  /** Délai moyen en jours. `null` quand la classe n'a aucun lot payé. */
  moyenJours: z.number().nullable(),
  medianeJours: z.number().nullable(),
});

export const OwnerDelaiPaiementSchema = z.object({
  mesure: z.boolean(),
  /** Pourquoi l'indicateur n'est pas mesurable. `null` quand il l'est. */
  raisonNonMesure: z.string().nullable(),
  /** Inscriptions ayant reçu au moins un règlement confirmé. */
  lotsPayes: z.number().int().nonnegative(),
  moyenJours: z.number().nullable(),
  medianeJours: z.number().nullable(),
  /** Seuil au-delà duquel la politique d'acompte doit changer. */
  seuilJours: z.number().int(),
  parClasse: z.array(OwnerDelaiClasseSchema),
});

export const OwnerTresorerieResponseSchema = z.object({
  dateDebut: z.string(),
  dateFin: z.string(),
  granularity: OwnerTresorerieGranularitySchema,
  computedAt: z.string(),
  totals: OwnerTresorerieTotalsSchema,
  agedByFiliere: z.array(OwnerAgedByFiliereRowSchema),
  cashflow: z.array(OwnerCashflowPointSchema),
  byPaymentMode: z.array(OwnerPaymentModeRowSchema),
  anomalies: OwnerCashAnomaliesSchema,
  /** Délai entre l'inscription et le premier règlement. */
  delaiPaiement: OwnerDelaiPaiementSchema,
});

/* --- Journal de caisse ---------------------------------------------------- */

export const OwnerCashRegisterRowSchema = z.object({
  paymentId: z.string(),
  paidAt: z.string(),
  receiptNumber: z.string().nullable(),
  studentName: z.string(),
  matricule: z.string().nullable(),
  filiereName: z.string().nullable(),
  orderReference: z.string().nullable(),
  mode: z.string(),
  modeLabel: z.string(),
  amount: z.number(),
});

export const OwnerCashRegisterQuerySchema = z.object({
  dateDebut: z.string().optional(),
  dateFin: z.string().optional(),
  mode: z.string().optional(),
  search: z.string().optional(),
  /**
   * Périmètre — même contrat que le reste de l'écran Impayés.
   *
   * Le journal est une pièce comptable : il doit lister exactement les
   * encaissements du périmètre affiché au-dessus de lui, sans quoi son total
   * ne se rapproche d'aucun des chiffres de la page.
   */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  filiereIds: z.array(z.string().uuid()).optional(),
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(50),
});

export const OwnerCashRegisterResponseSchema = z.object({
  dateDebut: z.string(),
  dateFin: z.string(),
  rows: z.array(OwnerCashRegisterRowSchema),
  /** Totaux sur TOUT le périmètre filtré, jamais sur la seule page affichée. */
  totalAmount: z.number(),
  totalCount: z.number().int().nonnegative(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

/* -------------------------------------------------------------------------- */
/*  Pouls — barre haute de l'espace propriétaire                               */
/* -------------------------------------------------------------------------- */

/**
 * Unité d'un KPI du pouls. Elle pilote le formatage côté écran : jamais de
 * montant sans devise, jamais de pourcentage sans signe.
 */
export const OwnerPulseUnitSchema = z.enum(["fcfa", "percent", "count"]);

/**
 * État d'un KPI. Toujours DOUBLÉ d'un libellé à l'écran : la couleur seule n'est
 * pas une information (règle de la palette data-viz).
 *  - `good`     : au-dessus du seuil attendu
 *  - `warning`  : à surveiller
 *  - `critical` : décision à prendre maintenant
 *  - `neutral`  : pas de seuil applicable, ou périmètre vide
 */
export const OwnerPulseStatusSchema = z.enum(["good", "warning", "critical", "neutral"]);

export const OwnerPulseKpiSchema = z.object({
  /** Identifiant stable, utilisé comme clé de rendu et dans les tests. */
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: OwnerPulseUnitSchema,
  /** Valeur de comparaison, ou `null` quand la comparaison n'a pas de sens. */
  previousValue: z.number().nullable(),
  /** Ce à quoi on compare, en toutes lettres (« même mois l'an dernier »). */
  previousLabel: z.string(),
  status: OwnerPulseStatusSchema,
  /**
   * Méthodologie et limites assumées de l'indicateur, affichées à l'écran.
   * Un chiffre approximé DOIT porter son hypothèse ici.
   */
  hint: z.string(),
  /** Sous-valeur marquante (« dont 1 250 000 FCFA à plus de 60 jours »). */
  detail: z.string().nullable(),
  /** Lien profond vers l'écran qui permet d'agir sur ce chiffre. */
  href: z.string().nullable(),
  /**
   * `false` quand la donnée nécessaire n'existe pas encore en base : l'écran
   * affiche « non mesuré » au lieu d'un zéro qui passerait pour un vrai chiffre.
   */
  measured: z.boolean(),
});

/**
 * Année scolaire regardée, au format « AAAA-AAAA+1 ».
 *
 * C'est l'année DÉRIVÉE des ouvertures de classe, pas une ligne de la table
 * `academic_years`. Le module professionnel n'a pas de table d'années : une
 * année existe parce qu'une classe a été ouverte, et son millésime se lit sur
 * la date de début de l'ouverture avec un pivot en septembre.
 *
 * S'adosser à `academic_years` était une erreur : sur une base réelle, cette
 * table ignorait trois années portant douze ouvertures chacune et déclarait une
 * année qui n'en portait aucune. Le filtre montrait donc le contraire de
 * l'activité.
 *
 * Absente, le pouls décrit le présent — le mois en cours, les 30 derniers
 * jours. Présente, il décrit cette année-là de bout en bout, et les indicateurs
 * concernés changent de libellé pour le dire.
 */
export const OwnerPulseQuerySchema = z.object({
  anneeScolaire: OwnerAcademicYearSchema.optional(),
});

export const OwnerPulseResponseSchema = z.object({
  /** Horodatage du calcul, affiché comme « données au JJ/MM à HH:MM ». */
  computedAt: z.string(),
  /** Fenêtre de l'année scolaire retenue pour les indicateurs annuels. */
  academicYearLabel: z.string().nullable(),
  /**
   * Bornes de la fenêtre effectivement retenue, en `AAAA-MM-JJ`.
   *
   * Le tableau de bord les réutilise pour caler ses autres blocs — courbe des
   * encaissements, concentration des impayés — sur la MÊME fenêtre que les
   * indicateurs. Les recalculer de son côté finirait par diverger le jour où
   * une année ne suivrait pas le pivot de septembre.
   *
   * `null` quand l'année demandée est introuvable : rien n'est alors mesuré,
   * plutôt que d'afficher les chiffres d'une autre année sous son nom.
   */
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  kpis: z.array(OwnerPulseKpiSchema),
});

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type OwnerEconomieQuery = z.infer<typeof OwnerEconomieQuerySchema>;
export type OwnerEconomieResponse = z.infer<typeof OwnerEconomieResponseSchema>;
export type OwnerCompteDeResultat = z.infer<typeof OwnerCompteDeResultatSchema>;
export type OwnerResultatLigne = z.infer<typeof OwnerResultatLigneSchema>;
export type OwnerMargeFiliere = z.infer<typeof OwnerMargeFiliereSchema>;
export type OwnerFamille = z.infer<typeof OwnerFamilleSchema>;
export type OwnerRisqueQuery = z.infer<typeof OwnerRisqueQuerySchema>;
export type OwnerRisqueResponse = z.infer<typeof OwnerRisqueResponseSchema>;
export type OwnerRisqueSignalKey = z.infer<typeof OwnerRisqueSignalKeySchema>;
export type OwnerRisqueStudent = z.infer<typeof OwnerRisqueStudentSchema>;
export type OwnerRisqueTeacher = z.infer<typeof OwnerRisqueTeacherSchema>;
export type OwnerRemplissageQuery = z.infer<typeof OwnerRemplissageQuerySchema>;
export type OwnerRemplissageResponse = z.infer<typeof OwnerRemplissageResponseSchema>;
export type OwnerCohorteRow = z.infer<typeof OwnerCohorteRowSchema>;
export type OwnerPlanningConflit = z.infer<typeof OwnerPlanningConflitSchema>;
export type OwnerCouvertureRow = z.infer<typeof OwnerCouvertureRowSchema>;
export type OwnerTresorerieGranularity = z.infer<typeof OwnerTresorerieGranularitySchema>;
export type OwnerTresorerieQuery = z.infer<typeof OwnerTresorerieQuerySchema>;
export type OwnerTresorerieResponse = z.infer<typeof OwnerTresorerieResponseSchema>;
export type OwnerAgedBucket = z.infer<typeof OwnerAgedBucketSchema>;
export type OwnerAgedByFiliereRow = z.infer<typeof OwnerAgedByFiliereRowSchema>;
export type OwnerCashflowPoint = z.infer<typeof OwnerCashflowPointSchema>;
export type OwnerCashRegisterQuery = z.infer<typeof OwnerCashRegisterQuerySchema>;
export type OwnerCashRegisterResponse = z.infer<typeof OwnerCashRegisterResponseSchema>;
export type OwnerCashRegisterRow = z.infer<typeof OwnerCashRegisterRowSchema>;
export type OwnerPulseUnit = z.infer<typeof OwnerPulseUnitSchema>;
export type OwnerPulseStatus = z.infer<typeof OwnerPulseStatusSchema>;
export type OwnerPulseKpi = z.infer<typeof OwnerPulseKpiSchema>;
export type OwnerPulseQuery = z.infer<typeof OwnerPulseQuerySchema>;
export type OwnerPulseResponse = z.infer<typeof OwnerPulseResponseSchema>;
export type OwnerUeCategorie = z.infer<typeof OwnerUeCategorieSchema>;
export type OwnerPedagogieQuery = z.infer<typeof OwnerPedagogieQuerySchema>;
export type OwnerPedagogieResponse = z.infer<typeof OwnerPedagogieResponseSchema>;
export type OwnerFinancesProPeriod = z.infer<typeof OwnerFinancesProPeriodSchema>;
export type OwnerFinancesProMode = z.infer<typeof OwnerFinancesProModeSchema>;
export type OwnerFinancesProQuery = z.infer<typeof OwnerFinancesProQuerySchema>;
export type OwnerFinancesProResponse = z.infer<typeof OwnerFinancesProResponseSchema>;
export type OwnerStatsFiltersResponse = z.infer<typeof OwnerStatsFiltersResponseSchema>;
export type OwnerReferentielQuery = z.infer<typeof OwnerReferentielQuerySchema>;
export type OwnerReferentielResponse = z.infer<typeof OwnerReferentielResponseSchema>;
export type OwnerReferentielIssue = z.infer<typeof OwnerReferentielIssueSchema>;
export type OwnerAssiduiteQuery = z.infer<typeof OwnerAssiduiteQuerySchema>;
export type OwnerAssiduiteResponse = z.infer<typeof OwnerAssiduiteResponseSchema>;
export type OwnerPersonnesQuery = z.infer<typeof OwnerPersonnesQuerySchema>;
export type OwnerPersonnesResponse = z.infer<typeof OwnerPersonnesResponseSchema>;
export type OwnerRecrutementQuery = z.infer<typeof OwnerRecrutementQuerySchema>;
export type OwnerRecrutementResponse = z.infer<typeof OwnerRecrutementResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  5.J — /owner/payroll : masse salariale                                     */
/* -------------------------------------------------------------------------- */

/**
 * Statuts réels de `payment_status` en base — six, pas trois.
 *
 * `disputed`, `cancelled` et `unpaid` existent et doivent être nommés : une
 * paie contestée exclue d'un total sans le dire ferait un écart inexplicable
 * entre cet écran et le bulletin que l'enseignant a en main.
 */
export const OwnerPayrollStatusSchema = z.enum([
  "calculated",
  "approved",
  "paid",
  "disputed",
  "cancelled",
  "unpaid",
]);

/** Filtre d'archivage. Toutes les paies d'un exercice clos sont archivées. */
export const OwnerPayrollArchiveSchema = z.enum(["actives", "archivees", "toutes"]);

/**
 * Année scolaire au format « AAAA-AAAA+1 », telle que l'affiche la page admin
 * des bulletins archivés. Le format est vérifié ici : c'est une chaîne libre qui
 * finit dans une comparaison SQL.
 */
export const OwnerPayrollAnneeSchema = z.string().regex(/^[0-9]{4}-[0-9]{4}$/);

export const OwnerPayrollQuerySchema = z.object({
  /** `payment_periods.id`. Absent = toutes les périodes. */
  periodId: z.string().uuid().optional(),
  /** Année scolaire ; restreint aux périodes de paie qui lui appartiennent. */
  anneeScolaire: OwnerPayrollAnneeSchema.optional(),
  /**
   * `teachers.id`. Absent = tous les enseignants.
   *
   * Même axe que le filtre « Enseignant » de la page administrateur des
   * bulletins archivés : « combien je paie, À QUI » est la moitié de la
   * question de l'écran, elle doit être filtrable.
   */
  teacherId: z.string().uuid().optional(),
  status: OwnerPayrollStatusSchema.optional(),
  archive: OwnerPayrollArchiveSchema.default("toutes"),
});

export const OwnerPayrollPeriodOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.string(),
  /**
   * Année scolaire de la période. `academic_years.name` quand la période y est
   * rattachée, sinon déduite de `period_start` avec un pivot en septembre —
   * même règle que la page administrateur des bulletins archivés, pour que les
   * deux écrans classent un même bulletin dans la même année.
   */
  anneeScolaire: z.string().nullable(),
});

export const OwnerPayrollKpisSchema = z.object({
  /** Somme des paies retenues par le filtre, hors annulées. */
  masseSalariale: z.number(),
  bulletins: z.number().int().nonnegative(),
  enseignantsPayes: z.number().int().nonnegative(),
  /** Masse / enseignants payés. `null` si personne n'est payé. */
  coutMoyenParEnseignant: z.number().nullable(),
  /** Statut `calculated` : calculé, en attente de la signature du propriétaire. */
  enAttenteValidation: z.number().int().nonnegative(),
  montantEnAttente: z.number(),
  /** Approuvé mais `paid_at IS NULL` : engagé, pas encore sorti de caisse. */
  approuveNonVerse: z.number().int().nonnegative(),
  montantApprouveNonVerse: z.number(),
  /**
   * Montant des paies annulées ou contestées sur le périmètre. Exclu de
   * `masseSalariale`, et affiché à part pour que l'exclusion soit visible.
   */
  montantHorsTotal: z.number(),
});

/** Décomposition du bulletin, telle que la porte `teacher_payments`. */
export const OwnerPayrollBreakdownSchema = z.object({
  base: z.number(),
  heuresSup: z.number(),
  primes: z.number(),
  retenues: z.number(),
  total: z.number(),
});

export const OwnerPayrollByPeriodSchema = z.object({
  periodId: z.string().uuid(),
  name: z.string(),
  periodStart: z.string(),
  bulletins: z.number().int().nonnegative(),
  enseignantsPayes: z.number().int().nonnegative(),
  montant: z.number(),
});

export const OwnerPayrollByTeacherSchema = z.object({
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  email: z.string().nullable(),
  bulletins: z.number().int().nonnegative(),
  base: z.number(),
  heuresSup: z.number(),
  primes: z.number(),
  retenues: z.number(),
  total: z.number(),
});

export const OwnerPayrollPendingRowSchema = z.object({
  id: z.string().uuid(),
  teacherName: z.string(),
  periodName: z.string().nullable(),
  amount: z.number(),
  calculatedAt: z.string().nullable(),
});

export const OwnerPayrollCourseGapSchema = z.object({
  classCourseId: z.string().uuid(),
  className: z.string(),
  courseName: z.string(),
});

/**
 * Enseignant proposé au filtre, avec son nombre de bulletins.
 *
 * Seuls ceux qui EN ONT figurent dans la liste — même règle que la page
 * administrateur des bulletins archivés. Proposer quelqu'un sans bulletin
 * ouvrirait un écran vide sans dire pourquoi.
 */
export const OwnerPayrollTeacherOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  bulletins: z.number().int().nonnegative(),
});

/**
 * Statut réellement porté par au moins un bulletin, avec son effectif.
 *
 * `payment_status` a six valeurs ; une base n'en porte généralement que deux ou
 * trois. Lister les six dans le menu revient à proposer quatre filtres qui
 * n'ouvrent que du vide. L'effectif est renvoyé pour que l'option annonce ce
 * qu'elle contient avant d'être choisie.
 */
export const OwnerPayrollStatusCountSchema = z.object({
  status: OwnerPayrollStatusSchema,
  bulletins: z.number().int().nonnegative(),
});

/**
 * Un bulletin, tel que la page administrateur des bulletins archivés le montre.
 *
 * L'écran propriétaire agrège ; mais dès qu'un enseignant ou une période est
 * choisi, la question devient « quelles lignes exactement ? ». Les mêmes
 * colonnes que l'historique — deux dates distinctes, `archivedAt` qui dit quand
 * le montant a été arrêté et `paidAt` quand l'argent est parti — pour que les
 * deux écrans ne puissent pas raconter deux histoires du même bulletin.
 */
export const OwnerPayrollBulletinSchema = z.object({
  id: z.string().uuid(),
  teacherId: z.string().uuid(),
  teacherName: z.string(),
  periodId: z.string().uuid().nullable(),
  periodName: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  anneeScolaire: z.string().nullable(),
  status: z.string(),
  amount: z.number(),
  /** `null` tant que le bulletin n'a pas été archivé. */
  archivedAt: z.string().nullable(),
  /** Date du versement RÉEL. `null` tant que le bulletin reste dû. */
  paidAt: z.string().nullable(),
});

export const OwnerPayrollResponseSchema = z.object({
  /** Filtres réellement appliqués, ré-exposés pour l'affichage et le PDF. */
  periodId: z.string().uuid().nullable(),
  periodName: z.string().nullable(),
  anneeScolaire: z.string().nullable(),
  teacherId: z.string().uuid().nullable(),
  teacherName: z.string().nullable(),
  status: OwnerPayrollStatusSchema.nullable(),
  archive: OwnerPayrollArchiveSchema,
  /** Périodes proposées au filtre : l'écran n'a pas à les deviner. */
  periods: z.array(OwnerPayrollPeriodOptionSchema),
  /**
   * Années réellement représentées, de la plus récente à la plus ancienne.
   * Proposer une année sans aucun bulletin donnerait un écran vide sans dire
   * pourquoi.
   */
  anneesScolaires: z.array(z.string()),
  /** Enseignants porteurs d'au moins un bulletin, du plus fourni au moins. */
  teachers: z.array(OwnerPayrollTeacherOptionSchema),
  /**
   * Statuts réellement présents, hors filtre de statut : le menu ne doit pas se
   * vider de ses propres options dès qu'on en choisit une.
   */
  statuts: z.array(OwnerPayrollStatusCountSchema),
  /**
   * Effectifs des deux faces de l'archivage, hors filtre d'archivage. Un
   * établissement dont tout est classé doit le LIRE sur l'option, plutôt que de
   * découvrir un écran vide après l'avoir choisie.
   */
  archiveCounts: z.object({
    actives: z.number().int().nonnegative(),
    archivees: z.number().int().nonnegative(),
  }),
  kpis: OwnerPayrollKpisSchema,
  breakdown: OwnerPayrollBreakdownSchema,
  /** Toutes les périodes, filtre de période ignoré : c'est une évolution. */
  byPeriod: z.array(OwnerPayrollByPeriodSchema),
  byTeacher: z.array(OwnerPayrollByTeacherSchema),
  /**
   * Les bulletins du périmètre, ligne à ligne. Plafonnés côté serveur ;
   * `bulletinsTotal` porte sur tout ce que le filtre retient, pour qu'un
   * écrêtage se lise au lieu de se deviner.
   */
  bulletins: z.array(OwnerPayrollBulletinSchema),
  bulletinsTotal: z.number().int().nonnegative(),
  pending: z.array(OwnerPayrollPendingRowSchema),
  coursesWithoutTeacher: z.array(OwnerPayrollCourseGapSchema),
  /**
   * Cours sans titulaire AFFICHABLES : mêmes jointures que la liste, pour que
   * le compteur et le tableau ne puissent pas se contredire.
   */
  coursesWithoutTeacherTotal: z.number().int().nonnegative(),
  /**
   * Lignes `class_courses` sans titulaire dont la classe ou la matière
   * référencée n'existe plus. Elles ne sont listables nulle part : les compter
   * avec les autres afficherait un total au-dessus d'un tableau plus court, ce
   * qui se lit comme une troncature au lieu d'un défaut de données.
   */
  coursesWithoutTeacherOrphaned: z.number().int().nonnegative(),
  /**
   * CONFIGURATION DE LA PAIE — première des quatre entrées du menu
   * administrateur que l'espace propriétaire ne montrait pas.
   *
   * Un enseignant sans configuration ne peut pas être payé : son bulletin ne se
   * calcule pas. Un tarif expiré non remplacé produit le même blocage, plus tard
   * et plus silencieusement.
   *
   * Mesuré le 23/09/2026 : 30 configurations pour 31 enseignants, toutes de type
   * horaire, et 96 tarifs d'ECUE **tous génériques** — aucun nominatif. Un tarif
   * générique convient tant qu'un enseignant ne négocie pas le sien ; le jour où
   * il le fait, l'absence de nominatif se paie en litige.
   */
  configuration: z.object({
    enseignants: z.number().int().nonnegative(),
    avecConfiguration: z.number().int().nonnegative(),
    sansConfiguration: z.number().int().nonnegative(),
    tarifsEcue: z.number().int().nonnegative(),
    tarifsNominatifs: z.number().int().nonnegative(),
    tarifsGeneriques: z.number().int().nonnegative(),
    tarifsExpires: z.number().int().nonnegative(),
  }),
  /**
   * VALIDATION DES SÉANCES — `validated_at` gouverne la payabilité, et c'est le
   * premier poste de litige.
   *
   * Une séance non validée n'est pas payable, quel que soit le travail fourni.
   * Une séance validée mais **sans tarif résoluble** ne l'est pas davantage :
   * elle sort `null` et n'entre dans aucun total, plutôt que de valoir 0 FCFA —
   * un zéro se lirait « cette heure ne vaut rien ».
   *
   * Mesuré le 23/09/2026 : 3 séances, **0 validée**, et **0 dont le tarif se
   * résout**. Double blocage, et aucun des deux ne se voyait.
   */
  seances: z.object({
    total: z.number().int().nonnegative(),
    validees: z.number().int().nonnegative(),
    horodatees: z.number().int().nonnegative(),
    /** Séances validées dont un tarif se résout : les seules valorisables. */
    valorisables: z.number().int().nonnegative(),
    /**
     * Engagement pris et non décaissé : les séances validées, valorisées au
     * tarif résolu. `null` quand aucune ne l'est — pas 0.
     */
    engagementNonPaye: z.number().nullable(),
    /** Pourquoi rien n'est valorisable, quand c'est le cas. */
    raisonNonValorisable: z.string().nullable(),
  }),
});

export type OwnerPayrollStatus = z.infer<typeof OwnerPayrollStatusSchema>;
export type OwnerPayrollArchive = z.infer<typeof OwnerPayrollArchiveSchema>;
export type OwnerPayrollQuery = z.infer<typeof OwnerPayrollQuerySchema>;
export type OwnerPayrollResponse = z.infer<typeof OwnerPayrollResponseSchema>;
export type OwnerPayrollByTeacher = z.infer<typeof OwnerPayrollByTeacherSchema>;
export type OwnerPayrollTeacherOption = z.infer<typeof OwnerPayrollTeacherOptionSchema>;
export type OwnerPayrollPeriodOption = z.infer<typeof OwnerPayrollPeriodOptionSchema>;
export type OwnerPayrollBulletin = z.infer<typeof OwnerPayrollBulletinSchema>;

/* -------------------------------------------------------------------------- */
/*  5.K — /owner/prospection : d'où viennent les étudiants, et à quel prix     */
/* -------------------------------------------------------------------------- */

/**
 * Lecture PROPRIÉTAIRE du module Prospection (migration
 * `0120_prospection_commerciaux.sql`).
 *
 * L'administration dispose déjà des écrans d'exploitation — saisir une
 * provenance, tenir la liste des commerciaux, régler une commission ligne à
 * ligne. Rien de tout cela n'est repris ici : le propriétaire ne saisit pas,
 * il arbitre. Cet écran répond à trois questions qu'aucun écran d'exploitation
 * ne pose :
 *
 *   1. quelle part de mes étudiants sait-on d'où elle vient (la couverture,
 *      qui conditionne la lecture de tout le reste) ;
 *   2. quel canal amène le plus d'argent, pas seulement le plus de monde ;
 *   3. combien me coûtent les commerciaux, et combien leur reste-t-il dû.
 *
 * MAILLE DE TEMPS ET DE PÉRIMÈTRE — un étudiant est rattaché à l'année et à la
 * filière de sa PREMIÈRE OUVERTURE DE CLASSE suivie, jamais à l'horodatage de
 * sa fiche (cf. `owner-pro-annee.sql.ts`). Une commission suit l'étudiant qui
 * l'a produite : le commercial a été payé pour l'avoir amené cette année-là,
 * même s'il encaisse encore sa part deux ans plus tard.
 */

/** Canal de provenance, augmenté du cas « jamais renseigné ». */
export const OwnerProspectionCanalSchema = z.enum([
  ...PROVENANCE_CANAUX,
  "non_renseigne",
]);

/**
 * Libellés d'affichage, repris du module d'exploitation pour que le canal
 * s'appelle pareil des deux côtés, et complétés du cas « jamais renseigné » —
 * qui est une information, pas une ligne vide.
 */
export const OWNER_PROSPECTION_CANAL_LABELS: Record<
  z.infer<typeof OwnerProspectionCanalSchema>,
  string
> = {
  ...PROVENANCE_CANAL_LABELS,
  non_renseigne: "Provenance inconnue",
};

export const OwnerProspectionQuerySchema = z.object({
  /** Année scolaire `YYYY-YYYY` (pivot septembre). Absente ⇒ toutes années. */
  anneeScolaire: OwnerAcademicYearSchema.optional(),
  /** Filières (= `programmes.id`). Vide ou absent ⇒ toutes filières. */
  filiereIds: z.array(z.string().uuid()).optional(),
  /** Ouverture de classe, clé « filiereId|nom » — contrat owner-perimetre.sql. */
  nomClasse: z.string().optional(),
  semestreId: z.string().uuid().optional(),
});

export const OwnerProspectionKpisSchema = z.object({
  /** Étudiants du périmètre, provenance renseignée ou non. */
  etudiants: z.number().int().nonnegative(),
  /** Part des étudiants dont la provenance est connue, en %. */
  couverture: z.number(),
  /** Étudiants amenés par un commercial. */
  viaCommercial: z.number().int().nonnegative(),
  /**
   * Scolarité encaissée sur les étudiants du périmètre — la ligne « Scolarité »
   * du barème (natures `ue` et `scolarite`), paiements confirmés.
   */
  scolariteEncaissee: z.number(),
  /** Commission acquise par les commerciaux sur ces encaissements. */
  commissionAcquise: z.number(),
  commissionVersee: z.number(),
  /** Acquise − versée : la dette réelle du jour. */
  commissionDue: z.number(),
  /**
   * Commission acquise / scolarité encaissée VIA COMMERCIAL, en %. C'est le
   * taux réellement consenti, moyenne pondérée des taux figés fiche par fiche.
   * `null` quand aucun encaissement commercial n'a eu lieu : un taux sans
   * assiette n'est pas zéro, il n'existe pas.
   */
  tauxEffectif: z.number().nullable(),
});

/**
 * Couverture de la saisie. Elle précède les chiffres par canal parce qu'elle
 * les qualifie : une répartition établie sur un tiers des étudiants décrit ce
 * tiers, pas l'école.
 */
export const OwnerProspectionCouvertureSchema = z.object({
  etudiants: z.number().int().nonnegative(),
  renseignes: z.number().int().nonnegative(),
  nonRenseignes: z.number().int().nonnegative(),
  /**
   * `true` dès que la moitié au moins des étudiants a une provenance connue.
   * En deçà, l'écran affiche la répartition mais dit qu'elle n'est pas
   * représentative.
   */
  representative: z.boolean(),
  /**
   * Scolarité encaissée par les étudiants SANS provenance : l'argent qu'on ne
   * sait rattacher à aucun canal, et donc la mesure du coût de l'angle mort.
   */
  scolariteNonRattachee: z.number(),
});

export const OwnerProspectionCanalRowSchema = z.object({
  canal: OwnerProspectionCanalSchema,
  etudiants: z.number().int().nonnegative(),
  /** Part du canal dans les étudiants du périmètre, en %. */
  part: z.number(),
  scolariteEncaissee: z.number(),
  /** Encaissé / étudiants du canal. `null` quand le canal est vide. */
  scolariteParEtudiant: z.number().nullable(),
  /** Nulle hors canal « commercial » : les autres ne coûtent rien. */
  commissionAcquise: z.number(),
  /** Encaissé − commission : ce que le canal laisse réellement à l'école. */
  net: z.number(),
});

export const OwnerProspectionMoisRowSchema = z.object({
  /** `YYYY-MM` du début de la première ouverture suivie. */
  mois: z.string(),
  total: z.number().int().nonnegative(),
  commercial: z.number().int().nonnegative(),
  /** Google, Facebook, radio / télé / journal. */
  medias: z.number().int().nonnegative(),
  /** Une connaissance, un étudiant déjà inscrit. */
  boucheAOreille: z.number().int().nonnegative(),
  /** « Autre », et les étudiants sans provenance renseignée. */
  autre: z.number().int().nonnegative(),
});

export const OwnerProspectionCommercialRowSchema = z.object({
  commercialId: z.string().uuid(),
  nom: z.string(),
  actif: z.boolean(),
  etudiants: z.number().int().nonnegative(),
  scolariteEncaissee: z.number(),
  commissionAcquise: z.number(),
  commissionVersee: z.number(),
  /** Acquise − versée. Négatif possible : un versement dépasse l'acquis. */
  solde: z.number(),
  /** Taux réellement consenti à ce commercial, en %. `null` sans assiette. */
  tauxEffectif: z.number().nullable(),
  /** Lignes de commission (un paiement de scolarité) encore non réglées. */
  lignesDues: z.number().int().nonnegative(),
});

/**
 * Ancienneté de la dette. Un solde de commissions n'est pas un chiffre neutre :
 * c'est une promesse faite à quelqu'un qui continue d'amener des étudiants.
 */
export const OwnerProspectionDetteSchema = z.object({
  total: z.number(),
  lignes: z.number().int().nonnegative(),
  /** Date du plus ancien encaissement dont la commission reste due. */
  plusAncienne: z.string().nullable(),
  /** Âge de cette ligne, en jours. `null` quand rien n'est dû. */
  ageJours: z.number().int().nullable(),
  /** Commerciaux ayant au moins une ligne due. */
  commerciaux: z.number().int().nonnegative(),
});

export const OwnerProspectionResponseSchema = z.object({
  /** Année retenue, ou `null` quand l'écran cumule toutes les années. */
  anneeScolaire: z.string().nullable(),
  filiereIds: z.array(z.string().uuid()),
  /**
   * Ouverture de classe retenue, telle que le service l a appliquee.
   *
   * Exposee parce que l export CSV doit annoncer SON perimetre : sans elle, il
   * ecrivait « Toutes filieres » sur un fichier filtre par classe — un en-tete
   * qui ment sur le contenu qu il accompagne.
   */
  nomClasse: z.string().nullable(),
  kpis: OwnerProspectionKpisSchema,
  couverture: OwnerProspectionCouvertureSchema,
  parCanal: z.array(OwnerProspectionCanalRowSchema),
  parMois: z.array(OwnerProspectionMoisRowSchema),
  commerciaux: z.array(OwnerProspectionCommercialRowSchema),
  dette: OwnerProspectionDetteSchema,
  /**
   * Étudiants du périmètre qu'aucune ouverture de classe ne date : ils sont
   * comptés dans les effectifs et les encaissements, mais absents de la courbe
   * mensuelle, qui n'a aucune date où les poser. Le dire évite qu'un total et
   * une somme de colonnes se contredisent sans explication.
   */
  etudiantsSansDate: z.number().int().nonnegative(),
});

export type OwnerProspectionCanal = z.infer<typeof OwnerProspectionCanalSchema>;
export type OwnerProspectionQuery = z.infer<typeof OwnerProspectionQuerySchema>;
export type OwnerProspectionResponse = z.infer<typeof OwnerProspectionResponseSchema>;
export type OwnerProspectionCanalRow = z.infer<typeof OwnerProspectionCanalRowSchema>;
export type OwnerProspectionCommercialRow = z.infer<
  typeof OwnerProspectionCommercialRowSchema
>;
