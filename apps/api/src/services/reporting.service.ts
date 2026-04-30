/**
 * ReportingService
 * 
 * Business logic for reporting and metrics calculation
 * Handles dashboard metrics, revenue forecasting, conversion rates, and detailed statistics
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from "pg";
import { getTableName } from '../utils/table-names';
import type {
  DashboardMetricsQuery,
  DashboardMetricsResponse,
  CAPrevisionnelQuery,
  CAPrevisionnelResponse,
  TauxConversionResponse,
  StatisticsQuery,
  StatisticsResponse,
  ReportingPeriod,
} from "@ecoledigitale/contracts/src/reporting";

export class ReportingService {
  constructor(private pool: Pool) {}

  /**
   * Set tenant context for RLS policies
   * Must be called before any database query
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Calculate date range for period
   */
  private getDateRange(period: ReportingPeriod): { start: Date; end: Date; previousStart: Date; previousEnd: Date } {
    const now = new Date();
    const end = new Date(now);
    let start = new Date(now);
    let previousStart = new Date(now);
    let previousEnd = new Date(now);

    switch (period) {
      case "jour":
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        previousStart = new Date(start);
        previousStart.setDate(previousStart.getDate() - 1);
        previousEnd = new Date(previousStart);
        previousEnd.setHours(23, 59, 59, 999);
        break;
      case "semaine":
        const dayOfWeek = now.getDay();
        start.setDate(now.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        previousStart = new Date(start);
        previousStart.setDate(previousStart.getDate() - 7);
        previousEnd = new Date(previousStart);
        previousEnd.setDate(previousEnd.getDate() + 6);
        previousEnd.setHours(23, 59, 59, 999);
        break;
      case "mois":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        previousStart.setHours(0, 0, 0, 0);
        previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        previousEnd.setHours(23, 59, 59, 999);
        break;
      case "annee":
        start = new Date(now.getFullYear(), 0, 1);
        start.setHours(0, 0, 0, 0);
        end = new Date(now.getFullYear(), 11, 31);
        end.setHours(23, 59, 59, 999);
        previousStart = new Date(now.getFullYear() - 1, 0, 1);
        previousStart.setHours(0, 0, 0, 0);
        previousEnd = new Date(now.getFullYear() - 1, 11, 31);
        previousEnd.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end, previousStart, previousEnd };
  }

  /**
   * Calculate percentage evolution
   */
  private calculateEvolution(current: number, previous: number): string {
    if (previous === 0) {
      return current > 0 ? "+100%" : "0%";
    }
    const change = ((current - previous) / previous) * 100;
    return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
  }

  /**
   * T101: Get dashboard metrics
   */
  async getDashboardMetrics(
    tenantId: string,
    query: DashboardMetricsQuery
  ): Promise<DashboardMetricsResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const { periode } = query;
      const { start, end, previousStart, previousEnd } = this.getDateRange(periode);

      // Current period inscriptions
      const inscriptionsQuery = `
        SELECT COUNT(*)::integer as total
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')}
        WHERE tenant_id = $1 AND date_inscription >= $2 AND date_inscription <= $3
      `;
      const inscriptionsResult = await client.query(inscriptionsQuery, [tenantId, start, end]);
      const inscriptionsTotal = inscriptionsResult.rows[0].total;

      // Previous period inscriptions
      const previousInscriptionsResult = await client.query(inscriptionsQuery, [
        tenantId,
        previousStart,
        previousEnd,
      ]);
      const previousInscriptionsTotal = previousInscriptionsResult.rows[0].total;

      // Current period CA
      const caQuery = `
        SELECT COALESCE(SUM(montant_ttc), 0)::numeric as total
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')}
        WHERE tenant_id = $1 AND date_inscription >= $2 AND date_inscription <= $3
      `;
      const caResult = await client.query(caQuery, [tenantId, start, end]);
      const caTotal = parseFloat(caResult.rows[0].total);

      // Previous period CA
      const previousCaResult = await client.query(caQuery, [tenantId, previousStart, previousEnd]);
      const previousCaTotal = parseFloat(previousCaResult.rows[0].total);

      // Sessions
      const sessionsQuery = `
        SELECT COUNT(*)::integer as total,
               COALESCE(AVG(
                 CASE WHEN places_totales > 0 
                   THEN (places_reservees::numeric / places_totales::numeric) * 100 
                   ELSE 0 
                 END
               ), 0)::numeric as taux_remplissage
        FROM ${getTableName(tenantId, 'sessions_professionnelles')}
        WHERE tenant_id = $1 AND date_debut >= $2 AND date_debut <= $3
      `;
      const sessionsResult = await client.query(sessionsQuery, [tenantId, start, end]);
      const sessionsTotal = sessionsResult.rows[0].total;
      const tauxRemplissage = parseFloat(sessionsResult.rows[0].taux_remplissage);

      // Top 5 formations
      const topFormationsQuery = `
        SELECT f.titre as formation, COUNT(i.id)::integer as nb_inscriptions
        FROM ${getTableName(tenantId, 'formations_professionnelles')} f
        JOIN sessions_professionnelles s ON s.formation_pro_id = f.id
        JOIN inscriptions_professionnelles i ON i.session_id = s.id
        WHERE i.tenant_id = $1 AND i.date_inscription >= $2 AND i.date_inscription <= $3
        GROUP BY f.id, f.titre
        ORDER BY nb_inscriptions DESC
        LIMIT 5
      `;
      const topFormationsResult = await client.query(topFormationsQuery, [tenantId, start, end]);

      // Top 5 enterprises
      const topEntreprisesQuery = `
        SELECT e.raison_sociale as entreprise,
               COUNT(i.id)::integer as nb_inscriptions,
               COALESCE(SUM(i.montant_ttc), 0)::numeric as ca
        FROM entreprises_clientes e
        JOIN inscriptions_professionnelles i ON i.entreprise_id = e.id
        WHERE i.tenant_id = $1 AND i.date_inscription >= $2 AND i.date_inscription <= $3
        GROUP BY e.id, e.raison_sociale
        ORDER BY ca DESC
        LIMIT 5
      `;
      const topEntreprisesResult = await client.query(topEntreprisesQuery, [tenantId, start, end]);

      return {
        inscriptions: {
          total: inscriptionsTotal,
          evolution: this.calculateEvolution(inscriptionsTotal, previousInscriptionsTotal),
        },
        ca: {
          total: caTotal,
          evolution: this.calculateEvolution(caTotal, previousCaTotal),
        },
        sessions: {
          total: sessionsTotal,
          taux_remplissage: `${tauxRemplissage.toFixed(1)}%`,
        },
        top_formations: topFormationsResult.rows.map((row: any) => ({
          formation: row.formation,
          nb_inscriptions: row.nb_inscriptions,
        })),
        top_entreprises: topEntreprisesResult.rows.map((row: any) => ({
          entreprise: row.entreprise,
          nb_inscriptions: row.nb_inscriptions,
          ca: parseFloat(row.ca),
        })),
      };
    } finally {
      client.release();
    }
  }

  /**
   * T102: Get CA prévisionnel
   */
  async getCAPrevisionnel(
    tenantId: string,
    query: CAPrevisionnelQuery
  ): Promise<CAPrevisionnelResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const { annee, trimestre } = query;
      const yearStart = new Date(annee, 0, 1);
      const yearEnd = new Date(annee, 11, 31, 23, 59, 59, 999);
      const now = new Date();

      // CA réalisé (past sessions with paid enrollments)
      const caRealiseQuery = `
        SELECT COALESCE(SUM(i.montant_ttc), 0)::numeric as total
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN sessions_professionnelles s ON i.session_id = s.id
        JOIN paiements_professionnels p ON p.inscription_id = i.id
        WHERE i.tenant_id = $1
          AND EXTRACT(YEAR FROM s.date_debut) = $2
          AND s.date_debut < $3
          AND p.statut = 'valide'
      `;
      const caRealiseResult = await client.query(caRealiseQuery, [tenantId, annee, now]);
      const caRealise = parseFloat(caRealiseResult.rows[0].total);

      // CA prévisionnel (future sessions with confirmed enrollments)
      const caPrevisionnelQuery = `
        SELECT COALESCE(SUM(i.montant_ttc), 0)::numeric as total
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN sessions_professionnelles s ON i.session_id = s.id
        WHERE i.tenant_id = $1
          AND EXTRACT(YEAR FROM s.date_debut) = $2
          AND s.date_debut >= $3
          AND i.statut = 'confirmee'
      `;
      const caPrevisionnelResult = await client.query(caPrevisionnelQuery, [tenantId, annee, now]);
      const caPrevisionnel = parseFloat(caPrevisionnelResult.rows[0].total);

      // CA potentiel (pending enrollments)
      const caPotentielQuery = `
        SELECT COALESCE(SUM(i.montant_ttc), 0)::numeric as total
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN sessions_professionnelles s ON i.session_id = s.id
        WHERE i.tenant_id = $1
          AND EXTRACT(YEAR FROM s.date_debut) = $2
          AND i.statut = 'en_attente'
      `;
      const caPotentielResult = await client.query(caPotentielQuery, [tenantId, annee]);
      const caPotentiel = parseFloat(caPotentielResult.rows[0].total);

      // Breakdown by month
      const parMoisQuery = `
        SELECT 
          TO_CHAR(s.date_debut, 'YYYY-MM') as mois,
          COALESCE(SUM(CASE WHEN s.date_debut < $3 AND p.statut = 'valide' THEN i.montant_ttc ELSE 0 END), 0)::numeric as ca_realise,
          COALESCE(SUM(CASE WHEN s.date_debut >= $3 AND i.statut = 'confirmee' THEN i.montant_ttc ELSE 0 END), 0)::numeric as ca_previsionnel
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        LEFT JOIN inscriptions_professionnelles i ON i.session_id = s.id
        LEFT JOIN paiements_professionnels p ON p.inscription_id = i.id AND p.statut = 'valide'
        WHERE s.tenant_id = $1 AND EXTRACT(YEAR FROM s.date_debut) = $2
        GROUP BY mois
        ORDER BY mois
      `;
      const parMoisResult = await client.query(parMoisQuery, [tenantId, annee, now]);

      // Breakdown by formation
      const parFormationQuery = `
        SELECT 
          f.titre as formation,
          COALESCE(SUM(i.montant_ttc), 0)::numeric as ca
        FROM ${getTableName(tenantId, 'formations_professionnelles')} f
        JOIN sessions_professionnelles s ON s.formation_pro_id = f.id
        JOIN inscriptions_professionnelles i ON i.session_id = s.id
        WHERE i.tenant_id = $1 AND EXTRACT(YEAR FROM s.date_debut) = $2
        GROUP BY f.id, f.titre
        ORDER BY ca DESC
      `;
      const parFormationResult = await client.query(parFormationQuery, [tenantId, annee]);

      return {
        ca_realise: caRealise,
        ca_previsionnel: caPrevisionnel,
        ca_potentiel: caPotentiel,
        ca_total_estime: caRealise + caPrevisionnel + caPotentiel,
        par_mois: parMoisResult.rows.map((row: any) => ({
          mois: row.mois,
          ca_realise: parseFloat(row.ca_realise),
          ca_previsionnel: parseFloat(row.ca_previsionnel),
        })),
        par_formation: parFormationResult.rows.map((row: any) => ({
          formation: row.formation,
          ca: parseFloat(row.ca),
        })),
      };
    } finally {
      client.release();
    }
  }

  /**
   * T103: Get conversion rates
   */
  async getTauxConversion(tenantId: string): Promise<TauxConversionResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Global conversion rate
      const globalQuery = `
        SELECT 
          COUNT(DISTINCT i.id)::integer as total_inscriptions,
          COUNT(DISTINCT CASE WHEN p.statut = 'valide' THEN i.id END)::integer as inscriptions_payees
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        LEFT JOIN paiements_professionnels p ON p.inscription_id = i.id
        WHERE i.tenant_id = $1
      `;
      const globalResult = await client.query(globalQuery, [tenantId]);
      const totalInscriptions = globalResult.rows[0].total_inscriptions;
      const inscriptionsPayees = globalResult.rows[0].inscriptions_payees;
      const tauxGlobal = totalInscriptions > 0 ? ((inscriptionsPayees / totalInscriptions) * 100).toFixed(1) : "0.0";

      // By formation
      const parFormationQuery = `
        SELECT 
          f.titre as formation,
          COUNT(DISTINCT i.id)::integer as total_inscriptions,
          COUNT(DISTINCT CASE WHEN p.statut = 'valide' THEN i.id END)::integer as inscriptions_payees
        FROM ${getTableName(tenantId, 'formations_professionnelles')} f
        JOIN sessions_professionnelles s ON s.formation_pro_id = f.id
        JOIN inscriptions_professionnelles i ON i.session_id = s.id
        LEFT JOIN paiements_professionnels p ON p.inscription_id = i.id
        WHERE i.tenant_id = $1
        GROUP BY f.id, f.titre
        HAVING COUNT(DISTINCT i.id) > 0
        ORDER BY inscriptions_payees DESC
      `;
      const parFormationResult = await client.query(parFormationQuery, [tenantId]);

      // By payment method
      const parMethodeQuery = `
        SELECT 
          p.methode_paiement as methode,
          COUNT(*)::integer as count,
          (COUNT(*)::numeric / (SELECT COUNT(*) FROM paiements_professionnels WHERE tenant_id = $1 AND statut = 'valide')) * 100 as pourcentage
        FROM ${getTableName(tenantId, 'paiements_professionnels')} p
        WHERE p.tenant_id = $1 AND p.statut = 'valide'
        GROUP BY p.methode_paiement
        ORDER BY count DESC
      `;
      const parMethodeResult = await client.query(parMethodeQuery, [tenantId]);

      // By month (last 12 months)
      const parMoisQuery = `
        SELECT 
          TO_CHAR(i.date_inscription, 'YYYY-MM') as mois,
          COUNT(DISTINCT i.id)::integer as total_inscriptions,
          COUNT(DISTINCT CASE WHEN p.statut = 'valide' THEN i.id END)::integer as inscriptions_payees
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        LEFT JOIN paiements_professionnels p ON p.inscription_id = i.id
        WHERE i.tenant_id = $1
          AND i.date_inscription >= NOW() - INTERVAL '12 months'
        GROUP BY mois
        ORDER BY mois DESC
        LIMIT 12
      `;
      const parMoisResult = await client.query(parMoisQuery, [tenantId]);

      return {
        taux_global: `${tauxGlobal}%`,
        par_formation: parFormationResult.rows.map((row: any) => {
          const taux = row.total_inscriptions > 0
            ? ((row.inscriptions_payees / row.total_inscriptions) * 100).toFixed(1)
            : "0.0";
          return {
            formation: row.formation,
            taux: `${taux}%`,
          };
        }),
        par_methode_paiement: parMethodeResult.rows.map((row: any) => ({
          methode: row.methode || "Non spécifié",
          pourcentage: parseFloat(row.pourcentage || "0"),
        })),
        par_mois: parMoisResult.rows.map((row: any) => {
          const taux = row.total_inscriptions > 0
            ? ((row.inscriptions_payees / row.total_inscriptions) * 100).toFixed(1)
            : "0.0";
          return {
            mois: row.mois,
            taux: `${taux}%`,
          };
        }),
      };
    } finally {
      client.release();
    }
  }

  /**
   * T104: Get statistics by type
   */
  async getStatistics(tenantId: string, query: StatisticsQuery): Promise<StatisticsResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const { type, date_debut, date_fin } = query;

      if (type === "inscriptions") {
        // Status distribution
        const statusQuery = `
          SELECT statut, COUNT(*)::integer as count
          FROM ${getTableName(tenantId, 'inscriptions_professionnelles')}
          WHERE tenant_id = $1 AND date_inscription >= $2 AND date_inscription <= $3
          GROUP BY statut
        `;
        const statusResult = await client.query(statusQuery, [tenantId, date_debut, date_fin]);
        const repartitionStatut: Record<string, number> = {};
        statusResult.rows.forEach((row: any) => {
          repartitionStatut[row.statut] = row.count;
        });

        // Temporal evolution (by week)
        const evolutionQuery = `
          SELECT 
            TO_CHAR(date_inscription, 'YYYY-WW') as periode,
            COUNT(*)::integer as nombre
          FROM ${getTableName(tenantId, 'inscriptions_professionnelles')}
          WHERE tenant_id = $1 AND date_inscription >= $2 AND date_inscription <= $3
          GROUP BY periode
          ORDER BY periode
        `;
        const evolutionResult = await client.query(evolutionQuery, [tenantId, date_debut, date_fin]);

        return {
          type: "inscriptions",
          repartition_statut: repartitionStatut,
          evolution_temporelle: evolutionResult.rows.map((row: any) => ({
            periode: row.periode,
            nombre: row.nombre,
          })),
        };
      } else if (type === "formations") {
        const formationsQuery = `
          SELECT 
            COUNT(DISTINCT s.id)::integer as nb_sessions,
            COALESCE(AVG(
              CASE WHEN s.places_totales > 0 
                THEN (s.places_reservees::numeric / s.places_totales::numeric) * 100 
                ELSE 0 
              END
            ), 0)::numeric as taux_remplissage_moyen
          FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
          WHERE s.tenant_id = $1 AND s.date_debut >= $2 AND s.date_debut <= $3
        `;
        const formationsResult = await client.query(formationsQuery, [tenantId, date_debut, date_fin]);

        const modeQuery = `
          SELECT mode_formation, COUNT(*)::integer as count
          FROM ${getTableName(tenantId, 'sessions_professionnelles')}
          WHERE tenant_id = $1 AND date_debut >= $2 AND date_debut <= $3
          GROUP BY mode_formation
        `;
        const modeResult = await client.query(modeQuery, [tenantId, date_debut, date_fin]);
        const repartitionMode: Record<string, number> = {};
        modeResult.rows.forEach((row: any) => {
          repartitionMode[row.mode_formation] = row.count;
        });

        return {
          type: "formations",
          nb_sessions: formationsResult.rows[0].nb_sessions,
          taux_remplissage_moyen: parseFloat(formationsResult.rows[0].taux_remplissage_moyen),
          repartition_mode: repartitionMode,
        };
      } else if (type === "formateurs") {
        const formateursQuery = `
          SELECT COUNT(DISTINCT f.id)::integer as nb_formateurs,
                 COUNT(DISTINCT sf.session_id)::integer as nb_sessions_animees
          FROM formateurs f
          JOIN session_formateurs sf ON sf.formateur_id = f.id
          JOIN sessions_professionnelles s ON s.id = sf.session_id
          WHERE f.tenant_id = $1 AND s.date_debut >= $2 AND s.date_debut <= $3
        `;
        const formateursResult = await client.query(formateursQuery, [tenantId, date_debut, date_fin]);

        const repartitionQuery = `
          SELECT 
            CONCAT(f.prenom, ' ', f.nom) as formateur,
            COUNT(DISTINCT sf.session_id)::integer as nb_sessions
          FROM formateurs f
          JOIN session_formateurs sf ON sf.formateur_id = f.id
          JOIN sessions_professionnelles s ON s.id = sf.session_id
          WHERE f.tenant_id = $1 AND s.date_debut >= $2 AND s.date_debut <= $3
          GROUP BY f.id, f.prenom, f.nom
          ORDER BY nb_sessions DESC
        `;
        const repartitionResult = await client.query(repartitionQuery, [tenantId, date_debut, date_fin]);

        return {
          type: "formateurs",
          nb_formateurs: formateursResult.rows[0].nb_formateurs,
          nb_sessions_animees: formateursResult.rows[0].nb_sessions_animees,
          repartition_sessions: repartitionResult.rows.map((row: any) => ({
            formateur: row.formateur,
            nb_sessions: row.nb_sessions,
          })),
        };
      } else {
        // entreprises
        const entreprisesQuery = `
          SELECT 
            COUNT(DISTINCT e.id)::integer as nb_entreprises,
            COUNT(DISTINCT i.id)::integer as nb_inscriptions,
            COALESCE(SUM(i.montant_ttc), 0)::numeric as ca_total
          FROM entreprises_clientes e
          JOIN inscriptions_professionnelles i ON i.entreprise_id = e.id
          WHERE i.tenant_id = $1 AND i.date_inscription >= $2 AND i.date_inscription <= $3
        `;
        const entreprisesResult = await client.query(entreprisesQuery, [tenantId, date_debut, date_fin]);

        return {
          type: "entreprises",
          nb_entreprises: entreprisesResult.rows[0].nb_entreprises,
          nb_inscriptions: entreprisesResult.rows[0].nb_inscriptions,
          ca_total: parseFloat(entreprisesResult.rows[0].ca_total),
        };
      }
    } finally {
      client.release();
    }
  }
}

