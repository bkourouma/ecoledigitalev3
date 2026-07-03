import type { PoolClient } from "pg";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
import {
  evaluerUe,
  moyenneSession,
  creditsValides as calcCreditsValides,
  creditsTotal as calcCreditsTotal,
  semestreValide as calcSemestreValide,
  arrondi,
  type EcueInput,
} from "./bulletin-calc";

/**
 * Service Bulletin — Module Professionnel (feature 030).
 *
 * Assemble, pour un étudiant et un semestre, le relevé complet :
 * UE → ECUE (moyenne devoirs, note examen, note ECUE, statut), moyenne de
 * session, crédits validés et décision. S'appuie sur les résultats persistés
 * (`professional_ecue_results`) et sur le moteur pur `bulletin-calc`.
 */

/** Sessions (cohortes) d'un semestre où l'étudiant est inscrit + composition. */
const BULLETIN_ROWS = `
  SELECT s.id AS ue_session_id, s.ue_id, s.date_debut::text AS session_date_debut,
         u.code AS ue_code, u.libelle AS ue_libelle, u.nb_uv::int AS nb_uv, u.categorie,
         e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
         e.credits::int AS credits, l.ordre,
         r.id AS result_id, r.moyenne::float8 AS moyenne,
         r.moyenne_devoirs::float8 AS moyenne_devoirs, r.note_examen::float8 AS note_examen,
         r.validee, r.validee_manuellement, r.eliminee
  FROM professional_ue_sessions s
  JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
  JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
  JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
  LEFT JOIN professional_ecue_results r ON r.ecue_id = e.id AND r.student_id = $3
       AND r.ue_session_id = s.id AND r.tenant_id = s.tenant_id
  JOIN professional_enrollments en ON en.ue_session_id = s.id AND en.student_id = $3
       AND en.tenant_id = s.tenant_id AND en.statut IN ('confirmee','terminee')
  WHERE s.tenant_id = $1
    AND NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
    AND (
      s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
               WHERE semestre_id = $2 AND tenant_id = $1)
      OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                     WHERE semestre_id = $2 AND tenant_id = $1)
    )
  ORDER BY u.code, l.ordre, e.code`;

