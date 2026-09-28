import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerAssiduiteQuery, OwnerAssiduiteResponse } from "@ecoledigitale/contracts";
import { OUVERTURES_CTE, OUVERTURES_PERIMETRE_CTE } from "./owner-perimetre.sql";

/**
 * Assiduité, occupation des salles et charge enseignante du module professionnel.
 *
 * Trois jeux de données complets en base et aujourd'hui inexploités en agrégat.
 *
 * Deux sources distinctes, à ne pas confondre :
 *  - `professional_emploi_temps` = ce qui est PLANIFIÉ (grille hebdomadaire).
 *    C'est la source de vérité de l'emploi du temps : `professional_course_plannings`
 *    existe (migrations 0072/0073) mais l'UI admin n'y écrit pas.
 *  - `professional_ecue_seances` = ce qui a été TENU, avec le pointage associé
 *    dans `professional_ecue_attendance`.
 *
 * Pièges appliqués :
 *  - §4.4-5  double chemin semestre → sessions. ⚠️ Écart connu : les services
 *            d'emploi du temps ne passent que par `professional_semestre_sessions`.
 *            On applique ici le double chemin partout, y compris sur l'emploi du
 *            temps, pour ne pas sous-compter la charge.
 *  - §4.4-8  requêtage direct de `professional_ue_sessions`.
 *  - §4.4-11 `teachers.user_id` est nullable : un enseignant peut exister sans
 *            compte de connexion. On le remonte plutôt que de l'exclure.
 */

/**
 * Amplitude ouvrable retenue pour le taux d'occupation : 12 créneaux (08h→20h)
 * sur 6 jours. Constante assumée et exposée dans la réponse — sans elle, le taux
 * d'occupation n'est pas interprétable.
 */
export const OWNER_ASSIDUITE_OPEN_HOURS_PER_DAY = 12;
export const OWNER_ASSIDUITE_OPEN_DAYS = 6;
export const OWNER_ASSIDUITE_OPEN_HOURS_PER_WEEK =
  OWNER_ASSIDUITE_OPEN_HOURS_PER_DAY * OWNER_ASSIDUITE_OPEN_DAYS;

/** Profondeur par défaut de l'analyse, en semaines. */
export const OWNER_ASSIDUITE_DEFAULT_WEEKS = 12;

/** Nombre d'étudiants remontés dans le classement des absences. */
export const OWNER_ASSIDUITE_TOP_ABSENT = 20;

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
    log.warn({ err: e, label }, "owner assiduite query failed");
    return [];
  }
}

/**
 * Périmètre des sessions d'UE : filière + semestre.
 * $1 tenant, $2 filiereIds (uuid[] | null), $3 semestreId (uuid | null).
 *
 * `DISTINCT ON (s.id)` : une session rattachée par les deux chemins à la fois
 * apparaîtrait deux fois et doublerait chaque heure comptée.
 */
const SESSION_SCOPE_CTE = `
  ${OUVERTURES_CTE},
  ${OUVERTURES_PERIMETRE_CTE},
  /*
     Les ouvertures du périmètre, avec le nom de leur classe.

     Ce CTE refaisait le filtrage à la main et ne connaissait que la filière et
     le semestre : l'écran Présences était sourd à l'année scolaire comme à
     l'ouverture de classe, deux dimensions que le propriétaire voit pourtant
     dans sa barre de filtres.

     Le DISTINCT ON d'origine protégeait du doublon que produisait le double
     chemin du semestre, rattaché par session ET par UE. Le fragment partagé
     pose ce test en EXISTS : une ouverture y figure une fois, quels que soient
     ses rattachements, et les heures ne peuvent plus être comptées deux fois.
  */
  session_scope AS (
    SELECT op.ue_session_id, op.ue_id, op.filiere_id, p.name AS filiere_name
      FROM ouvertures_perimetre op
      JOIN programmes p ON p.id = op.filiere_id AND p.tenant_id = $1::uuid
  )`;

