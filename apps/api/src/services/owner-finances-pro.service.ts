import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerFinancesProMode,
  OwnerFinancesProQuery,
  OwnerFinancesProResponse,
} from "@ecoledigitale/contracts";
import { PRO_ORDER_DATES_CTE } from "./owner-pro-annee.sql";
import {
  OUVERTURES_CTE,
  OUVERTURES_PERIMETRE_CTE,
  COMMANDES_PERIMETRE_CTE,
} from "./owner-perimetre.sql";

/**
 * Recouvrement du Module Professionnel (UE / ECUE) — onglet Impayés.
 *
 * L'écran Encaissements consolide désormais les deux moitiés. Celui-ci reste
 * la vue nominative du recouvrement des inscriptions aux UE : attendu,
 * encaissé, étudiants non soldés.
 *
 * Pièges appliqués :
 *  - §4.4-1  `professional_payments` n'a ni `student_id` ni `enrollment_id` :
 *            on remonte systématiquement par `order_id → professional_orders.student_id`.
 *  - §4.4-2  seul `statut = 'confirme'` compte comme encaissement.
 *  - §4.4-3  `professional_orders.statut = 'payee'` ne prouve AUCUN encaissement
 *            (`adminUpdateEnrollment` le force sans ligne de paiement). L'encaissé
 *            vient donc toujours de SUM(professional_payments.montant).
 *  - §4.4-4  un règlement utilisateur unique produit N lignes payments (une par
 *            commande touchée) : les transactions *métier* sont comptées
 *            DISTINCT sur (student_id, paid_at), jamais COUNT(*).
 *  - §4.4-6  DÉCISION PRODUIT : les UE « Conduite » sont INCLUSES ici — c'est du
 *            chiffre d'affaires réellement facturé et encaissé. L'écran admin
 *            /professionnel/admin/paiements les exclut : l'écart est assumé et
 *            signalé au front par `includesConduite: true`.
 *  - §4.4-8  on requête `professional_ue_sessions` en direct (l'endpoint REST
 *            clôturerait les sessions échues au passage).
 *
 * DATE MÉTIER D'UNE COMMANDE — corrigé.
 *
 * Le périmètre se bornait sur `o.created_at`. Cette colonne porte la date
 * d'ÉCRITURE de la ligne : les 1 360 commandes de cinq années scolaires y
 * portent toutes le 26 août 2026. L'écran affichait donc 102 000 000 FCFA sur
 * « 2025-2026 » — l'historique complet sous l'étiquette d'une seule année —
 * et 0 FCFA sur chacune des quatre précédentes, alors que la page admin
 * Paiements y lit 18 000 000 FCFA à chaque fois.
 *
 * La commande est désormais rattachée à l'ANNÉE DE LA CLASSE qu'elle ouvre,
 * par `PRO_ORDER_DATES_CTE` — la règle qu'appliquent déjà le tableau de bord,
 * Encaissements et Rentabilité, et surtout celle que la page Paiements applique
 * en JavaScript (`anneeScolaireOf(e.date_debut)`).
 *
 * FILTRE PAR NOM DE CLASSE.
 *
 * L'administration ne filtre pas par filière mais par NOM DE CLASSE, dérivé du
 * libellé de l'ouverture. Le même filtre est offert ici, avec la même clé
 * « filiereId|nom », pour que les deux écrans se recoupent option par option.
 *
 * Piège de double comptage (non listé au §4.4, mais structurant) : une commande
 * porte N inscriptions. Tout `orders JOIN enrollments JOIN payments` multiplie les
 * montants par N. On agrège donc les paiements par `order_id` dans un CTE dédié,
 * et on filtre les commandes par filière avec EXISTS — jamais avec un JOIN.
 */

/** Reste dû au-delà duquel un étudiant est considéré non soldé (tolérance d'arrondi). */
export const OWNER_FINANCES_PRO_SETTLED_EPSILON = 0.5;

/** Nombre de lignes du tableau des impayés. */
export const OWNER_FINANCES_PRO_TOP_UNPAID = 20;

