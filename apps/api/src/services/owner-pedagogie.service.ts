import type { Pool, PoolClient } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type {
  OwnerPedagogieQuery,
  OwnerPedagogieResponse,
  OwnerUeCategorie,
} from "@ecoledigitale/contracts";
import { CLE_NOM_DE_CLASSE_SQL } from "./owner-pro-annee.sql";

/**
 * Pilotage pédagogique LMD (module professionnel), toutes filières confondues.
 *
 * Règles de calcul et pièges appliqués ici :
 *  - §4.4-5  double chemin semestre → sessions (legacy `professional_semestre_sessions`
 *            + courant `professional_semestre_ue`) : les deux sont toujours parcourus.
 *  - §4.4-6  la « Conduite » est détectée par heuristique textuelle et exclue des
 *            statistiques de résultats (elle reste comptée dans le bulletin lui-même,
 *            donc dans les KPI issus de `professional_bulletins`).
 *  - §4.4-7  la pondération réelle utilise `professional_ecue.credits`, jamais
 *            `professional_ue_ecue.coefficient` ni `professional_ue.nb_uv`.
 *  - §4.4-8  on requête `professional_ue_sessions` en direct : passer par l'endpoint
 *            `GET /professional/ue-sessions` clôturerait les sessions échues.
 *  - §4.5    la validation de semestre suit la règle du service (`ues.every(validee)`),
 *            pas `semestreValide(credits >= 20)`. On ne recalcule rien : on lit
 *            `data->>'decision'`, déjà produit par cette règle.
 *
 * ⚠️ `professional_bulletins` n'a PAS de Row-Level Security (migration 0083 : ni
 * `ENABLE ROW LEVEL SECURITY`, ni policy). Le `WHERE tenant_id = $1` n'est donc pas
 * une double ceinture sur cette table, c'est la SEULE isolation. Ne jamais l'omettre.
 */

/** Effectif minimum pour qu'une ECUE apparaisse dans le top des échecs (évite le bruit). */
export const OWNER_PEDAGOGIE_MIN_COHORT = 5;

/** Nombre d'ECUE remontées dans le classement des échecs. */
export const OWNER_PEDAGOGIE_TOP_FAILED = 15;

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
    log.warn({ err: e, label }, "owner pedagogie query failed");
    return [];
  }
}

/**
 * Périmètre des semestres : filière + année scolaire + semestre.
 *
 * L'année scolaire n'est pas une colonne : elle est dérivée par pivot septembre sur
 * la première session rattachée au semestre (par l'un OU l'autre des deux chemins).
 *
 * Paramètres attendus : $1 tenantId, $3 filiereIds (uuid[] | null),
 * $5 semestreId (uuid | null), $2 anneeScolaire (text | null).
 */
const SEMESTRE_SCOPE_CTE = `
  semestre_scope AS (
    SELECT sem.id AS semestre_id,
           sem.libelle AS semestre_libelle,
           sem.filiere_id,
           p.name AS filiere_name,
           first_session.date_debut AS first_session_date
    FROM professional_semestres sem
    JOIN programmes p ON p.id = sem.filiere_id AND p.tenant_id = sem.tenant_id
    LEFT JOIN LATERAL (
      -- Piège §4.4-5 : double chemin semestre → sessions.
      SELECT min(s.date_debut) AS date_debut
      FROM professional_ue_sessions s
      WHERE s.tenant_id = sem.tenant_id
        AND (
          s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                   WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
          OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                         WHERE semestre_id = sem.id AND tenant_id = sem.tenant_id)
        )
    ) first_session ON true
    WHERE sem.tenant_id = $1::uuid
      AND ($3::uuid[] IS NULL OR sem.filiere_id = ANY($3::uuid[]))
      AND ($5::uuid IS NULL OR sem.id = $5::uuid)
      AND (
        $2::text IS NULL
        OR first_session.date_debut IS NOT NULL
        AND CASE WHEN EXTRACT(MONTH FROM first_session.date_debut) >= 9
                 THEN EXTRACT(YEAR FROM first_session.date_debut)::int
                 ELSE EXTRACT(YEAR FROM first_session.date_debut)::int - 1
            END = split_part($2::text, '-', 1)::int
      )
  )`;