/** Durée d'une séance en heures, depuis ses bornes horaires. */
const SEANCE_HOURS = `
  EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0`;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchOwnerAssiduite(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerAssiduiteQuery
): Promise<OwnerAssiduiteResponse> {
  const filiereIds =
    filters.filiereIds && filters.filiereIds.length > 0 ? filters.filiereIds : null;
  const semestreId = filters.semestreId ?? null;
  const building = filters.building ?? null;

  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - OWNER_ASSIDUITE_DEFAULT_WEEKS * 7);

  const dateDebut = filters.dateDebut ?? isoDate(defaultStart);
  const dateFin = filters.dateFin ?? isoDate(today);

  // $1 tenant, $2 filiereIds, $3 semestreId, $4 début, $5 fin
  /*
     Contrat de owner-perimetre.sql, puis les bornes de dates propres à l'écran.
     L'ordre a changé : ce service plaçait la filière en $2 et le semestre en
     $3, là où le contrat partagé réserve $2 à l'année et $4 au nom de classe.
  */
  const nomClasse = filters.nomClasse?.trim() ? filters.nomClasse.trim() : null;
  const anneeScolaire = filters.anneeScolaire ?? null;
  const perimetre = [tenantId, anneeScolaire, filiereIds, nomClasse, semestreId];
  const scopeParams = [...perimetre, dateDebut, dateFin];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- KPI de présence et d'appels ---- */
    const attendanceKpi = await safeQuery<{
      total_records: string | number;
      presentish: string | number;
      absence_hours: string | number | null;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT COUNT(*)::int AS total_records,
              -- Un retard reste une présence : l'étudiant était là.
              COUNT(*) FILTER (WHERE a.statut IN ('present', 'retard'))::int AS presentish,
              COALESCE(SUM(${SEANCE_HOURS}) FILTER (WHERE a.statut = 'absent'), 0)::float8
                AS absence_hours
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se
            ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       WHERE a.tenant_id = $1::uuid
         AND se.date >= $6::date AND se.date <= $7::date`,
      scopeParams,
      log,
      "attendanceKpi"
    );

    const callKpi = await safeQuery<{
      total_seances: string | number;
      called: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT COUNT(*)::int AS total_seances,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM professional_ecue_attendance a
                WHERE a.seance_id = se.id AND a.tenant_id = se.tenant_id
              ))::int AS called
       FROM professional_ecue_seances se
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       WHERE se.tenant_id = $1::uuid
         AND se.date >= $6::date AND se.date <= $7::date
         -- Séances passées uniquement : une séance à venir sans appel est normale.
         AND se.date <= CURRENT_DATE`,
      scopeParams,
      log,
      "callKpi"
    );

    /* ---- Heures planifiées et occupation des salles ---- */
    const plannedKpi = await safeQuery<{
      planned_hours: string | number | null;
      active_rooms: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT (SELECT COALESCE(SUM(
                 EXTRACT(EPOCH FROM (et.heure_fin - et.heure_debut)) / 3600.0
               ), 0)::float8
               FROM professional_emploi_temps et
               JOIN session_scope sc2 ON sc2.ue_session_id = et.ue_session_id
               WHERE et.tenant_id = $1::uuid) AS planned_hours,
              (SELECT COUNT(*) FROM classrooms cr
                WHERE cr.tenant_id = $1::uuid
                  AND COALESCE(cr.is_active, true) = true
                  AND ($6::text IS NULL OR cr.building = $6::text))::int AS active_rooms`,
      // L'emploi du temps est une grille HEBDOMADAIRE : les bornes de dates ne
      // s'y appliquent pas. On ne les passe donc pas — PostgreSQL rejetterait un
      // paramètre fourni mais jamais référencé.
      [...perimetre, building],
      log,
      "plannedKpi"
    );

    /* ---- Assiduité par semaine et par filière (heatmap) ---- */
    const weekRows = await safeQuery<{
      week_start: Date | string;
      filiere_id: string;
      filiere_name: string;
      total_records: string | number;
      presentish: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT date_trunc('week', se.date)::date AS week_start,
              sc.filiere_id,
              sc.filiere_name,
              COUNT(*)::int AS total_records,
              COUNT(*) FILTER (WHERE a.statut IN ('present', 'retard'))::int AS presentish
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se
            ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       WHERE a.tenant_id = $1::uuid
         AND se.date >= $6::date AND se.date <= $7::date
       GROUP BY week_start, sc.filiere_id, sc.filiere_name
       ORDER BY week_start, sc.filiere_name`,
      scopeParams,
      log,
      "attendanceByWeek"
    );

    /* ---- Tendance globale du taux de présence ---- */
    const trendRows = await safeQuery<{
      week_start: Date | string;
      total_records: string | number;
      presentish: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT date_trunc('week', se.date)::date AS week_start,
              COUNT(*)::int AS total_records,
              COUNT(*) FILTER (WHERE a.statut IN ('present', 'retard'))::int AS presentish
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se
            ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       WHERE a.tenant_id = $1::uuid
         AND se.date >= $6::date AND se.date <= $7::date
       GROUP BY week_start
       ORDER BY week_start`,
      scopeParams,
      log,
      "presenceTrend"
    );

    /* ---- Étudiants les plus absents ---- */
    const absentRows = await safeQuery<{
      student_id: string;
      student_name: string;
      matricule: string | null;
      absence_hours: string | number | null;
      excused_hours: string | number | null;
      absence_count: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT a.student_id,
              TRIM(COALESCE(us.first_name, '') || ' ' || COALESCE(us.last_name, '')) AS student_name,
              sp.student_number AS matricule,
              COALESCE(SUM(${SEANCE_HOURS}) FILTER (WHERE a.statut = 'absent'), 0)::float8
                AS absence_hours,
              -- Les absences excusées sont distinguées, pas fondues dans le total.
              COALESCE(SUM(${SEANCE_HOURS}) FILTER (WHERE a.statut = 'excuse'), 0)::float8
                AS excused_hours,
              COUNT(*) FILTER (WHERE a.statut = 'absent')::int AS absence_count
       FROM professional_ecue_attendance a
       JOIN professional_ecue_seances se
            ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
       JOIN session_scope sc ON sc.ue_session_id = se.ue_session_id
       JOIN student_profiles sp ON sp.id = a.student_id AND sp.tenant_id = a.tenant_id
       JOIN users us ON us.id = sp.user_id AND us.tenant_id = sp.tenant_id
       WHERE a.tenant_id = $1::uuid
         AND se.date >= $6::date AND se.date <= $7::date
       GROUP BY a.student_id, us.first_name, us.last_name, sp.student_number
       HAVING COUNT(*) FILTER (WHERE a.statut = 'absent') > 0
       ORDER BY absence_hours DESC
       LIMIT $8::int`,
      [...scopeParams, OWNER_ASSIDUITE_TOP_ABSENT],
      log,
      "topAbsentStudents"
    );

    /* ---- Occupation des salles : jour × créneau ---- */
    const occupancyRows = await safeQuery<{
      jour: string | number;
      hour: string | number;
      occupied_rooms: string | number;
      active_rooms: string | number;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE},
       active_rooms AS (
         SELECT COUNT(*)::int AS n
         FROM classrooms cr
         WHERE cr.tenant_id = $1::uuid
           AND COALESCE(cr.is_active, true) = true
           AND ($6::text IS NULL OR cr.building = $6::text)
       )
       SELECT et.jour,
              -- Un créneau qui chevauche plusieurs heures est compté sur chacune :
              -- generate_series déplie la plage horaire réservée.
              h.hour,
              COUNT(DISTINCT et.classroom_id)::int AS occupied_rooms,
              (SELECT n FROM active_rooms) AS active_rooms
       FROM professional_emploi_temps et
       JOIN session_scope sc ON sc.ue_session_id = et.ue_session_id
       JOIN classrooms cr ON cr.id = et.classroom_id AND cr.tenant_id = et.tenant_id
       CROSS JOIN LATERAL generate_series(
         EXTRACT(HOUR FROM et.heure_debut)::int,
         GREATEST(EXTRACT(HOUR FROM et.heure_fin)::int - 1,
                  EXTRACT(HOUR FROM et.heure_debut)::int)
       ) AS h(hour)
       WHERE et.tenant_id = $1::uuid
         AND et.classroom_id IS NOT NULL
         AND ($6::text IS NULL OR cr.building = $6::text)
       GROUP BY et.jour, h.hour
       ORDER BY et.jour, h.hour`,
      [...perimetre, building],
      log,
      "roomOccupancy"
    );

    /* ---- Charge par enseignant ---- */
    const teacherRows = await safeQuery<{
      teacher_id: string;
      teacher_name: string;
      weekly_hours: string | number | null;
      ecue_count: string | number;
      filiere_count: string | number;
      has_user_account: boolean;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT t.id AS teacher_id,
              TRIM(t.first_name || ' ' || t.last_name) AS teacher_name,
              COALESCE(SUM(
                EXTRACT(EPOCH FROM (et.heure_fin - et.heure_debut)) / 3600.0
              ), 0)::float8 AS weekly_hours,
              COUNT(DISTINCT et.ecue_id)::int AS ecue_count,
              COUNT(DISTINCT sc.filiere_id)::int AS filiere_count,
              -- §4.4-11 : un enseignant peut n'avoir aucun compte de connexion.
              (t.user_id IS NOT NULL) AS has_user_account
       FROM professional_emploi_temps et
       JOIN session_scope sc ON sc.ue_session_id = et.ue_session_id
       JOIN teachers t ON t.id = et.enseignant_id AND t.tenant_id = et.tenant_id
       WHERE et.tenant_id = $1::uuid
       GROUP BY t.id, t.first_name, t.last_name, t.user_id
       ORDER BY weekly_hours DESC
       LIMIT 30`,
      perimetre,
      log,
      "teacherLoad"
    );

    /* ---- Usage des salles ---- */
    const roomRows = await safeQuery<{
      classroom_id: string;
      name: string;
      code: string;
      capacity: string | number;
      building: string | null;
      weekly_hours: string | number | null;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT cr.id AS classroom_id, cr.name, cr.code,
              cr.capacity, cr.building,
              /*
                 SEULES LES HEURES DU PÉRIMÈTRE SONT COMPTÉES.

                 Le LEFT JOIN sur session_scope joint sans exclure : les heures
                 de TOUTE l'école étaient additionnées quel que soit le filtre,
                 et la colonne affichait le même total sur une classe précise
                 que sur l'établissement entier. Le test porte donc sur la
                 somme, pas sur la jointure — c'est ce qui permet à une salle
                 hors périmètre de rester listée à 0 h, l'information même que
                 cet écran cherche.
              */
              COALESCE(SUM(
                CASE WHEN sc.ue_session_id IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (et.heure_fin - et.heure_debut)) / 3600.0
                     ELSE 0 END
              ), 0)::float8 AS weekly_hours
       FROM classrooms cr
       -- LEFT JOIN : une salle jamais utilisée doit apparaître à 0 h, c'est
       -- précisément l'information recherchée.
       LEFT JOIN professional_emploi_temps et
              ON et.classroom_id = cr.id AND et.tenant_id = cr.tenant_id
       LEFT JOIN session_scope sc ON sc.ue_session_id = et.ue_session_id
       WHERE cr.tenant_id = $1::uuid
         AND COALESCE(cr.is_active, true) = true
         AND ($6::text IS NULL OR cr.building = $6::text)
       GROUP BY cr.id, cr.name, cr.code, cr.capacity, cr.building
       ORDER BY weekly_hours ASC, cr.name`,
      [...perimetre, building],
      log,
      "roomUsage"
    );

    /* ---- ECUE obligatoires sans enseignant sur session ouverte ---- */
    const unassignedRows = await safeQuery<{
      ue_session_id: string;
      ue_code: string;
      ecue_id: string;
      ecue_code: string;
      ecue_libelle: string;
      filiere_name: string;
    }>(
      client,
      `WITH ${SESSION_SCOPE_CTE}
       SELECT s.id AS ue_session_id, u.code AS ue_code,
              e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
              sc.filiere_name
       FROM professional_ue_sessions s
       JOIN session_scope sc ON sc.ue_session_id = s.id
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
       JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
       WHERE s.tenant_id = $1::uuid
         AND s.statut IN ('ouvert', 'complet', 'en_cours')
         AND l.est_obligatoire = true
         AND NOT EXISTS (
           SELECT 1 FROM professional_session_ecue_teachers st
           WHERE st.ue_session_id = s.id AND st.ecue_id = e.id
             AND st.tenant_id = s.tenant_id
         )
       ORDER BY sc.filiere_name, u.code, e.code
       LIMIT 50`,
      perimetre,
      log,
      "unassignedEcue"
    );

    /* ---- Assemblage ---- */
    const att = attendanceKpi[0] ?? { total_records: 0, presentish: 0, absence_hours: 0 };
    const totalRecords = Number(att.total_records) || 0;
    const presentish = Number(att.presentish) || 0;

    const call = callKpi[0] ?? { total_seances: 0, called: 0 };
    const totalSeances = Number(call.total_seances) || 0;

    const planned = plannedKpi[0] ?? { planned_hours: 0, active_rooms: 0 };
    const plannedHours = Number(planned.planned_hours) || 0;
    const activeRooms = Number(planned.active_rooms) || 0;
    const roomCapacityHours = activeRooms * OWNER_ASSIDUITE_OPEN_HOURS_PER_WEEK;

    const rate = (num: number, den: number) =>
      den > 0 ? Math.round((num * 1000) / den) / 10 : 0;

    const dateOf = (d: Date | string) =>
      d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

    /* ---- Conduite ---------------------------------------------------------- */
    /*
       LA CONDUITE EST UNE NOTE, PAS UNE PRÉSENCE — mais elle vit ici.

       Elle se note sur une ECUE dédiée, repérée par le prédicat canonique du
       dépôt. Elle n'a ni enseignant ni prix : elle ne s'enseigne pas et ne se
       vend pas, l'administration l'attribue. Sa place est sur l'écran des
       présences parce qu'elle sanctionne le même comportement — l'assiduité et
       la tenue — et qu'un fondateur les lit ensemble.

       CE QUI BLOQUE : un étudiant inscrit SANS note de conduite empêche la
       génération de son bulletin. Ce n'est pas une anomalie de saisie qu'on
       signale pour la forme, c'est un relevé qui ne sortira pas.
    */
    const conduiteRows = await safeQuery<Record<string, unknown>>(
      client,
      `WITH ${SESSION_SCOPE_CTE},
       inscrits AS (
         SELECT DISTINCT en.student_id, sc.filiere_id
           FROM professional_enrollments en
           JOIN session_scope sc ON sc.ue_session_id = en.ue_session_id
          WHERE en.tenant_id = $1::uuid AND en.statut <> 'annulee'
       ),
       notes AS (
         SELECT sc.filiere_id, n.student_id, n.note
           FROM professional_ecue_notes n
           JOIN session_scope sc ON sc.ue_session_id = n.ue_session_id
           JOIN professional_ecue e ON e.id = n.ecue_id AND e.tenant_id = n.tenant_id
          WHERE n.tenant_id = $1::uuid
            AND (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
       )
       SELECT sc.filiere_id,
              MIN(sc.filiere_name) AS filiere_name,
              (SELECT COUNT(*) FROM notes nn
                WHERE nn.filiere_id = sc.filiere_id)::int              AS notes,
              (SELECT AVG(nn.note) FROM notes nn
                WHERE nn.filiere_id = sc.filiere_id)::float8           AS moyenne,
              (SELECT MIN(nn.note) FROM notes nn
                WHERE nn.filiere_id = sc.filiere_id)::float8           AS mini,
              (SELECT MAX(nn.note) FROM notes nn
                WHERE nn.filiere_id = sc.filiere_id)::float8           AS maxi,
              (SELECT COUNT(*) FROM notes nn
                WHERE nn.filiere_id = sc.filiere_id AND nn.note < 10)::int AS sous_la_moyenne,
              /* Inscrits de la classe sans AUCUNE note de conduite : autant de
                 bulletins qui ne pourront pas etre generes. */
              (SELECT COUNT(*) FROM inscrits i
                WHERE i.filiere_id = sc.filiere_id
                  AND NOT EXISTS (SELECT 1 FROM notes nn
                                   WHERE nn.student_id = i.student_id
                                     AND nn.filiere_id = i.filiere_id))::int AS sans_note,
              (SELECT COUNT(*) FROM inscrits i
                WHERE i.filiere_id = sc.filiere_id)::int               AS inscrits
         FROM session_scope sc
        GROUP BY sc.filiere_id
        ORDER BY MIN(sc.filiere_name)`,
      perimetre,
      log,
      "conduite"
    );

    return {
      dateDebut,
      dateFin,
      filiereIds: filiereIds ?? [],
      semestreId,
      building,
      openingHoursPerWeek: OWNER_ASSIDUITE_OPEN_HOURS_PER_WEEK,
      kpis: {
        presenceRate: rate(presentish, totalRecords),
        absenceHours: Math.round((Number(att.absence_hours) || 0) * 10) / 10,
        callRate: rate(Number(call.called) || 0, totalSeances),
        roomOccupancyRate: rate(plannedHours, roomCapacityHours),
        plannedHours: Math.round(plannedHours * 10) / 10,
      },
      attendanceByWeek: weekRows.map((r) => {
        const tot = Number(r.total_records) || 0;
        return {
          weekStart: dateOf(r.week_start),
          filiereId: r.filiere_id,
          filiereName: r.filiere_name,
          presentRate: rate(Number(r.presentish) || 0, tot),
          totalRecords: tot,
        };
      }),
      topAbsentStudents: absentRows.map((r) => ({
        studentId: r.student_id,
        studentName: r.student_name || "—",
        matricule: r.matricule,
        absenceHours: Math.round((Number(r.absence_hours) || 0) * 10) / 10,
        excusedHours: Math.round((Number(r.excused_hours) || 0) * 10) / 10,
        absenceCount: Number(r.absence_count) || 0,
      })),
      roomOccupancy: occupancyRows.map((r) => {
        const occupied = Number(r.occupied_rooms) || 0;
        const active = Number(r.active_rooms) || 0;
        return {
          jour: Number(r.jour) || 1,
          hour: Number(r.hour) || 0,
          occupiedRooms: occupied,
          rate: rate(occupied, active),
        };
      }),
      teacherLoad: teacherRows.map((r) => ({
        teacherId: r.teacher_id,
        teacherName: r.teacher_name || "—",
        weeklyHours: Math.round((Number(r.weekly_hours) || 0) * 10) / 10,
        ecueCount: Number(r.ecue_count) || 0,
        filiereCount: Number(r.filiere_count) || 0,
        hasUserAccount: Boolean(r.has_user_account),
      })),
      roomUsage: roomRows.map((r) => {
        const hours = Number(r.weekly_hours) || 0;
        return {
          classroomId: r.classroom_id,
          name: r.name,
          code: r.code,
          capacity: Number(r.capacity) || 0,
          building: r.building,
          weeklyHours: Math.round(hours * 10) / 10,
          occupancyRate: rate(hours, OWNER_ASSIDUITE_OPEN_HOURS_PER_WEEK),
        };
      }),
      unassignedEcue: unassignedRows.map((r) => ({
        ueSessionId: r.ue_session_id,
        ueCode: r.ue_code,
        ecueId: r.ecue_id,
        ecueCode: r.ecue_code,
        ecueLibelle: r.ecue_libelle,
        filiereName: r.filiere_name,
      })),
      presenceTrend: trendRows.map((r) => {
        const tot = Number(r.total_records) || 0;
        return {
          weekStart: dateOf(r.week_start),
          presentRate: rate(Number(r.presentish) || 0, tot),
          totalRecords: tot,
        };
      }),
      conduite: {
        parClasse: conduiteRows.map((r) => ({
          filiereId: r.filiere_id === null ? null : String(r.filiere_id),
          filiereName: String(r.filiere_name ?? "—"),
          inscrits: Math.round(Number(r.inscrits) || 0),
          notes: Math.round(Number(r.notes) || 0),
          /* NULL et non 0 : une moyenne sur aucune note n'existe pas, et un
             zéro se lirait « toute la classe a eu 0 de conduite ». */
          moyenne:
            r.moyenne === null || r.moyenne === undefined
              ? null
              : Math.round(Number(r.moyenne) * 100) / 100,
          mini: r.mini === null || r.mini === undefined ? null : Number(r.mini),
          maxi: r.maxi === null || r.maxi === undefined ? null : Number(r.maxi),
          sousLaMoyenne: Math.round(Number(r.sous_la_moyenne) || 0),
          sansNote: Math.round(Number(r.sans_note) || 0),
        })),
        notesTotal: conduiteRows.reduce((t, r) => t + (Number(r.notes) || 0), 0),
        /* Le seul chiffre actionnable de ce bloc : autant d'étudiants dont le
           bulletin ne peut pas être généré faute de note de conduite. */
        etudiantsSansNote: conduiteRows.reduce(
          (t, r) => t + (Number(r.sans_note) || 0),
          0
        ),
      },
    };
  } finally {
    client.release();
  }
}