/** Profondeur du graphique d'encaissements mensuels. */
export const OWNER_FINANCES_PRO_MONTHS = 12;

async function safeQuery<T>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<T[]> {
  try {
    const r = await client.query<T>(sql, params);
    return r.rows;
  } catch (e) {
    log.warn({ err: e, label }, "owner finances pro query failed");
    return [];
  }
}

/**
 * Fenêtre temporelle. Elle filtre la COHORTE de commandes (`orders.created_at`),
 * pas les paiements : l'encaissé est ensuite mesuré sur ces mêmes commandes, quelle
 * que soit la date de règlement. C'est ce qui rend le taux de recouvrement
 * interprétable (sinon on divise des encaissements d'une période par un attendu
 * d'une autre). Le graphique mensuel, lui, est volontairement en 12 mois glissants
 * toutes cohortes confondues — c'est indiqué dans l'UI.
 *
 * `end` est la borne affichée. `sqlEnd` est la borne SQL exclue. Pour une
 * période prédéfinie (mois, trimestre, année) elles coïncident. Pour `custom`,
 * le sélecteur « Au » est inclusif : on ajoute un jour à `sqlEnd` pour que la
 * dernière journée choisie ne disparaisse pas du périmètre.
 */
function nextUtcDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function resolvePeriod(filters: OwnerFinancesProQuery): {
  start: string;
  /** Affichée telle quelle : pour `custom`, c'est le « Au » du sélecteur, inclusif. */
  end: string;
  /** Borne SQL exclue du CTE `order_scope` (`created_at < sqlEnd`). */
  sqlEnd: string;
} {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const exclusive = (start: string, end: string) => ({ start, end, sqlEnd: end });

  switch (filters.period) {
    case "month":
      return exclusive(
        iso(new Date(Date.UTC(y, m, 1))),
        iso(new Date(Date.UTC(y, m + 1, 1)))
      );
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      return exclusive(
        iso(new Date(Date.UTC(y, q, 1))),
        iso(new Date(Date.UTC(y, q + 3, 1)))
      );
    }
    case "year":
      return exclusive(
        iso(new Date(Date.UTC(y, 0, 1))),
        iso(new Date(Date.UTC(y + 1, 0, 1)))
      );
    case "academic_year": {
      // Pivot septembre, cohérent avec la dérivation d'année scolaire du module pédagogie.
      const label = filters.anneeScolaire;
      const startYear = label ? Number(label.split("-")[0]) : m >= 8 ? y : y - 1;
      return exclusive(
        iso(new Date(Date.UTC(startYear, 8, 1))),
        iso(new Date(Date.UTC(startYear + 1, 8, 1)))
      );
    }
    case "custom":
    default: {
      const start = filters.dateDebut ?? iso(new Date(Date.UTC(y, 0, 1)));
      // Le sélecteur « Au » est inclusif. Le CTE coupe à borne exclue : sans
      // ce +1 jour, la dernière journée choisie disparaissait du périmètre.
      if (filters.dateFin) {
        return { start, end: filters.dateFin, sqlEnd: nextUtcDay(filters.dateFin) };
      }
      const end = iso(new Date(Date.UTC(y + 1, 0, 1)));
      return exclusive(start, end);
    }
  }
}

