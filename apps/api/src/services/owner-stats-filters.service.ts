import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { OwnerStatsFiltersResponse } from "@ecoledigitale/contracts";

/**
 * Référentiel des filtres des pages de statistiques owner : filières, semestres,
 * années scolaires disponibles.
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
         SELECT DISTINCT
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
         ORDER BY annee DESC`,
        [tenantId]
      )
      .catch((e) => {
        log.warn({ err: e }, "owner stats filters: annees failed");
        return { rows: [] };
      });

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
      })),
      semestres: semestres.rows.map((r) => ({
        id: r.id,
        libelle: r.libelle,
        filiereId: r.filiere_id,
      })),
      anneesScolaires: annees.rows.map((r) => r.annee),
    };
  } finally {
    client.release();
  }
}
