import type { PoolClient } from "pg";
import type {
  ProfessionalSeanceStatut,
  ProfessionalSeancePaieQuery,
  ValidateProfessionalSeancesResult,
  SeanceBlocker,
} from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Validation des séances d'ECUE pour la paie — feature 031, US1.
 *
 * POURQUOI CE SERVICE
 * `professional_ecue_seances` est un objet de PLANNING : la séance y est créée
 * avant d'avoir lieu. Payer directement sur cette table reviendrait à payer le
 * planning. Deux notions distinctes sont donc portées séparément :
 *
 *   - `statut` (planifiee | realisee | annulee) — un FAIT pédagogique, constaté
 *     par la scolarité ou l'enseignant ;
 *   - `validated_at`/`validated_by` — un ACTE DE GESTION, posé par
 *     l'administration : « cette séance est payable ».
 *
 * Les fusionner ferait de tout constat pédagogique un engagement financier.
 * La saisie de présences est un INDICE de réalisation (exposé par
 * `presences_saisies` et le filtre `hasAttendance`), jamais un déclencheur : un
 * enseignant peut faire l'appel puis annuler, ou faire cours sans appel.
 */

/**
 * Durée planifiée, déduite des horaires. Reste le registre pédagogique : elle
 * n'est jamais stockée ni réécrite par la comptabilité.
 */
const DUREE_PLANIFIEE_SQL = `
  CASE
    WHEN se.heure_debut IS NOT NULL AND se.heure_fin IS NOT NULL
      THEN EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0
    ELSE NULL
  END`;

/**
 * Durée RETENUE POUR LA PAIE. La dérogation comptable l'emporte quand elle
 * existe ; sinon on retombe sur les horaires. Une seule expression, réutilisée
 * par le collecteur d'heures — deux formules divergentes feraient payer autre
 * chose que ce que l'écran annonce.
 */
export const DUREE_PAYEE_SQL = `COALESCE(se.duree_payee::float8, ${DUREE_PLANIFIEE_SQL})`;

/**
 * Prédicat de payabilité (FR-003). Exprimé une seule fois, ici, et réutilisé
 * par le collecteur d'heures.
 *
 * Une séance sans horaires reste payable SI le comptable a saisi son volume :
 * c'est précisément le cas que la dérogation débloque — un cours dont
 * l'administration connaît la durée sans que l'enseignant ait renseigné le
 * créneau.
 */
/**
 * Toutes les conditions de payabilité SAUF la validation : le cours a eu lieu,
 * il a un bénéficiaire et une durée connue. Autrement dit « cette séance
 * deviendra payable dès qu'on la validera ».
 *
 * Existe pour que l'écran « À traiter » puisse compter ce qui est prêt sans
 * réécrire le prédicat — le recopier avait déjà produit un écran qui annonçait
 * des séances que le serveur refusait.
 */
export const SEANCE_PRETE_A_VALIDER_PREDICATE = `
  se.statut        = 'realisee'
  AND se.enseignant_id IS NOT NULL
  AND (
    se.duree_payee IS NOT NULL
    OR (se.heure_debut IS NOT NULL AND se.heure_fin IS NOT NULL)
  )`;

/**
 * Payable = prête à valider ET validée. Composé, jamais réécrit : les deux
 * expressions ne peuvent pas diverger.
 *
 * ÉLIGIBILITÉ, PAS DISPONIBILITÉ. Ce prédicat ne sait pas si la séance a déjà
 * été payée : il ne connaît pas les bulletins. La seconde moitié de la règle
 * — « une heure n'est payable qu'une fois » — vit dans
 * `hour-collectors/heures-consommees.ts`, parce qu'elle a besoin de la période
 * en cours de calcul, que ce prédicat n'a pas. Qui filtre des heures payables
 * doit appliquer LES DEUX.
 */
export const SEANCE_PAYABLE_PREDICATE = `
  se.validated_at IS NOT NULL
  AND (${SEANCE_PRETE_A_VALIDER_PREDICATE}
  )`;

/**
 * Année scolaire d'une séance, pivot septembre : « AAAA-AAAA+1 ». Dérivée, pas
 * stockée — la même convention que `anneeScolaireOf` côté web et que le calcul
 * des bulletins. Exprimée ici en SQL pour que le filtre porte sur TOUTES les
 * séances du tenant et pas seulement sur la page renvoyée.
 */
const ANNEE_SCOLAIRE_SQL = `
  CASE
    WHEN EXTRACT(MONTH FROM se.date) >= 9
      THEN EXTRACT(YEAR FROM se.date)::int
    ELSE EXTRACT(YEAR FROM se.date)::int - 1
  END`;

