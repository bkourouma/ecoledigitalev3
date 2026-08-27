/**
 * Vue d'ensemble « enseignants x configuration de paie » — feature 031.
 *
 * POURQUOI UN SERVICE DEDIE
 * L'écran des bulletins doit répondre à une question qu'aucun endpoint existant
 * ne pose : « qui, parmi TOUS les enseignants, est prêt à être payé ? ».
 *
 *   - `/teachers` liste les enseignants sans rien savoir de la paie ;
 *   - `/teacher-payment-configs` liste les configurations, donc par
 *     construction seulement les enseignants qui en ont une — précisément
 *     l'inverse de ce qu'on cherche à repérer.
 *
 * Les recouper côté client échouerait de toute façon : les deux listes sont
 * paginées, et un enseignant non configuré disparaîtrait dès que la troncature
 * frappe. La jointure appartient donc au SQL.
 *
 * Ce service ne calcule AUCUN montant. Il dit qui est configuré et comment ;
 * le moteur reste `payment-calculator.ts`.
 */

import { ProfessionalBaseService, ok, ServiceResult } from "./professional-base.service";
import {
  DUREE_PAYEE_SQL,
  SEANCE_PAYABLE_PREDICATE,
  SEANCE_PRETE_A_VALIDER_PREDICATE,
} from "./professional-seance-validation.service";
import { heureDejaPayeeSQL } from "./hour-collectors/heures-consommees";

/**
 * État de couverture d'un enseignant, à la date du jour.
 *
 * La distinction compte : une configuration EXPIREE se voit comme « configuré »
 * dans une liste de configurations, alors qu'elle produit exactement le même
 * effet qu'une absence — le calculateur ignore l'enseignant en silence. C'est
 * le piège rencontré en production sur des séances antérieures à la date de
 * prise d'effet.
 */
export type EtatConfiguration = "active" | "expiree" | "future" | "absente";

