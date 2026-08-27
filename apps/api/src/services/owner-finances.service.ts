import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerFinancesPeriod, OwnerFinancesResponse } from "@ecoledigitale/contracts";
import { PRO_ORDER_DATES_CTE } from "./owner-pro-annee.sql";

/**
 * Encaissements : combien est rentré sur la période, et d'où.
 *
 * CE QUI A CHANGÉ, ET POURQUOI
 * Ce service ne lisait que le module scolaire — `payment_transactions` et
 * `student_tuition_installments`. Sur un établissement dont l'activité passe
 * par le module professionnel, il renvoyait donc zéro encaissement pendant que
 * la caisse encaissait. C'était l'inverse de la réalité, affiché sur le seul
 * écran qui porte le mot « Encaissements ».
 *
 * PUIS LA SCOLARITÉ EN EST SORTIE. L'écran ne décrit plus que le module
 * professionnel : les moitiés scolaires des totaux, la ventilation par cycle et
 * par classe, et la liste des échéances scolaires en retard ont été retirées.
 * Les laisser à zéro sur un établissement qui ne saisit pas de scolarité
 * revenait à afficher une contre-performance là où il n'y a pas de mesure.
 *
 * CE QUI N'Y EST PLUS
 * Le bloc des rémunérations enseignantes. C'est de l'argent qui sort, sur un
 * écran qui décrit ce qui rentre, et il ne suivait même pas la période
 * sélectionnée. Il a son écran — Masse salariale — filtrable et exportable.
 *
 * Chaque requête est indépendante et tolérante à l'échec : un bloc cassé
 * n'emporte pas les autres.
 */

export type OwnerFinancesQuery = {
  period: OwnerFinancesPeriod;
  /** Année scolaire dérivée « AAAA-AAAA+1 ». */
  anneeScolaire?: string;
  /** Restreint la moitié professionnelle. */
  filiereIds?: string[];
};

type Row = Record<string, unknown>;