/** « 2025-2026 » à partir de l'année de début ci-dessus. */
const ANNEE_SCOLAIRE_LABEL_SQL = `
  ((${ANNEE_SCOLAIRE_SQL})::text || '-' || ((${ANNEE_SCOLAIRE_SQL}) + 1)::text)`;

const SEANCE_SELECT = `
  se.id,
  se.date::text                     AS date,
  se.heure_debut::text              AS heure_debut,
  se.heure_fin::text                AS heure_fin,
  ${DUREE_PLANIFIEE_SQL}            AS duree_planifiee,
  se.duree_payee::float8            AS duree_payee,
  ${DUREE_PAYEE_SQL}                AS duree_heures,
  se.duree_payee_le,
  COALESCE(TRIM(du.first_name || ' ' || du.last_name), du.email) AS duree_payee_par_nom,
  se.saisie_comptable,
  se.statut,
  se.validated_at,
  se.validated_by,
  se.libelle                        AS seance_libelle,
  COALESCE(TRIM(vu.first_name || ' ' || vu.last_name), vu.email) AS validated_by_nom,
  se.enseignant_id,
  COALESCE(TRIM(tu.first_name || ' ' || tu.last_name),
           TRIM(t.first_name  || ' ' || t.last_name))            AS enseignant_nom,
  se.ecue_id,
  ec.code                           AS ecue_code,
  ec.libelle                        AS ecue_libelle,
  se.ue_session_id,
  us.libelle                        AS cohorte_libelle,
  sem.semestre_id,
  sem.semestre_libelle,
  sem.filiere_id,
  sem.filiere_nom,
  COALESCE(att.nb, 0)::int          AS presences_saisies,
  paie.payment_id                   AS paiement_id,
  paie.payment_statut               AS paiement_statut`;

const SEANCE_FROM = `
  FROM professional_ecue_seances se
  JOIN professional_ecue        ec ON ec.id = se.ecue_id       AND ec.tenant_id = se.tenant_id
  JOIN professional_ue_sessions us ON us.id = se.ue_session_id AND us.tenant_id = se.tenant_id
  LEFT JOIN teachers t  ON t.id  = se.enseignant_id
  LEFT JOIN users    tu ON tu.id = t.user_id
  LEFT JOIN users    vu ON vu.id = se.validated_by
  LEFT JOIN users    du ON du.id = se.duree_payee_par
  -- Semestre et filière de la cohorte. Une cohorte peut être rattachée à
  -- plusieurs semestres ; on prend le premier, comme la liste des sessions
  -- (professional-ue.service.ts) — deux règles différentes afficheraient une
  -- filière ici et une autre là pour la même cohorte.
  LEFT JOIN LATERAL (
    SELECT sm.id AS semestre_id, sm.libelle AS semestre_libelle,
           p.id  AS filiere_id,  p.name    AS filiere_nom
    FROM professional_semestre_sessions ss
    JOIN professional_semestres sm ON sm.id = ss.semestre_id AND sm.tenant_id = ss.tenant_id
    LEFT JOIN programmes p ON p.id = sm.filiere_id
    WHERE ss.ue_session_id = se.ue_session_id AND ss.tenant_id = se.tenant_id
    LIMIT 1
  ) sem ON TRUE
  LEFT JOIN LATERAL (
    SELECT count(*) AS nb
    FROM professional_ecue_attendance a
    WHERE a.seance_id = se.id AND a.tenant_id = se.tenant_id
  ) att ON TRUE
  LEFT JOIN LATERAL (
    SELECT tp.id AS payment_id, tp.status::text AS payment_statut
    FROM payment_hour_details phd
    JOIN teacher_payments tp ON tp.id = phd.payment_id
    WHERE phd.seance_id = se.id AND phd.tenant_id = se.tenant_id
    ORDER BY CASE tp.status::text
               WHEN 'paid' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END
    LIMIT 1
  ) paie ON TRUE`;

/** Statuts de paiement qui verrouillent la séance (FR-006). */
const LOCKING_STATUSES = ["approved", "paid"];

type SeanceRow = Record<string, any>;

/** Motifs de non-payabilité, dans l'ordre où ils sont utiles à l'utilisateur. */
export function computeBlockers(row: SeanceRow): SeanceBlocker[] {
  const blockers: SeanceBlocker[] = [];
  if (row.statut !== "realisee") blockers.push("STATUT_NON_REALISEE");
  if (!row.validated_at) blockers.push("NON_VALIDEE");
  if (!row.enseignant_id) blockers.push("SANS_ENSEIGNANT");
  // Une durée dérogée lève le besoin d'horaires : c'est le cas que la
  // dérogation comptable existe pour débloquer.
  const dureeConnue = row.duree_payee != null || (row.heure_debut && row.heure_fin);
  if (!dureeConnue) blockers.push("HORAIRES_INCOMPLETS");
  return blockers;
}