const SQL_OVERVIEW = `
  SELECT * FROM (
  SELECT
    t.id,
    COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
             NULLIF(TRIM(t.first_name  || ' ' || t.last_name), ''),
             u.email, t.email, 'Enseignant')          AS nom,
    COALESCE(u.email, t.email)                        AS email,
    t.employee_number                                 AS matricule,
    t.status::text                                    AS statut,
    t.contract_type::text                             AS type_contrat,
    cfg.id                                            AS config_id,
    cfg.config_type::text                             AS config_type,
    cfg.monthly_salary::float8                        AS monthly_salary,
    cfg.annual_salary::float8                         AS annual_salary,
    cfg.default_hourly_rate::float8                   AS default_hourly_rate,
    cfg.overtime_threshold::int                       AS overtime_threshold,
    cfg.overtime_multiplier::float8                   AS overtime_multiplier,
    cfg.effective_from::text                          AS effective_from,
    cfg.effective_to::text                            AS effective_to,
    cfg.couvre_aujourdhui                             AS couvre_aujourdhui,
    COALESCE(nb.total, 0)::int                        AS nb_configs,
    COALESCE(av.nb, 0)::int                           AS seances_a_valider,
    COALESCE(h.nb_seances, 0)::int                    AS nb_seances,
    COALESCE(h.heures_totales, 0)::float8             AS heures_totales,
    h.premiere_seance                                 AS premiere_seance,
    h.derniere_seance                                 AS derniere_seance,
    bul.id                                            AS bulletin_id,
    bul.statut                                        AS bulletin_statut,
    bul.montant                                       AS bulletin_montant,
    bul.devise                                        AS bulletin_devise,
    bul.calculated_at                                 AS bulletin_calcule_le,
    bul.periode_id                                    AS bulletin_periode_id,
    bul.periode_nom                                   AS bulletin_periode_nom,
    COALESCE(arch.n, 0)::int                          AS nb_bulletins_archives
  FROM teachers t
  LEFT JOIN users u ON u.id = t.user_id
  -- Configuration RETENUE : celle qui couvre aujourd'hui si elle existe, sinon
  -- la plus récente. Prendre systématiquement la dernière ferait passer une
  -- config future pour la config courante.
  LEFT JOIN LATERAL (
    SELECT c.*,
           (c.effective_from <= CURRENT_DATE
            AND (c.effective_to IS NULL OR c.effective_to >= CURRENT_DATE)) AS couvre_aujourdhui
      FROM teacher_payment_configs c
     WHERE c.teacher_id = t.id AND c.tenant_id = t.tenant_id
     ORDER BY (c.effective_from <= CURRENT_DATE
               AND (c.effective_to IS NULL OR c.effective_to >= CURRENT_DATE)) DESC,
              c.effective_from DESC
     LIMIT 1
  ) cfg ON TRUE
  LEFT JOIN LATERAL (
    SELECT count(*) AS total
      FROM teacher_payment_configs c2
     WHERE c2.teacher_id = t.id AND c2.tenant_id = t.tenant_id
  ) nb ON TRUE
  -- Heures VALIDÉES DE LA PÉRIODE EN COURS, pas de tous les temps.
  --
  -- L'écran suit un cycle : une période s'ouvre, ses heures apparaissent, le
  -- bulletin se génère, puis l'archivage remet le compteur à zéro en attendant
  -- la période suivante. Un cumul perpétuel ne redescendrait jamais et
  -- laisserait croire qu'il reste toujours quelque chose à payer.
  --
  -- $2/$3 sont les bornes de la période courante ; sans période ouverte, ils
  -- valent NULL et le compteur est nul par construction.
  --
  -- Le prédicat et l'expression de durée sont IMPORTÉS de
  -- professional-seance-validation.service.ts, jamais recopiés : ce sont ceux
  -- qu'appliquent le collecteur d'heures et la validation en lot. Une variante
  -- locale afficherait un cumul que le calcul ne retrouverait pas.
  LEFT JOIN LATERAL (
    SELECT count(*)                  AS nb_seances,
           SUM(${DUREE_PAYEE_SQL})   AS heures_totales,
           min(se.date)::text        AS premiere_seance,
           max(se.date)::text        AS derniere_seance
      FROM professional_ecue_seances se
     WHERE se.enseignant_id = t.id
       AND se.tenant_id     = t.tenant_id
       AND $2::date IS NOT NULL
       AND se.date BETWEEN $2::date AND $3::date
       -- PÉRIMÈTRE de la période : une période ciblée ne produira de bulletin
       -- que pour les enseignants qu'elle vise. Afficher des heures aux autres
       -- laisserait croire qu'ils vont être payés, alors que le calcul les
       -- écartera. Sans cible ($4 sans ligne), la période est collective.
       AND ($4::uuid IS NULL
            OR NOT EXISTS (SELECT 1 FROM payment_period_teachers ppt
                            WHERE ppt.payment_period_id = $4::uuid)
            OR EXISTS (SELECT 1 FROM payment_period_teachers ppt
                        WHERE ppt.payment_period_id = $4::uuid
                          AND ppt.teacher_id = t.id))
       AND (${SEANCE_PAYABLE_PREDICATE})
       -- Heures DÉJÀ CONSOMMÉES par un autre bulletin : elles ne seront pas
       -- repayées, les compter ici annoncerait un dû qui n'existe plus.
       -- Même expression que celle des collecteurs, importée et non recopiée.
       AND NOT ${heureDejaPayeeSQL("seance_id", "se.id", "se.tenant_id", "$4")}
  ) h ON TRUE
  -- SÉANCES FAITES MAIS PAS ENCORE VALIDÉES, sur la même période.
  --
  -- Sans ce compteur, deux situations opposées se présentent à l'identique —
  -- « 0 heure » : l'enseignant qui n'a pas fait cours, et celui qui a fait
  -- cours sans que personne ne valide ses séances. Le premier n'attend rien,
  -- le second sera sauté de la paie en silence.
  --
  -- Le prédicat est celui de l'écran de validation, importé et non recopié :
  -- annoncer ici un nombre que cet écran ne retrouverait pas serait pire que
  -- de ne rien annoncer.
  LEFT JOIN LATERAL (
    SELECT count(*) AS nb
      FROM professional_ecue_seances se
     WHERE se.enseignant_id = t.id
       AND se.tenant_id     = t.tenant_id
       AND $2::date IS NOT NULL
       AND se.date BETWEEN $2::date AND $3::date
       AND se.validated_at IS NULL
       AND (${SEANCE_PRETE_A_VALIDER_PREDICATE})
  ) av ON TRUE
  -- Bulletin COURANT : le plus récent non archivé.
  --
  -- C'est lui que l'écran propose de consulter puis d'archiver. Un bulletin
  -- archivé n'est plus « courant » : il a quitté le plan de travail, et le
  -- bouton de génération redevient disponible pour la période suivante.
  LEFT JOIN LATERAL (
    SELECT tp.id, tp.status::text AS statut, tp.total_amount::float8 AS montant,
           tp.currency AS devise, tp.calculated_at,
           pp.id AS periode_id, pp.name AS periode_nom
      FROM teacher_payments tp
      JOIN payment_periods pp ON pp.id = tp.payment_period_id
     WHERE tp.teacher_id = t.id
       AND tp.tenant_id  = t.tenant_id
       AND tp.archived_at IS NULL
     ORDER BY tp.calculated_at DESC NULLS LAST, tp.created_at DESC
     LIMIT 1
  ) bul ON TRUE
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM teacher_payments tp2
     WHERE tp2.teacher_id = t.id AND tp2.tenant_id = t.tenant_id
       AND tp2.archived_at IS NOT NULL
  ) arch ON TRUE
  WHERE t.tenant_id = $1
  ) q
  -- Tri alphabétique insensible à la casse, sur la sous-requête : PostgreSQL
  -- n'accepte un alias de sortie dans ORDER BY que seul, pas à l'intérieur
  -- d'une expression. L'envelopper évite de recopier tout le COALESCE du nom.
  --
  -- Les accents restent à la charge de la collation de la base : l'extension
  -- unaccent n'est pas installée ici, et l'exiger ferait dépendre l'écran
  -- d'une extension optionnelle.
  ORDER BY lower(q.nom) ASC`;