async function safeQuery<T extends Row>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  log: FastifyBaseLogger | undefined,
  label: string
): Promise<T[]> {
  try {
    const r = await client.query<T>(sql, params);
    return r.rows;
  } catch (e) {
    log?.warn({ err: e, label }, "owner finances query failed");
    return [];
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Arrondi au franc : le FCFA n'a pas de subdivision en circulation. */
function franc(v: unknown): number {
  return Math.round(num(v));
}

function taux(collected: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.round((1000 * collected) / expected) / 10;
}

/**
 * Référence anonymisée d'un élève.
 *
 * Les listes d'impayés de cet écran sont consultées par le propriétaire, pas
 * par le service de recouvrement : le nom n'y ajoute rien et l'expose sans
 * raison. La liste nominative existe, elle, sur l'écran Impayés.
 */
export function anonymizeStudentRef(studentId: string): string {
  const hex = studentId.replace(/-/g, "");
  return `${hex.slice(0, 6).toUpperCase()}…`;
}

/* --------------------------- Fenêtre de la période ------------------------- */

function utc(y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0): Date {
  return new Date(Date.UTC(y, m, d, h, mi, s, ms));
}

/**
 * Bornes de la période demandée.
 *
 * `academic_year` suit la MÊME règle que partout ailleurs dans l'espace
 * propriétaire : du 1er septembre de N au 31 août de N+1, millésime pris dans
 * `anneeScolaire` ou déduit du jour. L'ancienne version lisait `academic_years`
 * et, faute d'identifiant, retombait sur le mois en cours — « année scolaire »
 * affichait donc un mois.
 */
export function resolveFinancesDateRange(query: OwnerFinancesQuery): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  if (query.period === "month") return { start: utc(y, m, 1), end: utc(y, m + 1, 0, 23, 59, 59, 999) };
  if (query.period === "quarter") {
    const q = Math.floor(m / 3) * 3;
    return { start: utc(y, q, 1), end: utc(y, q + 3, 0, 23, 59, 59, 999) };
  }
  if (query.period === "year") return { start: utc(y, 0, 1), end: utc(y, 11, 31, 23, 59, 59, 999) };

  // academic_year — pivot septembre, douze mois pleins.
  const n = query.anneeScolaire
    ? parseInt(query.anneeScolaire.slice(0, 4), 10)
    : m >= 8
      ? y
      : y - 1;
  return { start: utc(n, 8, 1), end: utc(n + 1, 7, 31, 23, 59, 59, 999) };
}

/* --------------------------------- Service -------------------------------- */

export async function fetchOwnerFinances(
  pool: Pool,
  tenantId: string,
  query: OwnerFinancesQuery,
  log?: FastifyBaseLogger
): Promise<OwnerFinancesResponse> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const { start, end } = resolveFinancesDateRange(query);
    // Même fenêtre, un an plus tôt : le calendrier scolaire est trop saisonnier
    // pour qu'un écart au mois précédent veuille dire quoi que ce soit.
    const startPrev = new Date(start);
    startPrev.setUTCFullYear(startPrev.getUTCFullYear() - 1);
    const endPrev = new Date(end);
    endPrev.setUTCFullYear(endPrev.getUTCFullYear() - 1);

    const filieres = query.filiereIds?.length ? query.filiereIds : null;
    /* ---- Ce que le module professionnel a réellement à offrir ------------- */
    // Mesuré une fois, sans filtre : une source vide doit être annoncée comme
    // non alimentée, jamais lue comme une contre-performance.
    const couvRows = await safeQuery<Row>(
      client,
      `SELECT (SELECT COUNT(*) FROM professional_payments WHERE tenant_id = $1::uuid)
            + (SELECT COUNT(*) FROM professional_orders WHERE tenant_id = $1::uuid) AS pro`,
      [tenantId],
      log,
      "couverture"
    );

    /* ---- Totaux du module professionnel ----------------------------------- */
    const totalRows = await safeQuery<Row>(
      client,
      `WITH ${PRO_ORDER_DATES_CTE},
       pro AS (
         SELECT COALESCE(SUM(pp.montant), 0)::float8 AS collected
           FROM professional_payments pp
           JOIN pro_order_dates d ON d.order_id = pp.order_id
          WHERE pp.tenant_id = $1::uuid
            AND pp.statut = 'confirme'
            AND d.debut BETWEEN $2 AND $3
       ),
       pro_prev AS (
         SELECT COALESCE(SUM(pp.montant), 0)::float8 AS collected
           FROM professional_payments pp
           JOIN pro_order_dates d ON d.order_id = pp.order_id
          WHERE pp.tenant_id = $1::uuid
            AND pp.statut = 'confirme'
            AND d.debut BETWEEN $4 AND $5
       ),
       pro_att AS (
         SELECT COALESCE(SUM(po.montant_total), 0)::float8 AS expected
           FROM professional_orders po
           JOIN pro_order_dates d ON d.order_id = po.id
          WHERE po.tenant_id = $1::uuid
            AND po.statut <> 'annulee'
            AND d.debut BETWEEN $2 AND $3
       )
       SELECT pro.collected AS pro_collected, pro_att.expected AS pro_expected,
              pro_prev.collected AS prev_collected
         FROM pro, pro_att, pro_prev`,
      // `filieres` n'est PAS passé ici : cette requête ne le référence pas, et un
      // paramètre non cité empêche Postgres d'en déduire le type — la requête
      // échouait silencieusement, tous les totaux revenaient à zéro pendant que
      // les ventilations, elles, affichaient 102 millions.
      [tenantId, start, end, startPrev, endPrev],
      log,
      "totaux"
    );
    const t = totalRows[0] ?? {};

    /* ---- Courbe mensuelle ------------------------------------------------- */
    // Le filtre de filière s'applique ici aussi, par appartenance de la commande
    // — sinon la courbe raconterait un périmètre plus large que les totaux
    // affichés juste au-dessus d'elle.
    const monthlyRows = await safeQuery<Row>(
      client,
      `WITH ${PRO_ORDER_DATES_CTE},
       mois AS (
         SELECT generate_series(date_trunc('month', $2::timestamptz),
                                date_trunc('month', $3::timestamptz),
                                INTERVAL '1 month') AS m
       )
       SELECT to_char(mois.m, 'YYYY-MM') AS month,
              to_char(mois.m, 'TMMon YYYY') AS label,
              COALESCE((SELECT SUM(pp.montant) FROM professional_payments pp
                         JOIN pro_order_dates d ON d.order_id = pp.order_id
                         WHERE pp.tenant_id = $1::uuid
                           AND pp.statut = 'confirme'
                           -- Mois de la CLASSE OUVERTE, pas du versement.
                           AND date_trunc('month', d.debut) = mois.m
                           AND ($4::uuid[] IS NULL OR EXISTS (
                                 SELECT 1
                                   FROM professional_enrollments pe
                                   JOIN professional_ue_sessions s ON s.id = pe.ue_session_id AND s.tenant_id = pe.tenant_id
                                   JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
                                  WHERE pe.order_id = pp.order_id
                                    AND pe.tenant_id = pp.tenant_id
                                    AND ue.filiere_id = ANY($4::uuid[])))), 0)::float8 AS professionnel
         FROM mois
        ORDER BY mois.m`,
      [tenantId, start, end, filieres],
      log,
      "courbe"
    );

    /* ---- Professionnel : par filière -------------------------------------- */
    // Le rattachement passe par les inscriptions de la commande : une commande
    // peut porter des UE de plusieurs filières, on répartit donc au prorata du
    // nombre d'inscriptions plutôt que d'attribuer le tout à la première.
    const byFiliereRows = await safeQuery<Row>(
      client,
      `WITH ${PRO_ORDER_DATES_CTE},
       lignes AS (
         SELECT po.id AS order_id,
                pr.id AS filiere_id,
                COALESCE(pr.name, 'Sans filière') AS filiere_name,
                COUNT(*)::float8 AS n
           FROM professional_orders po
           JOIN pro_order_dates od ON od.order_id = po.id
           JOIN professional_enrollments pe ON pe.order_id = po.id AND pe.tenant_id = po.tenant_id
           JOIN professional_ue_sessions s ON s.id = pe.ue_session_id AND s.tenant_id = pe.tenant_id
           JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
           LEFT JOIN programmes pr ON pr.id = ue.filiere_id AND pr.tenant_id = ue.tenant_id
          WHERE po.tenant_id = $1::uuid
            AND po.statut <> 'annulee'
            AND od.debut BETWEEN $2 AND $3
            AND ($4::uuid[] IS NULL OR pr.id = ANY($4::uuid[]))
          GROUP BY po.id, pr.id, pr.name
       ),
       parts AS (
         SELECT l.*, l.n / SUM(l.n) OVER (PARTITION BY l.order_id) AS part FROM lignes l
       )
       SELECT p.filiere_id, p.filiere_name,
              COALESCE(SUM(po.montant_total * p.part), 0)::float8 AS expected,
              COALESCE(SUM(
                p.part * (SELECT COALESCE(SUM(pp.montant), 0) FROM professional_payments pp
                           WHERE pp.order_id = po.id AND pp.tenant_id = po.tenant_id
                             AND pp.statut = 'confirme')
              ), 0)::float8 AS collected
         FROM parts p
         JOIN professional_orders po ON po.id = p.order_id AND po.tenant_id = $1::uuid
        GROUP BY p.filiere_id, p.filiere_name
        ORDER BY expected DESC`,
      [tenantId, start, end, filieres],
      log,
      "parFiliere"
    );

    /* ---- Professionnel : par mode de règlement ---------------------------- */
    const byModeRows = await safeQuery<Row>(
      client,
      `WITH ${PRO_ORDER_DATES_CTE}
       SELECT pp.mode::text AS mode,
              COUNT(*)::int AS n,
              COALESCE(SUM(pp.montant), 0)::float8 AS amount
         FROM professional_payments pp
         JOIN pro_order_dates d ON d.order_id = pp.order_id
        WHERE pp.tenant_id = $1::uuid
          AND pp.statut = 'confirme'
          AND d.debut BETWEEN $2 AND $3
        GROUP BY pp.mode
        ORDER BY amount DESC`,
      [tenantId, start, end],
      log,
      "parMode"
    );

    /**
     * Total professionnel : deux calculs, et c'est délibéré.
     *
     * Sans filtre de filière, on prend la somme directe des paiements — la plus
     * juste, car elle compte aussi les commandes qu'aucune inscription ne
     * rattache à une filière.
     *
     * Avec un filtre, on prend la SOMME DES LIGNES de la ventilation. La
     * requête des totaux ne sait pas répartir une commande multi-filières au
     * prorata ; si elle appliquait la règle grossière « la commande compte en
     * entier dès qu'une de ses UE touche la filière », le total afficherait
     * plus que la somme des lignes juste en dessous. Un écran où le total
     * contredit son propre tableau est pire qu'un écran approximatif.
     */
    const filtreFiliere = filieres !== null;
    const collectedPro = filtreFiliere
      ? byFiliereRows.reduce((s, r) => s + franc(r.collected), 0)
      : franc(t.pro_collected);
    const expectedPro = filtreFiliere
      ? byFiliereRows.reduce((s, r) => s + franc(r.expected), 0)
      : franc(t.pro_expected);
    const collected = collectedPro;
    const expected = expectedPro;

    return {
      period: query.period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      anneeScolaire: query.anneeScolaire ?? null,
      filiereIds: query.filiereIds ?? [],
      couverture: {
        professionnelAlimente: num(couvRows[0]?.pro) > 0,
      },
      totals: {
        collected,
        expected,
        recoveryRate: taux(collected, expected),
        collectedPreviousYear: franc(t.prev_collected),
      },
      monthly: monthlyRows.map((r) => ({
        month: String(r.month),
        label: String(r.label),
        professionnel: franc(r.professionnel),
        total: franc(r.professionnel),
      })),
      byFiliere: byFiliereRows.map((r) => ({
        filiereId: (r.filiere_id as string) ?? null,
        filiereName: String(r.filiere_name),
        expected: franc(r.expected),
        collected: franc(r.collected),
        recoveryRate: taux(franc(r.collected), franc(r.expected)) ?? 0,
      })),
      byMode: byModeRows.map((r) => ({
        mode: String(r.mode ?? "autre"),
        label: MODE_LABELS[String(r.mode ?? "")] ?? String(r.mode ?? "Autre"),
        amount: franc(r.amount),
        count: Math.round(num(r.n)),
      })),
    };
  } finally {
    client.release();
  }
}

