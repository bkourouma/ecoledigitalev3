import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerPersonnesQuery, OwnerPersonnesResponse } from "@ecoledigitale/contracts";
import { CLE_NOM_DE_CLASSE_SQL, anneeDe } from "./owner-pro-annee.sql";

/**
 * Démographie et état des comptes : étudiants, enseignants, parents.
 *
 * Pièges appliqués :
 *  - §4.4-9  on ne passe JAMAIS par GET /api/v1/students : cet endpoint déclenche
 *            `enforceSequentialMatricules()`, qui réécrit les matricules de tout le
 *            tenant à chaque appel. On requête `student_profiles` directement.
 *  - §4.4-10 il n'existe pas de table `parents` : un parent est une ligne `users`
 *            portant le rôle `parent`, hors comptes techniques.
 *  - §4.4-11 `teachers.user_id` est nullable — on remonte les enseignants sans
 *            compte plutôt que de les exclure silencieusement.
 *
 * D'OÙ VIENT L'APPARTENANCE À UNE FILIÈRE — corrigé.
 *
 * Le périmètre passait par student_enrollments puis classes.programme_id. Cette
 * table est VIDE : le LEFT JOIN rendait programme_id NULL, la comparaison
 * échouait, et choisir une filière — n'importe laquelle, y compris celles qui
 * comptent 20 ou 40 étudiants — ramenait l'écran entier à zéro. Effectif,
 * répartition par sexe, pyramide des âges et nationalités disparaissaient
 * ensemble, et le bloc « Effectifs par filière » était vide pour la même raison.
 *
 * L'appartenance se lit désormais dans student_filiere, qui réunit DEUX voies :
 * l'inscription professionnelle (ouverture de classe → UE → filière) et
 * l'inscription scolaire, conservée pour le jour où elle portera des lignes.
 * Vérifié sur cette base : les 60 étudiants actifs sont exactement les 60
 * étudiants du module professionnel.
 *
 * POURQUOI UNE ANNÉE EST NÉCESSAIRE ICI
 *
 * Un étudiant traverse plusieurs filières au fil de son cursus. Sans année, la
 * somme des effectifs par filière vaut 140 pour 60 personnes — chacune comptée
 * une fois par promotion suivie. Avec une année, la somme retombe sur l'effectif
 * réel. C'est le seul écran où l'absence d'année ne produit pas un cumul lisible
 * mais un double comptage, et l'en-tête le dit quand aucune année n'est choisie.
 *
 * Deux limites du modèle, assumées et exposées à l'écran :
 *  - `student_profiles.is_repeating` n'existe dans AUCUNE migration (la colonne du
 *    même nom vit sur `student_enrollments`, migration 0059). L'indicateur
 *    « étudiants redoublants » du brief n'est donc pas calculable ici : il n'est
 *    pas produit plutôt que d'être approximé.
 *  - aucune colonne ne trace l'ENVOI des identifiants. On mesure la présence de
 *    `users.initial_password`, ce qui dit « généré », pas « transmis ».
 */

/** Nombre de nationalités remontées. */
export const OWNER_PERSONNES_TOP_NATIONALITIES = 10;

/** Amplitude des tranches d'âge, en années. */
export const OWNER_PERSONNES_AGE_BUCKET = 2;

/**
 * Millésime de l'année scolaire en cours, pivot septembre.
 *
 * Sert de référence aux files de relance quand la barre ne fixe aucune année :
 * « non réinscrit » n'a de sens que par rapport à une année précise, et
 * « toutes années » en donnerait zéro par construction — tout étudiant déjà
 * inscrit appartient à l'ensemble de toutes les années.
 */
