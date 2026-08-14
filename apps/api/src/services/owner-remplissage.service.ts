import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerRemplissageQuery,
  OwnerRemplissageResponse,
} from "@ecoledigitale/contracts/src/owner-stats.schema";

/**
 * Remplissage et planning.
 *
 * Deuxième question d'un propriétaire, après l'argent : « est-ce que les
 * effectifs tiennent, et est-ce que la machine est prête à tourner ? »
 *
 * Le paradoxe que cet écran corrige : `capacite_max` et l'effectif inscrit
 * transitent DÉJÀ dans les réponses d'API que consomme l'administration, et ne
 * sont affichés nulle part. On décide donc d'ouvrir ou de fermer une cohorte
 * sans jamais voir son taux de remplissage — alors qu'une cohorte vide
 * immobilise une salle, un enseignant et une ligne de planning.
 *
 * Quatre lectures :
 *
 *   1. REMPLISSAGE des cohortes professionnelles et des classes scolaires, trié
 *      par risque croissant : ce qu'il faut arbitrer avant la date de début ;
 *   2. CONFLITS de planning — même salle ou même enseignant sur deux créneaux
 *      qui se chevauchent. Rien ne les détecte aujourd'hui, ni à la saisie ni
 *      après : le conflit se découvre en salle, devant les étudiants ;
 *   3. COMPLÉTUDE du planning : créneaux sans salle, sans enseignant, et part
 *      des ECUE d'un semestre qui n'ont toujours pas d'horaire. C'est
 *      l'indicateur « prêt pour la rentrée », qui doit atteindre zéro à J-7 ;
 *   4. ÉCART entre les heures planifiées et les heures réellement tenues, qui
 *      mesure le respect du programme.
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
    log.warn({ err: e, label }, "owner remplissage query failed");
    return [];
  }
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Taux en %, `null` quand la capacité n'est pas renseignée — pas 0. */
function rate(part: number, whole: number): number | null {
  if (!whole || whole <= 0) return null;
  return round1((100 * part) / whole);
}

/** Nombre de lignes détaillées renvoyées par tableau. */
const ROWS_LIMIT = 100;

/**
 * Deux créneaux se chevauchent quand ils tombent le même jour de semaine, que
 * leurs plages horaires se croisent ET que leurs périodes de validité se
 * recouvrent. Oublier la troisième condition ferait remonter comme conflit deux
 * cours qui se succèdent sur deux semestres différents.
 */
const OVERLAP_CONDITION = `
  b.jour = a.jour
  AND a.heure_debut < b.heure_fin
  AND b.heure_debut < a.heure_fin
  AND COALESCE(a.date_debut, '-infinity'::date) <= COALESCE(b.date_fin, 'infinity'::date)
  AND COALESCE(b.date_debut, '-infinity'::date) <= COALESCE(a.date_fin, 'infinity'::date)`;

const JOURS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function hhmm(v: unknown): string {
  const s = String(v ?? "");
  return s.slice(0, 5);
}

/* --------------------------------- Service -------------------------------- */