const MODE_LABELS: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement",
  cheque: "Chèque",
  autre: "Autre",
};

/* ---------------------- Rapport financier (/owner/rapports) ---------------- */

function escapeCsv(s: string): string {
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fmtFr = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);

/** Module professionnel seul, dans l'ordre de l'écran. */
export function buildOwnerFinancialReportCsv(data: OwnerFinancesResponse): string {
  const lines: string[] = [];
  lines.push("Rapport financier (propriétaire) — module professionnel");
  lines.push(`Période;${data.period}`);
  lines.push(`Du;${data.periodStart.slice(0, 10)}`);
  lines.push(`Au;${data.periodEnd.slice(0, 10)}`);
  lines.push(`Année scolaire;${data.anneeScolaire ?? "Toutes"}`);
  lines.push("");
  lines.push("Indicateur;Valeur");
  lines.push(`Encaissé;${data.totals.collected}`);
  lines.push(`Attendu;${data.totals.expected}`);
  lines.push(`Taux de recouvrement (%);${data.totals.recoveryRate ?? ""}`);
  lines.push(`Encaissé sur la même période l'an dernier;${data.totals.collectedPreviousYear}`);
  if (!data.couverture.professionnelAlimente) {
    lines.push("Avertissement;Aucune donnée professionnelle saisie");
  }
  lines.push("");
  lines.push("Mois;Encaissé");
  for (const m of data.monthly) {
    lines.push(`${escapeCsv(m.label)};${m.professionnel}`);
  }
  lines.push("");
  lines.push("Filière;Attendu;Encaissé;Taux (%)");
  for (const r of data.byFiliere) {
    lines.push(`${escapeCsv(r.filiereName)};${r.expected};${r.collected};${r.recoveryRate}`);
  }
  lines.push("");
  lines.push("Mode de règlement;Règlements;Montant");
  for (const r of data.byMode) {
    lines.push(`${escapeCsv(r.label)};${r.count};${r.amount}`);
  }
  return lines.join("\n");
}