/**
 * Sessions d'UE du périmètre, dédupliquées.
 *
 * `DISTINCT ON (s.id)` est indispensable : une même session peut être rattachée à
 * plusieurs semestres (par session ET par UE), ce qui dupliquerait chaque résultat
 * ECUE dans les agrégats en aval.
 *
 * Paramètres supplémentaires : $6 statut ('en_cours' | 'termine' | 'tous'),
 * $7 categorie (text | null).
 */
const SESSION_SCOPE_CTE = `
  session_scope AS (
    SELECT DISTINCT ON (s.id)
           s.id AS ue_session_id,
           s.ue_id,
           ss.semestre_id,
           ss.filiere_id,
           ss.filiere_name
    FROM professional_ue_sessions s
    -- Alias de l UE : ue et non u, c est celui qu attend le fragment partage
    -- dérive le nom de classe. Une seule définition du nom pour toute
    -- l'application.
    JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
    JOIN semestre_scope ss ON (
      s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
               WHERE semestre_id = ss.semestre_id AND tenant_id = $1::uuid)
      OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                     WHERE semestre_id = ss.semestre_id AND tenant_id = $1::uuid)
    )
    WHERE s.tenant_id = $1::uuid
      AND ($7::text IS NULL OR ue.categorie = $7::text)
      /* Ouverture de classe — la dimension des écrans d'administration. */
      AND ($4::text IS NULL OR ${CLE_NOM_DE_CLASSE_SQL} = $4::text)
      AND CASE $6::text
            WHEN 'en_cours' THEN s.statut IN ('ouvert', 'complet', 'en_cours')
            WHEN 'termine'  THEN s.statut = 'termine'
            ELSE true
          END
    ORDER BY s.id
  )`;

/**
 * Exclusion de la « Conduite » (§4.4-6). Reprise à l'identique de la constante
 * canonique `NOT_CONDUITE` de professional-results.service.ts : toute divergence
 * de casse ou de motif produirait des chiffres différents de ceux des bulletins.
 */
/**
 * Restriction d un BULLETIN a une ouverture de classe.
 *
 * Un bulletin porte un etudiant et un semestre, jamais une ouverture : le lien
 * passe par les inscriptions. Sans ce fragment, choisir une classe restreignait
 * la sante des UE mais laissait les taux de reussite, les moyennes et les
 * decisions decrire l etablissement entier — deux perimetres sur le meme ecran.
 *
 * Il cite $4, ce qui resout au passage le typage du parametre sur les requetes
 * de bulletins : Postgres refuse une requete dont il ne peut pas typer un
 * parametre transmis, meme inutilise.
 *
 * Alias attendu : `b` = professional_bulletins.
 */
const BULLETIN_CLASSE_SQL = `
  ($4::text IS NULL OR EXISTS (
     SELECT 1
       FROM professional_enrollments en
       JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
       JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
      WHERE en.student_id = b.student_id
        AND en.tenant_id = b.tenant_id
        AND en.statut <> 'annulee'
        AND ${CLE_NOM_DE_CLASSE_SQL} = $4::text
   ))`;

const NOT_CONDUITE = "NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')";

/**
 * Extraction numérique défensive d'une clé JSONB de `professional_bulletins.data`.
 *
 * Le CASE (et non un FILTER) est délibéré : il garantit le court-circuit, donc
 * qu'un bulletin dont la clé contiendrait une chaîne ne fasse pas échouer le cast
 * de toute l'agrégation.
 */
function jsonNumber(key: string): string {
  return `CASE WHEN jsonb_typeof(b.data->'${key}') = 'number'
               THEN (b.data->>'${key}')::float8 END`;
}