function anneeCourante(): string {
  const d = new Date();
  const debut = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${debut}-${debut + 1}`;
}

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
    log.warn({ err: e, label }, "owner personnes query failed");
    return [];
  }
}

/**
 * Rattachement (étudiant, filière, année scolaire).
 *
 * Deux voies réunies par UNION — donc dédoublonnées : un étudiant inscrit des
 * deux côtés sur la même filière et la même année n'y figure qu'une fois.
 *
 * $1 tenant.
 */
const STUDENT_FILIERE_CTE = `
  student_filiere AS (
    -- Voie PROFESSIONNELLE : la filière vient de l'UE de l'ouverture suivie, et
    -- l'année se déduit de sa date de début (pivot septembre).
    -- L alias de l UE est ue et non u : c est celui qu attend le fragment
    -- partage qui derive le nom de classe. Une seule definition du nom pour
    -- toute l application.
    SELECT pe.student_id, ue.filiere_id, ${anneeDe("s.date_debut")} AS annee,
           ${CLE_NOM_DE_CLASSE_SQL} AS cle_classe
      FROM professional_enrollments pe
      JOIN professional_ue_sessions s
        ON s.id = pe.ue_session_id AND s.tenant_id = pe.tenant_id
      JOIN professional_ue ue
        ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
     WHERE pe.tenant_id = $1::uuid
       AND pe.statut <> 'annulee'
       AND ue.filiere_id IS NOT NULL
       AND s.date_debut IS NOT NULL
    UNION
    -- Voie SCOLAIRE, sans lignes sur cette base mais conservée : le jour où des
    -- inscriptions y seront saisies, filtre et effectifs les prendront seuls.
    SELECT se.student_id, cl.programme_id AS filiere_id, ay.name AS annee, NULL::text
      FROM student_enrollments se
      JOIN classes cl ON cl.id = se.class_id AND cl.tenant_id = se.tenant_id
      LEFT JOIN academic_years ay
        ON ay.id = se.academic_year_id AND ay.tenant_id = se.tenant_id
     WHERE se.tenant_id = $1::uuid
       AND se.status = 'active'
       AND cl.programme_id IS NOT NULL
  )`;

/**
 * Étudiants du périmètre.
 * $1 tenant, $2 anneeScolaire (text | null), $3 filiereIds (uuid[] | null).
 *
 * Sans aucun filtre, TOUS les étudiants actifs — y compris ceux qu'aucune
 * inscription ne rattache encore à une filière, qu'un EXISTS inconditionnel
 * ferait disparaître de leur propre établissement.
 *
 * Requiert STUDENT_FILIERE_CTE en amont.
 */
const STUDENT_SCOPE_CTE = `
  student_scope AS (
    SELECT sp.id, sp.gender::text AS gender, sp.date_of_birth,
           sp.nationality, sp.user_id
    FROM student_profiles sp
    WHERE sp.tenant_id = $1::uuid
      AND sp.status = 'active'
      AND (
        ($2::text IS NULL AND $3::uuid[] IS NULL AND $4::text IS NULL)
        OR EXISTS (
          SELECT 1 FROM student_filiere f
           WHERE f.student_id = sp.id
             AND ($3::uuid[] IS NULL OR f.filiere_id = ANY($3::uuid[]))
             AND ($2::text IS NULL OR f.annee = $2::text)
             AND ($4::text IS NULL OR f.cle_classe = $4::text)
        )
      )
      -- LE SEMESTRE N EST PAS UNE DIMENSION DE LA DEMOGRAPHIE, mais le contrat
      -- de perimetre le fournit a toutes les requetes : Postgres exige de
      -- pouvoir typer chaque parametre transmis, et refuse la requete entiere
      -- sinon. La condition est donc toujours vraie — elle ne sert qu au
      -- typage, comme le fait deja ACADEMIC_WINDOW_CTE pour le tenant.
      AND ($5::uuid IS NULL OR TRUE)
  )`;

/**
 * Enseignants du périmètre, mêmes paramètres.
 *
 * Sans cette restriction, « 30 enseignants » et le ratio étudiants/enseignant
 * décrivaient toute l'histoire de l'établissement pendant que l'effectif, lui,
 * décrivait une filière et une année : deux moitiés d'écran parlant d'écoles
 * différentes.
 */
const TEACHER_SCOPE_CTE = `
  teacher_scope AS (
    SELECT t.*
    FROM teachers t
    WHERE t.tenant_id = $1::uuid
      AND (
        ($2::text IS NULL AND $3::uuid[] IS NULL AND $4::text IS NULL)
        OR EXISTS (
          SELECT 1
            FROM professional_session_ecue_teachers st
            JOIN professional_ue_sessions s
              ON s.id = st.ue_session_id AND s.tenant_id = st.tenant_id
            JOIN professional_ue ue
              ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
           WHERE st.enseignant_id = t.id
             AND st.tenant_id = t.tenant_id
             AND ($3::uuid[] IS NULL OR ue.filiere_id = ANY($3::uuid[]))
             AND ($2::text IS NULL OR ${anneeDe("s.date_debut")} = $2::text)
             AND ($4::text IS NULL OR ${CLE_NOM_DE_CLASSE_SQL} = $4::text)
        )
      )
      -- LE SEMESTRE N EST PAS UNE DIMENSION DE LA DEMOGRAPHIE, mais le contrat
      -- de perimetre le fournit a toutes les requetes : Postgres exige de
      -- pouvoir typer chaque parametre transmis, et refuse la requete entiere
      -- sinon. La condition est donc toujours vraie — elle ne sert qu au
      -- typage, comme le fait deja ACADEMIC_WINDOW_CTE pour le tenant.
      AND ($5::uuid IS NULL OR TRUE)
  )`;

/** Parents rattachés à un étudiant du périmètre. Requiert student_scope. */
const PARENT_SCOPE_SQL = `
  SELECT sp.parent_id
    FROM student_parents sp
    JOIN student_scope ss ON ss.id = sp.student_id
   WHERE sp.tenant_id = $1::uuid`;

export async function fetchOwnerPersonnes(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerPersonnesQuery
): Promise<OwnerPersonnesResponse> {
  const anneeScolaire = filters.anneeScolaire ?? null;
  const filiereIds =
    filters.filiereIds && filters.filiereIds.length > 0 ? filters.filiereIds : null;

  /*
     Contrat de owner-perimetre.sql. Ce service numerotait deja
     [tenant, annee, filieres] : il suffit de completer.

     Le nom de classe agit sur les TROIS perimetres — etudiants, enseignants et
     parents. Ne le brancher que sur les etudiants aurait laisse le ratio
     etudiants/enseignant comparer une classe a tout l etablissement.
  */
  const nomClasse = filters.nomClasse?.trim() ? filters.nomClasse.trim() : null;
  const semestreId = filters.semestreId ?? null;
  const scopeParams = [tenantId, anneeScolaire, filiereIds, nomClasse, semestreId];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- KPI ---- */
    const kpiRows = await safeQuery<{
      active_students: string | number;
      active_teachers: string | number;
      parents: string | number;
      accounts_without_credentials: string | number;
    }>(
      client,
      `WITH ${STUDENT_FILIERE_CTE}, ${STUDENT_SCOPE_CTE}, ${TEACHER_SCOPE_CTE}
       SELECT (SELECT COUNT(*) FROM student_scope)::int AS active_students,
              (SELECT COUNT(*) FROM teacher_scope
                WHERE status = 'active')::int AS active_teachers,
              -- §4.4-10 : pas de table parents, un parent est une ligne users.
              -- Comptés par leur RATTACHEMENT aux étudiants du périmètre, et non
              -- par leur rôle : sinon choisir une filière changeait l'effectif
              -- sans jamais changer le nombre de parents.
              (SELECT COUNT(DISTINCT parent_id) FROM (${PARENT_SCOPE_SQL}) p)::int AS parents,
              -- Recentré sur les personnes dont l'écran parle. Il comptait
              -- auparavant tous les comptes du tenant — propriétaire, comptes
              -- d'administration — sur un écran d'effectifs.
              (SELECT COUNT(*) FROM users u
                WHERE u.tenant_id = $1::uuid
                  AND COALESCE(u.is_technical_account, false) = false
                  AND u.initial_password IS NULL
                  AND (u.id IN (SELECT user_id FROM student_scope WHERE user_id IS NOT NULL)
                    OR u.id IN (SELECT user_id FROM teacher_scope WHERE user_id IS NOT NULL)
                    OR u.id IN (${PARENT_SCOPE_SQL})))::int AS accounts_without_credentials`,
      scopeParams,
      log,
      "kpis"
    );

    const k = kpiRows[0] ?? {
      active_students: 0,
      active_teachers: 0,
      parents: 0,
      accounts_without_credentials: 0,
    };
    const activeStudents = Number(k.active_students) || 0;
    const activeTeachers = Number(k.active_teachers) || 0;

    /* ---- Répartition par sexe ---- */
    const genderRows = await safeQuery<{ gender: string | null; count: string | number }>(
      client,
      `WITH ${STUDENT_FILIERE_CTE}, ${STUDENT_SCOPE_CTE}
       -- La colonne gender est déclarée en ENUM par 0042 et en TEXT par 0079, les
       -- deux en IF NOT EXISTS : le type réel dépend de l'ordre d'application.
       -- Le cast ::text en amont rend la requête indépendante de ce choix.
       SELECT NULLIF(LOWER(TRIM(gender)), '') AS gender, COUNT(*)::int AS count
       FROM student_scope
       GROUP BY NULLIF(LOWER(TRIM(gender)), '')
       ORDER BY count DESC`,
      scopeParams,
      log,
      "genderDistribution"
    );

    /* ---- Pyramide des âges ---- */
    const ageRows = await safeQuery<{ bucket_start: string | number; count: string | number }>(
      client,
      `WITH ${STUDENT_FILIERE_CTE}, ${STUDENT_SCOPE_CTE}
       SELECT (FLOOR(EXTRACT(YEAR FROM AGE(date_of_birth)) / $6::int) * $6::int)::int
                AS bucket_start,
              COUNT(*)::int AS count
       FROM student_scope
       WHERE date_of_birth IS NOT NULL
         -- Garde-fou : des dates de naissance aberrantes existent en saisie libre
         -- et écraseraient l'échelle de la pyramide.
         AND EXTRACT(YEAR FROM AGE(date_of_birth)) BETWEEN 5 AND 100
       GROUP BY bucket_start
       ORDER BY bucket_start`,
      [...scopeParams, OWNER_PERSONNES_AGE_BUCKET],
      log,
      "agePyramid"
    );

    /* ---- Effectifs par filière ---- */
    const headcountRows = await safeQuery<{
      filiere_id: string;
      filiere_name: string;
      cycle_name: string | null;
      count: string | number;
    }>(
      client,
      // La restriction d'année porte sur le RATTACHEMENT, pas seulement sur le
      // périmètre : sans elle, un étudiant passé par cinq promotions serait
      // compté dans les cinq, et la somme des barres dépasserait l'effectif.
      `WITH ${STUDENT_FILIERE_CTE}, ${STUDENT_SCOPE_CTE}
       SELECT p.id AS filiere_id, p.name AS filiere_name, c.name AS cycle_name,
              COUNT(DISTINCT sf.student_id)::int AS count
       FROM student_filiere sf
       JOIN student_scope ss ON ss.id = sf.student_id
       JOIN programmes p ON p.id = sf.filiere_id AND p.tenant_id = $1::uuid
       LEFT JOIN cycles c ON c.id = p.cycle_id AND c.tenant_id = p.tenant_id
       WHERE ($2::text IS NULL OR sf.annee = $2::text)
         AND ($3::uuid[] IS NULL OR p.id = ANY($3::uuid[]))
       GROUP BY p.id, p.name, c.name
       ORDER BY count DESC, p.name`,
      scopeParams,
      log,
      "headcountByFiliere"
    );

    /* ---- Enseignants par type de contrat ---- */
    const contractRows = await safeQuery<{
      contract_type: string;
      count: string | number;
    }>(
      client,
      `WITH ${TEACHER_SCOPE_CTE}
       SELECT t.contract_type::text AS contract_type, COUNT(*)::int AS count
       FROM teacher_scope t
       WHERE t.status = 'active'
       GROUP BY t.contract_type
       ORDER BY count DESC`,
      scopeParams,
      log,
      "teachersByContract"
    );

    /* ---- Détail enseignants ---- */
    const teacherRows = await safeQuery<{
      teacher_id: string;
      teacher_name: string;
      contract_type: string;
      status: string;
      hire_date: Date | string | null;
      seniority_years: string | number | null;
      ecue_count: string | number;
      filiere_count: string | number;
      has_user_account: boolean;
    }>(
      client,
      `WITH ${TEACHER_SCOPE_CTE}
       SELECT t.id AS teacher_id,
              TRIM(t.first_name || ' ' || t.last_name) AS teacher_name,
              t.contract_type::text AS contract_type,
              t.status::text AS status,
              t.hire_date,
              CASE WHEN t.hire_date IS NULL THEN NULL
                   ELSE EXTRACT(YEAR FROM AGE(t.hire_date))::int END AS seniority_years,
              (SELECT COUNT(DISTINCT st.ecue_id)
                 FROM professional_session_ecue_teachers st
                WHERE st.enseignant_id = t.id AND st.tenant_id = t.tenant_id)::int AS ecue_count,
              (SELECT COUNT(DISTINCT u.filiere_id)
                 FROM professional_session_ecue_teachers st
                 JOIN professional_ue_sessions s
                      ON s.id = st.ue_session_id AND s.tenant_id = st.tenant_id
                 JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
                WHERE st.enseignant_id = t.id AND st.tenant_id = t.tenant_id)::int AS filiere_count,
              (t.user_id IS NOT NULL) AS has_user_account
       FROM teacher_scope t
       ORDER BY t.last_name, t.first_name
       LIMIT 200`,
      scopeParams,
      log,
      "teachers"
    );

    /* ---- Nationalités ---- */
    const nationalityRows = await safeQuery<{
      nationality: string;
      count: string | number;
    }>(
      client,
      `WITH ${STUDENT_FILIERE_CTE}, ${STUDENT_SCOPE_CTE}
       SELECT TRIM(nationality) AS nationality, COUNT(*)::int AS count
       FROM student_scope
       WHERE NULLIF(TRIM(nationality), '') IS NOT NULL
       GROUP BY TRIM(nationality)
       ORDER BY count DESC, nationality
       LIMIT $6::int`,
      [...scopeParams, OWNER_PERSONNES_TOP_NATIONALITIES],
      log,
      "topNationalities"
    );

    /* ---- Indicateurs de couverture ---- */
    const coverageRows = await safeQuery<{
      students_without_parent: string | number;
      parents_without_child: string | number;
      teachers_without_account: string | number;
      students_without_birth_date: string | number;
    }>(
      client,
      `WITH ${STUDENT_FILIERE_CTE}, ${STUDENT_SCOPE_CTE}, ${TEACHER_SCOPE_CTE}
       SELECT (SELECT COUNT(*) FROM student_scope ss
                WHERE NOT EXISTS (
                  SELECT 1 FROM student_parents sp2
                  WHERE sp2.student_id = ss.id AND sp2.tenant_id = $1::uuid
                ))::int AS students_without_parent,
              (SELECT COUNT(DISTINCT u.id)
                 FROM users u
                 JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
                 JOIN roles r ON r.id = ur.role_id AND r.key = 'parent'
                WHERE u.tenant_id = $1::uuid
                  AND COALESCE(u.is_technical_account, false) = false
                  AND NOT EXISTS (
                    SELECT 1 FROM student_parents sp3
                    WHERE sp3.parent_id = u.id AND sp3.tenant_id = u.tenant_id
                  ))::int AS parents_without_child,
              (SELECT COUNT(*) FROM teacher_scope
                WHERE user_id IS NULL)::int
                AS teachers_without_account,
              (SELECT COUNT(*) FROM student_scope
                WHERE date_of_birth IS NULL)::int AS students_without_birth_date`,
      scopeParams,
      log,
      "coverage"
    );

    const cov = coverageRows[0] ?? {
      students_without_parent: 0,
      parents_without_child: 0,
      teachers_without_account: 0,
      students_without_birth_date: 0,
    };

    /* ---- Files de relance nominatives -------------------------------------- */
    /*
       Deux listes, une seule question : qui, nommément, représente de l'argent
       qu'on ne fait pas travailler ?

       Elles ne suivent PAS le filtre d'année de l'écran, et c'est délibéré : un
       étudiant « à relancer » se définit par son ABSENCE de l'année active,
       donc le filtre qui le masquerait est exactement celui qu'il faut ignorer.
       L'année de référence est celle de la barre, ou l'année en cours à défaut.
    */
    const relanceRows = await safeQuery<Record<string, unknown>>(
      client,
      `WITH ${STUDENT_FILIERE_CTE}
       SELECT sp.id AS student_id,
              TRIM(COALESCE(us.first_name, '') || ' ' || COALESCE(us.last_name, '')) AS nom,
              sp.student_matricule AS matricule,
              /* Le telephone vit sur student_profiles, pas sur users : la
                 premiere version citait us.phone et TOUTE la requete etait
                 avalee par safeQuery — une file de relance vide qui avait
                 l air veridique. */
              sp.phone AS telephone,
              us.email,
              (SELECT pr.name FROM student_filiere sf
                 JOIN programmes pr ON pr.id = sf.filiere_id
                WHERE sf.student_id = sp.id
                ORDER BY sf.annee DESC NULLS LAST LIMIT 1)   AS derniere_classe,
              (SELECT sf.annee FROM student_filiere sf
                WHERE sf.student_id = sp.id
                ORDER BY sf.annee DESC NULLS LAST LIMIT 1)   AS derniere_annee,
              COUNT(*) OVER ()::int                          AS total
         FROM student_profiles sp
         LEFT JOIN users us ON us.id = sp.user_id AND us.tenant_id = sp.tenant_id
        WHERE sp.tenant_id = $1::uuid
          AND sp.status = 'active'
          /* Il a deja ete inscrit : sans cela, tout prospect jamais inscrit
             entrerait dans une file de REinscription. */
          AND EXISTS (SELECT 1 FROM student_filiere sf WHERE sf.student_id = sp.id)
          /* Mais pas sur l annee de reference. */
          AND NOT EXISTS (
            SELECT 1 FROM student_filiere sf
             WHERE sf.student_id = sp.id AND sf.annee = $2::text)
        ORDER BY derniere_annee DESC NULLS LAST, nom
        LIMIT 100`,
      [tenantId, anneeScolaire ?? anneeCourante()],
      log,
      "etudiantsARelancer"
    );

    /*
       Enseignants sans aucune affectation d'ECUE.

       Le type de contrat figure au meme rang que le nom, parce qu'il change
       tout : un PERMANENT sans affectation est un cout fixe dormant, un
       FREELANCE sans affectation ne coute rien. Une liste qui les melangerait
       ne servirait a aucune decision.
    */
    const inactifRows = await safeQuery<Record<string, unknown>>(
      client,
      `SELECT te.id AS teacher_id,
              TRIM(COALESCE(us.first_name, '') || ' ' || COALESCE(us.last_name, '')) AS nom,
              te.contract_type::text AS contract_type,
              /* Cout mensuel : salaire fixe s il existe, sinon rien. Un taux
                 horaire sans volume ne fait pas un cout mensuel, et l inventer
                 reviendrait a chiffrer une hypothese. */
              cfg.monthly_salary::float8 AS cout_mensuel,
              COUNT(*) OVER ()::int AS total,
              SUM(CASE WHEN te.contract_type::text = 'permanent' THEN 1 ELSE 0 END)
                OVER ()::int AS total_permanents,
              COUNT(cfg.monthly_salary) OVER ()::int AS total_chiffres
         FROM teachers te
         LEFT JOIN users us ON us.id = te.user_id AND us.tenant_id = te.tenant_id
         LEFT JOIN teacher_payment_configs cfg
           ON cfg.teacher_id = te.id AND cfg.tenant_id = te.tenant_id
        WHERE te.tenant_id = $1::uuid
          AND NOT EXISTS (
            SELECT 1 FROM professional_session_ecue_teachers st
             WHERE st.enseignant_id = te.id AND st.tenant_id = te.tenant_id)
        ORDER BY (te.contract_type::text = 'permanent') DESC, nom
        LIMIT 100`,
      [tenantId],
      log,
      "enseignantsInactifs"
    );

    const inactif0 = inactifRows[0] ?? {};

    return {
      anneeScolaire,
      filiereIds: filiereIds ?? [],
      kpis: {
        activeStudents,
        activeTeachers,
        parents: Number(k.parents) || 0,
        studentTeacherRatio:
          activeTeachers > 0
            ? Math.round((activeStudents / activeTeachers) * 10) / 10
            : null,
        accountsWithoutCredentials: Number(k.accounts_without_credentials) || 0,
      },
      genderDistribution: genderRows.map((r) => ({
        gender: r.gender,
        count: Number(r.count) || 0,
      })),
      agePyramid: ageRows.map((r) => ({
        bucketStart: Number(r.bucket_start) || 0,
        count: Number(r.count) || 0,
      })),
      headcountByFiliere: headcountRows.map((r) => ({
        filiereId: r.filiere_id,
        filiereName: r.filiere_name,
        cycleName: r.cycle_name,
        count: Number(r.count) || 0,
      })),
      teachersByContract: contractRows.map((r) => ({
        contractType: r.contract_type,
        count: Number(r.count) || 0,
      })),
      teachers: teacherRows.map((r) => ({
        teacherId: r.teacher_id,
        teacherName: r.teacher_name || "—",
        contractType: r.contract_type,
        status: r.status,
        hireDate:
          r.hire_date instanceof Date
            ? r.hire_date.toISOString().slice(0, 10)
            : r.hire_date
              ? String(r.hire_date).slice(0, 10)
              : null,
        seniorityYears: r.seniority_years === null ? null : Number(r.seniority_years),
        ecueCount: Number(r.ecue_count) || 0,
        filiereCount: Number(r.filiere_count) || 0,
        hasUserAccount: Boolean(r.has_user_account),
      })),
      topNationalities: nationalityRows.map((r) => ({
        nationality: r.nationality,
        count: Number(r.count) || 0,
      })),
      aRelancer: relanceRows.map((r) => ({
        studentId: String(r.student_id),
        nom: String(r.nom || "").trim() || "Étudiant inconnu",
        matricule: (r.matricule as string | null) ?? null,
        telephone: (r.telephone as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        derniereClasse: (r.derniere_classe as string | null) ?? null,
        derniereAnnee: (r.derniere_annee as string | null) ?? null,
      })),
      enseignantsInactifs: inactifRows.map((r) => ({
        teacherId: String(r.teacher_id),
        nom: String(r.nom || "").trim() || "Enseignant inconnu",
        contractType: (r.contract_type as string | null) ?? null,
        /* NULL et non 0 : aucun tarif n'est saisi sur cette base, et un zéro
           se lirait « cet enseignant est gratuit ». */
        coutMensuel: r.cout_mensuel === null || r.cout_mensuel === undefined
          ? null
          : Number(r.cout_mensuel),
      })),
      relances: {
        etudiantsARelancer: relanceRows.length > 0 ? Number(relanceRows[0].total) || 0 : 0,
        enseignantsSansAffectation: Number(inactif0.total) || 0,
        permanentsSansAffectation: Number(inactif0.total_permanents) || 0,
        coutMesure: (Number(inactif0.total_chiffres) || 0) > 0,
      },
      coverage: {
        studentsWithoutParent: Number(cov.students_without_parent) || 0,
        parentsWithoutChild: Number(cov.parents_without_child) || 0,
        teachersWithoutAccount: Number(cov.teachers_without_account) || 0,
        studentsWithoutBirthDate: Number(cov.students_without_birth_date) || 0,
      },
    };
  } finally {
    client.release();
  }
}
