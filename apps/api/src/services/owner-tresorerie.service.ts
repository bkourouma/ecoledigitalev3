import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerAgedBucket,
  OwnerCashRegisterQuery,
  OwnerCashRegisterResponse,
  OwnerTresorerieQuery,
  OwnerTresorerieResponse,
} from "@ecoledigitale/contracts/src/owner-stats.schema";
import { PRO_UNPAID_INSTALLMENTS_CTE } from "./owner-pro-outstanding.sql";
import { PRO_ORDER_DATES_CTE } from "./owner-pro-annee.sql";

/**
 * Trésorerie et recouvrement, scolaire et professionnel consolidés.
 *
 * Répond à la première question d'un propriétaire — « est-ce que l'argent
 * rentre ? » — par quatre lectures qui n'existaient nulle part :
 *
 *   1. le RESTE À RECOUVRER PAR FILIÈRE, ventilé par ancienneté. La probabilité
 *      de recouvrer s'effondre après 90 jours : un reste à recouvrer sans cette
 *      ventilation ne dit rien d'exploitable ;
 *   2. la COURBE DE TRÉSORERIE, comparée à la même saison l'an dernier — le
 *      calendrier scolaire est trop saisonnier pour qu'un écart au mois
 *      précédent veuille dire quoi que ce soit ;
 *   3. la RÉPARTITION PAR MODE de règlement, qui pilote la négociation des frais
 *      Mobile Money et la sécurisation du circuit espèces ;
 *   4. les ÉCARTS DE CAISSE : commande marquée payée sans aucun paiement,
 *      encaissement sans reçu. Chacun est soit une erreur de saisie, soit pire.
 *
 * Une règle de méthode : le dû à venir (`a_echoir`) n'est JAMAIS mélangé au
 * retard. Les confondre gonfle la dette et déclenche des relances injustifiées.
 *
 * CE QUE CETTE RÉPONSE N'EXPOSE PLUS, ET POURQUOI
 *
 * `agedBalance` (la balance âgée consolidée), `couverture` et
 * `proDefaultScheduleShare` ont été retirés : ils ne servaient qu'à un bloc de
 * l'écran Impayés, supprimé depuis. Ce module ne saisit pas d'échéancier — la
 * ventilation par ancienneté y était vide par construction, et le drapeau qui
 * l'annonçait promettait une saisie qui n'aura pas lieu.
 *
 * ATTENTION, LIMITE CONNUE : `agedByFiliere` repose encore sur
 * `professional_order_installments` côté professionnel, une table que ce module
 * n'alimente pas. Le tableau de bord, seul lecteur restant, y voit donc toujours
 * zéro côté professionnel. Le reste dû réel se calcule sur les commandes
 * (`montant_total` moins les versements confirmés), comme le fait déjà
 * `owner-finances-pro.service.ts`.
 */

/* --------------------------------- Outils --------------------------------- */

type Row = Record<string, unknown>;