export function buildOwnerFinancialReportHtml(data: OwnerFinancesResponse): string {
  const tbl = (entetes: string[], lignes: string[][]) =>
    `<table><thead><tr>${entetes.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${
      lignes.length
        ? lignes
            .map((l) => `<tr>${l.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
            .join("")
        : `<tr><td colspan="${entetes.length}" class="muted">Aucune donnée</td></tr>`
    }</tbody></table>`;

  const avertissements = data.couverture.professionnelAlimente
    ? ""
    : "<p class=\"warn\">Aucune donnée professionnelle n'est saisie.</p>";

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"/><title>Rapport financier</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px}h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}th{background:#f4f4f4}.muted{color:#666;font-size:12px}.warn{background:#fff7ed;border:1px solid #fdba74;padding:8px;font-size:12px}</style>
</head><body>
<h1>Rapport financier — encaissements du module professionnel</h1>
<p class="muted">Du ${data.periodStart.slice(0, 10)} au ${data.periodEnd.slice(0, 10)}${
    data.anneeScolaire ? ` · année ${escapeHtml(data.anneeScolaire)}` : ""
  }</p>
${avertissements}
<h2>Synthèse</h2>
${tbl(
  ["Indicateur", "Montant"],
  [
    ["Encaissé", fmtFr(data.totals.collected)],
    ["Attendu", fmtFr(data.totals.expected)],
  ]
)}
<ul>
<li>Taux de recouvrement : ${data.totals.recoveryRate === null ? "non mesuré" : `${data.totals.recoveryRate} %`}</li>
<li>Même période l'an dernier : ${fmtFr(data.totals.collectedPreviousYear)}</li>
</ul>
<h2>Encaissements par mois</h2>
${tbl(
  ["Mois", "Encaissé"],
  data.monthly.map((m) => [m.label, fmtFr(m.professionnel)])
)}
<h2>Recouvrement par filière</h2>
${tbl(
  ["Filière", "Attendu", "Encaissé", "Taux"],
  data.byFiliere.map((r) => [
    r.filiereName,
    fmtFr(r.expected),
    fmtFr(r.collected),
    `${r.recoveryRate} %`,
  ])
)}
<h2>Modes de règlement</h2>
${tbl(
  ["Mode", "Règlements", "Montant"],
  data.byMode.map((r) => [r.label, String(r.count), fmtFr(r.amount)])
)}
<p class="muted">Document généré le ${new Date().toLocaleString("fr-FR")}</p>
</body></html>`;
}