/**
 * Périmètre des commandes de l'écran, bâti sur le socle partagé.
 *
 * CE QUI A CHANGÉ, ET CE QUE ÇA CORRIGE
 *
 * Ce CTE posait trois EXISTS — filière, classe, semestre — qui passaient tous
 * par professional_enrollments. Les commandes de FRAIS (inscription, scolarité,
 * annexes, autres, migrations 0122 et 0123) n'ont aucune ligne dans cette table :
 * dès qu'un filtre était posé, elles disparaissaient. Mesuré à l'API sur cette
 * base : filtrer par classe faisait tomber l'attendu de 960 000 à 270 000 FCFA,
 * alors que les six commandes appartiennent toutes à cette classe.
 *
 * Le socle (owner-perimetre.sql) traite les deux sortes de commandes : par les
 * inscriptions quand il y en a, par la classe que porte la commande sinon.
 *
 * L'ANNÉE SCOLAIRE DEVIENT UN FILTRE À PART ENTIÈRE. Elle n'était jusqu'ici
 * honorée qu'à travers resolvePeriod, et seulement pour period=academic_year :
 * demander « 2026-2027 » avec une autre période retombait sur l'année civile.
 * Elle filtre désormais l'appartenance de l'ouverture, indépendamment de la
 * fenêtre de dates, qui reste ce qu'elle est — une période d'observation.
 *
 * Le nom order_scope et ses colonnes sont conservés : les huit requêtes qui le
 * consomment n'ont pas à connaître le socle.
 *
 * Paramètres (contrat de owner-perimetre.sql, puis les deux propres à l'écran) :
 * $1 tenantId, $2 anneeScolaire, $3 filiereIds, $4 nomClasse, $5 semestreId,
 * $6 start (date), $7 sqlEnd (date, borne exclue).
 */
const ORDER_SCOPE_CTE = `
  ${PRO_ORDER_DATES_CTE},
  ${OUVERTURES_CTE},
  ${OUVERTURES_PERIMETRE_CTE},
  ${COMMANDES_PERIMETRE_CTE},
  order_scope AS (
    SELECT c.order_id AS id, c.student_id, c.montant_total, d.debut,
           c.programme_id, c.par_inscription
      FROM commandes_perimetre c
      JOIN pro_order_dates d ON d.order_id = c.order_id
     WHERE d.debut >= $6::date
       AND d.debut <  $7::date
  )`;

/**
 * Encaissé par commande — agrégé AVANT toute jointure, pour ne jamais multiplier
 * les montants par le nombre d'inscriptions de la commande.
 */
const PAID_PER_ORDER_CTE = `
  paid_per_order AS (
    SELECT p.order_id, SUM(p.montant)::float8 AS paid
    FROM professional_payments p
    WHERE p.tenant_id = $1::uuid
      AND p.statut = 'confirme'   -- §4.4-2
    GROUP BY p.order_id
  )`;