export interface EnseignantPaie {
  id: string;
  nom: string;
  email: string | null;
  matricule: string | null;
  statut: string | null;
  type_contrat: string | null;
  etat_configuration: EtatConfiguration;
  /** Séances réalisées mais NON validées sur la période : la paie les sautera. */
  seances_a_valider: number;
  nb_configs: number;
  /**
   * Cumul des heures VALIDÉES : réalisées, validées, avec bénéficiaire et durée
   * connue — exactement le périmètre de l'écran de validation des séances.
   *
   * C'est un CONSTAT, pas une créance : sur un salaire fixe, ces heures ne
   * pèsent jamais sur le montant, et une partie peut porter sur des séances
   * encore à venir.
   */
  heures: {
    nb_seances: number;
    totales: number;
    premiere_seance: string | null;
    derniere_seance: string | null;
  };
  /**
   * Bulletin courant (le plus récent NON archivé), ou `null`.
   *
   * Sa présence conditionne l'écran : tant qu'il existe, le PDF est consultable
   * et l'archivage possible ; une fois archivé, il quitte le plan de travail et
   * la génération redevient disponible.
   */
  bulletin: {
    id: string;
    statut: string;
    montant: number;
    devise: string;
    calcule_le: string | null;
    periode_id: string;
    periode_nom: string;
  } | null;
  nb_bulletins_archives: number;
  config: {
    id: string;
    config_type: string;
    monthly_salary: number | null;
    annual_salary: number | null;
    default_hourly_rate: number | null;
    overtime_threshold: number | null;
    overtime_multiplier: number | null;
    effective_from: string | null;
    effective_to: string | null;
  } | null;
}