function mapSeance(row: SeanceRow) {
  const blockers = computeBlockers(row);
  return {
    id: row.id,
    date: row.date,
    heure_debut: row.heure_debut,
    heure_fin: row.heure_fin,
    /** Durée retenue pour la paie (dérogation si elle existe, sinon horaires). */
    duree_heures: row.duree_heures === null ? null : Number(row.duree_heures),
    /** Durée déduite des horaires — conservée pour montrer le prévu à côté du payé. */
    duree_planifiee: row.duree_planifiee === null ? null : Number(row.duree_planifiee),
    /** Dérogation comptable, NULL si aucune. */
    duree_payee: row.duree_payee === null ? null : Number(row.duree_payee),
    duree_payee_le: row.duree_payee_le,
    duree_payee_par_nom: row.duree_payee_par_nom,
    saisie_comptable: Boolean(row.saisie_comptable),
    statut: row.statut as ProfessionalSeanceStatut,
    seance_libelle: row.seance_libelle,
    validated_at: row.validated_at,
    validated_by: row.validated_by,
    validated_by_nom: row.validated_by_nom,
    payable: blockers.length === 0,
    blockers,
    enseignant_id: row.enseignant_id,
    enseignant_nom: row.enseignant_nom,
    ecue_id: row.ecue_id,
    ecue_code: row.ecue_code,
    ecue_libelle: row.ecue_libelle,
    ue_session_id: row.ue_session_id,
    cohorte_libelle: row.cohorte_libelle,
    semestre_id: row.semestre_id ?? null,
    semestre_libelle: row.semestre_libelle ?? null,
    filiere_id: row.filiere_id ?? null,
    filiere_nom: row.filiere_nom ?? null,
    presences_saisies: row.presences_saisies,
    paiement_id: row.paiement_id,
    paiement_statut: row.paiement_statut,
  };
}