export async function fetchOwnerFinancesPro(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerFinancesProQuery
): Promise<OwnerFinancesProResponse> {
  const filiereIds =
    filters.filiereIds && filters.filiereIds.length > 0 ? filters.filiereIds : null;
  const semestreId = filters.semestreId ?? null;
  const anneeScolaire = filters.anneeScolaire ?? null;
  const mode = filters.mode ?? null;
  const etat = filters.etat ?? "tous";
  const nomClasse = filters.nomClasse?.trim() ? filters.nomClasse.trim() : null;
  const recherche = filters.recherche?.trim() ? filters.recherche.trim() : null;
  const { start, end, sqlEnd } = resolvePeriod(filters);

  /*
     Le contrat de owner-perimetre.sql, dans son ordre figé, puis les deux
     paramètres propres à cet écran. Toute requête bâtie sur order_scope les
     reçoit en bloc ; ses paramètres à elle commencent donc à $8.

     L'ordre n'est pas négociable : c'est lui qui rend les fragments du socle
     réutilisables d'un service à l'autre. La version précédente numérotait à sa
     guise, et avait dû ajouter le nom de classe en $6 après coup.
  */
  const scopeParams = [
    tenantId, // $1
    anneeScolaire, // $2
    filiereIds, // $3
    nomClasse, // $4
    semestreId, // $5
    start, // $6
    sqlEnd, // $7
  ];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- Totaux : attendu, encaissé, recouvrement, étudiants non soldés ---- */
    const totalRows = await safeQuery<{
      expected: string | number | null;
      collected: string | number | null;
      unsettled: string | number;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE},
            ${PAID_PER_ORDER_CTE},
       per_student AS (
         SELECT os.student_id,
                SUM(os.montant_total) AS due,
                SUM(COALESCE(pp.paid, 0)) AS paid
         FROM order_scope os
         LEFT JOIN paid_per_order pp ON pp.order_id = os.id
         GROUP BY os.student_id
       )
       SELECT COALESCE(SUM(due), 0)::float8 AS expected,
              COALESCE(SUM(paid), 0)::float8 AS collected,
              COUNT(*) FILTER (WHERE due - paid > $8::float8)::int AS unsettled
       FROM per_student`,
      [...scopeParams, OWNER_FINANCES_PRO_SETTLED_EPSILON],
      log,
      "totals"
    );

    /* ---- Part des UE de conduite dans ces totaux (§4.4-6) ---- */
    // Publiée pour rendre lisible l'écart avec la page admin Paiements, qui
    // écarte ces UE de son périmètre. Même cohorte de commandes, restreinte aux
    // commandes portant au moins une inscription de conduite.
    const conduiteRows = await safeQuery<{
      expected: string | number | null;
      collected: string | number | null;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE},
            ${PAID_PER_ORDER_CTE}
       SELECT COALESCE(SUM(os.montant_total), 0)::float8 AS expected,
              COALESCE(SUM(COALESCE(pp.paid, 0)), 0)::float8 AS collected
       FROM order_scope os
       LEFT JOIN paid_per_order pp ON pp.order_id = os.id
       WHERE EXISTS (
         SELECT 1
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
         WHERE en.order_id = os.id
           AND en.tenant_id = $1::uuid
           AND en.statut <> 'annulee'
           -- Même test que l'écran admin : le libellé commence par « conduite ».
           AND lower(btrim(ue.libelle)) LIKE 'conduite%'
       )`,
      scopeParams,
      log,
      "partConduite"
    );
    const cond = conduiteRows[0] ?? { expected: 0, collected: 0 };

    const t = totalRows[0] ?? { expected: 0, collected: 0, unsettled: 0 };
    const expected = Number(t.expected) || 0;
    const collected = Number(t.collected) || 0;

    /* ---- Encaissements mensuels de la fenêtre ---- */
    // Deux corrections d'un coup. L'axe portait sur `p.paid_at`, l'horodatage
    // d'écriture du règlement : les 1 360 paiements y tombent tous dans le même
    // mois, et la courbe se réduisait à une barre. Et la fenêtre était de douze
    // mois glissants, donc étrangère à l'année choisie et au filtre de classe.
    // Le mois est désormais celui de l'OUVERTURE DE LA CLASSE, comme sur l'écran
    // Encaissements, et la série couvre exactement la fenêtre de l'écran.
    const monthlyRows = await safeQuery<{
      month: string;
      amount: string | number | null;
      tx_count: string | number;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE},
            ${PAID_PER_ORDER_CTE},
       mois AS (
         -- Grille pleine : un mois sans encaissement doit apparaître à zéro,
         -- sans quoi la courbe relie deux points distants comme s'ils étaient
         -- consécutifs.
         SELECT generate_series(date_trunc('month', $6::timestamptz),
                                date_trunc('month', $7::timestamptz - INTERVAL '1 day'),
                                INTERVAL '1 month') AS m
       )
       SELECT to_char(mois.m, 'YYYY-MM') AS month,
              COALESCE((SELECT SUM(COALESCE(pp.paid, 0))
                          FROM order_scope os
                          LEFT JOIN paid_per_order pp ON pp.order_id = os.id
                         WHERE date_trunc('month', os.debut) = mois.m), 0)::float8 AS amount,
              -- §4.4-4 : transactions métier = règlements distincts, pas de lignes.
              COALESCE((SELECT COUNT(DISTINCT (os.student_id, p.paid_at))
                          FROM order_scope os
                          JOIN professional_payments p
                            ON p.order_id = os.id AND p.tenant_id = $1::uuid
                           AND p.statut = 'confirme'
                         WHERE date_trunc('month', os.debut) = mois.m), 0)::int AS tx_count
       FROM mois
       ORDER BY month`,
      scopeParams,
      log,
      "monthlyCollections"
    );

    /* ---- Répartition par mode de paiement, sur la cohorte du périmètre ---- */
    const modeRows = await safeQuery<{
      mode: string;
      amount: string | number | null;
      count: string | number;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE}
       SELECT p.mode,
              COALESCE(SUM(p.montant), 0)::float8 AS amount,
              COUNT(DISTINCT (os.student_id, p.paid_at))::int AS count
       FROM professional_payments p
       JOIN order_scope os ON os.id = p.order_id
       WHERE p.tenant_id = $1::uuid
         AND p.statut = 'confirme'
         AND ($8::text IS NULL OR p.mode = $8::text)
       GROUP BY p.mode
       ORDER BY amount DESC`,
      [...scopeParams, mode],
      log,
      "byPaymentMode"
    );

    /* ---- Recouvrement par filière ---- */
    const recoveryRows = await safeQuery<{
      filiere_id: string;
      filiere_name: string;
      expected: string | number | null;
      collected: string | number | null;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE},
            ${PAID_PER_ORDER_CTE},
       -- L'attendu est réparti au prorata des inscriptions : une commande peut
       -- porter des UE de plusieurs filières, on ne peut pas l'affecter en bloc.
       enrollment_share AS (
         SELECT en.order_id,
                u.filiere_id,
                SUM(en.prix_unitaire)::float8 AS share
         FROM professional_enrollments en
         JOIN order_scope os ON os.id = en.order_id
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE en.tenant_id = $1::uuid
           AND en.statut <> 'annulee'
         GROUP BY en.order_id, u.filiere_id
         UNION ALL
         -- Les commandes de FRAIS n'inscrivent à aucune UE : le prorata
         -- ci-dessus ne leur donne aucune part, et elles sortaient du tableau
         -- alors que le total, lui, les comptait. Mesuré : 270 000 FCFA
         -- ventilés sous un total de 960 000 — un total qui contredit ses
         -- propres lignes coûte plus cher qu'un écran approximatif.
         --
         -- Part entière, et ce n'est pas une clé de répartition : la classe est
         -- portée par la commande elle-même.
         SELECT os.id, os.programme_id, os.montant_total
         FROM order_scope os
         WHERE NOT os.par_inscription
           AND os.programme_id IS NOT NULL
       ),
       order_share_total AS (
         SELECT order_id, SUM(share) AS total FROM enrollment_share GROUP BY order_id
       )
       SELECT es.filiere_id,
              p.name AS filiere_name,
              COALESCE(SUM(es.share), 0)::float8 AS expected,
              COALESCE(SUM(COALESCE(pp.paid, 0) * es.share / NULLIF(ost.total, 0)), 0)::float8 AS collected
       FROM enrollment_share es
       JOIN order_share_total ost ON ost.order_id = es.order_id
       LEFT JOIN paid_per_order pp ON pp.order_id = es.order_id
       JOIN programmes p ON p.id = es.filiere_id AND p.tenant_id = $1::uuid
       GROUP BY es.filiere_id, p.name
       ORDER BY p.name`,
      scopeParams,
      log,
      "recoveryByFiliere"
    );

    /* ---- Top des impayés ---- */
    const unpaidRows = await safeQuery<{
      student_id: string;
      student_name: string;
      matricule: string | null;
      filiere_names: string | null;
      due: string | number;
      paid: string | number;
      oldest_unpaid_at: Date | string | null;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE},
            ${PAID_PER_ORDER_CTE},
       per_student AS (
         SELECT os.student_id,
                SUM(os.montant_total) AS due,
                SUM(COALESCE(pp.paid, 0)) AS paid,
                -- Date de l'impayé le plus ancien : le DÉBUT DE L'OUVERTURE,
                -- et non l'horodatage d'écriture de la commande, qui est le même
                -- pour toute la base et rendait cette colonne muette.
                MIN(os.debut) FILTER (
                  WHERE os.montant_total - COALESCE(pp.paid, 0) > $8::float8
                ) AS oldest_unpaid_at
         FROM order_scope os
         LEFT JOIN paid_per_order pp ON pp.order_id = os.id
         GROUP BY os.student_id
       )
       SELECT ps.student_id,
              TRIM(COALESCE(us.first_name, '') || ' ' || COALESCE(us.last_name, '')) AS student_name,
              -- establishment_matricule n'existe dans aucune migration : on utilise
              -- student_number, la seule colonne matricule réellement définie (0003).
              sp.student_number AS matricule,
              (SELECT string_agg(DISTINCT pr.name, ', ')
               FROM professional_enrollments en
               JOIN order_scope os2 ON os2.id = en.order_id AND os2.student_id = ps.student_id
               JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
               JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
               JOIN programmes pr ON pr.id = u.filiere_id AND pr.tenant_id = $1::uuid
               WHERE en.tenant_id = $1::uuid AND en.statut <> 'annulee') AS filiere_names,
              ps.due::float8 AS due,
              ps.paid::float8 AS paid,
              ps.oldest_unpaid_at
       FROM per_student ps
       JOIN student_profiles sp ON sp.id = ps.student_id AND sp.tenant_id = $1::uuid
       JOIN users us ON us.id = sp.user_id AND us.tenant_id = sp.tenant_id
       WHERE CASE $9::text
               WHEN 'non_regle' THEN ps.paid <= $8::float8
               WHEN 'partiel'   THEN ps.paid > $8::float8 AND ps.due - ps.paid > $8::float8
               WHEN 'solde'     THEN ps.due - ps.paid <= $8::float8
               ELSE ps.due - ps.paid > $8::float8
             END
         -- Recherche nom / prénom / matricule, comme le champ « Étudiant… » de
         -- la page admin Paiements. Elle ne touche QUE ce tableau : les totaux
         -- de l'écran décrivent le périmètre, pas la ligne cherchée.
         AND ($11::text IS NULL OR
              TRIM(COALESCE(us.first_name, '') || ' ' || COALESCE(us.last_name, ''))
                ILIKE '%' || $11::text || '%'
              OR COALESCE(sp.student_number, '') ILIKE '%' || $11::text || '%')
       ORDER BY (ps.due - ps.paid) DESC
       LIMIT $10::int`,
      [
        ...scopeParams,
        OWNER_FINANCES_PRO_SETTLED_EPSILON,
        etat,
        OWNER_FINANCES_PRO_TOP_UNPAID,
        recherche,
      ],
      log,
      "topUnpaid"
    );

    /* ---- Chiffre d'affaires par UE ---- */
    const ueRevenueRows = await safeQuery<{
      ue_id: string;
      code: string;
      libelle: string;
      filiere_name: string;
      confirmed: string | number;
      revenue: string | number | null;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE}
       SELECT u.id AS ue_id,
              u.code,
              u.libelle,
              p.name AS filiere_name,
              COUNT(*)::int AS confirmed,
              -- Le CA réel est la somme des prix figés à l'inscription, pas
              -- professional_ue.prix × N : le tarif de l'UE a pu changer depuis.
              COALESCE(SUM(en.prix_unitaire), 0)::float8 AS revenue
       FROM professional_enrollments en
       JOIN order_scope os ON os.id = en.order_id
       JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       JOIN programmes p ON p.id = u.filiere_id AND p.tenant_id = $1::uuid
       WHERE en.tenant_id = $1::uuid
         AND en.statut IN ('confirmee', 'terminee')
       GROUP BY u.id, u.code, u.libelle, p.name
       ORDER BY revenue DESC
       LIMIT 20`,
      scopeParams,
      log,
      "revenueByUe"
    );

    /* ---- Entonnoir des inscriptions ---- */
    const funnelRows = await safeQuery<{
      created: string | number;
      confirmed: string | number;
      completed: string | number;
      cancelled: string | number;
    }>(
      client,
      `WITH ${ORDER_SCOPE_CTE}
       SELECT COUNT(*)::int AS created,
              COUNT(*) FILTER (WHERE en.statut = 'confirmee')::int AS confirmed,
              COUNT(*) FILTER (WHERE en.statut = 'terminee')::int AS completed,
              COUNT(*) FILTER (WHERE en.statut = 'annulee')::int AS cancelled
       FROM professional_enrollments en
       JOIN order_scope os ON os.id = en.order_id
       WHERE en.tenant_id = $1::uuid`,
      scopeParams,
      log,
      "enrollmentFunnel"
    );

    const f = funnelRows[0] ?? { created: 0, confirmed: 0, completed: 0, cancelled: 0 };

    return {
      period: filters.period ?? "year",
      periodStart: start,
      periodEnd: end,
      filiereIds: filiereIds ?? [],
      nomClasse,
      semestreId,
      mode: mode as OwnerFinancesProMode | null,
      etat,
      includesConduite: true,
      totals: {
        expected: Math.round(expected),
        collected: Math.round(collected),
        // `null` et non 0 : « rien n'est attendu » n'est pas « rien n'est
        // recouvré ». Le zéro affichait 0 % sur un périmètre soldé — l'inverse
        // de la situation, sur l'écran même des impayés. Aligné sur
        // OwnerFinancesProTotalsSchema.recoveryRate (.nullable()).
        recoveryRate:
          expected > 0 ? Math.round((collected * 1000) / expected) / 10 : null,
        outstanding: Math.max(0, Math.round(expected - collected)),
        unsettledStudents: Number(t.unsettled) || 0,
        // §4.4-6 : de quoi rapprocher ces totaux de ceux de la page admin
        // Paiements, qui écarte les UE de conduite de son périmètre.
        conduite: {
          expected: Math.round(Number(cond.expected) || 0),
          collected: Math.round(Number(cond.collected) || 0),
        },
      },
      monthlyCollections: monthlyRows.map((r) => ({
        month: r.month,
        amount: Math.round(Number(r.amount) || 0),
        transactionCount: Number(r.tx_count) || 0,
      })),
      byPaymentMode: modeRows
        .filter((r): r is typeof r & { mode: OwnerFinancesProMode } =>
          ["especes", "mobile_money", "virement", "autre"].includes(r.mode)
        )
        .map((r) => ({
          mode: r.mode,
          amount: Math.round(Number(r.amount) || 0),
          count: Number(r.count) || 0,
        })),
      recoveryByFiliere: recoveryRows.map((r) => {
        const exp = Number(r.expected) || 0;
        const col = Number(r.collected) || 0;
        return {
          filiereId: r.filiere_id,
          filiereName: r.filiere_name,
          expected: Math.round(exp),
          collected: Math.round(col),
          recoveryRate: exp > 0 ? Math.round((col * 1000) / exp) / 10 : 0,
        };
      }),
      topUnpaid: unpaidRows.map((r) => {
        const due = Number(r.due) || 0;
        const paid = Number(r.paid) || 0;
        return {
          studentId: r.student_id,
          studentName: r.student_name || "—",
          matricule: r.matricule,
          filiereNames: r.filiere_names,
          due: Math.round(due),
          paid: Math.round(paid),
          outstanding: Math.round(due - paid),
          oldestUnpaidAt:
            r.oldest_unpaid_at instanceof Date
              ? r.oldest_unpaid_at.toISOString().slice(0, 10)
              : r.oldest_unpaid_at
                ? String(r.oldest_unpaid_at).slice(0, 10)
                : null,
        };
      }),
      revenueByUe: ueRevenueRows.map((r) => ({
        ueId: r.ue_id,
        code: r.code,
        libelle: r.libelle,
        filiereName: r.filiere_name,
        confirmedEnrollments: Number(r.confirmed) || 0,
        revenue: Math.round(Number(r.revenue) || 0),
      })),
      enrollmentFunnel: {
        created: Number(f.created) || 0,
        confirmed: Number(f.confirmed) || 0,
        completed: Number(f.completed) || 0,
        cancelled: Number(f.cancelled) || 0,
      },
    };
  } finally {
    client.release();
  }
}