function etatDe(row: Record<string, any>): EtatConfiguration {
  if (!row.config_id) return "absente";
  if (row.couvre_aujourdhui) return "active";
  // Une config non couvrante est soit derrière nous, soit devant.
  return row.effective_from && row.effective_from > new Date().toISOString().slice(0, 10)
    ? "future"
    : "expiree";
}

function mapEnseignant(row: Record<string, any>): EnseignantPaie {
  return {
    id: row.id,
    nom: row.nom,
    email: row.email ?? null,
    matricule: row.matricule ?? null,
    statut: row.statut ?? null,
    type_contrat: row.type_contrat ?? null,
    etat_configuration: etatDe(row),
    nb_configs: row.nb_configs ?? 0,
    /** Séances faites, pas encore validées : la paie les sautera en l'état. */
    seances_a_valider: row.seances_a_valider ?? 0,
    heures: {
      nb_seances: row.nb_seances ?? 0,
      totales: Number(row.heures_totales ?? 0),
      premiere_seance: row.premiere_seance ?? null,
      derniere_seance: row.derniere_seance ?? null,
    },
    bulletin: row.bulletin_id
      ? {
          id: row.bulletin_id,
          statut: row.bulletin_statut,
          montant: Number(row.bulletin_montant ?? 0),
          devise: row.bulletin_devise ?? "XOF",
          calcule_le: row.bulletin_calcule_le ?? null,
          periode_id: row.bulletin_periode_id,
          periode_nom: row.bulletin_periode_nom,
        }
      : null,
    nb_bulletins_archives: row.nb_bulletins_archives ?? 0,
    config: row.config_id
      ? {
          id: row.config_id,
          config_type: row.config_type,
          monthly_salary: row.monthly_salary ?? null,
          annual_salary: row.annual_salary ?? null,
          default_hourly_rate: row.default_hourly_rate ?? null,
          overtime_threshold: row.overtime_threshold ?? null,
          overtime_multiplier: row.overtime_multiplier ?? null,
          effective_from: row.effective_from ?? null,
          effective_to: row.effective_to ?? null,
        }
      : null,
  };
}

export interface PeriodePaie {
  id: string;
  nom: string;
  periode_debut: string;
  periode_fin: string;
  statut: string;
  /** Vide = période COLLECTIVE (tous les enseignants). */
  enseignants: Array<{ id: string; nom: string }>;
  /** Nombre de bulletins déjà calculés sur cette période. */
  nb_paiements: number;
  /** `false` tant qu'aucun calcul n'a été lancé : c'est ce qui bloque. */
  utilisee: boolean;
  cree_le: string;
}

/**
 * Périodes, avec leur périmètre et leur consommation.
 *
 * `utilisee` se déduit de l'existence de bulletins, pas du statut : le statut
 * vaut « active » dès la création, il ne dit donc rien de ce qui a été calculé.
 */
const SQL_PERIODES = `
  SELECT pp.id,
         pp.name                    AS nom,
         pp.period_start::text      AS periode_debut,
         pp.period_end::text        AS periode_fin,
         pp.status::text            AS statut,
         COALESCE(cibles.liste, '[]'::json) AS enseignants,
         COALESCE(nb.n, 0)::int     AS nb_paiements,
         pp.created_at              AS cree_le
    FROM payment_periods pp
    -- Périmètre agrégé en JSON : une jointure simple multiplierait les lignes
    -- de période par ses enseignants, et le compte de bulletins avec.
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('id', t.id, 'nom',
               COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                        NULLIF(TRIM(t.first_name  || ' ' || t.last_name), ''),
                        u.email, t.email, 'Enseignant'))
               ORDER BY lower(COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                                       NULLIF(TRIM(t.first_name || ' ' || t.last_name), ''), ''))
             ) AS liste
        FROM payment_period_teachers ppt
        JOIN teachers t ON t.id = ppt.teacher_id
        LEFT JOIN users u ON u.id = t.user_id
       WHERE ppt.payment_period_id = pp.id AND ppt.tenant_id = pp.tenant_id
    ) cibles ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM teacher_payments tp WHERE tp.payment_period_id = pp.id
    ) nb ON TRUE
   WHERE pp.tenant_id = $1 AND pp.status <> 'archived'
   ORDER BY pp.created_at DESC`;