export async function fetchOwnerPedagogie(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger,
  filters: OwnerPedagogieQuery
): Promise<OwnerPedagogieResponse> {
  const filiereIds =
    filters.filiereIds && filters.filiereIds.length > 0 ? filters.filiereIds : null;
  const semestreId = filters.semestreId ?? null;
  const anneeScolaire = filters.anneeScolaire ?? null;
  const statut = filters.statut ?? "tous";
  const categorie = filters.categorie ?? null;

  /**
   * Deux jeux de paramètres distincts : PostgreSQL rejette un bind qui fournit plus
   * de paramètres que la requête n'en référence. Les agrégats qui n'utilisent que
   * SEMESTRE_SCOPE_CTE ($1..$2) ne doivent donc pas recevoir statut/categorie.
   */
  /*
     Contrat de owner-perimetre.sql. Ce service ordonnait ses paramètres
     autrement — filière en $2, semestre en $3, année en $4 — et trois rangs se
     croisaient avec le contrat partagé. L'ordre est désormais celui de tous les
     autres services, ce qui rend ses fragments réutilisables.
  */
  const nomClasse = filters.nomClasse?.trim() ? filters.nomClasse.trim() : null;
  const semestreParams = [tenantId, anneeScolaire, filiereIds, nomClasse, semestreId];
  const sessionParams = [...semestreParams, statut, categorie];

  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    /* ---- KPI globaux : lus depuis les bulletins, jamais recalculés ---- */
    const kpiRows = await safeQuery<{
      bulletin_count: string | number;
      admis: string | number;
      rattrapage: string | number;
      definitif: string | number;
      avg_grade: string | number | null;
      credits_valides: string | number | null;
      credits_total: string | number | null;
    }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE}
       SELECT COUNT(*)::int AS bulletin_count,
              COUNT(*) FILTER (WHERE b.data->>'decision' = 'admis')::int AS admis,
              COUNT(*) FILTER (WHERE b.data->>'decision' = 'rattrapage')::int AS rattrapage,
              COUNT(*) FILTER (WHERE b.statut = 'definitif')::int AS definitif,
              AVG(${jsonNumber("moyenne_session")})::float8 AS avg_grade,
              COALESCE(SUM(${jsonNumber("credits_valides")}), 0)::int AS credits_valides,
              COALESCE(SUM(${jsonNumber("credits_total")}), 0)::int AS credits_total
       FROM professional_bulletins b
       JOIN semestre_scope ss ON ss.semestre_id = b.semestre_id
       WHERE b.tenant_id = $1::uuid
         AND ${BULLETIN_CLASSE_SQL}`,
      semestreParams,
      log,
      "kpis"
    );

    const k = kpiRows[0] ?? {
      bulletin_count: 0,
      admis: 0,
      rattrapage: 0,
      definitif: 0,
      avg_grade: 0,
      credits_valides: 0,
      credits_total: 0,
    };
    const bulletinCount = Number(k.bulletin_count) || 0;
    const creditsValidated = Number(k.credits_valides) || 0;
    const creditsTotal = Number(k.credits_total) || 0;
    const pct = (n: number) =>
      bulletinCount > 0 ? Math.round((n * 1000) / bulletinCount) / 10 : 0;

    /* ---- Décisions par filière (barres empilées) ---- */
    const decisionRows = await safeQuery<{
      filiere_id: string;
      filiere_name: string;
      admis: string | number;
      rattrapage: string | number;
      ajourne: string | number;
      total: string | number;
    }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE}
       SELECT ss.filiere_id,
              ss.filiere_name,
              COUNT(*) FILTER (WHERE b.data->>'decision' = 'admis')::int AS admis,
              COUNT(*) FILTER (WHERE b.data->>'decision' = 'rattrapage')::int AS rattrapage,
              COUNT(*) FILTER (WHERE b.data->>'decision' = 'ajourne')::int AS ajourne,
              COUNT(*)::int AS total
       FROM professional_bulletins b
       JOIN semestre_scope ss ON ss.semestre_id = b.semestre_id
       WHERE b.tenant_id = $1::uuid
         AND ${BULLETIN_CLASSE_SQL}
       GROUP BY ss.filiere_id, ss.filiere_name
       ORDER BY ss.filiere_name`,
      semestreParams,
      log,
      "decisionsByFiliere"
    );

    /* ---- Moyenne par semestre et par filière (courbe multi-séries) ---- */
    const semestreRows = await safeQuery<{
      semestre_id: string;
      semestre_libelle: string;
      filiere_id: string;
      filiere_name: string;
      avg_grade: string | number | null;
      student_count: string | number;
    }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE}
       SELECT ss.semestre_id,
              ss.semestre_libelle,
              ss.filiere_id,
              ss.filiere_name,
              AVG(${jsonNumber("moyenne_session")})::float8 AS avg_grade,
              COUNT(DISTINCT b.student_id)::int AS student_count
       FROM professional_bulletins b
       JOIN semestre_scope ss ON ss.semestre_id = b.semestre_id
       WHERE b.tenant_id = $1::uuid
         AND ${BULLETIN_CLASSE_SQL}
       GROUP BY ss.semestre_id, ss.semestre_libelle, ss.filiere_id, ss.filiere_name
       -- professional_semestres n'a aucune colonne d'ordre : le libellé est le seul tri possible.
       ORDER BY ss.filiere_name, ss.semestre_libelle`,
      semestreParams,
      log,
      "averagesBySemestre"
    );

    /* ---- Top des ECUE les plus échouées ---- */
    const failedRows = await safeQuery<{
      ecue_id: string;
      code: string;
      libelle: string;
      evaluated: string | number;
      failed: string | number;
      eliminated: string | number;
      fail_rate: string | number;
    }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE},
            ${SESSION_SCOPE_CTE}
       SELECT e.id AS ecue_id,
              e.code,
              e.libelle,
              -- Une ECUE sans note d'examen a moyenne IS NULL (§4.5) : elle est en
              -- cours, pas échouée. On l'exclut du dénominateur.
              COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL)::int AS evaluated,
              COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL AND r.validee = false)::int AS failed,
              COUNT(*) FILTER (WHERE r.eliminee)::int AS eliminated,
              CASE WHEN COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL) > 0
                   THEN (100.0 * COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL AND r.validee = false)
                         / COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL))::float8
                   ELSE 0::float8 END AS fail_rate
       FROM professional_ecue_results r
       JOIN session_scope sc ON sc.ue_session_id = r.ue_session_id
       JOIN professional_ecue e ON e.id = r.ecue_id AND e.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1::uuid
         AND ${NOT_CONDUITE}
       GROUP BY e.id, e.code, e.libelle
       HAVING COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL) >= $8::int
       ORDER BY fail_rate DESC, evaluated DESC
       LIMIT $9::int`,
      [...sessionParams, OWNER_PEDAGOGIE_MIN_COHORT, OWNER_PEDAGOGIE_TOP_FAILED],
      log,
      "topFailedEcue"
    );

    /* ---- Santé par UE ---- */
    const ueRows = await safeQuery<{
      ue_id: string;
      code: string;
      libelle: string;
      filiere_name: string;
      categorie: string | null;
      student_count: string | number;
      avg_grade: string | number | null;
      validation_rate: string | number;
      eliminated_rate: string | number;
      session2_rate: string | number;
    }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE},
            ${SESSION_SCOPE_CTE}
       SELECT u.id AS ue_id,
              u.code,
              u.libelle,
              sc.filiere_name,
              u.categorie,
              COUNT(DISTINCT r.student_id)::int AS student_count,
              AVG(r.moyenne)::float8 AS avg_grade,
              CASE WHEN COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL) > 0
                   THEN (100.0 * COUNT(*) FILTER (WHERE r.validee)
                         / COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL))::float8
                   ELSE 0::float8 END AS validation_rate,
              CASE WHEN COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL) > 0
                   THEN (100.0 * COUNT(*) FILTER (WHERE r.eliminee)
                         / COUNT(*) FILTER (WHERE r.moyenne IS NOT NULL))::float8
                   ELSE 0::float8 END AS eliminated_rate,
              -- Poids du rattrapage : part des validations obtenues en session 2.
              CASE WHEN COUNT(*) FILTER (WHERE r.validee) > 0
                   THEN (100.0 * COUNT(*) FILTER (WHERE r.validee AND r.session_obtention = 2)
                         / COUNT(*) FILTER (WHERE r.validee))::float8
                   ELSE 0::float8 END AS session2_rate
       FROM professional_ecue_results r
       JOIN session_scope sc ON sc.ue_session_id = r.ue_session_id
       JOIN professional_ue u ON u.id = sc.ue_id AND u.tenant_id = r.tenant_id
       JOIN professional_ecue e ON e.id = r.ecue_id AND e.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1::uuid
         AND ${NOT_CONDUITE}
       GROUP BY u.id, u.code, u.libelle, sc.filiere_name, u.categorie
       ORDER BY validation_rate ASC, u.code`,
      sessionParams,
      log,
      "ueHealth"
    );

    /* ---- Le rattrapage, comme chantier et non comme taux ------------------ */
    /*
       `session2` dit déjà quelle PART des validations vient du rattrapage.
       Ceci répond à la question d'avant : qui est concerné, et est-ce que ça
       marche ? Comparer les deux moyennes est le seul moyen de le savoir.

       La session vit sur `professional_ecue_notes.session` : 1 pour la session
       normale, 2 pour le rattrapage.
    */
    const rattrapageRows = await safeQuery<{
      etudiants: string | number;
      notes2: string | number;
      moyenne2: string | number | null;
      moyenne1: string | number | null;
    }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE},
            ${SESSION_SCOPE_CTE}
       SELECT COUNT(DISTINCT n.student_id) FILTER (WHERE n.session = 2)::int AS etudiants,
              COUNT(*) FILTER (WHERE n.session = 2)::int                     AS notes2,
              AVG(n.note) FILTER (WHERE n.session = 2)::float8               AS moyenne2,
              AVG(n.note) FILTER (WHERE n.session = 1)::float8               AS moyenne1
         FROM professional_ecue_notes n
         JOIN session_scope sc ON sc.ue_session_id = n.ue_session_id
         JOIN professional_ecue e ON e.id = n.ecue_id AND e.tenant_id = n.tenant_id
        WHERE n.tenant_id = $1::uuid
          /* La conduite n est pas rattrapable : elle se note, elle ne se
             repasse pas. La melanger fausserait les deux moyennes. */
          AND ${NOT_CONDUITE}`,
      sessionParams,
      log,
      "rattrapage"
    );
    const rat = rattrapageRows[0] ?? {};

    /* Les ECUE où le rattrapage est le plus demandé : le vrai goulot. */
    const rattrapageEcueRows = await safeQuery<{
      ecue_id: string;
      code: string;
      libelle: string;
      filiere_name: string | null;
      etudiants: string | number;
      moyenne: string | number | null;
    }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE},
            ${SESSION_SCOPE_CTE}
       SELECT e.id AS ecue_id, e.code, e.libelle,
              sc.filiere_name,
              COUNT(DISTINCT n.student_id)::int AS etudiants,
              AVG(n.note)::float8 AS moyenne
         FROM professional_ecue_notes n
         JOIN session_scope sc ON sc.ue_session_id = n.ue_session_id
         JOIN professional_ecue e ON e.id = n.ecue_id AND e.tenant_id = n.tenant_id
        WHERE n.tenant_id = $1::uuid
          AND n.session = 2
          AND ${NOT_CONDUITE}
        GROUP BY e.id, e.code, e.libelle, sc.filiere_name
        ORDER BY etudiants DESC, e.code
        LIMIT 10`,
      sessionParams,
      log,
      "rattrapageEcue"
    );

    /* ---- L'état de la chaîne des bulletins --------------------------------- */
    /*
       Un semestre CLÔTURÉ SANS AUCUN BULLETIN est un blocage sec : la clôture
       dit « c'est fini » et les étudiants n'ont pourtant aucun relevé. Sans
       bulletin définitif, ni diplôme ni attestation ni réinscription ne
       suivent. Mesuré le 23/09/2026 : 16 semestres clôturés, 15 sans bulletin.
    */
    const bulletinRows = await safeQuery<{
      semestre_id: string;
      libelle: string;
      filiere_name: string | null;
      cloture_le: string | null;
      bulletins: string | number;
      definitifs: string | number;
    }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE}
       SELECT ss.semestre_id,
              ss.semestre_libelle AS libelle,
              ss.filiere_name,
              sem.bulletins_clotures_at::text AS cloture_le,
              COUNT(b.id)::int AS bulletins,
              COUNT(b.id) FILTER (WHERE b.statut = 'definitif')::int AS definitifs
         FROM semestre_scope ss
         JOIN professional_semestres sem
           ON sem.id = ss.semestre_id AND sem.tenant_id = $1::uuid
         LEFT JOIN professional_bulletins b
           ON b.semestre_id = ss.semestre_id AND b.tenant_id = $1::uuid
          AND ${BULLETIN_CLASSE_SQL}
        /*
           LE DENOMINATEUR SUIT LE FILTRE, SINON LE COMPTEUR MENT.

           Le filtre de classe ne portait que sur les bulletins, jamais sur les
           semestres : choisir une classe ecartait ses bulletins des autres
           semestres sans ecarter ces semestres eux-memes, et le nombre de
           « clotures sans bulletin » AUGMENTAIT — 15 sans filtre, 16 avec.
           Filtrer ne peut pas creer un blocage.

           La cle de classe est « filiereId|nom » : sa filiere est la partie
           gauche, et c est elle qui restreint les semestres.
        */
        WHERE ($4::text IS NULL
               OR ss.filiere_id::text = split_part($4::text, '|', 1))
        GROUP BY ss.semestre_id, ss.semestre_libelle, ss.filiere_name,
                 sem.bulletins_clotures_at
        /* Les cloturés sans bulletin d'abord : c'est là que la chaîne casse. */
        ORDER BY (sem.bulletins_clotures_at IS NOT NULL AND COUNT(b.id) = 0) DESC,
                 sem.bulletins_clotures_at DESC NULLS LAST,
                 ss.semestre_libelle
        LIMIT 200`,
      semestreParams,
      log,
      "bulletinsParSemestre"
    );

    /* ---- Distribution des moyennes de session (histogramme) ---- */
    const distRows = await safeQuery<{ bucket: string; count: string | number }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE},
       graded AS (
         SELECT ${jsonNumber("moyenne_session")} AS moyenne
         FROM professional_bulletins b
         JOIN semestre_scope ss ON ss.semestre_id = b.semestre_id
         WHERE b.tenant_id = $1::uuid
           AND ${BULLETIN_CLASSE_SQL}
       )
       SELECT bucket, COUNT(g.moyenne)::int AS count
       FROM (VALUES ('<5', 0), ('5-8', 1), ('8-10', 2), ('10-12', 3),
                    ('12-14', 4), ('14-16', 5), ('>16', 6)) AS b(bucket, ord)
       LEFT JOIN graded g ON g.moyenne IS NOT NULL AND b.bucket = CASE
              WHEN g.moyenne <  5  THEN '<5'
              WHEN g.moyenne <  8  THEN '5-8'
              WHEN g.moyenne < 10  THEN '8-10'
              WHEN g.moyenne < 12  THEN '10-12'
              WHEN g.moyenne < 14  THEN '12-14'
              WHEN g.moyenne < 16  THEN '14-16'
              ELSE '>16' END
       GROUP BY bucket, ord
       ORDER BY ord`,
      semestreParams,
      log,
      "gradeDistribution"
    );

    /* ---- Poids global de la session 2 (jauge) ---- */
    const s2Rows = await safeQuery<{
      validated_total: string | number;
      validated_s2: string | number;
    }>(
      client,
      `WITH ${SEMESTRE_SCOPE_CTE},
            ${SESSION_SCOPE_CTE}
       SELECT COUNT(*) FILTER (WHERE r.validee)::int AS validated_total,
              COUNT(*) FILTER (WHERE r.validee AND r.session_obtention = 2)::int AS validated_s2
       FROM professional_ecue_results r
       JOIN session_scope sc ON sc.ue_session_id = r.ue_session_id
       JOIN professional_ecue e ON e.id = r.ecue_id AND e.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1::uuid
         AND ${NOT_CONDUITE}`,
      sessionParams,
      log,
      "session2"
    );

    const s2 = s2Rows[0] ?? { validated_total: 0, validated_s2: 0 };
    const validatedTotal = Number(s2.validated_total) || 0;
    const validatedSession2 = Number(s2.validated_s2) || 0;

    return {
      anneeScolaire,
      filiereIds: filiereIds ?? [],
      semestreId,
      statut,
      categorie: categorie as OwnerUeCategorie | null,
      kpis: {
        bulletinCount,
        successRate: pct(Number(k.admis) || 0),
        averageGrade: Math.round((Number(k.avg_grade) || 0) * 100) / 100,
        creditsRate:
          creditsTotal > 0
            ? Math.round((creditsValidated * 1000) / creditsTotal) / 10
            : 0,
        creditsValidated,
        creditsTotal,
        retakeRate: pct(Number(k.rattrapage) || 0),
        finalBulletinRate: pct(Number(k.definitif) || 0),
      },
      decisionsByFiliere: decisionRows.map((r) => ({
        filiereId: r.filiere_id,
        filiereName: r.filiere_name,
        admis: Number(r.admis) || 0,
        rattrapage: Number(r.rattrapage) || 0,
        ajourne: Number(r.ajourne) || 0,
        total: Number(r.total) || 0,
      })),
      averagesBySemestre: semestreRows.map((r) => ({
        semestreId: r.semestre_id,
        semestreLabel: r.semestre_libelle,
        filiereId: r.filiere_id,
        filiereName: r.filiere_name,
        averageGrade: Math.round((Number(r.avg_grade) || 0) * 100) / 100,
        studentCount: Number(r.student_count) || 0,
      })),
      topFailedEcue: failedRows.map((r) => ({
        ecueId: r.ecue_id,
        code: r.code,
        libelle: r.libelle,
        evaluated: Number(r.evaluated) || 0,
        failed: Number(r.failed) || 0,
        eliminated: Number(r.eliminated) || 0,
        failRate: Math.round((Number(r.fail_rate) || 0) * 10) / 10,
      })),
      ueHealth: ueRows.map((r) => ({
        ueId: r.ue_id,
        code: r.code,
        libelle: r.libelle,
        filiereName: r.filiere_name,
        categorie: (r.categorie as OwnerUeCategorie | null) ?? null,
        studentCount: Number(r.student_count) || 0,
        averageGrade:
          r.avg_grade === null ? null : Math.round((Number(r.avg_grade) || 0) * 100) / 100,
        validationRate: Math.round((Number(r.validation_rate) || 0) * 10) / 10,
        eliminatedRate: Math.round((Number(r.eliminated_rate) || 0) * 10) / 10,
        session2Rate: Math.round((Number(r.session2_rate) || 0) * 10) / 10,
      })),
      gradeDistribution: distRows.map((r) => ({
        bucket: r.bucket as OwnerPedagogieResponse["gradeDistribution"][number]["bucket"],
        count: Number(r.count) || 0,
      })),
      rattrapage: {
        etudiantsConcernes: Math.round(Number(rat.etudiants) || 0),
        notesSession2: Math.round(Number(rat.notes2) || 0),
        /* NULL et non 0 : une moyenne sur aucune note n'existe pas, et un zéro
           se lirait « tout le monde a eu 0 au rattrapage ». */
        moyenneSession2:
          rat.moyenne2 === null || rat.moyenne2 === undefined
            ? null
            : Math.round(Number(rat.moyenne2) * 100) / 100,
        moyenneSession1:
          rat.moyenne1 === null || rat.moyenne1 === undefined
            ? null
            : Math.round(Number(rat.moyenne1) * 100) / 100,
        ecueLesPlusReprises: rattrapageEcueRows.map((r) => ({
          ecueId: String(r.ecue_id),
          code: String(r.code ?? ""),
          libelle: String(r.libelle ?? ""),
          filiereName: (r.filiere_name as string | null) ?? null,
          etudiants: Math.round(Number(r.etudiants) || 0),
          moyenne:
            r.moyenne === null || r.moyenne === undefined
              ? null
              : Math.round(Number(r.moyenne) * 100) / 100,
        })),
      },
      bulletins: {
        generes: bulletinRows.reduce((t, r) => t + (Number(r.bulletins) || 0), 0),
        definitifs: bulletinRows.reduce((t, r) => t + (Number(r.definitifs) || 0), 0),
        provisoires: bulletinRows.reduce(
          (t, r) => t + ((Number(r.bulletins) || 0) - (Number(r.definitifs) || 0)),
          0
        ),
        semestres: bulletinRows.length,
        semestresClotures: bulletinRows.filter((r) => r.cloture_le !== null).length,
        semestresCloturesSansBulletin: bulletinRows.filter(
          (r) => r.cloture_le !== null && (Number(r.bulletins) || 0) === 0
        ).length,
        parSemestre: bulletinRows.map((r) => ({
          semestreId: String(r.semestre_id),
          libelle: String(r.libelle ?? ""),
          filiereName: (r.filiere_name as string | null) ?? null,
          clotureLe: r.cloture_le ? String(r.cloture_le).slice(0, 10) : null,
          bulletins: Math.round(Number(r.bulletins) || 0),
          definitifs: Math.round(Number(r.definitifs) || 0),
        })),
      },
      session2: {
        validatedTotal,
        validatedSession2,
        rate:
          validatedTotal > 0
            ? Math.round((validatedSession2 * 1000) / validatedTotal) / 10
            : 0,
      },
    };
  } finally {
    client.release();
  }
}
