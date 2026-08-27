import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerStatsFiltersResponse } from "@ecoledigitale/contracts";
import { anneeDe, NOM_DE_CLASSE_SQL } from "./owner-pro-annee.sql";

/** Regroupe des couples (id, année) en `id -> [années]`, plus récente d'abord. */
function grouperAnnees(rows: Array<{ id: string; annee: string }>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const liste = map.get(r.id);
    if (liste) liste.push(r.annee);
    else map.set(r.id, [r.annee]);
  }
  return map;
}

/**
 * Référentiel des filtres des pages de statistiques owner : filières, noms de
 * classe, semestres, années scolaires disponibles.
 *
 * Sert à peupler `FiliereFilter` / le sélecteur d'année sans que le front ait à
 * charger des listes paginées puis à les dédupliquer côté client (c'est exactement
 * le défaut des pages Cycles / Matières / Parents actuelles).
 */
export async function fetchOwnerStatsFilters(
  pool: Pool,
  tenantId: string,
  log: FastifyBaseLogger
): Promise<OwnerStatsFiltersResponse> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const filieres = await client
      .query<{
        id: string;
        name: string;
        code: string;
        cycle_id: string | null;
        cycle_name: string | null;
      }>(
        // `cycle_id` sert au filtre global : restreindre les filières proposées
        // au cycle choisi demande un identifiant, pas un libellé (deux cycles
        // peuvent porter le même nom, et un nom peut être renommé).
        `SELECT p.id, p.name, p.code, p.cycle_id, c.name AS cycle_name
         FROM programmes p
         -- LEFT JOIN délibéré : une filière dont le cycle a été supprimé doit rester
         -- sélectionnable (cf. le défaut inverse de GET /courses, §6-11).
         LEFT JOIN cycles c ON c.id = p.cycle_id AND c.tenant_id = p.tenant_id
         WHERE p.tenant_id = $1::uuid
         ORDER BY p.name`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner stats filters: filieres failed");
        return { rows: [] };
      });

    // Noms de classe, avec les années et les semestres qu'ils atteignent : de
    // quoi rejouer côté front la cascade année → nom de classe → semestre de la
    // page Paiements, sans charger toutes les inscriptions pour les dédupliquer.
    const nomsDeClasse = await client
      .query<{
        value: string;
        nom: string;
        filiere_id: string;
        annees: string[];
        semestre_ids: string[];
      }>(
        `WITH sessions_nommees AS (
           SELECT ue.filiere_id,
                  ${NOM_DE_CLASSE_SQL} AS nom,
                  s.id AS session_id,
                  s.ue_id,
                  ${anneeDe("s.date_debut")} AS annee
             FROM professional_ue_sessions s
             JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
            WHERE s.tenant_id = $1::uuid
              AND ue.filiere_id IS NOT NULL
              AND s.date_debut IS NOT NULL
         )
         SELECT sn.filiere_id::text || '|' || sn.nom AS value,
                sn.nom,
                sn.filiere_id,
                array_agg(DISTINCT sn.annee ORDER BY sn.annee DESC) AS annees,
                -- Rattachement du semestre par ses deux chemins, celui de la
                -- session et celui de l'UE, comme partout dans le module.
                (SELECT COALESCE(array_agg(DISTINCT sem.id), ARRAY[]::uuid[])
                   FROM professional_semestres sem
                  WHERE sem.tenant_id = $1::uuid
                    AND (EXISTS (SELECT 1 FROM professional_semestre_sessions ss
                                  WHERE ss.semestre_id = sem.id AND ss.tenant_id = sem.tenant_id
                                    AND ss.ue_session_id = ANY(array_agg(sn.session_id)))
                      OR EXISTS (SELECT 1 FROM professional_semestre_ue su
                                  WHERE su.semestre_id = sem.id AND su.tenant_id = sem.tenant_id
                                    AND su.ue_id = ANY(array_agg(sn.ue_id))))
                ) AS semestre_ids
           FROM sessions_nommees sn
          GROUP BY sn.filiere_id, sn.nom
          ORDER BY sn.nom`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner stats filters: nomsDeClasse failed");
        return { rows: [] };
      });

    const semestres = await client
      .query<{ id: string; libelle: string; filiere_id: string }>(
        `SELECT sem.id, sem.libelle, sem.filiere_id
         FROM professional_semestres sem
         WHERE sem.tenant_id = $1::uuid
         ORDER BY sem.libelle`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner stats filters: semestres failed");
        return { rows: [] };
      });

    const annees = await client
      .query<{ annee: string }>(
        `-- Année scolaire dérivée par pivot septembre : ce n'est pas une colonne.
         -- UNION des deux moteurs : les sessions pro d'un côté, les classes
         -- réellement ouvertes de l'autre. La table academic_years seule
         -- ignorait des années d'activité et en déclarait des vides ; on ne
         -- la lit que pour nommer une classe qui existe déjà.
         SELECT DISTINCT annee FROM (
           SELECT
                  CASE WHEN EXTRACT(MONTH FROM s.date_debut) >= 9
                       THEN EXTRACT(YEAR FROM s.date_debut)::int
                       ELSE EXTRACT(YEAR FROM s.date_debut)::int - 1
                  END::text
                  || '-' ||
                  CASE WHEN EXTRACT(MONTH FROM s.date_debut) >= 9
                       THEN EXTRACT(YEAR FROM s.date_debut)::int + 1
                       ELSE EXTRACT(YEAR FROM s.date_debut)::int
                  END::text AS annee
           FROM professional_ue_sessions s
           WHERE s.tenant_id = $1::uuid
             AND s.date_debut IS NOT NULL
           UNION
           SELECT ay.name AS annee
           FROM academic_years ay
           WHERE ay.tenant_id = $1::uuid
             AND ay.name ~ '^\\d{4}-\\d{4}$'
             AND EXISTS (
               SELECT 1 FROM classes c
               WHERE c.academic_year_id = ay.id AND c.tenant_id = ay.tenant_id
             )
         ) millesimes
         ORDER BY annee DESC`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner stats filters: annees failed");
        return { rows: [] };
      });

    /**
     * Années d'activité de chaque classe et de chaque semestre.
     *
     * C'est ce qui permet à l'année choisie de COMMANDER les listes en aval,
     * comme le fait l'écran Paiements du module professionnel. Sans ces
     * colonnes, la barre proposait les six classes de l'établissement sur une
     * année qui n'en a ouvert qu'une : cinq croisements sur six ne ramenaient
     * rien, et l'écran vide se lisait comme une absence de données.
     *
     * L'ouverture de session (`date_debut`) fait foi — la même colonne que le
     * sélecteur d'année lui-même, sinon les deux listes se contrediraient.
     */
    const filiereAnnees = await client
      .query<{ id: string; annee: string }>(
        // UNION des deux moteurs, comme la liste des années elle-même : une
        // classe peut porter de l'activité professionnelle, scolaire, ou les
        // deux. N'interroger que le professionnel ferait disparaître les
        // classes de la scolarité du sélecteur dès qu'une année est retenue.
        `SELECT id, annee FROM (
           SELECT u.filiere_id AS id, ${anneeDe("s.date_debut")} AS annee
           FROM professional_ue_sessions s
           JOIN professional_ue u ON u.id = s.ue_id AND u.tenant_id = s.tenant_id
           WHERE s.tenant_id = $1::uuid
             AND s.date_debut IS NOT NULL
             AND u.filiere_id IS NOT NULL
           UNION
           SELECT c.programme_id AS id, ay.name AS annee
           FROM classes c
           JOIN academic_years ay
             ON ay.id = c.academic_year_id AND ay.tenant_id = c.tenant_id
           WHERE c.tenant_id = $1::uuid
             AND c.programme_id IS NOT NULL
             AND ay.name ~ '^\\d{4}-\\d{4}$'
         ) millesimes
         ORDER BY annee DESC`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner stats filters: filiereAnnees failed");
        return { rows: [] };
      });

    const semestreAnnees = await client
      .query<{ id: string; annee: string }>(
        // Le semestre n'a pas de date : il la tient des ouvertures de ses UE.
        `SELECT su.semestre_id AS id, ${anneeDe("s.date_debut")} AS annee
         FROM professional_semestre_ue su
         JOIN professional_ue_sessions s
           ON s.ue_id = su.ue_id AND s.tenant_id = su.tenant_id
         WHERE su.tenant_id = $1::uuid
           AND s.date_debut IS NOT NULL
         GROUP BY 1, 2
         ORDER BY 2 DESC`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner stats filters: semestreAnnees failed");
        return { rows: [] };
      });

    const anneesParFiliere = grouperAnnees(filiereAnnees.rows);
    const anneesParSemestre = grouperAnnees(semestreAnnees.rows);

    const cycles = await client
      .query<{ id: string; name: string; code: string }>(
        `SELECT c.id, c.name, c.code
         FROM cycles c
         WHERE c.tenant_id = $1::uuid
         ORDER BY c.name`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner stats filters: cycles failed");
        return { rows: [] };
      });

    const academicYears = await client
      .query<{ id: string; name: string; is_active: boolean | null }>(
        `SELECT ay.id, ay.name, ay.is_active
         FROM academic_years ay
         WHERE ay.tenant_id = $1::uuid
         -- L'année en cours d'abord : c'est le choix par défaut attendu.
         ORDER BY ay.is_active DESC NULLS LAST, ay.start_date DESC`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner stats filters: academicYears failed");
        return { rows: [] };
      });

    return {
      cycles: cycles.rows.map((r) => ({ id: r.id, name: r.name, code: r.code })),
      academicYears: academicYears.rows.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: Boolean(r.is_active),
      })),
      filieres: filieres.rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        cycleId: r.cycle_id,
        cycleName: r.cycle_name,
        // Tableau vide = classe sans ouverture professionnelle (le cas des
        // classes purement scolaires) : elle reste proposée sur toutes les
        // années. Cf. le commentaire du contrat.
        annees: anneesParFiliere.get(r.id) ?? [],
      })),
      nomsDeClasse: nomsDeClasse.rows.map((r) => ({
        value: r.value,
        nom: r.nom,
        filiereId: r.filiere_id,
        annees: r.annees ?? [],
        semestreIds: r.semestre_ids ?? [],
      })),
      semestres: semestres.rows.map((r) => ({
        id: r.id,
        libelle: r.libelle,
        filiereId: r.filiere_id,
        annees: anneesParSemestre.get(r.id) ?? [],
      })),
      anneesScolaires: annees.rows.map((r) => r.annee),
    };
  } finally {
    client.release();
  }
}