async function safeRows<T extends Row>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger,
  label: string
): Promise<T[]> {
  try {
    const res = await client.query<T>(sql, params);
    return res.rows;
  } catch (e) {
    log.warn({ err: e, label }, "owner tresorerie query failed");
    return [];
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function round0(v: number): number {
  return Math.round(v);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Bornes par défaut : 90 jours glissants, assez pour voir une saison de rentrée. */
function resolveWindow(q: OwnerTresorerieQuery): { from: string; to: string } {
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const to = isDate(q.dateFin) ? q.dateFin! : toIsoDate(new Date());
  if (isDate(q.dateDebut)) return { from: q.dateDebut!, to };
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 89);
  return { from: toIsoDate(d), to };
}

const BUCKET_ORDER: OwnerAgedBucket[] = ["a_echoir", "j0_30", "j31_60", "j61_90", "j90_plus"];

/** Libellés des modes de règlement du module professionnel. */
const MODE_LABEL: Record<string, string> = {
  especes: "Espèces",
  cash: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement bancaire",
  cheque: "Chèque",
  carte: "Carte bancaire",
  autre: "Autre",
};

function modeLabel(mode: string): string {
  return MODE_LABEL[String(mode).toLowerCase()] ?? mode;
}

/**
 * Tranche d'ancienneté, en SQL. Une échéance non encore exigible tombe dans
 * `a_echoir` : ce n'est pas de la dette en retard.
 */
const AGE_BUCKET_SQL = `
  CASE
    WHEN due_date > CURRENT_DATE THEN 'a_echoir'
    WHEN CURRENT_DATE - due_date <= 30 THEN 'j0_30'
    WHEN CURRENT_DATE - due_date <= 60 THEN 'j31_60'
    WHEN CURRENT_DATE - due_date <= 90 THEN 'j61_90'
    ELSE 'j90_plus'
  END`;

/**
 * Impayés SCOLAIRES, ligne à ligne, avec leur filière.
 *
 * `student_tuition_installments` porte déjà `amount_paid` par échéance : le
 * reste dû se lit directement, sans reconstruire d'imputation.
 */
const SCOLAIRE_UNPAID_CTE = `
  scolaire_unpaid AS (
    SELECT
      p.id           AS filiere_id,
      p.name         AS filiere_name,
      sti.due_date   AS due_date,
      GREATEST(0, sti.amount - sti.amount_paid)::float8 AS unpaid
    FROM student_tuition_installments sti
    JOIN student_enrollments se ON se.id = sti.enrollment_id AND se.tenant_id = sti.tenant_id
    LEFT JOIN classes c    ON c.id = se.class_id      AND c.tenant_id = se.tenant_id
    LEFT JOIN programmes p ON p.id = c.programme_id   AND p.tenant_id = c.tenant_id
    WHERE sti.tenant_id = $1::uuid
      AND sti.status IN ('pending'::installment_status,
                         'partial'::installment_status,
                         'overdue'::installment_status)
      AND sti.amount > sti.amount_paid
  )`;

/**
 * Impayés PROFESSIONNELS, ventilés sur l'échéancier de la commande.
 *
 * Deux subtilités :
 *
 * 1. Imputation des paiements. Un versement solde les échéances les plus
 *    anciennes d'abord — c'est la convention comptable usuelle et la seule qui
 *    ne fasse pas vieillir artificiellement la dette. D'où le cumul glissant :
 *    l'impayé d'une échéance vaut son montant moins ce que les versements ont
 *    déjà absorbé en amont, borné à [0, montant].
 *
 * 2. Répartition par filière. Une commande peut porter des UE de plusieurs
 *    filières : on répartit son impayé AU PRORATA des prix unitaires inscrits,
 *    jamais en bloc sur une seule filière.
 */
const PRO_UNPAID_CTE = `
  ${PRO_UNPAID_INSTALLMENTS_CTE},
  pro_share AS (
    SELECT en.order_id, u.filiere_id, SUM(en.prix_unitaire)::float8 AS part
    FROM professional_enrollments en
    JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
    JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
    WHERE en.tenant_id = $1::uuid AND en.statut <> 'annulee'
    GROUP BY en.order_id, u.filiere_id
  ),
  pro_share_total AS (
    SELECT order_id, SUM(part) AS total FROM pro_share GROUP BY order_id
  ),
  pro_unpaid AS (
    SELECT
      sh.filiere_id,
      pr.name AS filiere_name,
      pi.due_date,
      (pi.unpaid * sh.part / NULLIF(t.total, 0))::float8 AS unpaid
    FROM pro_unpaid_installments pi
    JOIN pro_share sh       ON sh.order_id = pi.order_id
    JOIN pro_share_total t  ON t.order_id = pi.order_id
    LEFT JOIN programmes pr ON pr.id = sh.filiere_id AND pr.tenant_id = $1::uuid
    WHERE pi.unpaid > 0
  )`;

/** Nombre de filières détaillées dans la balance âgée avant regroupement. */
const FILIERE_ROWS_LIMIT = 8;

/* --------------------------------- Service -------------------------------- */

export async function fetchOwnerTresorerie(
  pool: Pool,
  tenantId: string,
  query: OwnerTresorerieQuery,
  log: FastifyBaseLogger
): Promise<OwnerTresorerieResponse> {
  const { from, to } = resolveWindow(query);
  const granularity = query.granularity ?? "week";
  const filiereIds = query.filiereIds && query.filiereIds.length > 0 ? query.filiereIds : null;
  const client = await pool.connect();

  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- Balance âgée, par tranche et par filière ------------------------ */
    const agedRows = await safeRows<Row>(
      client,
      `WITH ${SCOLAIRE_UNPAID_CTE},
       ${PRO_UNPAID_CTE},
       tous AS (
         SELECT filiere_id, filiere_name, due_date, unpaid, 'scolaire' AS source FROM scolaire_unpaid
         UNION ALL
         SELECT filiere_id, filiere_name, due_date, unpaid, 'pro'      AS source FROM pro_unpaid
       )
       SELECT
         filiere_id,
         COALESCE(filiere_name, 'Sans filière') AS filiere_name,
         ${AGE_BUCKET_SQL} AS bucket,
         source,
         SUM(unpaid)::float8 AS montant
       FROM tous
       WHERE ($2::uuid[] IS NULL OR filiere_id = ANY($2::uuid[]))
       GROUP BY filiere_id, filiere_name, bucket, source`,
      [tenantId, filiereIds],
      log,
      "agedByFiliere"
    );

    // Agrégation par tranche (scolaire / professionnel / total).
    const perBucket = new Map<OwnerAgedBucket, { scolaire: number; professionnel: number }>();
    for (const b of BUCKET_ORDER) perBucket.set(b, { scolaire: 0, professionnel: 0 });
    // Agrégation par filière.
    const perFiliere = new Map<
      string,
      { filiereId: string | null; filiereName: string; buckets: Record<OwnerAgedBucket, number> }
    >();

    for (const row of agedRows) {
      const bucket = String(row.bucket) as OwnerAgedBucket;
      const montant = num(row.montant);
      const slot = perBucket.get(bucket);
      if (slot) {
        if (row.source === "scolaire") slot.scolaire += montant;
        else slot.professionnel += montant;
      }

      const key = String(row.filiere_id ?? "__none__");
      if (!perFiliere.has(key)) {
        perFiliere.set(key, {
          filiereId: (row.filiere_id as string | null) ?? null,
          filiereName: String(row.filiere_name),
          buckets: { a_echoir: 0, j0_30: 0, j31_60: 0, j61_90: 0, j90_plus: 0 },
        });
      }
      perFiliere.get(key)!.buckets[bucket] += montant;
    }

    /**
     * `perBucket` ne sort plus dans la réponse : il ne sert qu'à totaliser.
     *
     * La balance âgée consolidée (`agedBalance`) était exposée pour un
     * graphique que l'écran Impayés n'affiche plus — le module professionnel ne
     * saisit pas d'échéancier, la ventilation par ancienneté y restait vide par
     * construction. La ventilation PAR FILIÈRE, elle, est encore lue par le
     * tableau de bord et reste produite.
     */
    const totalParBucket = (bucket: OwnerAgedBucket) => {
      const v = perBucket.get(bucket)!;
      return v.scolaire + v.professionnel;
    };

    // Classement par dette ÉCHUE : c'est elle qui appelle une relance, pas le
    // dû à venir. Au-delà de 8 filières, le reste est regroupé — mais compté,
    // jamais tronqué en silence.
    const filiereRows = Array.from(perFiliere.values())
      .map((f) => ({
        filiereId: f.filiereId,
        filiereName: f.filiereName,
        aEchoir: round0(f.buckets.a_echoir),
        j0_30: round0(f.buckets.j0_30),
        j31_60: round0(f.buckets.j31_60),
        j61_90: round0(f.buckets.j61_90),
        j90Plus: round0(f.buckets.j90_plus),
        totalEchu: round0(
          f.buckets.j0_30 + f.buckets.j31_60 + f.buckets.j61_90 + f.buckets.j90_plus
        ),
      }))
      .sort((a, b) => b.totalEchu - a.totalEchu);

    let agedByFiliere = filiereRows;
    if (filiereRows.length > FILIERE_ROWS_LIMIT) {
      const head = filiereRows.slice(0, FILIERE_ROWS_LIMIT);
      const tail = filiereRows.slice(FILIERE_ROWS_LIMIT);
      head.push({
        filiereId: null,
        filiereName: `Autres (${tail.length} filières)`,
        aEchoir: tail.reduce((s, r) => s + r.aEchoir, 0),
        j0_30: tail.reduce((s, r) => s + r.j0_30, 0),
        j31_60: tail.reduce((s, r) => s + r.j31_60, 0),
        j61_90: tail.reduce((s, r) => s + r.j61_90, 0),
        j90Plus: tail.reduce((s, r) => s + r.j90Plus, 0),
        totalEchu: tail.reduce((s, r) => s + r.totalEchu, 0),
      });
      agedByFiliere = head;
    }

    /* ---- Courbe de trésorerie -------------------------------------------- */
    // Une seule requête produit la série courante ET celle de l'an dernier : on
    // décale la fenêtre d'un an et on ramène les points sur la même grille.
    const cashRows = await safeRows<Row>(
      client,
      `WITH ${PRO_ORDER_DATES_CTE},
       bornes AS (
         SELECT $2::date AS d1, $3::date AS d2, $4::text AS gran
       ),
       grille AS (
         SELECT generate_series(
                  date_trunc((SELECT gran FROM bornes), (SELECT d1 FROM bornes)::timestamptz),
                  (SELECT d2 FROM bornes)::timestamptz,
                  CASE (SELECT gran FROM bornes)
                    WHEN 'day' THEN INTERVAL '1 day'
                    WHEN 'week' THEN INTERVAL '1 week'
                    ELSE INTERVAL '1 month'
                  END
                )::date AS tranche
       ),
       encaissements AS (
         SELECT COALESCE(processed_at, created_at)::date AS jour,
                amount::float8 AS montant,
                'scolaire' AS source
         FROM payment_transactions
         WHERE tenant_id = $1::uuid AND status = 'completed'::transaction_status
         UNION ALL
         -- Daté par la CLASSE OUVERTE, pas par le versement : sur une base
         -- reprise, tous les paiements portent le même horodatage et la courbe
         -- des années passées restait plate à zéro pendant que l'indicateur
         -- au-dessus d'elle affichait 18 millions.
         SELECT d.debut::date AS jour,
                pp.montant::float8 AS montant,
                'pro' AS source
         FROM professional_payments pp
         JOIN pro_order_dates d ON d.order_id = pp.order_id
         WHERE pp.tenant_id = $1::uuid AND pp.statut = 'confirme'
       )
       SELECT
         g.tranche::text AS tranche,
         COALESCE(SUM(e.montant) FILTER (
           WHERE e.source = 'scolaire'
             AND date_trunc((SELECT gran FROM bornes), e.jour::timestamptz)::date = g.tranche
         ), 0)::float8 AS scolaire,
         COALESCE(SUM(e.montant) FILTER (
           WHERE e.source = 'pro'
             AND date_trunc((SELECT gran FROM bornes), e.jour::timestamptz)::date = g.tranche
         ), 0)::float8 AS professionnel,
         COALESCE(SUM(e.montant) FILTER (
           WHERE date_trunc((SELECT gran FROM bornes), (e.jour + INTERVAL '1 year')::timestamptz)::date = g.tranche
         ), 0)::float8 AS annee_precedente
       FROM grille g
       LEFT JOIN encaissements e
         ON e.jour BETWEEN (SELECT d1 FROM bornes) - INTERVAL '1 year'
                       AND (SELECT d2 FROM bornes)
       GROUP BY g.tranche
       ORDER BY g.tranche`,
      [tenantId, from, to, granularity],
      log,
      "cashflow"
    );

    const cashflow = cashRows.map((row) => {
      const date = String(row.tranche);
      const d = new Date(`${date}T00:00:00Z`);
      const label =
        granularity === "month"
          ? d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" })
          : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
      const scolaire = round0(num(row.scolaire));
      const professionnel = round0(num(row.professionnel));
      return {
        date,
        label,
        scolaire,
        professionnel,
        total: scolaire + professionnel,
        totalAnneePrecedente: round0(num(row.annee_precedente)),
      };
    });

    /* ---- Répartition par mode de règlement -------------------------------- */
    const modeRows = await safeRows<Row>(
      client,
      `WITH ${PRO_ORDER_DATES_CTE}
       SELECT COALESCE(NULLIF(TRIM(pp.mode), ''), 'autre') AS mode,
              SUM(pp.montant)::float8 AS amount,
              COUNT(*)::int AS n
         FROM professional_payments pp
         JOIN pro_order_dates d ON d.order_id = pp.order_id
        WHERE pp.tenant_id = $1::uuid
          AND pp.statut = 'confirme'
          AND d.debut BETWEEN $2::date AND $3::date
        GROUP BY 1
        ORDER BY amount DESC`,
      [tenantId, from, to],
      log,
      "byPaymentMode"
    );

    const byPaymentMode = modeRows.map((row) => ({
      mode: String(row.mode),
      label: modeLabel(String(row.mode)),
      amount: round0(num(row.amount)),
      count: Math.round(num(row.n)),
    }));

    /* ---- Écarts de caisse -------------------------------------------------- */
    const anomalyRow = await safeRows<Row>(
      client,
      `SELECT
         (SELECT COUNT(*) FROM professional_orders o
           WHERE o.tenant_id = $1::uuid
             AND o.statut = 'payee'
             AND NOT EXISTS (SELECT 1 FROM professional_payments p
                              WHERE p.order_id = o.id AND p.tenant_id = o.tenant_id))::int AS orders_no_payment,
         (SELECT COALESCE(SUM(o.montant_total), 0) FROM professional_orders o
           WHERE o.tenant_id = $1::uuid
             AND o.statut = 'payee'
             AND NOT EXISTS (SELECT 1 FROM professional_payments p
                              WHERE p.order_id = o.id AND p.tenant_id = o.tenant_id))::float8 AS orders_no_payment_amount,
         (SELECT COUNT(*) FROM professional_payments p
           WHERE p.tenant_id = $1::uuid
             AND p.statut = 'confirme'
             AND (p.receipt_number IS NULL OR TRIM(p.receipt_number) = '')
             AND COALESCE(p.paid_at, p.created_at) < now() - INTERVAL '48 hours')::int AS no_receipt,
         (SELECT COALESCE(SUM(p.montant), 0) FROM professional_payments p
           WHERE p.tenant_id = $1::uuid
             AND p.statut = 'confirme'
             AND (p.receipt_number IS NULL OR TRIM(p.receipt_number) = '')
             AND COALESCE(p.paid_at, p.created_at) < now() - INTERVAL '48 hours')::float8 AS no_receipt_amount`,
      [tenantId],
      log,
      "cashAnomalies"
    );
    const anomaly = anomalyRow[0] ?? {};

    /* ---- Totaux et part d'échéancier par défaut --------------------------- */
    const totalsRow = await safeRows<Row>(
      client,
      `WITH ${PRO_ORDER_DATES_CTE},
       ${PRO_UNPAID_CTE},
       collected AS (
         SELECT
           (SELECT COALESCE(SUM(amount), 0)::float8 FROM payment_transactions
             WHERE tenant_id = $1::uuid AND status = 'completed'::transaction_status
               AND COALESCE(processed_at, created_at)::date BETWEEN $2::date AND $3::date)
         + (SELECT COALESCE(SUM(pp.montant), 0)::float8
              FROM professional_payments pp
              JOIN pro_order_dates d ON d.order_id = pp.order_id
             WHERE pp.tenant_id = $1::uuid AND pp.statut = 'confirme'
               AND d.debut BETWEEN $2::date AND $3::date) AS v
       ),
       expected AS (
         SELECT
           (SELECT COALESCE(SUM(amount), 0)::float8 FROM student_tuition_installments
             WHERE tenant_id = $1::uuid AND due_date BETWEEN $2::date AND $3::date)
         -- Montant ajusté au total réel de la commande (cf. fragment partagé) :
         -- un échéancier figé ne doit pas minorer l'attendu.
         + (SELECT COALESCE(SUM(si.montant), 0)::float8
              FROM pro_scaled_installments si
             WHERE si.due_date BETWEEN $2::date AND $3::date)
         -- Commandes SANS échéancier : sans ce terme, l'attendu ne compte que
         -- ce qui a une date d'échéance alors que l'encaissé compte tout. Les
         -- deux termes du ratio ne portaient pas sur le même périmètre, et le
         -- taux affichait 0 % sur un établissement intégralement payé.
         --
         -- DATÉES À LA CLASSE OUVERTE, comme l'encaissé juste au-dessus. Ce
         -- terme filtrait sur created_at, l'horodatage d'écriture de la ligne :
         -- sur une base reprise, les 1 360 commandes le portent au même jour.
         -- L'attendu retombait donc à 0 là où l'encaissé valait 18 M, et le taux
         -- de recouvrement passait « non mesuré » sur toutes les années passées.
         + (SELECT COALESCE(SUM(po.montant_total), 0)::float8
              FROM professional_orders po
              JOIN pro_order_dates d ON d.order_id = po.id
             WHERE po.tenant_id = $1::uuid
               AND po.statut <> 'annulee'
               AND d.debut BETWEEN $2::date AND $3::date
               AND NOT EXISTS (SELECT 1 FROM professional_order_installments oi
                                WHERE oi.order_id = po.id AND oi.tenant_id = po.tenant_id)) AS v
       ),
       SELECT collected.v AS collected,
              expected.v  AS expected
       FROM collected, expected`,
      [tenantId, from, to],
      log,
      "tresorerieTotals"
    );
    const totalsSrc = totalsRow[0] ?? {};

    const outstanding = round0(
      BUCKET_ORDER.reduce((s, bucket) => s + totalParBucket(bucket), 0)
    );
    // Le dû à venir n'est pas du retard : `a_echoir` sort du total échu.
    const outstandingEchu = round0(
      BUCKET_ORDER.filter((b) => b !== "a_echoir").reduce(
        (s, bucket) => s + totalParBucket(bucket),
        0
      )
    );
    const collected = round0(num(totalsSrc.collected));
    const expected = round0(num(totalsSrc.expected));

    return {
      dateDebut: from,
      dateFin: to,
      granularity,
      computedAt: new Date().toISOString(),
      totals: {
        collected,
        expected,
        outstanding,
        outstandingEchu,
        // `null` et non 0 : « rien n'est attendu » n'est pas « rien n'est
        // recouvré ». Le zéro affichait 0 % de recouvrement sur un
        // établissement intégralement payé — l'inverse de la situation, sur
        // l'écran même des impayés.
        recoveryRate: expected > 0 ? round1((100 * collected) / expected) : null,
      },
      agedByFiliere,
      cashflow,
      byPaymentMode,
      anomalies: {
        ordersPaidWithoutPayment: {
          count: Math.round(num(anomaly.orders_no_payment)),
          amount: round0(num(anomaly.orders_no_payment_amount)),
        },
        paymentsWithoutReceipt: {
          count: Math.round(num(anomaly.no_receipt)),
          amount: round0(num(anomaly.no_receipt_amount)),
        },
      },
    };
  } finally {
    client.release();
  }
}

/* ------------------------------ Journal de caisse -------------------------- */

/**
 * Journal de caisse : la liste des reçus émis sur une période.
 *
 * C'est la pièce de contrôle interne qui manquait — indispensable en audit, et
 * seule façon de rapprocher l'encaisse déclarée des reçus réellement remis.
 *
 * Les totaux sont calculés sur TOUT le périmètre filtré, jamais sur la page
 * affichée : c'est précisément l'erreur qui rendait faux les impayés du tableau
 * de bord financier.
 *
 * Limite assumée : `professional_payments` ne stocke pas l'auteur de la saisie.
 * Le journal ne peut donc pas dire QUI a encaissé — seulement quoi, quand et
 * pour qui. Rattacher un encaissement à un agent demande une colonne d'auteur.
 */
export async function fetchOwnerCashRegister(
  pool: Pool,
  tenantId: string,
  query: OwnerCashRegisterQuery,
  log: FastifyBaseLogger
): Promise<OwnerCashRegisterResponse> {
  const { from, to } = resolveWindow({
    dateDebut: query.dateDebut,
    dateFin: query.dateFin,
    granularity: "day",
  });
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  const mode = query.mode && query.mode.trim() !== "" ? query.mode.trim() : null;
  const search = query.search && query.search.trim() !== "" ? `%${query.search.trim()}%` : null;

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const base = `
      FROM professional_payments p
      JOIN professional_orders o ON o.id = p.order_id AND o.tenant_id = p.tenant_id
      LEFT JOIN student_profiles sp ON sp.id = o.student_id AND sp.tenant_id = o.tenant_id
      LEFT JOIN users u ON u.id = sp.user_id AND u.tenant_id = sp.tenant_id
      LEFT JOIN LATERAL (
        -- Filière majoritaire de la commande : une commande peut en mêler
        -- plusieurs, on retient celle qui pèse le plus dans le montant.
        SELECT pr.name
        FROM professional_enrollments en
        JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
        JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
        JOIN programmes pr ON pr.id = ue.filiere_id AND pr.tenant_id = ue.tenant_id
        WHERE en.order_id = o.id AND en.tenant_id = o.tenant_id AND en.statut <> 'annulee'
        GROUP BY pr.name
        ORDER BY SUM(en.prix_unitaire) DESC
        LIMIT 1
      ) fil ON true
      WHERE p.tenant_id = $1::uuid
        AND p.statut = 'confirme'
        AND COALESCE(p.paid_at, p.created_at)::date BETWEEN $2::date AND $3::date
        AND ($4::text IS NULL OR p.mode = $4::text)
        AND ($5::text IS NULL OR (
              COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') ILIKE $5::text
           OR COALESCE(sp.student_matricule, '') ILIKE $5::text
           OR COALESCE(sp.student_number, '') ILIKE $5::text
           OR COALESCE(p.receipt_number, '') ILIKE $5::text
           OR COALESCE(o.reference, '') ILIKE $5::text))`;

    const params = [tenantId, from, to, mode, search];

    const totalsRows = await safeRows<Row>(
      client,
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(p.montant), 0)::float8 AS total ${base}`,
      params,
      log,
      "cashRegisterTotals"
    );

    const rows = await safeRows<Row>(
      client,
      `SELECT
         p.id,
         COALESCE(p.paid_at, p.created_at) AS paid_at,
         p.receipt_number,
         p.mode,
         p.montant::float8 AS montant,
         o.reference AS order_reference,
         sp.student_matricule,
         sp.student_number,
         TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS student_name,
         fil.name AS filiere_name
       ${base}
       ORDER BY COALESCE(p.paid_at, p.created_at) DESC, p.id
       LIMIT $6 OFFSET $7`,
      [...params, pageSize, (page - 1) * pageSize],
      log,
      "cashRegisterRows"
    );

    return {
      dateDebut: from,
      dateFin: to,
      rows: rows.map((r) => ({
        paymentId: String(r.id),
        paidAt: new Date(r.paid_at as string).toISOString(),
        receiptNumber: (r.receipt_number as string | null) ?? null,
        studentName: String(r.student_name || "").trim() || "Étudiant inconnu",
        matricule:
          (r.student_matricule as string | null) ?? (r.student_number as string | null) ?? null,
        filiereName: (r.filiere_name as string | null) ?? null,
        orderReference: (r.order_reference as string | null) ?? null,
        mode: String(r.mode ?? "autre"),
        modeLabel: modeLabel(String(r.mode ?? "autre")),
        amount: round0(num(r.montant)),
      })),
      totalAmount: round0(num(totalsRows[0]?.total)),
      totalCount: Math.round(num(totalsRows[0]?.n)),
      page,
      pageSize,
    };
  } finally {
    client.release();
  }
}

/** Journal de caisse au format CSV, pour la pièce comptable mensuelle. */
export function buildOwnerCashRegisterCsv(data: OwnerCashRegisterResponse): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(`Journal de caisse du ${data.dateDebut} au ${data.dateFin}`);
  lines.push(`Total encaissé;${data.totalAmount}`);
  lines.push(`Nombre d'encaissements;${data.totalCount}`);
  lines.push("");
  lines.push("Date;Reçu;Étudiant;Matricule;Filière;Commande;Mode;Montant");
  for (const r of data.rows) {
    lines.push(
      [
        new Date(r.paidAt).toLocaleDateString("fr-FR"),
        esc(r.receiptNumber ?? "—"),
        esc(r.studentName),
        esc(r.matricule ?? ""),
        esc(r.filiereName ?? ""),
        esc(r.orderReference ?? ""),
        esc(r.modeLabel),
        r.amount,
      ].join(";")
    );
  }
  return lines.join("\n");
}
