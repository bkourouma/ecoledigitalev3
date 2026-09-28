import type { PoolClient } from "pg";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
import {
  evaluerUe,
  moyenneSession,
  creditsValides as calcCreditsValides,
  creditsTotal as calcCreditsTotal,
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

/**
 * Portée des écrans de notes :
 *  - `actives`   → cohortes encore ouvertes : la saisie y est possible.
 *  - `terminees` → cohortes terminées ou annulées : consultation seule (historique).
 *  - absent      → aucune restriction (comportement historique).
 *
 * Une cohorte est « active » tant que son statut n'est ni `termine` ni `annule`,
 * même règle que le statut de semestre dérivé dans `getBulletinHistory`.
 */
export type NotesScope = "actives" | "terminees";

/**
 * Un étudiant en attente de Session 2 n'a pas de décision arrêtée : son bulletin
 * n'est ni consultable ni généré tant que le rattrapage n'a pas été saisi
 * (page « Rattrapages »). Les deux autres états sont, eux, définitifs :
 * « valide » (admis) et « dette » (session 2 déjà tentée, ajourné).
 */
function enAttenteSession2(bulletin: any): boolean {
  return bulletin?.statut_etudiant === "session2";
}

/** Message unique du refus, pour que l'écran et l'API disent la même chose. */
const SESSION2_PENDING_MESSAGE =
  "Bulletin indisponible : l'étudiant est en attente de Session 2 (rattrapage). " +
  "Saisissez les notes de rattrapage pour arrêter la décision.";

/** Condition SQL de portée sur une cohorte (`alias` = alias de la table sessions). */
function sessionScopeSql(scope: NotesScope | undefined, alias: string): string {
  if (scope === "actives") return `AND ${alias}.statut NOT IN ('termine','annule')`;
  if (scope === "terminees") return `AND ${alias}.statut IN ('termine','annule')`;
  return "";
}

/** Sessions (cohortes) d'un semestre où l'étudiant est inscrit + composition. */
const BULLETIN_ROWS = `
  SELECT s.id AS ue_session_id, s.ue_id, s.date_debut::text AS session_date_debut,
         u.code AS ue_code, u.libelle AS ue_libelle, u.nb_uv::int AS nb_uv, u.categorie,
         e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
         e.credits::int AS credits, l.ordre,
         r.id AS result_id, r.moyenne::float8 AS moyenne,
         r.moyenne_devoirs::float8 AS moyenne_devoirs, r.note_examen::float8 AS note_examen,
         r.validee, r.validee_manuellement, r.eliminee, r.session_obtention,
         EXISTS (SELECT 1 FROM professional_ecue_notes n2
                 WHERE n2.tenant_id = s.tenant_id AND n2.ecue_id = e.id
                   AND n2.student_id = $3 AND n2.ue_session_id = s.id
                   AND n2.session = 2) AS ecue_has_s2
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
    teacherUserId?: string,
    scope?: NotesScope
  ): Promise<ServiceResult<any>> {
    // On ne retient que les filières ayant au moins un étudiant inscrit
    // (confirmé/terminé) dans une session d'UE.
    const HAS_ENROLLED = `EXISTS (
      SELECT 1 FROM professional_enrollments en
      WHERE en.ue_session_id = s.id AND en.tenant_id = s.tenant_id
        AND en.statut IN ('confirmee','terminee'))`;
    const scopeFilter = sessionScopeSql(scope, "s");
    return this.withTenant(tenantId, async (client) => {
      if (teacherUserId) {
        const r = await client.query(
          `SELECT DISTINCT p.id, p.name, p.code
           FROM professional_session_ecue_teachers a
           JOIN teachers t ON t.id = a.enseignant_id
           JOIN professional_ue_sessions s ON s.id = a.ue_session_id AND s.tenant_id = a.tenant_id
           JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
           JOIN programmes p ON p.id = u.filiere_id
           WHERE a.tenant_id = $1 AND t.user_id = $2 AND ${HAS_ENROLLED} ${scopeFilter}
           ORDER BY p.name`,
          [tenantId, teacherUserId]
        );
        return ok(r.rows);
      }
      const r = await client.query(
        `SELECT DISTINCT p.id, p.name, p.code
         FROM programmes p
         JOIN professional_ue u ON u.filiere_id = p.id AND u.tenant_id = p.tenant_id
         JOIN professional_ue_sessions s ON s.ue_id = u.id AND s.tenant_id = u.tenant_id
         WHERE p.tenant_id = $1 AND ${HAS_ENROLLED} ${scopeFilter}
         ORDER BY p.name`,
        [tenantId]
      );
      return ok(r.rows);
    });
  }

  /**
   * Classes encore concernées par l'édition des bulletins : celles ayant au
   * moins un semestre doté d'une session ET dont les bulletins ne sont pas
   * clôturés. Même prédicat que le sélecteur de semestre de la page, pour
   * qu'une classe ne puisse pas apparaître avec une liste de semestres vide.
   */
  async listBulletinsFilieres(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT DISTINCT p.id, p.name, p.code
         FROM programmes p
         JOIN professional_semestres sm
           ON sm.filiere_id = p.id AND sm.tenant_id = p.tenant_id
         WHERE p.tenant_id = $1
           AND sm.bulletins_clotures_at IS NULL
           AND EXISTS (
             SELECT 1 FROM professional_ue_sessions s
             WHERE s.tenant_id = sm.tenant_id AND (
               s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                        WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
               OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                              WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
             )
           )
         ORDER BY p.name`,
        [tenantId]
      );
      return ok(r.rows);
    });
  }

  /**
   * Noms de classe dont au moins un semestre a été clôturé — sélecteur de la
   * page Historique. Le miroir exact de `listBulletinsNoms` : un nom bascule
   * de l'un à l'autre au moment de la clôture.
   */
  async listHistoriqueNoms(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT DISTINCT p.id AS classe_id, p.name AS classe_nom, p.code AS classe_code,
                btrim(split_part(s.libelle, ' ' || chr(8212) || ' ', 1)) AS nom,
                CASE WHEN EXTRACT(MONTH FROM s.date_debut) >= 9
                     THEN EXTRACT(YEAR FROM s.date_debut)::int || '-' ||
                          (EXTRACT(YEAR FROM s.date_debut)::int + 1)
                     ELSE (EXTRACT(YEAR FROM s.date_debut)::int - 1) || '-' ||
                          EXTRACT(YEAR FROM s.date_debut)::int
                END AS annee_scolaire
         FROM programmes p
         JOIN professional_semestres sm
           ON sm.filiere_id = p.id AND sm.tenant_id = p.tenant_id
         JOIN professional_semestre_sessions ss
           ON ss.semestre_id = sm.id AND ss.tenant_id = sm.tenant_id
         JOIN professional_ue_sessions s
           ON s.id = ss.ue_session_id AND s.tenant_id = ss.tenant_id
         WHERE p.tenant_id = $1 AND sm.bulletins_clotures_at IS NOT NULL
         ORDER BY annee_scolaire DESC, nom`,
        [tenantId]
      );
      return ok(r.rows);
    });
  }

  /**
   * Noms de classe encore concernés par l'édition des bulletins : ceux ayant
   * au moins un semestre doté d'une session ET dont les bulletins ne sont pas
   * clôturés. Même prédicat que `listBulletinsFilieres`, au grain du nom.
   */
  async listBulletinsNoms(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT DISTINCT p.id AS classe_id, p.name AS classe_nom, p.code AS classe_code,
                btrim(split_part(s.libelle, ' ' || chr(8212) || ' ', 1)) AS nom
         FROM programmes p
         JOIN professional_semestres sm
           ON sm.filiere_id = p.id AND sm.tenant_id = p.tenant_id
         JOIN professional_ue u ON u.filiere_id = p.id AND u.tenant_id = p.tenant_id
         JOIN professional_ue_sessions s ON s.ue_id = u.id AND s.tenant_id = u.tenant_id
         WHERE p.tenant_id = $1
           AND sm.bulletins_clotures_at IS NULL
           AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
           )
         ORDER BY p.name, nom`,
        [tenantId]
      );
      return ok(r.rows);
    });
  }

  /**
   * Noms de classe pour la saisie des notes, au grain du nom : une classe peut
   * en porter plusieurs, et on ne saisit pas les notes des deux ensemble.
   *
   * Contrairement à `listNotesFilieres`, aucun inscrit n'est exigé : un nom
   * apparaît dès que sa classe est ouverte, même si personne n'y est encore
   * inscrit.
   *
   * Une ligne par couple (nom, semestre), avec l'année scolaire : les écrans
   * qui font choisir l'année en premier en dérivent tout leur arbre.
   */
  async listNotesNoms(
    tenantId: string,
    teacherUserId?: string,
    scope?: NotesScope
  ): Promise<ServiceResult<any>> {
    const scopeFilter = sessionScopeSql(scope, "s");
    const NOM = `btrim(split_part(s.libelle, ' ' || chr(8212) || ' ', 1))`;
    return this.withTenant(tenantId, async (client) => {
      if (teacherUserId) {
        const r = await client.query(
          `SELECT DISTINCT p.id AS classe_id, p.name AS classe_nom, p.code AS classe_code,
                  ${NOM} AS nom,
                  CASE WHEN EXTRACT(MONTH FROM s.date_debut) >= 9
                       THEN EXTRACT(YEAR FROM s.date_debut)::int || '-' ||
                            (EXTRACT(YEAR FROM s.date_debut)::int + 1)
                       ELSE (EXTRACT(YEAR FROM s.date_debut)::int - 1) || '-' ||
                            EXTRACT(YEAR FROM s.date_debut)::int
                  END AS annee_scolaire,
                  sm.id AS semestre_id, sm.libelle AS semestre_libelle
           FROM professional_session_ecue_teachers a
           JOIN teachers t ON t.id = a.enseignant_id
           JOIN professional_ue_sessions s ON s.id = a.ue_session_id AND s.tenant_id = a.tenant_id
           JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
           JOIN programmes p ON p.id = u.filiere_id
           LEFT JOIN professional_semestre_sessions ss
                  ON ss.ue_session_id = s.id AND ss.tenant_id = s.tenant_id
           LEFT JOIN professional_semestres sm ON sm.id = ss.semestre_id
           WHERE a.tenant_id = $1 AND t.user_id = $2 ${scopeFilter}
           ORDER BY annee_scolaire DESC, nom, sm.libelle`,
          [tenantId, teacherUserId]
        );
        return ok(r.rows);
      }
      const r = await client.query(
        `SELECT DISTINCT p.id AS classe_id, p.name AS classe_nom, p.code AS classe_code,
                ${NOM} AS nom,
                CASE WHEN EXTRACT(MONTH FROM s.date_debut) >= 9
                     THEN EXTRACT(YEAR FROM s.date_debut)::int || '-' ||
                          (EXTRACT(YEAR FROM s.date_debut)::int + 1)
                     ELSE (EXTRACT(YEAR FROM s.date_debut)::int - 1) || '-' ||
                          EXTRACT(YEAR FROM s.date_debut)::int
                END AS annee_scolaire,
                sm.id AS semestre_id, sm.libelle AS semestre_libelle
         FROM programmes p
         JOIN professional_ue u ON u.filiere_id = p.id AND u.tenant_id = p.tenant_id
         JOIN professional_ue_sessions s ON s.ue_id = u.id AND s.tenant_id = u.tenant_id
         LEFT JOIN professional_semestre_sessions ss
                ON ss.ue_session_id = s.id AND ss.tenant_id = s.tenant_id
         LEFT JOIN professional_semestres sm ON sm.id = ss.semestre_id
         WHERE p.tenant_id = $1 ${scopeFilter}
         ORDER BY annee_scolaire DESC, nom, sm.libelle`,
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
    teacherUserId?: string,
    scope?: NotesScope
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
                -- Cloture : l'ecran de saisie doit le savoir AVANT la frappe,
                -- sinon l'utilisateur remplit un formulaire que le serveur
                -- refusera ligne par ligne.
                sm.bulletins_clotures_at,
                (SELECT count(DISTINCT s.id)::int FROM professional_ue_sessions s
                 WHERE s.tenant_id = sm.tenant_id AND (
                   s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                            WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                   OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                                  WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                 )) AS nb_sessions,
                -- Sessions encore actives (ni terminées ni annulées) : sert aux
                -- écrans réservés au semestre en cours (saisie des conduites).
                (SELECT count(DISTINCT s.id)::int FROM professional_ue_sessions s
                 WHERE s.tenant_id = sm.tenant_id
                   AND s.statut NOT IN ('termine','annule') AND (
                   s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                            WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                   OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                                  WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                 )) AS nb_sessions_actives,
                (SELECT min(s.date_debut)::text FROM professional_ue_sessions s
                 WHERE s.tenant_id = sm.tenant_id AND (
                   s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                            WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                   OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                                  WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                 )) AS date_debut
         FROM professional_semestres sm
         WHERE sm.tenant_id = $1 AND sm.filiere_id = $2 ${teacherJoin}
         ORDER BY sm.libelle`,
        params
      );
      // Un semestre sans aucune session n'a rien à afficher. Selon la portée, on
      // ne garde ensuite que ceux ayant au moins une cohorte active (saisie
      // possible) ou au moins une cohorte terminée (consultation de l'historique).
      return ok(
        r.rows.filter((x: any) => {
          const total = Number(x.nb_sessions ?? 0);
          if (total === 0) return false;
          const actives = Number(x.nb_sessions_actives ?? 0);
          if (scope === "actives") return actives > 0;
          if (scope === "terminees") return total - actives > 0;
          return true;
        })
      );
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
      // Décision non arrêtée : le relevé n'est pas consultable (cf. Rattrapages).
      if (enAttenteSession2(bulletin)) return fail("SESSION2_PENDING", SESSION2_PENDING_MESSAGE);
      bulletin.rang = await this.computeRang(client, tenantId, sem, studentId);
      await this.attachGeneratedMeta(client, tenantId, semestreId, studentId, bulletin);
      return ok(bulletin);
    });
  }

  /**
   * Bulletin de style BTS (feature ad hoc, hors spec 030) — même moteur de
   * calcul que le relevé LMD (`computeStudentBulletin`), restitué en tableau
   * « discipline » (UE en gras, ECUE en sous-ligne) avec un rang de classe
   * PAR LIGNE (UE et ECUE), réservé aux filières Licence 1 et Licence 2.
   * Sur le dernier semestre de la filière, ajoute un bilan annuel (moyenne
   * pondérée par les crédits de chaque semestre + rang annuel).
   */
  async getBulletinBts(
    tenantId: string,
    semestreId: string,
    studentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sem = await this.loadSemestre(client, tenantId, semestreId);
      if (!sem) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");
      if (!/licence\s*[12]\b/i.test(String(sem.filiere_nom ?? ""))) {
        return fail(
          "NOT_ELIGIBLE",
          "Le bulletin BTS n'est disponible que pour les filières Licence 1 et Licence 2."
        );
      }

      const stu = await client.query(
        `SELECT sp.id, u.first_name, u.last_name, sp.student_number AS matricule,
                sp.date_of_birth::text AS date_of_birth, sp.place_of_birth,
                sp.is_repeating, sp.gender
         FROM student_profiles sp JOIN users u ON u.id = sp.user_id
         WHERE sp.id = $1 AND sp.tenant_id = $2`,
        [studentId, tenantId]
      );
      if (stu.rowCount === 0) return fail("STUDENT_NOT_FOUND", "Étudiant introuvable.");

      // Promotion du semestre (tous les étudiants confirmés/terminés).
      const rosterRes = await client.query(
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
        [tenantId, semestreId]
      );
      const effectif = rosterRes.rowCount ?? 0;
      const rankable = effectif > 0 && effectif <= 300; // garde-fou perf (cf. computeRang)

      // Bulletin de chaque étudiant de la promotion — une seule passe,
      // réutilisée pour le rang par UE/ECUE ET le rang global.
      const classBulletins: { studentId: string; bulletin: any }[] = [];
      if (rankable) {
        for (const s of rosterRes.rows) {
          const b = await this.computeStudentBulletin(client, tenantId, sem, {
            id: s.student_id,
            first_name: s.first_name,
            last_name: s.last_name,
            matricule: s.matricule,
          });
          classBulletins.push({ studentId: s.student_id, bulletin: b });
        }
      }

      const target = classBulletins.find((x) => x.studentId === studentId);
      const bulletin = target
        ? target.bulletin
        : await this.computeStudentBulletin(client, tenantId, sem, stu.rows[0]);
      // Même règle que le relevé LMD : pas de document tant que la décision
      // n'est pas arrêtée.
      if (enAttenteSession2(bulletin)) return fail("SESSION2_PENDING", SESSION2_PENDING_MESSAGE);
      // Le bulletin de la cible peut provenir de classBulletins (promotion),
      // dont la requête ne charge que id/nom/matricule — on complète toujours
      // avec le profil complet (date de naissance, genre, redoublement…).
      bulletin.student = {
        ...bulletin.student,
        date_of_birth: stu.rows[0].date_of_birth,
        place_of_birth: stu.rows[0].place_of_birth,
        is_repeating: stu.rows[0].is_repeating,
        gender: stu.rows[0].gender,
      };
      bulletin.effectif = effectif;

      const rangGlobal = rankable
        ? this.rankAmong(
            classBulletins.map((x) => x.bulletin.moyenne_session),
            bulletin.moyenne_session
          )
        : null;
      bulletin.rang = rangGlobal;
      await this.attachGeneratedMeta(client, tenantId, semestreId, studentId, bulletin);

      const ueRow = (ue: any) => {
        const rangUe = rankable
          ? this.rankAmong(
              classBulletins.map(
                (x) => (x.bulletin.ues as any[]).find((u) => u.ue_id === ue.ue_id)?.moyenne_ue ?? null
              ),
              ue.moyenne_ue
            )
          : null;
        return {
          ue_id: ue.ue_id,
          libelle: ue.libelle,
          moyenne: ue.moyenne_ue,
          coeff: ue.credits,
          moyenne_ponderee: ue.moyenne_ue != null ? arrondi(ue.moyenne_ue * ue.credits) : null,
          rang: rangUe,
          ecues: (ue.ecues as any[]).map((e) => {
            const rangEcue = rankable
              ? this.rankAmong(
                  classBulletins.map((x) => {
                    const u = (x.bulletin.ues as any[]).find((uu) => uu.ue_id === ue.ue_id);
                    return u?.ecues?.find((ee: any) => ee.ecue_id === e.ecue_id)?.note_ecue ?? null;
                  }),
                  e.note_ecue
                )
              : null;
            return {
              ecue_id: e.ecue_id,
              libelle: e.libelle,
              moyenne: e.note_ecue,
              coeff: e.credits,
              moyenne_ponderee:
                e.note_ecue != null && e.credits != null ? arrondi(e.note_ecue * e.credits) : null,
              rang: rangEcue,
            };
          }),
        };
      };

      const disciplines = (bulletin.ues as any[]).filter((ue) => !ue.is_conduite).map(ueRow);
      const conduiteUe = (bulletin.ues as any[]).find((ue) => ue.is_conduite) ?? null;

      // Absences réelles (feature ad hoc, hors spec 030) — affichées telles
      // quelles (justifiées / non justifiées), sans conversion en note.
      // 'absent' = non justifiée, 'excuse' = justifiée.
      const absRes = await client.query(
        `SELECT count(*) FILTER (WHERE a.statut='absent')::int AS nb_absent,
                count(*) FILTER (WHERE a.statut='excuse')::int  AS nb_excuse
         FROM professional_ecue_attendance a
         JOIN professional_ecue_seances se ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
         JOIN professional_ue_sessions s ON s.id = se.ue_session_id AND s.tenant_id = se.tenant_id
         WHERE a.tenant_id = $1 AND a.student_id = $3
           AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = $2 AND tenant_id = $1)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = $2 AND tenant_id = $1)
           )`,
        [tenantId, semestreId, studentId]
      );
      const targetAbsences = {
        nb_absent: Number(absRes.rows[0]?.nb_absent ?? 0),
        nb_excuse: Number(absRes.rows[0]?.nb_excuse ?? 0),
      };

      // Savoir être = Conduite uniquement, note réelle (saisie via la page
      // Notes), identique à celle du relevé LMD (bouton « Consulter »).
      const savoirEtre: any[] = conduiteUe ? [{ key: "conduite", ...ueRow(conduiteUe) }] : [];

      // Distinctions / sanctions (feature ad hoc) — barème sur la moyenne
      // semestrielle officielle (LMD), inchangée par ailleurs dans l'appli.
      const mGlobal = bulletin.moyenne_session as number | null;
      const distinction =
        mGlobal == null
          ? { tableau_honneur: false, tableau_honneur_encouragement: false, avertissement: false }
          : {
              tableau_honneur: mGlobal >= 12 && mGlobal < 15,
              tableau_honneur_encouragement: mGlobal >= 15,
              avertissement: mGlobal < 10,
            };

      // Total des points (informatif) : somme des moyennes pondérées de
      // TOUTES les lignes affichées (disciplines + savoir être). NB : ce
      // total inclut l'Assiduité, qui n'entre PAS dans la moyenne
      // semestrielle officielle (LMD) affichée par ailleurs — cette dernière
      // reste inchangée pour rester cohérente avec le reste de l'application.
      const allRows = [...disciplines, ...savoirEtre];
      const totalPoints = allRows.reduce((s, r) => s + (r.moyenne_ponderee ?? 0), 0);
      const totalCoeff = allRows.reduce((s, r) => s + (r.coeff ?? 0), 0);

      // Bilan annuel : uniquement sur le DERNIER semestre de la filière
      // (numéro le plus élevé extrait du libellé), moyenne pondérée par les
      // crédits totaux de chaque semestre.
      const semNum = (libelle: string | null | undefined): number => {
        const m = String(libelle ?? "").match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      };
      const allSemRes = await client.query(
        `SELECT id, libelle FROM professional_semestres WHERE tenant_id=$1 AND filiere_id=$2`,
        [tenantId, sem.filiere_id]
      );
      const allSemestres = allSemRes.rows
        .map((r) => ({ id: r.id as string, libelle: r.libelle as string, num: semNum(r.libelle) }))
        .sort((a, b) => a.num - b.num);
      const maxNum = allSemestres.length ? allSemestres[allSemestres.length - 1].num : semNum(sem.libelle);
      const isLastSemestre = allSemestres.length > 1 && semNum(sem.libelle) === maxNum;

      let annuel: any = null;
      if (isLastSemestre) {
        // Charge une seule fois l'objet semestre des AUTRES semestres de la
        // filière (réutilisé pour tous les étudiants de la promotion).
        const otherSemObjs = new Map<string, any>();
        for (const s of allSemestres) {
          if (s.id === sem.id) continue;
          const semObj = await this.loadSemestre(client, tenantId, s.id);
          if (semObj) otherSemObjs.set(s.id, semObj);
        }

        const semDetails: {
          id: string;
          libelle: string;
          moyenne_session: number | null;
          credits_total: number;
          rang: number | null;
        }[] = [];
        for (const s of allSemestres) {
          if (s.id === sem.id) {
            semDetails.push({
              id: sem.id,
              libelle: sem.libelle,
              moyenne_session: bulletin.moyenne_session,
              credits_total: bulletin.credits_total,
              rang: rangGlobal,
            });
            continue;
          }
          const semObj = otherSemObjs.get(s.id);
          if (!semObj) continue;
          const b = await this.computeStudentBulletin(client, tenantId, semObj, stu.rows[0]);
          semDetails.push({
            id: s.id,
            libelle: semObj.libelle,
            moyenne_session: b.moyenne_session,
            credits_total: b.credits_total,
            rang: null,
          });
        }
        let som = 0;
        let cred = 0;
        for (const s of semDetails) {
          if (s.moyenne_session == null) continue;
          som += s.moyenne_session * s.credits_total;
          cred += s.credits_total;
        }
        const moyenneAnnuelle = cred > 0 ? arrondi(som / cred) : null;

        let rangAnnuel: number | null = null;
        if (rankable) {
          // Moyennes de TOUTE la promotion, semestre par semestre — permet à
          // la fois le rang annuel (somme pondérée) ET le rang de chaque
          // semestre affiché dans le bilan (hors semestre courant, déjà
          // connu via rangGlobal).
          const perSemMoyennes = new Map<string, (number | null)[]>();
          for (const s of allSemestres) perSemMoyennes.set(s.id, []);
          const classAnnual: (number | null)[] = [];
          for (const cb of classBulletins) {
            let s2 = 0;
            let c2 = 0;
            for (const s of allSemestres) {
              const semObj = s.id === sem.id ? sem : otherSemObjs.get(s.id);
              const mb =
                s.id === sem.id
                  ? cb.bulletin
                  : semObj
                  ? await this.computeStudentBulletin(client, tenantId, semObj, {
                      id: cb.studentId,
                      first_name: "",
                      last_name: "",
                      matricule: null,
                    })
                  : null;
              perSemMoyennes.get(s.id)!.push(mb?.moyenne_session ?? null);
              if (!mb || mb.moyenne_session == null) continue;
              s2 += mb.moyenne_session * mb.credits_total;
              c2 += mb.credits_total;
            }
            classAnnual.push(c2 > 0 ? s2 / c2 : null);
          }
          rangAnnuel = this.rankAmong(classAnnual, moyenneAnnuelle);
          for (const detail of semDetails) {
            if (detail.id === sem.id) continue; // déjà rangGlobal
            detail.rang = this.rankAmong(perSemMoyennes.get(detail.id) ?? [], detail.moyenne_session);
          }
        }

        annuel = { moyenne: moyenneAnnuelle, rang: rangAnnuel, semestres: semDetails };
      }

      return ok({
        ...bulletin,
        disciplines,
        savoir_etre: savoirEtre,
        absences: { justifiees: targetAbsences.nb_excuse, non_justifiees: targetAbsences.nb_absent },
        distinction,
        total_points: arrondi(totalPoints),
        total_coeff: totalCoeff,
        annuel,
      });
    });
  }

  /** Rang (1 = premier) d'une valeur au sein d'une liste ; ex æquo = même rang. */
  private rankAmong(values: (number | null)[], value: number | null): number | null {
    if (value == null) return null;
    const higher = values.filter((v) => v != null && (v as number) > (value as number)).length;
    return higher + 1;
  }

  /** Attache la date de génération officielle et le statut du bulletin (si généré). */
  private async attachGeneratedMeta(
    client: PoolClient,
    tenantId: string,
    semestreId: string,
    studentId: string,
    bulletin: any
  ): Promise<void> {
    const g = await client.query(
      `SELECT statut, generated_at, updated_at FROM professional_bulletins
       WHERE tenant_id=$1 AND semestre_id=$2 AND student_id=$3`,
      [tenantId, semestreId, studentId]
    );
    if ((g.rowCount ?? 0) > 0) {
      bulletin.generated_at = g.rows[0].generated_at;
      bulletin.bulletin_statut = g.rows[0].statut;
    } else {
      bulletin.generated_at = null;
      bulletin.bulletin_statut = null;
    }
  }

  /** Semestres où l'étudiant (user_id) est inscrit — pour son sélecteur. */
  async listStudentSemestres(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT DISTINCT sm.id, sm.libelle, p.name AS filiere_nom, p.code AS filiere_code,
                ctx.classe_nom, ctx.annee_scolaire
         FROM professional_semestres sm
         LEFT JOIN programmes p ON p.id = sm.filiere_id
         -- Nom de classe et année scolaire tels que vécus par CET étudiant :
         -- ils viennent de la cohorte où il est inscrit pour ce semestre, pas
         -- du programme, qui ne connaît ni l'un ni l'autre.
         LEFT JOIN LATERAL (
           SELECT btrim(split_part(s2.libelle, ' ' || chr(8212) || ' ', 1)) AS classe_nom,
                  CASE WHEN EXTRACT(MONTH FROM s2.date_debut) >= 9
                       THEN EXTRACT(YEAR FROM s2.date_debut)::int || '-' ||
                            (EXTRACT(YEAR FROM s2.date_debut)::int + 1)
                       ELSE (EXTRACT(YEAR FROM s2.date_debut)::int - 1) || '-' ||
                            EXTRACT(YEAR FROM s2.date_debut)::int
                  END AS annee_scolaire
           FROM professional_enrollments en2
           JOIN student_profiles sp2 ON sp2.id = en2.student_id
           JOIN professional_ue_sessions s2 ON s2.id = en2.ue_session_id
                AND s2.tenant_id = en2.tenant_id
           LEFT JOIN professional_semestre_sessions ss2
                  ON ss2.ue_session_id = s2.id AND ss2.tenant_id = s2.tenant_id
           LEFT JOIN professional_semestre_ue su2
                  ON su2.ue_id = s2.ue_id AND su2.tenant_id = s2.tenant_id
           WHERE sp2.user_id = $1 AND en2.tenant_id = $2
             AND en2.statut IN ('confirmee','terminee')
             AND (ss2.semestre_id = sm.id OR su2.semestre_id = sm.id)
           ORDER BY s2.date_debut DESC
           LIMIT 1
         ) ctx ON TRUE
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
      await this.attachGeneratedMeta(client, tenantId, semestreId, sp.rows[0].id, bulletin);
      return ok(bulletin);
    });
  }

  /**
   * Bulletin de mise en page « BTS » de l'étudiant CONNECTÉ (Licence 1 et 2).
   *
   * Le gabarit BTS ne lit pas le même payload que le relevé LMD : il attend des
   * lignes de disciplines à coefficients et un total de points. Lui passer le
   * payload LMD produisait un document vide — identité correcte, tableau sans
   * une ligne, total « — ». Cette méthode sert à l'étudiant les données que
   * l'administration utilise pour éditer ce même bulletin.
   *
   * Le profil est résolu depuis l'utilisateur connecté : un étudiant n'obtient
   * que le sien, jamais celui d'un camarade.
   */
  async getBulletinBtsForUser(
    tenantId: string,
    semestreId: string,
    userId: string
  ): Promise<ServiceResult<any>> {
    const spId = await this.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT sp.id FROM student_profiles sp
          WHERE sp.user_id = $1 AND sp.tenant_id = $2 LIMIT 1`,
        [userId, tenantId]
      );
      return r.rowCount === 0 ? null : (r.rows[0].id as string);
    });
    if (!spId) return fail("STUDENT_NOT_FOUND", "Profil étudiant introuvable.");
    return this.getBulletinBts(tenantId, semestreId, spId);
  }

  /**
   * Détail des notes individuelles de l'étudiant connecté pour un semestre :
   * chaque devoir et examen saisi manuellement + les copies d'évaluation notées,
   * par ECUE/cohorte. Sert à afficher le détail des devoirs (pas seulement la
   * moyenne) dans l'espace étudiant. Scopé au student_profile de l'utilisateur.
   */
  async getStudentSemestreNotes(
    tenantId: string,
    semestreId: string,
    userId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sp = await client.query(
        `SELECT id FROM student_profiles WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
        [userId, tenantId]
      );
      if (sp.rowCount === 0) return fail("STUDENT_NOT_FOUND", "Profil étudiant introuvable.");
      const studentId = sp.rows[0].id as string;

      // Cohortes (UE sessions) du semestre où l'étudiant est inscrit (confirmé).
      const sessions = await client.query(
        `SELECT DISTINCT s.id
         FROM professional_ue_sessions s
         JOIN professional_enrollments en ON en.ue_session_id = s.id AND en.tenant_id = s.tenant_id
         WHERE s.tenant_id = $1 AND en.student_id = $3
           AND en.statut IN ('confirmee','terminee')
           AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = $2 AND tenant_id = $1)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = $2 AND tenant_id = $1)
           )`,
        [tenantId, semestreId, studentId]
      );
      const sessionIds = sessions.rows.map((r) => r.id as string);
      if (sessionIds.length === 0) return ok({ notes: [], submissions: [] });

      // Notes manuelles individuelles (devoirs + examen) de l'étudiant.
      const notes = await client.query(
        `SELECT id, ecue_id, ue_session_id, nature, libelle,
                note::float8 AS note, note_max::float8 AS note_max,
                COALESCE(session, 1)::int AS session, created_at
         FROM professional_ecue_notes
         WHERE tenant_id = $1 AND student_id = $2 AND ue_session_id = ANY($3::uuid[])
         ORDER BY nature, session, created_at`,
        [tenantId, studentId, sessionIds]
      );

      // Copies d'évaluation notées (devoirs/examens issus des évaluations).
      const submissions = await client.query(
        `SELECT a.ecue_id, a.ue_session_id, a.id AS assignment_id, a.titre,
                a.type, a.evaluation_type,
                sub.note::float8 AS note, a.note_max::float8 AS note_max
         FROM professional_assignment_submissions sub
         JOIN professional_assignments a ON a.id = sub.assignment_id
         WHERE sub.tenant_id = $1 AND sub.student_id = $2 AND sub.note IS NOT NULL
           AND a.ue_session_id = ANY($3::uuid[])
         ORDER BY a.type DESC, a.titre`,
        [tenantId, studentId, sessionIds]
      );

      return ok({ notes: notes.rows, submissions: submissions.rows });
    });
  }

  /* ===================== Espace parent (lecture seule) ===================== */

  /** Vérifie qu'un enfant (student_profiles.id) est rattaché au parent. */
  private async isParentOfChild(
    client: PoolClient,
    tenantId: string,
    parentUserId: string,
    childStudentId: string
  ): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM student_parents
       WHERE tenant_id = $1 AND parent_id = $2 AND student_id = $3 LIMIT 1`,
      [tenantId, parentUserId, childStudentId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Semestres où l'enfant est inscrit (parent authentifié). */
  async listChildSemestres(
    tenantId: string,
    parentUserId: string,
    childStudentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (!(await this.isParentOfChild(client, tenantId, parentUserId, childStudentId))) {
        return fail("FORBIDDEN", "Cet élève n'est pas rattaché à votre compte.");
      }
      const r = await client.query(
        `SELECT DISTINCT sm.id, sm.libelle, p.name AS filiere_nom, p.code AS filiere_code,
                ctx.classe_nom, ctx.annee_scolaire
         FROM professional_semestres sm
         LEFT JOIN programmes p ON p.id = sm.filiere_id
         -- Nom de classe et année scolaire tels que vécus par CET enfant :
         -- ils viennent de la cohorte où il est inscrit pour ce semestre, pas
         -- du programme, qui ne connaît ni l'un ni l'autre.
         LEFT JOIN LATERAL (
           SELECT btrim(split_part(s2.libelle, ' ' || chr(8212) || ' ', 1)) AS classe_nom,
                  CASE WHEN EXTRACT(MONTH FROM s2.date_debut) >= 9
                       THEN EXTRACT(YEAR FROM s2.date_debut)::int || '-' ||
                            (EXTRACT(YEAR FROM s2.date_debut)::int + 1)
                       ELSE (EXTRACT(YEAR FROM s2.date_debut)::int - 1) || '-' ||
                            EXTRACT(YEAR FROM s2.date_debut)::int
                  END AS annee_scolaire
           FROM professional_enrollments en2
           JOIN professional_ue_sessions s2 ON s2.id = en2.ue_session_id
                AND s2.tenant_id = en2.tenant_id
           LEFT JOIN professional_semestre_sessions ss2
                  ON ss2.ue_session_id = s2.id AND ss2.tenant_id = s2.tenant_id
           LEFT JOIN professional_semestre_ue su2
                  ON su2.ue_id = s2.ue_id AND su2.tenant_id = s2.tenant_id
           WHERE en2.student_id = $1 AND en2.tenant_id = $2
             AND en2.statut IN ('confirmee','terminee')
             AND (ss2.semestre_id = sm.id OR su2.semestre_id = sm.id)
           ORDER BY s2.date_debut DESC
           LIMIT 1
         ) ctx ON TRUE
         WHERE sm.tenant_id = $2 AND sm.id IN (
           SELECT ss.semestre_id FROM professional_semestre_sessions ss
           JOIN professional_enrollments en ON en.ue_session_id = ss.ue_session_id
           WHERE en.student_id = $1 AND en.tenant_id = $2 AND en.statut IN ('confirmee','terminee')
           UNION
           SELECT su.semestre_id FROM professional_semestre_ue su
           JOIN professional_ue_sessions s ON s.ue_id = su.ue_id AND s.tenant_id = su.tenant_id
           JOIN professional_enrollments en ON en.ue_session_id = s.id
           WHERE en.student_id = $1 AND en.tenant_id = $2 AND en.statut IN ('confirmee','terminee')
         )
         ORDER BY sm.libelle`,
        [childStudentId, tenantId]
      );
      return ok(r.rows);
    });
  }

  /** Bulletin d'un enfant pour un semestre (parent authentifié). */
  async getChildBulletin(
    tenantId: string,
    parentUserId: string,
    semestreId: string,
    childStudentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (!(await this.isParentOfChild(client, tenantId, parentUserId, childStudentId))) {
        return fail("FORBIDDEN", "Cet élève n'est pas rattaché à votre compte.");
      }
      const stu = await client.query(
        `SELECT sp.id, u.first_name, u.last_name, sp.student_number AS matricule,
                sp.date_of_birth::text AS date_of_birth, sp.place_of_birth,
                sp.is_repeating, sp.gender
         FROM student_profiles sp JOIN users u ON u.id = sp.user_id
         WHERE sp.id = $1 AND sp.tenant_id = $2`,
        [childStudentId, tenantId]
      );
      if (stu.rowCount === 0) return fail("STUDENT_NOT_FOUND", "Élève introuvable.");
      const sem = await this.loadSemestre(client, tenantId, semestreId);
      if (!sem) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");
      const effectif = await this.countSemestreStudents(client, tenantId, semestreId);
      const bulletin = await this.computeStudentBulletin(client, tenantId, sem, stu.rows[0], effectif);
      bulletin.rang = await this.computeRang(client, tenantId, sem, childStudentId);
      await this.attachGeneratedMeta(client, tenantId, semestreId, childStudentId, bulletin);
      return ok(bulletin);
    });
  }

  /** Notes individuelles (devoirs + examen) d'un enfant pour un semestre. */
  async getChildSemestreNotes(
    tenantId: string,
    parentUserId: string,
    semestreId: string,
    childStudentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (!(await this.isParentOfChild(client, tenantId, parentUserId, childStudentId))) {
        return fail("FORBIDDEN", "Cet élève n'est pas rattaché à votre compte.");
      }
      const sessions = await client.query(
        `SELECT DISTINCT s.id
         FROM professional_ue_sessions s
         JOIN professional_enrollments en ON en.ue_session_id = s.id AND en.tenant_id = s.tenant_id
         WHERE s.tenant_id = $1 AND en.student_id = $3
           AND en.statut IN ('confirmee','terminee')
           AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = $2 AND tenant_id = $1)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = $2 AND tenant_id = $1)
           )`,
        [tenantId, semestreId, childStudentId]
      );
      const sessionIds = sessions.rows.map((r) => r.id as string);
      if (sessionIds.length === 0) return ok({ notes: [], submissions: [] });

      const notes = await client.query(
        `SELECT id, ecue_id, ue_session_id, nature, libelle,
                note::float8 AS note, note_max::float8 AS note_max,
                COALESCE(session, 1)::int AS session, created_at
         FROM professional_ecue_notes
         WHERE tenant_id = $1 AND student_id = $2 AND ue_session_id = ANY($3::uuid[])
         ORDER BY nature, session, created_at`,
        [tenantId, childStudentId, sessionIds]
      );
      const submissions = await client.query(
        `SELECT a.ecue_id, a.ue_session_id, a.id AS assignment_id, a.titre,
                a.type, a.evaluation_type,
                sub.note::float8 AS note, a.note_max::float8 AS note_max
         FROM professional_assignment_submissions sub
         JOIN professional_assignments a ON a.id = sub.assignment_id
         WHERE sub.tenant_id = $1 AND sub.student_id = $2 AND sub.note IS NOT NULL
           AND a.ue_session_id = ANY($3::uuid[])
         ORDER BY a.type DESC, a.titre`,
        [tenantId, childStudentId, sessionIds]
      );
      return ok({ notes: notes.rows, submissions: submissions.rows });
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
      // État de génération des bulletins (date permanente + statut).
      const gen = await client.query(
        `SELECT student_id, statut, generated_at FROM professional_bulletins
         WHERE tenant_id=$1 AND semestre_id=$2`,
        [tenantId, semestreId]
      );
      const genBy = new Map<string, any>();
      for (const g of gen.rows) genBy.set(String(g.student_id), g);

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
        const g = genBy.get(String(s.student_id));
        roster.push({
          student_id: s.student_id,
          first_name: s.first_name,
          last_name: s.last_name,
          // Matricule pro (IPAM…) résolu par computeStudentBulletin, sinon le numéro brut.
          matricule: b.student?.matricule ?? s.matricule,
          moyenne_session: b.moyenne_session,
          credits_valides: b.credits_valides,
          credits_total: b.credits_total,
          semestre_valide: b.semestre_valide,
          decision: b.decision,
          statut_etudiant: b.statut_etudiant,
          session_globale: b.session_globale,
          bulletin_statut: g?.statut ?? null,
          generated_at: g?.generated_at ?? null,
        });
      }
      return ok({
        semestre: { id: sem.id, libelle: sem.libelle },
        filiere: {
        id: sem.filiere_id,
        name: sem.filiere_nom,
        code: sem.filiere_code,
        domaine: sem.filiere_domaine ?? null,
      },
        students: roster,
      });
    });
  }

  /**
   * Génère (ou régénère) les bulletins officiels de TOUS les étudiants du
   * semestre. La date de génération est DÉFINITIVE : posée à la première
   * génération, elle n'est jamais modifiée (les régénérations mettent à jour
   * l'instantané et le statut, `updated_at` trace le dernier rafraîchissement).
   * Statut : « definitif » si le semestre est validé, sinon « provisoire »
   * (étudiant ajourné après rattrapage).
   *
   * Les étudiants en attente de Session 2 sont IGNORÉS : leur décision n'est
   * pas arrêtée, générer leur bulletin figerait un document qui changera dès la
   * saisie du rattrapage. Ils sont recomptés dans `ignores`.
   */
  async generateBulletins(tenantId: string, semestreId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sem = await this.loadSemestre(client, tenantId, semestreId);
      if (!sem) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");
      // Clôturé = archivé : regénérer réécrirait des documents déjà arrêtés.
      if (sem.bulletins_clotures_at) {
        return fail(
          "BULLETINS_CLOTURES",
          "Les bulletins de ce semestre sont clôturés : ils ne peuvent plus être régénérés."
        );
      }

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
        [tenantId, semestreId]
      );

      const effectif = students.rowCount ?? 0;
      let definitifs = 0;
      let provisoires = 0;
      let ignores = 0;
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
        if (enAttenteSession2(b)) {
          ignores++;
          continue;
        }
        const statut = b.semestre_valide ? "definitif" : "provisoire";
        if (statut === "definitif") definitifs++;
        else provisoires++;
        await client.query(
          `INSERT INTO professional_bulletins
             (tenant_id, student_id, semestre_id, statut, data)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, student_id, semestre_id)
           DO UPDATE SET data = EXCLUDED.data,
                         statut = EXCLUDED.statut,
                         updated_at = now()`,
          [tenantId, s.student_id, semestreId, statut, JSON.stringify(b)]
        );
      }
      return ok({ generated: definitifs + provisoires, definitifs, provisoires, ignores });
    });
  }

  /**
   * Bulletins COMPLETS (calculés) de tous les étudiants d'un semestre — pour
   * générer un PDF combiné. Le rang est dérivé du classement des moyennes.
   *
   * Les étudiants en attente de Session 2 en sont exclus : leur bulletin n'est
   * pas consultable individuellement, il ne doit pas l'être davantage dans le
   * document groupé. Le rang, lui, reste calculé sur la promotion entière.
   */
  async listFullBulletins(tenantId: string, semestreId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sem = await this.loadSemestre(client, tenantId, semestreId);
      if (!sem) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");

      const students = await client.query(
        `SELECT DISTINCT en.student_id, u.first_name, u.last_name,
                sp.student_number AS matricule, sp.date_of_birth::text AS date_of_birth,
                sp.place_of_birth, sp.is_repeating, sp.gender
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
      const bulletins: any[] = [];
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
            date_of_birth: s.date_of_birth,
            place_of_birth: s.place_of_birth,
            is_repeating: s.is_repeating,
            gender: s.gender,
          },
          effectif
        );
        await this.attachGeneratedMeta(client, tenantId, semestreId, s.student_id, b);
        bulletins.push(b);
      }
      // Rang : nombre d'étudiants ayant une moyenne strictement supérieure + 1.
      // Calculé AVANT le filtrage, sur la promotion entière : exclure les
      // étudiants en attente de Session 2 du document ne doit pas remonter
      // artificiellement le rang des autres.
      for (const b of bulletins) {
        b.rang =
          b.moyenne_session == null
            ? null
            : bulletins.filter(
                (o) => o.moyenne_session != null && o.moyenne_session > b.moyenne_session
              ).length + 1;
      }
      return ok(bulletins.filter((b) => !enAttenteSession2(b)));
    });
  }

  /**
   * Historique des bulletins d'une filière : semestres (avec statut global et
   * année scolaire dérivés de leurs sessions d'UE), étudiants inscrits et
   * bulletins GÉNÉRÉS (professional_bulletins) — pour la page « Historique ».
   */
  async getBulletinHistory(
    tenantId: string,
    filiereId: string,
    classeNom?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      // Une classe peut porter plusieurs noms : sans ce filtre, l'historique
      // de l'un afficherait les étudiants et les bulletins de l'autre.
      const NOM = `btrim(split_part(s.libelle, ' ' || chr(8212) || ' ', 1))`;
      const fil = await client.query(
        `SELECT id, name, code, domaine FROM programmes WHERE id=$1 AND tenant_id=$2`,
        [filiereId, tenantId]
      );
      if (fil.rowCount === 0) return fail("FILIERE_NOT_FOUND", "Filière introuvable.");

      // Semestres + agrégat de leurs sessions d'UE (2 chemins de liaison).
      const sems = await client.query(
        `SELECT sm.id, sm.libelle, sm.bulletins_clotures_at,
                min(s.date_debut)::text AS date_debut,
                max(s.date_fin)::text AS date_fin,
                count(DISTINCT s.id)::int AS nb_sessions,
                count(DISTINCT s.id) FILTER (WHERE s.statut NOT IN ('termine','annule'))::int AS nb_actives,
                count(DISTINCT b.id)::int AS nb_bulletins,
                count(DISTINCT b.id) FILTER (WHERE b.statut <> 'definitif')::int AS nb_bulletins_non_definitifs
         FROM professional_semestres sm
         LEFT JOIN LATERAL (
           SELECT DISTINCT s.id, s.date_debut, s.date_fin, s.statut
           FROM professional_ue_sessions s
           WHERE s.tenant_id = sm.tenant_id AND (
             s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                      WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
             OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                            WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
           )
         ) s ON TRUE
         LEFT JOIN professional_bulletins b
           ON b.semestre_id = sm.id AND b.tenant_id = sm.tenant_id
         WHERE sm.tenant_id = $1 AND sm.filiere_id = $2
           AND ($3::text IS NULL OR EXISTS (
             SELECT 1 FROM professional_semestre_sessions ss2
             JOIN professional_ue_sessions s2 ON s2.id = ss2.ue_session_id
             WHERE ss2.semestre_id = sm.id AND ss2.tenant_id = sm.tenant_id
               AND btrim(split_part(s2.libelle, ' ' || chr(8212) || ' ', 1)) = $3
           ))
         GROUP BY sm.id, sm.libelle, sm.bulletins_clotures_at
         ORDER BY sm.libelle`,
        [tenantId, filiereId, classeNom ?? null]
      );
      const semestres = sems.rows.map((r) => {
        let statut: "en_cours" | "terminee" | "aucune";
        if (Number(r.nb_sessions) === 0) statut = "aucune";
        else if (Number(r.nb_bulletins) > 0 && Number(r.nb_bulletins_non_definitifs) === 0) statut = "terminee";
        else if (Number(r.nb_actives) === 0) statut = "terminee";
        else statut = "en_cours";
        // Année scolaire (pivot septembre) dérivée de la 1re date de début.
        let annee: string | null = null;
        if (r.date_debut) {
          const d = new Date(r.date_debut);
          if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            annee = d.getMonth() + 1 >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
          }
        }
        return {
          id: r.id,
          libelle: r.libelle,
          date_debut: r.date_debut,
          date_fin: r.date_fin,
          statut,
          annee_scolaire: annee,
          bulletins_clotures_at: r.bulletins_clotures_at,
        };
      });

      // Étudiants inscrits (confirmés/terminés) sur les UE de la filière.
      // Matricule pro (IPAM…) de la filière prioritaire sur le numéro brut.
      const students = await client.query(
        `SELECT DISTINCT en.student_id, u.first_name, u.last_name,
                COALESCE(psm.matricule, sp.student_number) AS matricule
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
         JOIN student_profiles sp ON sp.id = en.student_id
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN professional_student_matricules psm
                ON psm.student_id = en.student_id AND psm.filiere_id = $2
               AND psm.tenant_id = $1
         WHERE en.tenant_id = $1 AND en.statut IN ('confirmee','terminee')
           AND ue.filiere_id = $2
           AND ($3::text IS NULL OR ${NOM} = $3)
         ORDER BY u.last_name, u.first_name`,
        [tenantId, filiereId, classeNom ?? null]
      );

      // Bulletins générés de ces semestres.
      const bulletins = await client.query(
        `SELECT b.student_id, b.semestre_id, b.statut, b.generated_at,
                (b.data->>'moyenne_session')::float8 AS moyenne_session,
                (b.data->>'credits_valides')::int AS credits_valides,
                (b.data->>'credits_total')::int AS credits_total,
                b.data->>'decision' AS decision,
                b.data->>'statut_etudiant' AS statut_etudiant
         FROM professional_bulletins b
         JOIN professional_semestres sm ON sm.id = b.semestre_id AND sm.tenant_id = b.tenant_id
         WHERE b.tenant_id = $1 AND sm.filiere_id = $2
           AND ($3::text IS NULL OR b.semestre_id = ANY($4::uuid[]))`,
        [tenantId, filiereId, classeNom ?? null, semestres.map((x) => x.id)]
      );

      return ok({
        filiere: fil.rows[0],
        semestres,
        students: students.rows,
        bulletins: bulletins.rows,
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

  /**
   * Clôture les bulletins d'un semestre : ils sont arrêtés, le semestre quitte
   * la page de travail « Bulletins & moyennes » pour l'historique, où il est en
   * lecture seule. `generateBulletins` le refuse ensuite.
   *
   * À NE PAS CONFONDRE avec la clôture des NOTES
   * (`professional-semestre.service.ts` → `cloturerSemestre`), qui passe les
   * cohortes d'UE en « terminé ». Les deux gestes sont indépendants et dans cet
   * ordre : clôturer les notes, générer les bulletins, clôturer les bulletins.
   *
   * Refus si aucun bulletin n'a été généré : clôturer un semestre vide
   * l'archiverait sans document, donc sans rien à consulter dans l'historique.
   *
   * Idempotent : un semestre déjà clôturé n'est pas re-daté.
   */
  async cloturerBulletins(
    tenantId: string,
    semestreId: string,
    userId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sem = await this.loadSemestre(client, tenantId, semestreId);
      if (!sem) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");
      if (sem.bulletins_clotures_at) {
        return ok({
          id: semestreId,
          libelle: sem.libelle,
          bulletins_clotures_at: sem.bulletins_clotures_at,
          deja_cloture: true,
        });
      }

      const nb = await client.query(
        `SELECT count(*)::int AS n FROM professional_bulletins
         WHERE tenant_id = $1 AND semestre_id = $2`,
        [tenantId, semestreId]
      );
      if (Number(nb.rows[0].n) === 0) {
        return fail(
          "AUCUN_BULLETIN",
          "Aucun bulletin généré pour ce semestre : générez-les avant de clôturer."
        );
      }

      const res = await client.query(
        `UPDATE professional_semestres
         SET bulletins_clotures_at = now(),
             bulletins_clotures_par = $3,
             updated_at = now()
         WHERE id = $2 AND tenant_id = $1 AND bulletins_clotures_at IS NULL
         RETURNING bulletins_clotures_at`,
        [tenantId, semestreId, userId ?? null]
      );
      return ok({
        id: semestreId,
        libelle: sem.libelle,
        bulletins: Number(nb.rows[0].n),
        bulletins_clotures_at: res.rows[0]?.bulletins_clotures_at ?? null,
        deja_cloture: false,
      });
    });
  }

  private async loadSemestre(
    client: PoolClient,
    tenantId: string,
    semestreId: string
  ): Promise<any | null> {
    const r = await client.query(
      `SELECT sm.id, sm.libelle, sm.filiere_id, sm.bulletins_clotures_at,
              p.name AS filiere_nom, p.code AS filiere_code, p.domaine AS filiere_domaine
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
    // Matricule PROFESSIONNEL de la filière (IPAM…) prioritaire sur le numéro
    // d'établissement générique — pour l'affichage du bulletin et sa référence.
    if (sem.filiere_id) {
      const pm = await client.query(
        `SELECT matricule FROM professional_student_matricules
         WHERE tenant_id = $1 AND filiere_id = $2 AND student_id = $3 LIMIT 1`,
        [tenantId, sem.filiere_id, student.id]
      );
      if ((pm.rowCount ?? 0) > 0 && pm.rows[0].matricule) {
        student = { ...student, matricule: pm.rows[0].matricule as string };
      }
    }

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
          // Session dans laquelle l'ECUE a été validée (1 normale, 2 rattrapage).
          session_obtention:
            calc.validee && e.session_obtention != null
              ? Number(e.session_obtention)
              : calc.validee
              ? e.validee_manuellement === true
                ? 2
                : 1
              : null,
          result_id: e.result_id ?? null,
        };
      });
      // Session de validation de l'UE (LMD) : la plus élevée des sessions
      // d'obtention de ses ECUE validées (2 dès qu'un rattrapage a servi),
      // ou 2 si une ECUE n'a été validée que par le jury. Non validée → null.
      const sessionsEcue = ue._ecues
        .filter((e: any) => e.session_obtention != null)
        .map((e: any) => Number(e.session_obtention));
      const valideeManuel = ue._ecues.some((e: any) => e.validee_manuellement === true);
      const session_validation = res.validee
        ? Math.max(1, ...(sessionsEcue.length ? sessionsEcue : [valideeManuel ? 2 : 1]))
        : null;
      // État LMD de l'UE : validée / en rattrapage (session 2 pas encore
      // tentée) / en dette (encore non validée après un passage en session 2).
      const aTenteS2 = ue._ecues.some((e: any) => e.ecue_has_s2 === true);
      const etat: "validee" | "rattrapage" | "dette" = res.validee
        ? "validee"
        : aTenteS2
        ? "dette"
        : "rattrapage";
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
        session_validation,
        etat,
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
        // « Conduite (S1) » → « Conduite » (on retire le suffixe entre parenthèses).
        libelle: String(cr.ue_libelle ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim() || "Conduite",
        categorie: cr.categorie ?? null,
        credits: cr.credits ?? 0,
        nb_uv: cr.nb_uv,
        moyenne_ue: note,
        validee,
        session_validation: validee ? 1 : null,
        etat: validee ? "validee" : "dette",
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
            session_obtention: validee ? 1 : null,
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
    // LMD : pas de compensation entre UE — le semestre est validé UNIQUEMENT
    // lorsque TOUTES les UE sont validées.
    const semValide = ues.every((u) => u.validee);
    // Statut LMD de l'étudiant sur le semestre :
    //  - valide   : toutes les UE validées ;
    //  - session2 : au moins une UE en rattrapage (session 2 pas encore tentée) ;
    //  - dette    : toutes les UE non validées ont déjà été tentées en session 2
    //               → dette (à trancher au niveau ANNÉE selon les crédits).
    const anyRattrapage = ues.some((u) => u.etat === "rattrapage");
    const statut_etudiant: "valide" | "session2" | "dette" = semValide
      ? "valide"
      : anyRattrapage
      ? "session2"
      : "dette";
    const decision = semValide ? "admis" : anyRattrapage ? "rattrapage" : "ajourne";

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
    // Session globale : celle à laquelle l'étudiant a sécurisé tous ses crédits
    // = la plus élevée parmi les UE validées (Session 2 si au moins une UE l'a
    // été en rattrapage). Défaut Session 1.
    const sessionsValidees = ues
      .filter((u) => u.validee)
      .map((u) => u.session_validation ?? 1);
    const session_globale = sessionsValidees.length > 0 ? Math.max(...sessionsValidees) : 1;

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
      filiere: {
        id: sem.filiere_id,
        name: sem.filiere_nom,
        code: sem.filiere_code,
        domaine: sem.filiere_domaine ?? null,
      },
      semestre: { id: sem.id, libelle: sem.libelle },
      annee_academique: anneeAcademique,
      effectif: effectif ?? null,
      reference,
      rang: null as number | null,
      nb_ue_validees: nbUeValidees,
      nb_ue_total: ues.length,
      session_globale,
      statut_etudiant,
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