function mapPeriode(row: Record<string, any>): PeriodePaie {
  return {
    id: row.id,
    nom: row.nom,
    periode_debut: row.periode_debut,
    periode_fin: row.periode_fin,
    statut: row.statut,
    enseignants: row.enseignants ?? [],
    nb_paiements: row.nb_paiements ?? 0,
    utilisee: (row.nb_paiements ?? 0) > 0,
    cree_le: row.cree_le,
  };
}

export class TeacherPayrollOverviewService extends ProfessionalBaseService {
  /**
   * Tous les enseignants du tenant, par ordre alphabétique, avec leur
   * configuration de paie courante — ou l'absence de celle-ci.
   *
   * Pas de pagination : un établissement compte des dizaines d'enseignants, pas
   * des milliers, et l'écran sert justement à repérer les MANQUANTS. Une liste
   * tronquée en cacherait.
   */
  async listEnseignants(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      /**
       * PÉRIODE COURANTE — celle qui pilote tout l'écran.
       *
       * C'est soit la période en attente de calcul, soit celle du dernier
       * bulletin encore au plan de travail. Une fois tout archivé, il n'y en a
       * plus : les compteurs retombent à zéro et l'écran attend qu'on en ouvre
       * une nouvelle.
       *
       * On prend la plus récemment créée : deux périodes ouvertes en même temps
       * sont impossibles (le verrou de création l'interdit), mais une période
       * calculée non archivée peut coexister avec rien d'autre.
       */
      const courante = await client.query(
        `SELECT pp.id, pp.name, pp.period_start::text AS debut, pp.period_end::text AS fin,
                EXISTS (SELECT 1 FROM teacher_payments tp
                         WHERE tp.payment_period_id = pp.id AND tp.archived_at IS NULL) AS a_bulletins,
                (SELECT count(*)::int FROM payment_period_teachers ppt
                  WHERE ppt.payment_period_id = pp.id)                                  AS nb_cibles
           FROM payment_periods pp
          WHERE pp.tenant_id = $1
            AND pp.status <> 'archived'
            AND (
              -- en attente de calcul
              NOT EXISTS (SELECT 1 FROM teacher_payments tp WHERE tp.payment_period_id = pp.id)
              -- ou calculée mais pas encore classée
              OR EXISTS (SELECT 1 FROM teacher_payments tp
                          WHERE tp.payment_period_id = pp.id AND tp.archived_at IS NULL)
            )
          ORDER BY pp.created_at DESC
          LIMIT 1`,
        [tenantId]
      );
      const p = courante.rows[0] ?? null;

      const rows = await client.query(SQL_OVERVIEW, [
        tenantId,
        p?.debut ?? null,
        p?.fin ?? null,
        p?.id ?? null,
      ]);
      const items = rows.rows.map(mapEnseignant);

      /**
       * TOUS les bulletins encore au plan de travail — pas seulement ceux que
       * les cartes montrent.
       *
       * `bul` ne remonte qu'UN bulletin par enseignant (`LIMIT 1`, le plus
       * récent non archivé). Compter les cartes sous-estimait donc le reste à
       * classer dès qu'un enseignant en avait plusieurs, ce qui arrive depuis
       * que deux périodes peuvent coexister : « Tout archiver (3) » en classait
       * trois et en laissait d'autres derrière, sans rien dire.
       *
       * Plus de répartition payés / impayés : l'archivage ne tranche plus le
       * sort financier, il arrête le montant. Tous les bulletins classés
       * partent « à verser », et c'est le constat de versement qui les solde.
       */
      const attente = await client.query(
        `SELECT count(*)::int AS total
           FROM teacher_payments
          WHERE tenant_id = $1 AND archived_at IS NULL`,
        [tenantId]
      );

      return ok({
        items,
        total: items.length,
        /** Ce que « Tout archiver » va réellement traiter. */
        en_attente: { total: attente.rows[0].total as number },
        non_configures: items.filter((e) => e.etat_configuration !== "active").length,
        /** Heures validées SUR LA PÉRIODE COURANTE, tous enseignants. */
        heures_validees: items.reduce((s, e) => s + e.heures.totales, 0),
        seances_validees: items.reduce((s, e) => s + e.heures.nb_seances, 0),
        /**
         * `null` = aucune période ouverte : les compteurs sont à zéro et
         * l'écran attend qu'on en crée une.
         */
        periode_courante: p
          ? {
              id: p.id,
              nom: p.name,
              debut: p.debut,
              fin: p.fin,
              a_bulletins: Boolean(p.a_bulletins),
              nb_cibles: p.nb_cibles ?? 0,
            }
          : null,
      });
    });
  }

  /**
   * Classe des bulletins et ARRÊTE le montant dû. Ne verse rien.
   *
   * TROIS ACTES, TROIS TRACES. Générer calcule (`calculated_at`), archiver
   * arrête (`archived_at` + `approved_at`), verser décaisse (`paid_at`, voir
   * `marquerVerses`). L'archivage posait auparavant `paid` directement : 35
   * bulletins ont ainsi été déclarés payés sans qu'aucun décaissement ne soit
   * jamais enregistré, `paid_at` restant vide. Classer un papier n'est pas
   * sortir de l'argent.
   *
   * Le statut retenu est `approved` — « la Direction arrête la rémunération »,
   * ce que dit le document lui-même. Il s'affiche « Impayé » à l'écran : une
   * somme est due, elle n'a pas encore été versée.
   *
   * EFFET DE BORD VOULU : `approved` fait partie de `LOCKING_STATUSES`
   * (professional-seance-validation.service.ts). Les séances restent donc
   * verrouillées après archivage, exactement comme avec `paid` auparavant.
   *
   * Les heures consommées ne bougent pas : `payment_hour_details` reste en
   * place, donc elles restent décomptées. Classer n'est pas annuler.
   *
   * Idempotent : réarchiver un bulletin déjà classé ne le redate pas, sans quoi
   * l'ordre de l'historique changerait à chaque clic. `approved_at` est posé
   * par `COALESCE`, pour ne pas écraser une approbation antérieure.
   */
  /**
   * @param paymentIds liste explicite, ou `null` pour TOUT ce qui reste au plan
   *   de travail. L'écran passe `null` : il n'a jamais la liste complète, la
   *   vue d'ensemble ne lui remonte qu'un bulletin par enseignant. Lui faire
   *   énumérer les identifiants revenait à n'archiver que ce qu'il voyait.
   */
  async archiverBulletins(
    tenantId: string,
    paymentIds: string[] | null,
    userId: string | null
  ): Promise<
    ServiceResult<{ archives: number; deja_archives: number; a_verser: number }>
  > {
    return this.withTenantTx(tenantId, async (client) => {
      const res = await client.query(
        `UPDATE teacher_payments
            SET archived_at = now(),
                archived_by = $3,
                -- ARRÊTER N'EST PAS VERSER. L'archivage fixe le montant dû ;
                -- le versement se constate ailleurs, avec sa date. Poser
                -- 'paid' ici déclarait payés 35 bulletins dont aucun
                -- décaissement n'a jamais été enregistré.
                status = 'approved'::payment_status,
                approved_by = COALESCE(approved_by, $3),
                approved_at = COALESCE(approved_at, now()),
                updated_at = now()
          WHERE tenant_id = $1
            AND archived_at IS NULL
            AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
          RETURNING id`,
        [tenantId, paymentIds, userId]
      );
      const archives = res.rowCount ?? 0;
      return ok({
        archives,
        // Sans liste explicite, la notion n'a pas de sens : on archive ce qui
        // reste, il ne peut rien y avoir « déjà archivé » dans la demande.
        deja_archives: paymentIds ? paymentIds.length - archives : 0,
        /** Tous les bulletins archivés sont désormais « à verser ». */
        a_verser: archives,
      });
    });
  }

  /**
   * Constate le VERSEMENT de bulletins arrêtés. C'est ici, et nulle part
   * ailleurs, que `paid_at` se remplit.
   *
   * Ne touche QUE les bulletins `approved` : on ne verse pas ce qui n'a pas été
   * arrêté. Un bulletin encore `calculated` doit d'abord être archivé, un
   * bulletin `cancelled` ou `disputed` ne doit pas l'être du tout. Le filtre
   * porte donc sur le statut, pas seulement sur les identifiants reçus — un
   * appel qui viserait large ne pourrait pas court-circuiter la règle.
   *
   * Idempotent : un bulletin déjà versé n'est pas redaté, il n'entre plus dans
   * le périmètre.
   *
   * `paid_by` répond à « qui a constaté le versement ». Sans cette colonne, le
   * journal d'audit attribuait la ligne à l'approbateur — celui qui a arrêté le
   * montant, pas celui qui a sorti l'argent.
   *
   * @param paymentIds liste explicite, ou `null` pour tous les bulletins
   *   arrêtés et non encore versés du tenant.
   */
  async marquerVerses(
    tenantId: string,
    paymentIds: string[] | null,
    userId: string | null
  ): Promise<ServiceResult<{ verses: number; ignores: number }>> {
    return this.withTenantTx(tenantId, async (client) => {
      const res = await client.query(
        `UPDATE teacher_payments
            SET status = 'paid'::payment_status,
                paid_at = now(),
                paid_by = $3,
                updated_at = now()
          WHERE tenant_id = $1
            AND status = 'approved'::payment_status
            AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
          RETURNING id`,
        [tenantId, paymentIds, userId]
      );
      const verses = res.rowCount ?? 0;
      return ok({
        verses,
        /** Demandés mais hors périmètre : déjà versés, annulés, ou non arrêtés. */
        ignores: paymentIds ? paymentIds.length - verses : 0,
      });
    });
  }

  /**
   * Historique des bulletins archivés, le plus récent en premier.
   *
   * Filtrable par enseignant : c'est la question qu'on pose à un historique de
   * paie — « qu'a-t-on versé à cette personne, et quand ? ».
   *
   * `seulementVerses` restreint aux bulletins réellement payés. C'est ce que
   * lit l'espace enseignant : un bulletin archivé mais non versé n'est qu'un
   * montant arrêté en interne, le montrer à l'intéressé lui annoncerait un
   * versement qui n'a pas eu lieu. Le filtre est posé EN SQL et non à
   * l'affichage — ces lignes ne doivent pas quitter le serveur.
   */
  async historiqueBulletins(
    tenantId: string,
    enseignantId?: string,
    seulementVerses = false
  ): Promise<ServiceResult<{ items: any[]; total: number }>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [tenantId];
      let filtre = "";
      if (enseignantId) {
        filtre = " AND tp.teacher_id = $2";
        params.push(enseignantId);
      }
      // `paid_at` en plus du statut : c'est la date qui atteste le
      // décaissement, un statut posé sans elle ne prouve rien.
      if (seulementVerses) filtre += " AND tp.status = 'paid' AND tp.paid_at IS NOT NULL";

      const rows = await client.query(
        `SELECT tp.id,
                tp.status::text          AS statut,
                tp.total_amount::float8  AS montant,
                tp.currency              AS devise,
                tp.calculated_at         AS calcule_le,
                tp.archived_at           AS archive_le,
                -- Date du versement RÉEL. Distincte de l'archivage : classer un
                -- bulletin ne sort pas l'argent.
                tp.paid_at               AS verse_le,
                tp.payment_type::text    AS type_paiement,
                (tp.calculation_details -> 'regularHours')  AS heures_normales,
                (tp.calculation_details -> 'overtimeHours') AS heures_sup,
                tp.teacher_id            AS enseignant_id,
                COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
                         NULLIF(TRIM(t.first_name  || ' ' || t.last_name), '')) AS enseignant_nom,
                pp.id                    AS periode_id,
                pp.name                  AS periode_nom,
                pp.period_start::text    AS periode_debut,
                pp.period_end::text      AS periode_fin,
                ay.name                  AS annee_scolaire,
                -- L'identité figée du journal d'audit prime sur la jointure :
                -- elle dit qui a agi ALORS, et survit à la suppression comme au
                -- renommage du compte. La jointure ne sert que de repli pour
                -- les bulletins archivés avant la 0111.
                COALESCE(aud.nom_fige, arc.nom, '') AS archive_par,
                (SELECT count(*)::int FROM payment_hour_details d
                  WHERE d.payment_id = tp.id) AS nb_lignes
           FROM teacher_payments tp
           JOIN payment_periods pp ON pp.id = tp.payment_period_id
           LEFT JOIN academic_years ay ON ay.id = pp.academic_year_id
           JOIN teachers        t  ON t.id  = tp.teacher_id
           LEFT JOIN users      u  ON u.id  = t.user_id
           LEFT JOIN LATERAL (
             SELECT COALESCE(NULLIF(TRIM(au.first_name || ' ' || au.last_name), ''), au.email) AS nom
               FROM users au WHERE au.id = tp.archived_by
           ) arc ON TRUE
           -- Nom figé au moment du classement : la mise à jour du bulletin
           -- déclenche une ligne d'audit, dont on lit l'auteur.
           LEFT JOIN LATERAL (
             SELECT al.changed_by_nom AS nom_fige
               FROM payment_audit_log al
              WHERE al.payment_id = tp.id AND al.changed_by = tp.archived_by
              ORDER BY al.changed_at DESC
              LIMIT 1
           ) aud ON TRUE
          WHERE tp.tenant_id = $1
            AND tp.archived_at IS NOT NULL${filtre}
          -- Le plus récent en tête : une nouvelle génération archivée vient
          -- se poser au-dessus des précédentes.
          ORDER BY tp.archived_at DESC`,
        params
      );

      return ok({ items: rows.rows, total: rows.rowCount ?? 0 });
    });
  }

  /** Périodes du tenant, la plus récente en premier. */
  async listPeriodes(tenantId: string): Promise<ServiceResult<{ items: PeriodePaie[] }>> {
    return this.withTenant(tenantId, async (client) => {
      const rows = await client.query(SQL_PERIODES, [tenantId]);
      return ok({ items: rows.rows.map(mapPeriode) });
    });
  }

  /**
   * Période en attente de calcul, ou `null`.
   *
   * Une seule peut exister à la fois : c'est la règle de gestion. Tant qu'elle
   * n'a pas servi au calcul, en ouvrir une deuxième laisserait deux exercices
   * ouverts sans dire lequel alimente quoi.
   *
   * L'écran interroge cet état pour désactiver son formulaire d'emblée, plutôt
   * que de laisser l'utilisateur tout saisir avant de se voir opposer un refus.
   */
  async periodeEnAttente(
    tenantId: string
  ): Promise<ServiceResult<{ periode: PeriodePaie | null }>> {
    return this.withTenant(tenantId, async (client) => {
      const rows = await client.query(
        `${SQL_PERIODES.replace(
          "WHERE pp.tenant_id = $1 AND pp.status <> 'archived'",
          `WHERE pp.tenant_id = $1 AND pp.status <> 'archived'
             AND NOT EXISTS (SELECT 1 FROM teacher_payments tp
                              WHERE tp.payment_period_id = pp.id)`
        )} LIMIT 1`,
        [tenantId]
      );
      return ok({ periode: rows.rows[0] ? mapPeriode(rows.rows[0]) : null });
    });
  }
}