export class ProfessionalBulletinService extends ProfessionalBaseService {
  /** Ids des cohortes rattachées à un semestre (pour recalcul). */
  async listSemestreSessionIds(
    tenantId: string,
    semestreId: string
  ): Promise<ServiceResult<string[]>> {
    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT DISTINCT s.id
         FROM professional_ue_sessions s
         WHERE s.tenant_id = $1
           AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = $2 AND tenant_id = $1)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = $2 AND tenant_id = $1)
           )`,
        [tenantId, semestreId]
      );
      return ok(r.rows.map((x) => x.id as string));
    });
  }

  /**
   * Filières pour la saisie des notes. Admin → toutes ; enseignant → celles
   * où il a au moins une ECUE affectée.
   */
  async listNotesFilieres(
    tenantId: string,
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (teacherUserId) {
        const r = await client.query(
          `SELECT DISTINCT p.id, p.name, p.code
           FROM professional_session_ecue_teachers a
           JOIN teachers t ON t.id = a.enseignant_id
           JOIN professional_ue_sessions s ON s.id = a.ue_session_id AND s.tenant_id = a.tenant_id
           JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
           JOIN programmes p ON p.id = u.filiere_id
           WHERE a.tenant_id = $1 AND t.user_id = $2
           ORDER BY p.name`,
          [tenantId, teacherUserId]
        );
        return ok(r.rows);
      }
      const r = await client.query(
        `SELECT id, name, code FROM programmes WHERE tenant_id = $1 ORDER BY name`,
        [tenantId]
      );
      return ok(r.rows);
    });
  }

  /**
   * Semestres d'une filière ayant au moins une session — pour la saisie.
   * Enseignant → uniquement les semestres où il enseigne.
   */
  async listNotesSemestres(
    tenantId: string,
    filiereId: string,
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [tenantId, filiereId];
      let teacherJoin = "";
      if (teacherUserId) {
        params.push(teacherUserId);
        teacherJoin = `AND sm.id IN (
          SELECT ss.semestre_id FROM professional_semestre_sessions ss
            JOIN professional_session_ecue_teachers a
              ON a.ue_session_id = ss.ue_session_id AND a.tenant_id = ss.tenant_id
            JOIN teachers t ON t.id = a.enseignant_id
            WHERE t.user_id = $3 AND ss.tenant_id = $1
          UNION
          SELECT su.semestre_id FROM professional_semestre_ue su
            JOIN professional_ue_sessions s ON s.ue_id = su.ue_id AND s.tenant_id = su.tenant_id
            JOIN professional_session_ecue_teachers a
              ON a.ue_session_id = s.id AND a.tenant_id = su.tenant_id
            JOIN teachers t ON t.id = a.enseignant_id
            WHERE t.user_id = $3 AND su.tenant_id = $1
        )`;
      }
      const r = await client.query(
        `SELECT sm.id, sm.libelle,
                (SELECT count(DISTINCT s.id)::int FROM professional_ue_sessions s
                 WHERE s.tenant_id = sm.tenant_id AND (
                   s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                            WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                   OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                                  WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                 )) AS nb_sessions
         FROM professional_semestres sm
         WHERE sm.tenant_id = $1 AND sm.filiere_id = $2 ${teacherJoin}
         ORDER BY sm.libelle`,
        params
      );
      return ok(r.rows.filter((x: any) => (x.nb_sessions ?? 0) > 0));
    });
  }

  /** Sessions (cohortes UE) d'un semestre, avec libellés — pour la saisie. */
  async listSemestreSessions(
    tenantId: string,
    semestreId: string,
    teacherUserId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [tenantId, semestreId];
      let teacherFilter = "";
      if (teacherUserId) {
        params.push(teacherUserId);
        teacherFilter = `AND s.id IN (
          SELECT a.ue_session_id FROM professional_session_ecue_teachers a
          JOIN teachers t ON t.id = a.enseignant_id
          WHERE t.user_id=$3 AND a.tenant_id=$1)`;
      }
      const r = await client.query(
        `SELECT DISTINCT s.id, s.ue_id, u.code AS ue_code, u.libelle AS ue_libelle,
                s.libelle AS session_libelle, s.statut,
                s.date_debut::text AS date_debut, s.date_fin::text AS date_fin,
                (SELECT count(*)::int FROM professional_enrollments en
                 WHERE en.ue_session_id = s.id AND en.statut IN ('confirmee','terminee')) AS nb_inscrits
         FROM professional_ue_sessions s
         JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
         WHERE s.tenant_id = $1
           AND u.libelle NOT ILIKE 'conduite%'
           AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = $2 AND tenant_id = $1)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = $2 AND tenant_id = $1)
           ) ${teacherFilter}
         ORDER BY u.code`,
        params
      );
      return ok(r.rows);
    });
  }

  /** Bulletin complet d'un étudiant pour un semestre. */
  async getBulletin(
    tenantId: string,
    semestreId: string,
    studentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sem = await this.loadSemestre(client, tenantId, semestreId);
      if (!sem) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");

      const stu = await client.query(
        `SELECT sp.id, u.first_name, u.last_name, sp.student_number AS matricule,
                sp.date_of_birth::text AS date_of_birth, sp.place_of_birth,
                sp.is_repeating, sp.gender
         FROM student_profiles sp JOIN users u ON u.id = sp.user_id
         WHERE sp.id = $1 AND sp.tenant_id = $2`,
        [studentId, tenantId]
      );
      if (stu.rowCount === 0) return fail("STUDENT_NOT_FOUND", "Étudiant introuvable.");

      const effectif = await this.countSemestreStudents(client, tenantId, semestreId);
      const bulletin = await this.computeStudentBulletin(client, tenantId, sem, stu.rows[0], effectif);
      bulletin.rang = await this.computeRang(client, tenantId, sem, studentId);
      return ok(bulletin);
    });
  }

  /** Semestres où l'étudiant (user_id) est inscrit — pour son sélecteur. */
  async listStudentSemestres(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT DISTINCT sm.id, sm.libelle, p.name AS filiere_nom, p.code AS filiere_code
         FROM professional_semestres sm
         LEFT JOIN programmes p ON p.id = sm.filiere_id
         WHERE sm.tenant_id = $2 AND sm.id IN (
           SELECT ss.semestre_id FROM professional_semestre_sessions ss
           JOIN professional_enrollments en ON en.ue_session_id = ss.ue_session_id
           JOIN student_profiles sp ON sp.id = en.student_id
           WHERE sp.user_id = $1 AND en.tenant_id = $2 AND en.statut IN ('confirmee','terminee')
           UNION
           SELECT su.semestre_id FROM professional_semestre_ue su
           JOIN professional_ue_sessions s ON s.ue_id = su.ue_id AND s.tenant_id = su.tenant_id
           JOIN professional_enrollments en ON en.ue_session_id = s.id
           JOIN student_profiles sp ON sp.id = en.student_id
           WHERE sp.user_id = $1 AND en.tenant_id = $2 AND en.statut IN ('confirmee','terminee')
         )
         ORDER BY sm.libelle`,
        [userId, tenantId]
      );
      return ok(r.rows);
    });
  }

  /** Bulletin de l'étudiant identifié par son user_id (espace étudiant). */
  async getBulletinForUser(
    tenantId: string,
    semestreId: string,
    userId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sp = await client.query(
        `SELECT sp.id, u.first_name, u.last_name, sp.student_number AS matricule,
                sp.date_of_birth::text AS date_of_birth, sp.place_of_birth,
                sp.is_repeating, sp.gender
         FROM student_profiles sp JOIN users u ON u.id = sp.user_id
         WHERE sp.user_id = $1 AND sp.tenant_id = $2 LIMIT 1`,
        [userId, tenantId]
      );
      if (sp.rowCount === 0) return fail("STUDENT_NOT_FOUND", "Profil étudiant introuvable.");
      const sem = await this.loadSemestre(client, tenantId, semestreId);
      if (!sem) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");
      const effectif = await this.countSemestreStudents(client, tenantId, semestreId);
      const bulletin = await this.computeStudentBulletin(client, tenantId, sem, sp.rows[0], effectif);
      bulletin.rang = await this.computeRang(client, tenantId, sem, sp.rows[0].id);
      return ok(bulletin);
    });
  }

  /** Tableau récapitulatif : tous les étudiants du semestre + décision. */
  async listRoster(tenantId: string, semestreId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sem = await this.loadSemestre(client, tenantId, semestreId);
      if (!sem) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");

      const students = await client.query(
        `SELECT DISTINCT en.student_id, u.first_name, u.last_name,
                sp.student_number AS matricule
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN student_profiles sp ON sp.id = en.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE en.tenant_id = $1 AND en.statut IN ('confirmee','terminee')
           AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = $2 AND tenant_id = $1)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = $2 AND tenant_id = $1)
           )
         ORDER BY u.last_name, u.first_name`,
        [tenantId, semestreId]
      );

      const effectif = students.rowCount ?? 0;
      const roster = [];
      for (const s of students.rows) {
        const b = await this.computeStudentBulletin(
          client,
          tenantId,
          sem,
          {
            id: s.student_id,
            first_name: s.first_name,
            last_name: s.last_name,
            matricule: s.matricule,
          },
          effectif
        );
        roster.push({
          student_id: s.student_id,
          first_name: s.first_name,
          last_name: s.last_name,
          matricule: s.matricule,
          moyenne_session: b.moyenne_session,
          credits_valides: b.credits_valides,
          credits_total: b.credits_total,
          semestre_valide: b.semestre_valide,
          decision: b.decision,
        });
      }
      return ok({
        semestre: { id: sem.id, libelle: sem.libelle },
        filiere: { id: sem.filiere_id, name: sem.filiere_nom, code: sem.filiere_code },
        students: roster,
      });
    });
  }

  /* --------------------------- interne --------------------------- */

  /** Nombre d'étudiants (confirmés) inscrits sur les cohortes du semestre. */
  private async countSemestreStudents(
    client: PoolClient,
    tenantId: string,
    semestreId: string
  ): Promise<number> {
    const r = await client.query(
      `SELECT count(DISTINCT en.student_id)::int AS n
       FROM professional_enrollments en
       JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
       WHERE en.tenant_id = $1 AND en.statut IN ('confirmee','terminee')
         AND (
           s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                    WHERE semestre_id = $2 AND tenant_id = $1)
           OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                          WHERE semestre_id = $2 AND tenant_id = $1)
         )`,
      [tenantId, semestreId]
    );
    return r.rows[0]?.n ?? 0;
  }

  /** Rang de l'étudiant dans la promotion (par moyenne de session, ex æquo = même rang). */
  private async computeRang(
    client: PoolClient,
    tenantId: string,
    sem: any,
    studentId: string
  ): Promise<number | null> {
    const students = await client.query(
      `SELECT DISTINCT en.student_id, u.first_name, u.last_name, sp.student_number AS matricule
       FROM professional_enrollments en
       JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
       JOIN student_profiles sp ON sp.id = en.student_id
       JOIN users u ON u.id = sp.user_id
       WHERE en.tenant_id = $1 AND en.statut IN ('confirmee','terminee')
         AND (
           s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                    WHERE semestre_id = $2 AND tenant_id = $1)
           OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                          WHERE semestre_id = $2 AND tenant_id = $1)
         )`,
      [tenantId, sem.id]
    );
    const n = students.rowCount ?? 0;
    if (n === 0 || n > 300) return null; // garde-fou perf
    const moys: { id: string; m: number | null }[] = [];
    for (const s of students.rows) {
      const b = await this.computeStudentBulletin(client, tenantId, sem, {
        id: s.student_id,
        first_name: s.first_name,
        last_name: s.last_name,
        matricule: s.matricule,
      });
      moys.push({ id: s.student_id, m: b.moyenne_session });
    }
    const target = moys.find((x) => x.id === studentId);
    if (!target || target.m == null) return null;
    const higher = moys.filter((x) => x.m != null && (x.m as number) > (target.m as number)).length;
    return higher + 1;
  }

  private async loadSemestre(
    client: PoolClient,
    tenantId: string,
    semestreId: string
  ): Promise<any | null> {
    const r = await client.query(
      `SELECT sm.id, sm.libelle, sm.filiere_id,
              p.name AS filiere_nom, p.code AS filiere_code
       FROM professional_semestres sm
       LEFT JOIN programmes p ON p.id = sm.filiere_id
       WHERE sm.id = $1 AND sm.tenant_id = $2`,
      [semestreId, tenantId]
    );
    return r.rowCount === 0 ? null : r.rows[0];
  }

  private async computeStudentBulletin(
    client: PoolClient,
    tenantId: string,
    sem: any,
    student: {
      id: string;
      first_name: string;
      last_name: string;
      matricule: string | null;
      date_of_birth?: string | null;
      place_of_birth?: string | null;
      is_repeating?: boolean | null;
      gender?: string | null;
    },
    effectif?: number
  ): Promise<any> {
    const rows = await client.query(BULLETIN_ROWS, [tenantId, sem.id, student.id]);

    // Regroupe par cohorte/UE.
    const ueMap = new Map<string, any>();
    for (const r of rows.rows) {
      let ue = ueMap.get(r.ue_session_id);
      if (!ue) {
        ue = {
          ue_id: r.ue_id,
          ue_session_id: r.ue_session_id,
          code: r.ue_code,
          libelle: r.ue_libelle,
          nb_uv: r.nb_uv,
          categorie: r.categorie ?? null,
          _ecues: [],
        };
        ueMap.set(r.ue_session_id, ue);
      }
      ue._ecues.push(r);
    }

    const ues: any[] = [];
    for (const ue of ueMap.values()) {
      const inputs: EcueInput[] = ue._ecues.map((e: any) => ({
        moyenneDevoirs: e.moyenne_devoirs ?? null,
        noteExamen: e.note_examen ?? null,
        credits: e.credits ?? 0,
        validationManuelle: e.validee_manuellement === true,
      }));
      const res = evaluerUe(inputs);
      const ecues = ue._ecues.map((e: any, i: number) => {
        const calc = res.ecues[i];
        return {
          ecue_id: e.ecue_id,
          code: e.ecue_code,
          libelle: e.ecue_libelle,
          credits: e.credits ?? null,
          moyenne_devoirs: arrondi(calc.moyenneDevoirs),
          note_examen: arrondi(calc.noteExamen),
          note_ecue: arrondi(calc.note),
          validee: calc.validee,
          validee_manuellement: e.validee_manuellement === true,
          statut: calc.statut,
          result_id: e.result_id ?? null,
        };
      });
      ues.push({
        ue_id: ue.ue_id,
        ue_session_id: ue.ue_session_id,
        code: ue.code,
        libelle: ue.libelle,
        categorie: ue.categorie,
        credits: res.credits,
        nb_uv: ue.nb_uv,
        moyenne_ue: arrondi(res.moyenne),
        validee: res.validee,
        motifs: res.motifs,
        ecues,
      });
    }

    // Conduite du semestre : note unique (/20) portée par une UE/ECUE dédiée,
    // sans inscription. Elle vaut sa note brute (pas de pondération devoirs/
    // examen) et compte dans la moyenne et les crédits du semestre.
    const condRows = await client.query(
      `SELECT s.id AS ue_session_id, s.ue_id, u.code AS ue_code, u.libelle AS ue_libelle,
              u.nb_uv::int AS nb_uv, u.categorie,
              e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
              e.credits::int AS credits, n.note::float8 AS note
       FROM professional_ue_sessions s
       JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
       JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
       JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
       JOIN professional_ecue_notes n ON n.ecue_id = e.id AND n.ue_session_id = s.id
            AND n.student_id = $3 AND n.tenant_id = s.tenant_id AND n.nature = 'examen'
       WHERE s.tenant_id = $1
         AND (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
         AND (
           s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                    WHERE semestre_id = $2 AND tenant_id = $1)
           OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                          WHERE semestre_id = $2 AND tenant_id = $1)
         )
       ORDER BY u.code`,
      [tenantId, sem.id, student.id]
    );
    for (const cr of condRows.rows) {
      const note = arrondi(cr.note);
      if (note == null) continue;
      const validee = note >= 10;
      ues.push({
        ue_id: cr.ue_id,
        ue_session_id: cr.ue_session_id,
        code: cr.ue_code,
        libelle: cr.ue_libelle,
        categorie: cr.categorie ?? null,
        credits: cr.credits ?? 0,
        nb_uv: cr.nb_uv,
        moyenne_ue: note,
        validee,
        motifs: [],
        is_conduite: true,
        ecues: [
          {
            ecue_id: cr.ecue_id,
            code: cr.ecue_code,
            libelle: cr.ecue_libelle,
            credits: cr.credits ?? null,
            moyenne_devoirs: null,
            note_examen: note,
            note_ecue: note,
            validee,
            validee_manuellement: false,
            statut: validee ? "valide" : "insuffisant",
            result_id: null,
          },
        ],
      });
    }

    const ponds = ues.map((u) => ({
      moyenne: u.moyenne_ue,
      credits: u.credits,
      validee: u.validee,
    }));
    const cValides = calcCreditsValides(ponds);
    const cTotal = calcCreditsTotal(ponds);
    // Validé si le seuil de 20 crédits est atteint OU si l'étudiant a validé
    // TOUS les crédits gradables du semestre (cas d'un semestre offrant < 20
    // crédits notables, ex. la Conduite non graduée occupe des UV).
    const semValide = calcSemestreValide(cValides) || (cTotal > 0 && cValides >= cTotal);
    // Rattrapage possible s'il reste une UE non validée avec une ECUE notée < 10.
    // La conduite ne se « repasse » pas : elle est exclue de ce déclencheur.
    const hasRepassable = ues.some(
      (u) =>
        !u.is_conduite &&
        !u.validee &&
        u.ecues.some((e: any) => e.note_ecue != null && e.note_ecue < 10)
    );
    const decision = semValide ? "admis" : hasRepassable ? "rattrapage" : "ajourne";

    // Année académique dérivée de la 1re date de début de session (sept → août).
    const debuts = rows.rows
      .map((r: any) => r.session_date_debut)
      .filter(Boolean)
      .sort();
    let anneeAcademique: string | null = null;
    if (debuts.length > 0) {
      const d = new Date(debuts[0]);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        anneeAcademique = d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
      }
    }
    const nbUeValidees = ues.filter((u) => u.validee).length;

    // Regroupement des UE par catégorie pédagogique (bandeaux du bulletin).
    const CAT_ORDER = ["fondamentale", "specialite", "culture_generale"];
    const catMap = new Map<string, any[]>();
    for (const u of ues) {
      const key = u.categorie ?? "_autres";
      (catMap.get(key) ?? catMap.set(key, []).get(key)!).push(u);
    }
    const orderedKeys = [
      ...CAT_ORDER.filter((k) => catMap.has(k)),
      ...(catMap.has("_autres") ? ["_autres"] : []),
    ];
    const categories = orderedKeys.map((key) => {
      const list = catMap.get(key)!;
      return {
        key,
        credits_obtenus: list.reduce((s, u) => s + (u.validee ? u.credits : 0), 0),
        credits_ue: list.reduce((s, u) => s + u.credits, 0),
        ues: list,
      };
    });

    // Référence unique du relevé.
    const refYear = anneeAcademique ? anneeAcademique.split("-")[0] : "";
    const reference = `REL-${refYear || "XXXX"}-${sem.filiere_code ?? "XXX"}-${
      student.matricule ?? student.id.slice(0, 6)
    }`.toUpperCase();

    return {
      student: {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        matricule: student.matricule,
        date_of_birth: student.date_of_birth ?? null,
        place_of_birth: student.place_of_birth ?? null,
        is_repeating: student.is_repeating ?? null,
        gender: student.gender ?? null,
      },
      filiere: { id: sem.filiere_id, name: sem.filiere_nom, code: sem.filiere_code },
      semestre: { id: sem.id, libelle: sem.libelle },
      annee_academique: anneeAcademique,
      effectif: effectif ?? null,
      reference,
      rang: null as number | null,
      nb_ue_validees: nbUeValidees,
      nb_ue_total: ues.length,
      categories,
      ues,
      moyenne_session: arrondi(moyenneSession(ponds)),
      credits_valides: cValides,
      credits_total: cTotal,
      semestre_valide: semValide,
      decision,
    };
  }
}