export class ProfessionalSeanceValidationService extends ProfessionalBaseService {
  /** Liste filtrable des séances, avec leur payabilité et ses motifs. */
  async listSeances(
    tenantId: string,
    query: Partial<ProfessionalSeancePaieQuery>
  ): Promise<ServiceResult<{ items: any[]; total: number; limit: number; offset: number }>> {
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ["se.tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;

      if (query.enseignantId) {
        where.push(`se.enseignant_id = $${i++}`);
        params.push(query.enseignantId);
      }
      if (query.ueSessionId) {
        where.push(`se.ue_session_id = $${i++}`);
        params.push(query.ueSessionId);
      }
      if (query.ecueId) {
        where.push(`se.ecue_id = $${i++}`);
        params.push(query.ecueId);
      }
      if (query.fromDate) {
        where.push(`se.date >= $${i++}::date`);
        params.push(query.fromDate);
      }
      if (query.toDate) {
        where.push(`se.date <= $${i++}::date`);
        params.push(query.toDate);
      }
      // Découpage par année scolaire fait en base : borner côté client sur les
      // séances déjà chargées donnerait un compte faux dès que `limit` tronque.
      if (query.anneeScolaire) {
        where.push(`${ANNEE_SCOLAIRE_LABEL_SQL} = $${i++}`);
        params.push(query.anneeScolaire);
      }
      // La filière n'est pas portée par la séance : elle vient du semestre
      // auquel la cohorte est rattachée. EXISTS plutôt qu'une jointure, pour ne
      // pas dupliquer une séance dont la cohorte sert plusieurs semestres.
      if (query.filiereId) {
        where.push(
          `EXISTS (SELECT 1 FROM professional_semestre_sessions ss
                     JOIN professional_semestres sm
                       ON sm.id = ss.semestre_id AND sm.tenant_id = ss.tenant_id
                    WHERE ss.ue_session_id = se.ue_session_id
                      AND ss.tenant_id = se.tenant_id
                      AND sm.filiere_id = $${i++})`
        );
        params.push(query.filiereId);
      }
      if (query.statut) {
        where.push(`se.statut = $${i++}`);
        params.push(query.statut);
      }
      if (query.validated === true) where.push("se.validated_at IS NOT NULL");
      if (query.validated === false) where.push("se.validated_at IS NULL");
      if (query.payable === true) where.push(`(${SEANCE_PAYABLE_PREDICATE})`);
      if (query.payable === false) where.push(`NOT (${SEANCE_PAYABLE_PREDICATE})`);
      if (query.hasAttendance === true) {
        where.push(
          `EXISTS (SELECT 1 FROM professional_ecue_attendance a
                    WHERE a.seance_id = se.id AND a.tenant_id = se.tenant_id)`
        );
      }

      const whereSql = where.join(" AND ");
      const limit = query.limit ?? 100;
      const offset = query.offset ?? 0;

      const rows = await client.query(
        `SELECT ${SEANCE_SELECT} ${SEANCE_FROM}
         WHERE ${whereSql}
         -- Le PASSÉ d'abord, du plus récent au plus ancien ; les séances encore
         -- à venir ensuite.
         --
         -- Un simple tri date DESC remontait les cours planifiés jusqu'en 2029 :
         -- l'écran s'ouvrait sur des séances qu'aucun paiement ne pouvait
         -- couvrir, et la colonne Paie affichait « aucun paiement » sur toute
         -- la première page. Ce qui a déjà eu lieu est ce qu'on vient traiter
         -- ou consulter ; le reste n'est pas encore de l'histoire.
         ORDER BY (se.date > CURRENT_DATE) ASC, se.date DESC, se.heure_debut NULLS LAST
         LIMIT $${i++} OFFSET $${i++}`,
        [...params, limit, offset]
      );

      // Le total repasse par la MÊME clause que la liste : une clause simplifiée
      // donnerait un compte incohérent avec ce qui est affiché.
      //
      // Les agrégats accompagnent le total parce que la liste est PAGINÉE :
      // calculés sur les lignes renvoyées, ils ne compteraient que la page
      // courante et l'écran annoncerait « 10 séances » sur un lot de 300.
      const totalRes = await client.query(
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE ${SEANCE_PRETE_A_VALIDER_PREDICATE})::int AS pretes,
                COALESCE(SUM(${DUREE_PAYEE_SQL})
                         FILTER (WHERE ${SEANCE_PRETE_A_VALIDER_PREDICATE}), 0)::float8
                  AS heures_pretes,
                count(*) FILTER (WHERE paie.payment_id IS NOT NULL)::int AS avec_paiement,
                count(*) FILTER (WHERE ${SEANCE_PAYABLE_PREDICATE})::int AS payables,
                COALESCE(SUM(${DUREE_PAYEE_SQL})
                         FILTER (WHERE ${SEANCE_PAYABLE_PREDICATE}), 0)::float8
                  AS heures_payables
           ${SEANCE_FROM} WHERE ${whereSql}`,
        params
      );
      const agg = totalRes.rows[0] ?? {};

      return ok({
        items: rows.rows.map(mapSeance),
        total: agg.n ?? rows.rows.length,
        limit,
        offset,
        /** Agrégats sur TOUT le périmètre filtré, pas sur la page affichée. */
        summary: {
          avec_paiement: agg.avec_paiement ?? 0,
          pretes: agg.pretes ?? 0,
          heures_pretes: Number(agg.heures_pretes ?? 0),
          payables: agg.payables ?? 0,
          heures_payables: Number(agg.heures_payables ?? 0),
        },
      });
    });
  }

  /**
   * Années scolaires pour lesquelles des séances existent, la plus récente en
   * premier.
   *
   * Alimente le filtre de l'écran. Déduire ces options de la page affichée
   * ferait disparaître une année dès que la pagination la tronque, et le
   * filtre cacherait alors les séances qu'il est censé aider à retrouver.
   */
  /**
   * Une séance et TOUT son contexte, pour la fiche de détail.
   *
   * Réutilise la projection de la liste (`SEANCE_SELECT`) plutôt que d'en
   * écrire une seconde : deux requêtes divergentes finiraient par afficher un
   * volume ou une payabilité différents ici et là, pour la même séance.
   * S'y ajoutent les informations qu'un tableau ne peut pas porter — la
   * répartition des pointages et le paiement rattaché.
   */
  async getSeance(tenantId: string, seanceId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT ${SEANCE_SELECT} ${SEANCE_FROM} WHERE se.tenant_id = $1 AND se.id = $2`,
        [tenantId, seanceId]
      );
      if (res.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");

      const presences = await client.query(
        `SELECT a.statut, count(*)::int AS n
         FROM professional_ecue_attendance a
         WHERE a.seance_id = $1 AND a.tenant_id = $2
         GROUP BY a.statut ORDER BY a.statut`,
        [seanceId, tenantId]
      );

      const paiement = await client.query(
        `SELECT tp.id, tp.status::text AS statut, tp.total_amount::float8 AS total,
                tp.currency, pp.name AS periode,
                phd.hours_count::float8 AS heures, phd.hourly_rate::float8 AS tarif,
                phd.amount::float8 AS montant, phd.is_overtime
         FROM payment_hour_details phd
         JOIN teacher_payments tp ON tp.id = phd.payment_id
         LEFT JOIN payment_periods pp ON pp.id = tp.payment_period_id
         WHERE phd.seance_id = $1 AND phd.tenant_id = $2`,
        [seanceId, tenantId]
      );

      return ok({
        ...mapSeance(res.rows[0]),
        presences_detail: presences.rows,
        lignes_paiement: paiement.rows,
      });
    });
  }

  async listAnneesScolaires(tenantId: string): Promise<ServiceResult<string[]>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT DISTINCT ${ANNEE_SCOLAIRE_LABEL_SQL} AS annee
         FROM professional_ecue_seances se
         WHERE se.tenant_id = $1
         ORDER BY annee DESC`,
        [tenantId]
      );
      return ok(res.rows.map((r: SeanceRow) => r.annee as string));
    });
  }

  /**
   * Enseignants ayant au moins une séance RÉALISÉE et NON ENCORE VALIDÉE.
   *
   * C'est la liste du filtre de l'écran « À traiter » : y proposer les 200
   * enseignants de l'établissement obligerait à en essayer un par un pour
   * trouver ceux qui ont du travail en attente.
   *
   * Calculé par l'API, pas déduit des lignes affichées : la liste est paginée,
   * et un enseignant disparaîtrait du filtre dès que ses séances tombent
   * au-delà de la page chargée.
   */
  async listEnseignantsATraiter(
    tenantId: string
  ): Promise<ServiceResult<Array<{ id: string; nom: string; nb_seances: number }>>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT se.enseignant_id AS id,
                COALESCE(TRIM(tu.first_name || ' ' || tu.last_name),
                         TRIM(t.first_name  || ' ' || t.last_name),
                         tu.email)          AS nom,
                count(*)::int               AS nb_seances
           FROM professional_ecue_seances se
           LEFT JOIN teachers t  ON t.id  = se.enseignant_id
           LEFT JOIN users    tu ON tu.id = t.user_id
          WHERE se.tenant_id      = $1
            AND se.enseignant_id IS NOT NULL
            AND se.statut         = 'realisee'
            AND se.validated_at  IS NULL
          GROUP BY se.enseignant_id, tu.first_name, tu.last_name, tu.email,
                   t.first_name, t.last_name
          ORDER BY nom`,
        [tenantId]
      );
      return ok(res.rows);
    });
  }

  /** Change le statut de réalisation. Refuse d'annuler une séance déjà payée. */
  async setStatut(
    tenantId: string,
    seanceId: string,
    statut: ProfessionalSeanceStatut,
    userId: string | null
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const cur = await client.query(
        `SELECT se.id, se.statut FROM professional_ecue_seances se
         WHERE se.id = $1 AND se.tenant_id = $2`,
        [seanceId, tenantId]
      );
      if (cur.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");

      // Annuler une séance déjà payée reviendrait à retirer la justification
      // d'un montant approuvé : le détail du paiement pointerait sur une séance
      // annulée, sans que le montant bouge.
      if (statut === "annulee" && (await this.isLocked(client, tenantId, seanceId))) {
        return fail(
          "SEANCE_ALREADY_PAID",
          "Séance rattachée à un paiement approuvé ou payé : elle ne peut plus être annulée."
        );
      }

      // Sortir de 'realisee' retire la base d'une validation existante.
      const clearValidation = statut !== "realisee";

      const res = await client.query(
        `UPDATE professional_ecue_seances
         SET statut = $1,
             statut_modifie_par = $2,
             statut_modifie_le  = now(),
             validated_by = CASE WHEN $3::boolean THEN NULL ELSE validated_by END,
             validated_at = CASE WHEN $3::boolean THEN NULL ELSE validated_at END,
             updated_at = now()
         WHERE id = $4 AND tenant_id = $5
         RETURNING id, statut, validated_at`,
        [statut, userId, clearValidation, seanceId, tenantId]
      );
      return ok(res.rows[0]);
    });
  }

  /**
   * Validation / dévalidation en lot. Application PARTIELLE : les séances
   * éligibles passent, les autres sont rejetées avec leur motif. Faire échouer
   * tout le lot sur une anomalie bloquerait 200 séances pour une seule.
   */
  async validateBatch(
    tenantId: string,
    seanceIds: string[],
    validated: boolean,
    userId: string | null
  ): Promise<ServiceResult<ValidateProfessionalSeancesResult>> {
    return this.withTenantTx(tenantId, async (client) => {
      const res = await client.query(
        `SELECT se.id, se.statut, se.enseignant_id, se.heure_debut, se.heure_fin,
                se.duree_payee, se.validated_at,
                paie.payment_statut
         FROM professional_ecue_seances se
         LEFT JOIN LATERAL (
           SELECT tp.status::text AS payment_statut
           FROM payment_hour_details phd
           JOIN teacher_payments tp ON tp.id = phd.payment_id
           WHERE phd.seance_id = se.id AND phd.tenant_id = se.tenant_id
             AND tp.status::text = ANY($3::text[])
           LIMIT 1
         ) paie ON TRUE
         WHERE se.tenant_id = $1 AND se.id = ANY($2::uuid[])`,
        [tenantId, seanceIds, LOCKING_STATUSES]
      );

      const eligible: string[] = [];
      const rejected: Array<{ seanceId: string; reason: SeanceBlocker }> = [];

      for (const row of res.rows) {
        if (validated) {
          // Les motifs de refus sont ceux de computeBlockers : une règle
          // réécrite ici diverge de l'écran, qui annonce alors une séance
          // validable que le serveur refuse.
          const blockers = computeBlockers({ ...row, validated_at: "ignoré" });
          if (blockers.length > 0) {
            rejected.push({ seanceId: row.id, reason: blockers[0] });
            continue;
          }
        } else if (row.payment_statut) {
          // Dévalider une séance déjà payée laisserait un paiement approuvé
          // sans justification (FR-006).
          rejected.push({ seanceId: row.id, reason: "DEJA_PAYEE" });
          continue;
        }
        eligible.push(row.id);
      }

      let updated = 0;
      if (eligible.length > 0) {
        // Chaque requête reçoit EXACTEMENT ses paramètres. Passer un $1 que le
        // SQL de dévalidation n'utilise pas empêchait Postgres d'en inférer le
        // type : la dévalidation échouait en 500, sans jamais être exercée.
        const upd = validated
          ? await client.query(
              `UPDATE professional_ecue_seances
               SET validated_by = $1::uuid, validated_at = now(), updated_at = now()
               WHERE tenant_id = $2 AND id = ANY($3::uuid[])`,
              [userId, tenantId, eligible]
            )
          : await client.query(
              `UPDATE professional_ecue_seances
               SET validated_by = NULL, validated_at = NULL, updated_at = now()
               WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
              [tenantId, eligible]
            );
        updated = upd.rowCount ?? 0;
      }

      return ok({ updated, rejected });
    });
  }

  /**
   * Dérogation comptable sur le volume horaire.
   *
   * `duree` à `null` retire la dérogation : la durée redevient celle des
   * horaires. Les horaires ne sont JAMAIS touchés — corriger un volume de paie
   * ne doit pas réécrire l'emploi du temps.
   */
  async setDureePayee(
    tenantId: string,
    seanceId: string,
    duree: number | null,
    userId: string | null
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      if (duree !== null && !(duree > 0)) {
        return fail("VALIDATION_ERROR", "Le volume horaire doit être strictement positif.");
      }

      const cur = await client.query(
        `SELECT id, heure_debut, heure_fin FROM professional_ecue_seances
         WHERE id = $1 AND tenant_id = $2`,
        [seanceId, tenantId]
      );
      if (cur.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");

      // Retirer la dérogation d'une séance sans horaires la rendrait
      // impayable : autant le dire plutôt que de la faire disparaître du calcul.
      if (duree === null && (!cur.rows[0].heure_debut || !cur.rows[0].heure_fin)) {
        return fail(
          "SEANCE_NOT_PAYABLE",
          "Cette séance n'a pas d'horaires : retirer le volume saisi la rendrait impayable. Renseignez les horaires d'abord."
        );
      }

      if (await this.isLocked(client, tenantId, seanceId)) {
        return fail(
          "SEANCE_ALREADY_PAID",
          "Séance rattachée à un paiement approuvé ou payé : son volume horaire n'est plus modifiable."
        );
      }

      const res = await client.query(
        `UPDATE professional_ecue_seances
         SET duree_payee = $1,
             -- $2::uuid explicite : dans un CASE dont une branche est NULL,
             -- Postgres infere le type text pour le parametre et refuse
             -- l'affectation dans une colonne uuid.
             duree_payee_par = CASE WHEN $1::numeric IS NULL THEN NULL ELSE $2::uuid END,
             duree_payee_le  = CASE WHEN $1::numeric IS NULL THEN NULL ELSE now() END,
             updated_at = now()
         WHERE id = $3 AND tenant_id = $4
         RETURNING id, duree_payee::float8 AS duree_payee`,
        [duree, userId, seanceId, tenantId]
      );
      return ok(res.rows[0]);
    });
  }

  /**
   * Ajout d'une séance depuis l'écran de paie — une séance que l'enseignant
   * n'avait pas enregistrée.
   *
   * Marquée `saisie_comptable` : la personne qui saisit est aussi celle qui
   * valide, ce cumul doit rester visible en contrôle.
   */
  async createSeanceComptable(
    tenantId: string,
    input: {
      ue_session_id: string;
      ecue_id: string;
      enseignant_id: string;
      date: string;
      heure_debut?: string | null;
      heure_fin?: string | null;
      duree_payee?: number | null;
      libelle?: string | null;
    },
    userId: string | null
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const aHoraires = Boolean(input.heure_debut && input.heure_fin);
      if (!aHoraires && !(input.duree_payee && input.duree_payee > 0)) {
        return fail(
          "VALIDATION_ERROR",
          "Renseignez soit des horaires, soit un volume horaire : sans l'un des deux, la séance ne peut pas être payée."
        );
      }

      // L'ECUE doit appartenir à l'UE de la cohorte, sinon on crée une séance
      // qui n'a pas de sens pédagogique et fausse les bulletins.
      const coherence = await client.query(
        `SELECT 1
         FROM professional_ue_sessions s
         JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2 AND l.ecue_id = $3`,
        [input.ue_session_id, tenantId, input.ecue_id]
      );
      if (coherence.rowCount === 0) {
        return fail("ECUE_NOT_IN_SESSION", "Cette ECUE n'appartient pas à l'UE de la cohorte choisie.");
      }

      const teacher = await client.query(
        `SELECT 1 FROM teachers WHERE id = $1 AND tenant_id = $2`,
        [input.enseignant_id, tenantId]
      );
      if (teacher.rowCount === 0) return fail("TEACHER_NOT_FOUND", "Enseignant introuvable.");

      const res = await client.query(
        `INSERT INTO professional_ecue_seances
           (tenant_id, ue_session_id, ecue_id, enseignant_id, libelle, date,
            heure_debut, heure_fin, duree_payee, duree_payee_par, duree_payee_le,
            statut, statut_modifie_par, statut_modifie_le, saisie_comptable, cree_par)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7::time, $8::time, $9,
                 CASE WHEN $9::numeric IS NULL THEN NULL ELSE $10::uuid END,
                 CASE WHEN $9::numeric IS NULL THEN NULL ELSE now() END,
                 'realisee', $10::uuid, now(), true, $10::uuid)
         RETURNING id`,
        [
          tenantId,
          input.ue_session_id,
          input.ecue_id,
          input.enseignant_id,
          input.libelle ?? null,
          input.date,
          input.heure_debut ?? null,
          input.heure_fin ?? null,
          input.duree_payee ?? null,
          userId,
        ]
      );

      // Créée en 'realisee' — l'administration constate un cours qui a eu lieu.
      // Mais PAS validée : engager la dépense reste un acte distinct, y compris
      // quand c'est la même personne qui l'accomplit ensuite.
      return ok(res.rows[0]);
    });
  }

  /**
   * Rapprochement emploi du temps ↔ séances : les créneaux attendus sur la
   * période qui n'ont aucune séance correspondante.
   *
   * Sans ce rapprochement, « ajouter une séance oubliée » suppose que le
   * comptable sache déjà laquelle manque. Ici le système le lui dit.
   */
  async findSeancesManquantes(
    tenantId: string,
    fromDate: string,
    toDate: string
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `WITH attendus AS (
           SELECT et.ue_session_id,
                  et.ecue_id,
                  et.enseignant_id,
                  et.heure_debut,
                  et.heure_fin,
                  d::date AS date
           FROM professional_emploi_temps et
           JOIN professional_ue_sessions s
             ON s.id = et.ue_session_id AND s.tenant_id = et.tenant_id
           -- Un créneau récurrent est décliné en dates réelles, bornées par la
           -- période demandée ET par la durée de vie de la cohorte.
           CROSS JOIN LATERAL generate_series(
             GREATEST($2::date, s.date_debut),
             LEAST($3::date, s.date_fin),
             INTERVAL '1 day'
           ) AS d
           WHERE et.tenant_id = $1
             AND s.statut <> 'annule'
             AND EXTRACT(ISODOW FROM d) = et.jour
         )
         SELECT a.ue_session_id,
                a.ecue_id,
                a.enseignant_id,
                a.date::text                  AS date,
                a.heure_debut::text           AS heure_debut,
                a.heure_fin::text             AS heure_fin,
                EXTRACT(EPOCH FROM (a.heure_fin - a.heure_debut)) / 3600.0 AS duree_attendue,
                ec.code                       AS ecue_code,
                ec.libelle                    AS ecue_libelle,
                us.libelle                    AS cohorte_libelle,
                COALESCE(TRIM(u.first_name || ' ' || u.last_name),
                         TRIM(t.first_name  || ' ' || t.last_name)) AS enseignant_nom
         FROM attendus a
         JOIN professional_ecue        ec ON ec.id = a.ecue_id
         JOIN professional_ue_sessions us ON us.id = a.ue_session_id
         LEFT JOIN teachers t ON t.id = a.enseignant_id
         LEFT JOIN users    u ON u.id = t.user_id
         WHERE NOT EXISTS (
           SELECT 1 FROM professional_ecue_seances se
           WHERE se.tenant_id      = $1
             AND se.ue_session_id  = a.ue_session_id
             AND se.ecue_id        = a.ecue_id
             AND se.date           = a.date
         )
         ORDER BY a.date, a.heure_debut
         LIMIT 500`,
        [tenantId, fromDate, toDate]
      );
      return ok(res.rows);
    });
  }

  /**
   * Chevauchements d'horaires d'un même enseignant (FR-007), restreints aux
   * séances DÉJÀ VALIDÉES.
   *
   * Pourquoi seulement celles-là : deux séances planifiées qui se recoupent
   * sont un problème d'emploi du temps, pas de rémunération — et un écran de
   * paie qui alerte sur tout le planning devient un bandeau permanent qu'on
   * apprend à ignorer. Le risque de payer deux fois le même créneau
   * n'existe qu'à partir du moment où les deux séances sont validées : c'est
   * là que l'alerte a du sens et une action associée (en dévalider une).
   */
  async findOverlaps(
    tenantId: string,
    params: { fromDate?: string; toDate?: string; enseignantId?: string }
  ): Promise<ServiceResult<any[]>> {
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = [
        "a.tenant_id = $1",
        "b.tenant_id = a.tenant_id",
        "a.enseignant_id IS NOT NULL",
        "b.enseignant_id = a.enseignant_id",
        "a.date = b.date",
        "a.id < b.id",
        // Uniquement les séances validées : ce sont les seules qui vont
        // réellement produire un montant.
        "a.statut = 'realisee'",
        "b.statut = 'realisee'",
        "a.validated_at IS NOT NULL",
        "b.validated_at IS NOT NULL",
        "a.heure_debut IS NOT NULL AND a.heure_fin IS NOT NULL",
        "b.heure_debut IS NOT NULL AND b.heure_fin IS NOT NULL",
        "a.heure_debut < b.heure_fin",
        "b.heure_debut < a.heure_fin",
      ];
      const values: any[] = [tenantId];
      let i = 2;
      if (params.fromDate) {
        where.push(`a.date >= $${i++}::date`);
        values.push(params.fromDate);
      }
      if (params.toDate) {
        where.push(`a.date <= $${i++}::date`);
        values.push(params.toDate);
      }
      if (params.enseignantId) {
        where.push(`a.enseignant_id = $${i++}`);
        values.push(params.enseignantId);
      }

      const res = await client.query(
        `SELECT a.enseignant_id,
                COALESCE(TRIM(u.first_name || ' ' || u.last_name),
                         TRIM(t.first_name  || ' ' || t.last_name)) AS enseignant_nom,
                a.date::text AS date,
                a.id AS seance_a_id, a.libelle AS seance_a_libelle,
                a.heure_debut::text AS seance_a_debut, a.heure_fin::text AS seance_a_fin,
                b.id AS seance_b_id, b.libelle AS seance_b_libelle,
                b.heure_debut::text AS seance_b_debut, b.heure_fin::text AS seance_b_fin
         FROM professional_ecue_seances a
         JOIN professional_ecue_seances b ON TRUE
         LEFT JOIN teachers t ON t.id = a.enseignant_id
         LEFT JOIN users    u ON u.id = t.user_id
         WHERE ${where.join(" AND ")}
         ORDER BY a.date DESC, a.heure_debut`,
        values
      );
      return ok(res.rows);
    });
  }

  /** La séance est-elle rattachée à un paiement approuvé ou payé ? */
  private async isLocked(
    client: PoolClient,
    tenantId: string,
    seanceId: string
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1
       FROM payment_hour_details phd
       JOIN teacher_payments tp ON tp.id = phd.payment_id
       WHERE phd.seance_id = $1 AND phd.tenant_id = $2
         AND tp.status::text = ANY($3::text[])
       LIMIT 1`,
      [seanceId, tenantId, LOCKING_STATUSES]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