export async function fetchOwnerRemplissage(
  pool: Pool,
  tenantId: string,
  query: OwnerRemplissageQuery,
  log: FastifyBaseLogger
): Promise<OwnerRemplissageResponse> {
  const filiereIds = query.filiereIds && query.filiereIds.length > 0 ? query.filiereIds : null;
  const client = await pool.connect();

  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- Cohortes professionnelles --------------------------------------- */
    // Périmètre : tout ce qui n'est ni terminé ni annulé. Une cohorte terminée
    // n'appelle plus d'arbitrage, elle n'a plus rien à remplir.
    const cohorteRows = await safeRows<Row>(
      client,
      `SELECT
         s.id, s.libelle, s.date_debut, s.date_fin, s.statut,
         s.capacite_max,
         u.code AS ue_code, u.libelle AS ue_libelle,
         u.filiere_id,
         pr.name AS filiere_name,
         (s.date_debut - CURRENT_DATE) AS jours_avant_debut,
         (SELECT COUNT(*) FROM professional_enrollments pe
           WHERE pe.ue_session_id = s.id
             AND pe.tenant_id = s.tenant_id
             AND pe.statut <> 'annulee')::int AS inscrits
       FROM professional_ue_sessions s
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       LEFT JOIN programmes pr ON pr.id = u.filiere_id AND pr.tenant_id = u.tenant_id
       WHERE s.tenant_id = $1::uuid
         AND s.statut NOT IN ('termine', 'annule')
         AND ($2::uuid[] IS NULL OR u.filiere_id = ANY($2::uuid[]))
       ORDER BY s.date_debut NULLS LAST
       LIMIT ${ROWS_LIMIT}`,
      [tenantId, filiereIds],
      log,
      "cohortes"
    );

    const cohortes = cohorteRows
      .map((r) => {
        const capacite = r.capacite_max === null ? null : Math.round(num(r.capacite_max));
        const inscrits = Math.round(num(r.inscrits));
        return {
          sessionId: String(r.id),
          libelle: String(r.libelle ?? ""),
          ueCode: String(r.ue_code ?? ""),
          ueLibelle: String(r.ue_libelle ?? ""),
          filiereName: (r.filiere_name as string | null) ?? null,
          statut: String(r.statut ?? ""),
          dateDebut: r.date_debut ? String(r.date_debut).slice(0, 10) : null,
          dateFin: r.date_fin ? String(r.date_fin).slice(0, 10) : null,
          joursAvantDebut: r.jours_avant_debut === null ? null : Math.round(num(r.jours_avant_debut)),
          capacite,
          inscrits,
          tauxRemplissage: capacite ? rate(inscrits, capacite) : null,
        };
      })
      // Le plus critique d'abord : une cohorte vide qui démarre dans 3 jours
      // passe avant une cohorte à moitié pleine qui démarre dans 2 mois.
      .sort((a, b) => {
        const ra = a.tauxRemplissage ?? 999;
        const rb = b.tauxRemplissage ?? 999;
        if (ra !== rb) return ra - rb;
        return (a.joursAvantDebut ?? 9999) - (b.joursAvantDebut ?? 9999);
      });

    /* ---- Classes scolaires ------------------------------------------------ */
    const classeRows = await safeRows<Row>(
      client,
      `SELECT
         c.id, c.name, c.code, c.max_students,
         pr.name AS filiere_name, cy.name AS cycle_name,
         (SELECT COUNT(*) FROM student_enrollments se
           WHERE se.class_id = c.id
             AND se.tenant_id = c.tenant_id
             AND se.status = 'active'::enrollment_status)::int AS effectif
       FROM classes c
       JOIN academic_years a ON a.id = c.academic_year_id AND a.tenant_id = c.tenant_id
       LEFT JOIN programmes pr ON pr.id = c.programme_id AND pr.tenant_id = c.tenant_id
       LEFT JOIN cycles cy ON cy.id = pr.cycle_id AND cy.tenant_id = pr.tenant_id
       WHERE c.tenant_id = $1::uuid
         AND a.is_active
         AND ($2::uuid[] IS NULL OR c.programme_id = ANY($2::uuid[]))
       ORDER BY cy.name NULLS LAST, c.name
       LIMIT ${ROWS_LIMIT}`,
      [tenantId, filiereIds],
      log,
      "classes"
    );

    const classes = classeRows.map((r) => {
      const capacite = r.max_students === null ? null : Math.round(num(r.max_students));
      const effectif = Math.round(num(r.effectif));
      return {
        classId: String(r.id),
        name: String(r.name ?? ""),
        code: (r.code as string | null) ?? null,
        filiereName: (r.filiere_name as string | null) ?? null,
        cycleName: (r.cycle_name as string | null) ?? null,
        capacite,
        effectif,
        tauxRemplissage: capacite ? rate(effectif, capacite) : null,
      };
    });

    /* ---- Conflits de planning --------------------------------------------- */
    // `b.id > a.id` : sans cette borne, chaque conflit remonterait deux fois,
    // une fois dans chaque sens.
    const conflitRows = await safeRows<Row>(
      client,
      `SELECT
         a.id AS a_id, b.id AS b_id,
         CASE WHEN a.classroom_id IS NOT NULL AND a.classroom_id = b.classroom_id
              THEN 'salle' ELSE 'enseignant' END AS type,
         a.jour,
         a.heure_debut AS a_debut, a.heure_fin AS a_fin,
         b.heure_debut AS b_debut, b.heure_fin AS b_fin,
         cr.name AS classroom_name,
         TRIM(COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '')) AS teacher_name,
         ea.libelle AS ecue_a, eb.libelle AS ecue_b,
         ua.code AS ue_a, ub.code AS ue_b
       FROM professional_emploi_temps a
       JOIN professional_emploi_temps b
         ON b.tenant_id = a.tenant_id
        AND b.id > a.id
        AND ${OVERLAP_CONDITION}
        AND (
          (a.classroom_id IS NOT NULL AND a.classroom_id = b.classroom_id)
          OR (a.enseignant_id IS NOT NULL AND a.enseignant_id = b.enseignant_id)
        )
       LEFT JOIN classrooms cr ON cr.id = a.classroom_id AND cr.tenant_id = a.tenant_id
       LEFT JOIN teachers t ON t.id = a.enseignant_id AND t.tenant_id = a.tenant_id
       LEFT JOIN professional_ecue ea ON ea.id = a.ecue_id AND ea.tenant_id = a.tenant_id
       LEFT JOIN professional_ecue eb ON eb.id = b.ecue_id AND eb.tenant_id = b.tenant_id
       LEFT JOIN professional_ue_sessions sa ON sa.id = a.ue_session_id AND sa.tenant_id = a.tenant_id
       LEFT JOIN professional_ue ua ON ua.id = sa.ue_id AND ua.tenant_id = sa.tenant_id
       LEFT JOIN professional_ue_sessions sb ON sb.id = b.ue_session_id AND sb.tenant_id = b.tenant_id
       LEFT JOIN professional_ue ub ON ub.id = sb.ue_id AND ub.tenant_id = sb.tenant_id
       WHERE a.tenant_id = $1::uuid
       ORDER BY a.jour, a.heure_debut
       LIMIT ${ROWS_LIMIT}`,
      [tenantId],
      log,
      "conflitsPlanning"
    );

    const conflits = conflitRows.map((r) => ({
      type: String(r.type) as "salle" | "enseignant",
      jour: JOURS[Math.round(num(r.jour))] ?? String(r.jour),
      plageA: `${hhmm(r.a_debut)}–${hhmm(r.a_fin)}`,
      plageB: `${hhmm(r.b_debut)}–${hhmm(r.b_fin)}`,
      ressource:
        String(r.type) === "salle"
          ? ((r.classroom_name as string | null) ?? "Salle inconnue")
          : ((r.teacher_name as string | null)?.trim() || "Enseignant inconnu"),
      coursA: `${r.ue_a ?? "?"} · ${r.ecue_a ?? "ECUE inconnue"}`,
      coursB: `${r.ue_b ?? "?"} · ${r.ecue_b ?? "ECUE inconnue"}`,
    }));

    /* ---- Complétude du planning ------------------------------------------- */
    const gapRows = await safeRows<Row>(
      client,
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE classroom_id IS NULL)::int AS sans_salle,
         COUNT(*) FILTER (WHERE enseignant_id IS NULL)::int AS sans_enseignant
       FROM professional_emploi_temps
       WHERE tenant_id = $1::uuid`,
      [tenantId],
      log,
      "creneauxIncomplets"
    );
    const gap = gapRows[0] ?? {};

    /* ---- Couverture du planning, par semestre ------------------------------ */
    // Le rattachement semestre → session emprunte les DEUX chemins existants
    // (par session et par UE), comme partout ailleurs dans le module.
    const couvertureRows = await safeRows<Row>(
      client,
      `WITH sem_sessions AS (
         SELECT DISTINCT sem.id AS semestre_id, sem.libelle, sem.filiere_id, s.id AS ue_session_id
         FROM professional_semestres sem
         JOIN professional_ue_sessions s
           ON s.tenant_id = sem.tenant_id
          AND (
            s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
            OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
          )
         WHERE sem.tenant_id = $1::uuid
           AND s.statut NOT IN ('termine', 'annule')
           AND ($2::uuid[] IS NULL OR sem.filiere_id = ANY($2::uuid[]))
       ),
       attendus AS (
         SELECT ss.semestre_id, ss.libelle, ss.filiere_id, ss.ue_session_id, l.ecue_id
         FROM sem_sessions ss
         JOIN professional_ue_sessions s ON s.id = ss.ue_session_id AND s.tenant_id = $1::uuid
         JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
       )
       SELECT
         a.semestre_id, a.libelle,
         pr.name AS filiere_name,
         COUNT(*)::int AS ecue_total,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM professional_emploi_temps et
            WHERE et.tenant_id = $1::uuid
              AND et.ue_session_id = a.ue_session_id
              AND et.ecue_id = a.ecue_id
         ))::int AS ecue_programmees
       FROM attendus a
       LEFT JOIN programmes pr ON pr.id = a.filiere_id AND pr.tenant_id = $1::uuid
       GROUP BY a.semestre_id, a.libelle, pr.name
       ORDER BY pr.name NULLS LAST, a.libelle
       LIMIT ${ROWS_LIMIT}`,
      [tenantId, filiereIds],
      log,
      "couverturePlanning"
    );

    const couverture = couvertureRows.map((r) => {
      const total = Math.round(num(r.ecue_total));
      const programmees = Math.round(num(r.ecue_programmees));
      return {
        semestreId: String(r.semestre_id),
        libelle: String(r.libelle ?? ""),
        filiereName: (r.filiere_name as string | null) ?? null,
        ecueTotal: total,
        ecueProgrammees: programmees,
        taux: rate(programmees, total),
      };
    });

    /* ---- Écart entre planifié et tenu, sur 30 jours ------------------------ */
    // On déroule le calendrier des 30 derniers jours et on compte, pour chaque
    // créneau hebdomadaire, ses occurrences réellement tombées dans sa période
    // de validité. Comparer une grille hebdomadaire à un volume mensuel sans ce
    // déroulé donnerait n'importe quoi.
    const ecartRows = await safeRows<Row>(
      client,
      `WITH jours AS (
         SELECT d::date AS d, EXTRACT(ISODOW FROM d)::int AS dow
         FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, INTERVAL '1 day') d
       ),
       planifie AS (
         SELECT COALESCE(SUM(
                  EXTRACT(EPOCH FROM (et.heure_fin - et.heure_debut)) / 3600.0
                ), 0)::float8 AS h
         FROM professional_emploi_temps et
         JOIN jours j
           ON j.dow = et.jour
          AND j.d >= COALESCE(et.date_debut, j.d)
          AND j.d <= COALESCE(et.date_fin, j.d)
         WHERE et.tenant_id = $1::uuid
           AND et.heure_debut IS NOT NULL AND et.heure_fin IS NOT NULL
       ),
       tenu AS (
         SELECT COALESCE(SUM(
                  EXTRACT(EPOCH FROM (s.heure_fin - s.heure_debut)) / 3600.0
                ), 0)::float8 AS h,
                COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE s.heure_debut IS NULL OR s.heure_fin IS NULL)::int AS n_sans_horaire
         FROM professional_ecue_seances s
         WHERE s.tenant_id = $1::uuid
           AND s.date >= CURRENT_DATE - 29
           AND s.date <= CURRENT_DATE
       )
       SELECT planifie.h AS planifie, tenu.h AS tenu, tenu.n AS seances, tenu.n_sans_horaire AS sans_horaire
       FROM planifie, tenu`,
      [tenantId],
      log,
      "ecartPlanifieTenu"
    );
    const ecart = ecartRows[0] ?? {};
    const heuresPlanifiees = round1(num(ecart.planifie));
    const heuresTenues = round1(num(ecart.tenu));

    /* ---- Totaux ------------------------------------------------------------ */
    const capaciteCohortes = cohortes.reduce((s, c) => s + (c.capacite ?? 0), 0);
    const inscritsCohortes = cohortes
      .filter((c) => c.capacite !== null)
      .reduce((s, c) => s + c.inscrits, 0);
    const capaciteClasses = classes.reduce((s, c) => s + (c.capacite ?? 0), 0);
    const effectifClasses = classes
      .filter((c) => c.capacite !== null)
      .reduce((s, c) => s + c.effectif, 0);

    return {
      computedAt: new Date().toISOString(),
      kpis: {
        cohortesActives: cohortes.length,
        cohortesVides: cohortes.filter((c) => c.inscrits === 0).length,
        cohortesSansCapacite: cohortes.filter((c) => c.capacite === null).length,
        tauxRemplissageCohortes: rate(inscritsCohortes, capaciteCohortes),
        classesActives: classes.length,
        tauxRemplissageClasses: rate(effectifClasses, capaciteClasses),
        conflitsPlanning: conflits.length,
        creneauxTotal: Math.round(num(gap.total)),
        creneauxSansSalle: Math.round(num(gap.sans_salle)),
        creneauxSansEnseignant: Math.round(num(gap.sans_enseignant)),
        heuresPlanifiees30j: heuresPlanifiees,
        heuresTenues30j: heuresTenues,
        tauxRespectPlanning: rate(heuresTenues, heuresPlanifiees),
        seancesSansHoraire30j: Math.round(num(ecart.sans_horaire)),
      },
      cohortes,
      classes,
      conflits,
      couverture,
    };
  } finally {
    client.release();
  }
}

/** Export CSV du remplissage des cohortes et des classes. */
export function buildOwnerRemplissageCsv(data: OwnerRemplissageResponse): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const pct = (v: number | null) => (v === null ? "capacité non renseignée" : String(v));
  const lines: string[] = [];

  lines.push("Cohortes professionnelles");
  lines.push("Filière;UE;Session;Statut;Début;Jours avant début;Inscrits;Capacité;Remplissage %");
  for (const c of data.cohortes) {
    lines.push(
      [
        esc(c.filiereName ?? ""),
        esc(c.ueCode),
        esc(c.libelle),
        esc(c.statut),
        c.dateDebut ?? "",
        c.joursAvantDebut ?? "",
        c.inscrits,
        c.capacite ?? "",
        pct(c.tauxRemplissage),
      ].join(";")
    );
  }

  lines.push("");
  lines.push("Classes");
  lines.push("Cycle;Filière;Classe;Effectif;Capacité;Remplissage %");
  for (const c of data.classes) {
    lines.push(
      [
        esc(c.cycleName ?? ""),
        esc(c.filiereName ?? ""),
        esc(c.name),
        c.effectif,
        c.capacite ?? "",
        pct(c.tauxRemplissage),
      ].join(";")
    );
  }

  lines.push("");
  lines.push("Conflits de planning");
  lines.push("Type;Ressource;Jour;Plage A;Cours A;Plage B;Cours B");
  for (const c of data.conflits) {
    lines.push(
      [
        c.type === "salle" ? "Salle" : "Enseignant",
        esc(c.ressource),
        c.jour,
        c.plageA,
        esc(c.coursA),
        c.plageB,
        esc(c.coursB),
      ].join(";")
    );
  }

  return lines.join("\n");
}
