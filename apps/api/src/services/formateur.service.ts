/**
 * FormateurService
 * 
 * Business logic for trainer space functionality
 * Handles dashboard data, schedule management, session management, and profile operations
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from "pg";
import { AuditLogService } from "../utils/audit-log";
import { getTableName } from '../utils/table-names';

export interface DashboardData {
  stats: {
    sessions_a_venir: number;
    sessions_en_cours: number;
    sessions_terminees_mois: number;
    total_apprenants: number;
    heures_formation_mois: number;
  };
  prochaines_sessions: Array<{
    id: string;
    code_session: string;
    formation: {
      id: string;
      titre: string;
      slug?: string;
    };
    date_debut: string;
    date_fin: string;
    horaires?: string;
    mode_formation: "presentiel" | "distanciel" | "hybride";
    lieu?: string;
    lien_visio?: string;
    statut: string;
    places_totales: number;
    places_reservees: number;
    places_disponibles: number;
    nb_inscrits: number;
  }>;
  sessions_recentes: Array<{
    id: string;
    code_session: string;
    formation: {
      id: string;
      titre: string;
      slug?: string;
    };
    date_debut: string;
    date_fin: string;
    horaires?: string;
    mode_formation: "presentiel" | "distanciel" | "hybride";
    lieu?: string;
    lien_visio?: string;
    statut: string;
    places_totales: number;
    places_reservees: number;
    places_disponibles: number;
    nb_inscrits: number;
  }>;
  supports_recents: Array<{
    id: string;
    titre: string;
    description?: string;
    type_fichier: string;
    taille_fichier: number;
    fichier_url: string;
    nb_telechargements: number;
    created_at: string;
  }>;
  notifications: {
    nb_non_lues: number;
    recentes: Array<{
      id: string;
      type: string;
      titre: string;
      message: string;
      metadata?: Record<string, any>;
      lue: boolean;
      lue_at?: string;
      created_at: string;
    }>;
  };
}

export class FormateurService {
  private auditLog: AuditLogService;

  constructor(private pool: Pool) {
    this.auditLog = new AuditLogService(pool);
  }

  /**
   * Set tenant context for RLS policies
   * Must be called before any database query
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  private normalizeModeFormation(
    mode: string | null | undefined
  ): "presentiel" | "distanciel" | "hybride" {
    const normalized = (mode || "").toLowerCase();
    if (normalized === "presential" || normalized === "presentiel") return "presentiel";
    if (normalized === "remote" || normalized === "distanciel" || normalized === "elearning") return "distanciel";
    if (normalized === "hybrid" || normalized === "hybride") return "hybride";
    return "presentiel";
  }

  /**
   * Get dashboard data for a trainer
   * T008: Dashboard service method
   */
  async getDashboardData(formateurId: string, tenantId: string): Promise<DashboardData> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

      // Calculate statistics - sessions counts
      const sessionsStatsQuery = `
        SELECT 
          COUNT(*) FILTER (WHERE s.statut IN ('planifiee', 'ouverte', 'complete') AND s.date_debut >= CURRENT_DATE)::integer as sessions_a_venir,
          COUNT(*) FILTER (WHERE s.statut = 'en_cours')::integer as sessions_en_cours,
          COUNT(*) FILTER (WHERE s.statut = 'terminee' AND s.date_fin >= $1 AND s.date_fin <= $2)::integer as sessions_terminees_mois
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sf.session_id = s.id
        WHERE sf.formateur_id = $3
          AND s.tenant_id = $4
          AND s.statut != 'annulee'
      `;

      const sessionsStatsResult = await client.query(sessionsStatsQuery, [
        startOfMonth.toISOString().split('T')[0],
        endOfMonth.toISOString().split('T')[0],
        formateurId,
        tenantId,
      ]);

      const sessionsStats = sessionsStatsResult.rows[0];

      // Calculate total learners trained (across all sessions assigned to trainer)
      const totalApprenantsQuery = `
        SELECT COUNT(DISTINCT i.apprenant_id)::integer as total_apprenants
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        INNER JOIN ${getTableName(tenantId, 'sessions_professionnelles')} s ON s.id = i.session_id
        INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sf.session_id = s.id
        WHERE sf.formateur_id = $1
          AND i.tenant_id = $2
          AND i.statut = 'confirmee'
      `;

      const totalApprenantsResult = await client.query(totalApprenantsQuery, [formateurId, tenantId]);
      const total_apprenants = totalApprenantsResult.rows[0]?.total_apprenants || 0;

      // Calculate training hours this month
      const heuresQuery = `
        SELECT COALESCE(SUM(
          CASE 
            WHEN s.date_debut >= $1 AND s.date_fin <= $2 THEN
              (s.date_fin::date - s.date_debut::date + 1) * 8  -- Assume 8 hours per day
            ELSE 0
          END
        ), 0)::integer as heures_formation_mois
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sf.session_id = s.id
        WHERE sf.formateur_id = $3
          AND s.tenant_id = $4
          AND s.statut != 'annulee'
      `;

      const heuresResult = await client.query(heuresQuery, [
        startOfMonth.toISOString().split('T')[0],
        endOfMonth.toISOString().split('T')[0],
        formateurId,
        tenantId,
      ]);

      const stats = {
        sessions_a_venir: sessionsStats.sessions_a_venir || 0,
        sessions_en_cours: sessionsStats.sessions_en_cours || 0,
        sessions_terminees_mois: sessionsStats.sessions_terminees_mois || 0,
        total_apprenants,
        heures_formation_mois: heuresResult.rows[0]?.heures_formation_mois || 0,
      };

      const sessionsTable = getTableName(tenantId, "sessions_professionnelles");
      const sessionFormateursTable = getTableName(tenantId, "session_formateurs");
      const formationsTable = getTableName(tenantId, "formations_professionnelles");
      const inscriptionsTable = getTableName(tenantId, "inscriptions_professionnelles");
      const supportsTable = getTableName(tenantId, "supports_cours");
      const supportDownloadsTable = getTableName(tenantId, "support_telechargements");

      // Get next 5 upcoming sessions
      const upcomingSessionsQuery = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.horaires,
          s.mode_formation,
          s.lieu,
          s.lien_visio,
          s.statut,
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          jsonb_build_object(
            'id', f.id,
            'titre', f.titre,
            'slug', f.slug
          ) as formation,
          (
            SELECT COUNT(*)::integer
            FROM ${inscriptionsTable} i
            WHERE i.session_id = s.id
              AND i.tenant_id = $1
              AND i.statut = 'confirmee'
          ) as nb_inscrits
        FROM ${sessionsTable} s
        INNER JOIN ${sessionFormateursTable} sf ON sf.session_id = s.id
        INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id
        WHERE sf.formateur_id = $2
          AND s.tenant_id = $1
          AND s.statut IN ('planifiee', 'ouverte', 'complete')
          AND s.date_debut >= CURRENT_DATE
        ORDER BY s.date_debut ASC
        LIMIT 5
      `;

      const upcomingResult = await client.query(upcomingSessionsQuery, [tenantId, formateurId]);
      const prochaines_sessions = upcomingResult.rows.map((row: any) => ({
        id: row.id,
        code_session: row.code_session,
        formation: row.formation,
        date_debut: row.date_debut.toISOString(),
        date_fin: row.date_fin.toISOString(),
        horaires: row.horaires,
        mode_formation: this.normalizeModeFormation(row.mode_formation),
        lieu: row.lieu,
        lien_visio: row.lien_visio || undefined,
        statut: row.statut,
        places_totales: row.places_totales,
        places_reservees: row.places_reservees,
        places_disponibles: row.places_disponibles,
        nb_inscrits: row.nb_inscrits || 0,
      }));

      // Get last 5 completed sessions
      const recentSessionsQuery = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.horaires,
          s.mode_formation,
          s.lieu,
          s.lien_visio,
          s.statut,
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          jsonb_build_object(
            'id', f.id,
            'titre', f.titre,
            'slug', f.slug
          ) as formation,
          (
            SELECT COUNT(*)::integer
            FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
            WHERE i.session_id = s.id
              AND i.tenant_id = $1
              AND i.statut = 'confirmee'
          ) as nb_inscrits
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sf.session_id = s.id
        INNER JOIN ${getTableName(tenantId, 'formations_professionnelles')} f ON f.id = s.formation_pro_id
        WHERE sf.formateur_id = $2
          AND s.tenant_id = $1
          AND s.statut = 'terminee'
        ORDER BY s.date_fin DESC
        LIMIT 5
      `;

      const recentResult = await client.query(recentSessionsQuery, [tenantId, formateurId]);
      const sessions_recentes = recentResult.rows.map((row: any) => ({
        id: row.id,
        code_session: row.code_session,
        formation: row.formation,
        date_debut: row.date_debut.toISOString(),
        date_fin: row.date_fin.toISOString(),
        horaires: row.horaires,
        mode_formation: this.normalizeModeFormation(row.mode_formation),
        lieu: row.lieu,
        lien_visio: row.lien_visio || undefined,
        statut: row.statut,
        places_totales: row.places_totales,
        places_reservees: row.places_reservees,
        places_disponibles: row.places_disponibles,
        nb_inscrits: row.nb_inscrits || 0,
      }));

      // Get last 5 uploaded course materials
      const materialsQuery = `
        SELECT 
          sc.id,
          sc.titre,
          sc.description,
          sc.type_fichier,
          sc.taille_fichier,
          sc.fichier_url,
          sc.created_at,
          (
            SELECT COUNT(*)::integer
            FROM ${supportDownloadsTable} st
            WHERE st.support_id = sc.id
              AND st.tenant_id = $1
          ) as nb_telechargements
        FROM ${supportsTable} sc
        WHERE sc.formateur_id = $2
          AND sc.tenant_id = $1
        ORDER BY sc.created_at DESC
        LIMIT 5
      `;

      const materialsResult = await client.query(materialsQuery, [tenantId, formateurId]);
      const supports_recents = materialsResult.rows.map((row: any) => ({
        id: row.id,
        titre: row.titre,
        description: row.description,
        type_fichier: row.type_fichier,
        taille_fichier: parseInt(row.taille_fichier) || 0,
        fichier_url: row.fichier_url,
        nb_telechargements: row.nb_telechargements || 0,
        created_at: row.created_at.toISOString(),
      }));

      // Get unread notifications count and recent 5 notifications
      const notificationsQuery = `
        SELECT 
          id,
          type,
          titre,
          message,
          metadata,
          lue,
          lue_at,
          created_at
        FROM ${getTableName(tenantId, 'notifications_formateurs')}
        WHERE formateur_id = $1
          AND tenant_id = $2
        ORDER BY created_at DESC
        LIMIT 5
      `;

      const notificationsResult = await client.query(notificationsQuery, [formateurId, tenantId]);
      const recentes = notificationsResult.rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        titre: row.titre,
        message: row.message,
        metadata: row.metadata,
        lue: row.lue,
        lue_at: row.lue_at ? row.lue_at.toISOString() : undefined,
        created_at: row.created_at.toISOString(),
      }));

      // Count unread notifications
      const unreadCountQuery = `
        SELECT COUNT(*)::integer as nb_non_lues
        FROM ${getTableName(tenantId, 'notifications_formateurs')}
        WHERE formateur_id = $1
          AND tenant_id = $2
          AND lue = false
      `;

      const unreadResult = await client.query(unreadCountQuery, [formateurId, tenantId]);
      const nb_non_lues = unreadResult.rows[0]?.nb_non_lues || 0;

      return {
        stats: {
          sessions_a_venir: stats.sessions_a_venir || 0,
          sessions_en_cours: stats.sessions_en_cours || 0,
          sessions_terminees_mois: stats.sessions_terminees_mois || 0,
          total_apprenants: stats.total_apprenants || 0,
          heures_formation_mois: stats.heures_formation_mois || 0,
        },
        prochaines_sessions,
        sessions_recentes,
        supports_recents,
        notifications: {
          nb_non_lues,
          recentes,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get schedule data for a trainer (sessions and unavailability)
   * T013: Schedule service method
   */
  async getSchedule(
    formateurId: string,
    tenantId: string,
    year: number,
    month?: number
  ): Promise<{
    sessions: Array<{
      id: string;
      title: string;
      start: string;
      end: string;
      backgroundColor: string;
      extendedProps: {
        type: "session";
        code_session: string;
        formation_titre: string;
        mode_formation: string;
        nb_inscrits: number;
        statut: string;
      };
    }>;
    indisponibilites: Array<{
      id: string;
      date_debut: string;
      date_fin: string;
      raison?: string;
      created_at: string;
    }>;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Calculate date range
      const startDate = month
        ? new Date(year, month - 1, 1)
        : new Date(year, 0, 1);
      const endDate = month
        ? new Date(year, month, 0)
        : new Date(year, 11, 31);

      // Query assigned sessions for date range
      const sessionsQuery = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.mode_formation,
          s.statut,
          f.titre as formation_titre,
          (
            SELECT COUNT(*)::integer
            FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
            WHERE i.session_id = s.id
              AND i.tenant_id = $1
              AND i.statut = 'confirmee'
          ) as nb_inscrits
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sf.session_id = s.id
        INNER JOIN ${getTableName(tenantId, 'formations_professionnelles')} f ON f.id = s.formation_pro_id
        WHERE sf.formateur_id = $2
          AND s.tenant_id = $1
          AND s.date_debut <= $4
          AND s.date_fin >= $3
          AND s.statut != 'annulee'
        ORDER BY s.date_debut ASC
      `;

      const sessionsResult = await client.query(sessionsQuery, [
        tenantId,
        formateurId,
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0],
      ]);

      // Format sessions as FullCalendar events
      const sessions = sessionsResult.rows.map((row: any) => {
        const startDate = new Date(row.date_debut);
        const endDate = new Date(row.date_fin);
        // Add 1 day to end date for FullCalendar (exclusive end)
        endDate.setDate(endDate.getDate() + 1);

        return {
          id: row.id,
          title: row.formation_titre,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          backgroundColor: "#3b82f6", // Blue for sessions
          extendedProps: {
            type: "session" as const,
            code_session: row.code_session,
            formation_titre: row.formation_titre,
            mode_formation: this.normalizeModeFormation(row.mode_formation),
            nb_inscrits: row.nb_inscrits || 0,
            statut: row.statut,
          },
        };
      });

      // Query unavailability periods for date range
      const indisponibilitesQuery = `
        SELECT 
          id,
          date_debut,
          date_fin,
          raison,
          created_at
        FROM ${getTableName(tenantId, 'formateur_indisponibilites')}
        WHERE formateur_id = $1
          AND tenant_id = $2
          AND date_debut <= $4
          AND date_fin >= $3
        ORDER BY date_debut ASC
      `;

      const indisponibilitesResult = await client.query(indisponibilitesQuery, [
        formateurId,
        tenantId,
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0],
      ]);

      // Format unavailability periods
      const indisponibilites = indisponibilitesResult.rows.map((row: any) => ({
        id: row.id,
        date_debut: row.date_debut.toISOString().split('T')[0],
        date_fin: row.date_fin.toISOString().split('T')[0],
        raison: row.raison,
        created_at: row.created_at.toISOString(),
      }));

      return {
        sessions,
        indisponibilites,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get all unavailability periods for a trainer
   * T014: Get indisponibilites
   */
  async getIndisponibilites(
    formateurId: string,
    tenantId: string
  ): Promise<Array<{
    id: string;
    date_debut: string;
    date_fin: string;
    raison?: string;
    created_at: string;
  }>> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const query = `
        SELECT 
          id,
          date_debut,
          date_fin,
          raison,
          created_at
        FROM ${getTableName(tenantId, 'formateur_indisponibilites')}
        WHERE formateur_id = $1
          AND tenant_id = $2
        ORDER BY date_debut ASC
      `;

      const result = await client.query(query, [formateurId, tenantId]);

      return result.rows.map((row: any) => ({
        id: row.id,
        date_debut: row.date_debut.toISOString().split('T')[0],
        date_fin: row.date_fin.toISOString().split('T')[0],
        raison: row.raison,
        created_at: row.created_at.toISOString(),
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Create a new unavailability period
   * T014: Create indisponibilite
   */
  async createIndisponibilite(
    formateurId: string,
    tenantId: string,
    data: {
      date_debut: string;
      date_fin: string;
      raison?: string;
    }
  ): Promise<{
    id: string;
    date_debut: string;
    date_fin: string;
    raison?: string;
    created_at: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Validate date range
      const dateDebut = new Date(data.date_debut);
      const dateFin = new Date(data.date_fin);

      if (dateFin < dateDebut) {
        throw new Error("date_fin must be >= date_debut");
      }

      const insertQuery = `
        INSERT INTO formateur_indisponibilites (
          tenant_id,
          formateur_id,
          date_debut,
          date_fin,
          raison
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, date_debut, date_fin, raison, created_at
      `;

      const result = await client.query(insertQuery, [
        tenantId,
        formateurId,
        data.date_debut,
        data.date_fin,
        data.raison || null,
      ]);

      const row = result.rows[0];
      return {
        id: row.id,
        date_debut: row.date_debut.toISOString().split('T')[0],
        date_fin: row.date_fin.toISOString().split('T')[0],
        raison: row.raison,
        created_at: row.created_at.toISOString(),
      };
    } finally {
      client.release();
    }
  }

  /**
   * Delete an unavailability period
   * T014: Delete indisponibilite
   */
  async deleteIndisponibilite(
    indispoId: string,
    formateurId: string,
    tenantId: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify ownership before deleting
      const checkQuery = `
        SELECT id
        FROM ${getTableName(tenantId, 'formateur_indisponibilites')}
        WHERE id = $1
          AND formateur_id = $2
          AND tenant_id = $3
      `;

      const checkResult = await client.query(checkQuery, [indispoId, formateurId, tenantId]);

      if (checkResult.rows.length === 0) {
        throw new Error("UNAUTHORIZED: Unavailability period not found or access denied");
      }

      const deleteQuery = `
        DELETE FROM formateur_indisponibilites
        WHERE id = $1
          AND formateur_id = $2
          AND tenant_id = $3
      `;

      await client.query(deleteQuery, [indispoId, formateurId, tenantId]);
    } finally {
      client.release();
    }
  }

  /**
   * Get list of assigned sessions with filtering and pagination
   * T019: Session list service method
   */
  async getSessions(
    formateurId: string,
    tenantId: string,
    filters: {
      page?: number;
      limit?: number;
      statuts?: string[];
      date_debut?: string;
      date_fin?: string;
      formation_id?: string;
      search?: string;
    }
  ): Promise<{
    sessions: Array<{
      id: string;
      code_session: string;
      formation: {
        id: string;
        titre: string;
        slug?: string;
      };
      date_debut: string;
      date_fin: string;
      horaires?: string;
      mode_formation: string;
      lieu?: string;
      lien_visio?: string;
      statut: string;
      places_totales: number;
      places_reservees: number;
      places_disponibles: number;
      nb_inscrits: number;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const page = filters.page || 1;
      const limit = filters.limit || 20;
      const offset = (page - 1) * limit;

      // Build WHERE clause
      const conditions: string[] = [
        "sf.formateur_id = $1",
        "s.tenant_id = $2",
      ];
      const params: any[] = [formateurId, tenantId];
      let paramIndex = 3;

      // Status filter
      if (filters.statuts && filters.statuts.length > 0) {
        conditions.push(`s.statut = ANY($${paramIndex}::text[])`);
        params.push(filters.statuts);
        paramIndex++;
      }

      // Date range filters
      if (filters.date_debut) {
        conditions.push(`s.date_debut >= $${paramIndex}`);
        params.push(filters.date_debut);
        paramIndex++;
      }
      if (filters.date_fin) {
        conditions.push(`s.date_fin <= $${paramIndex}`);
        params.push(filters.date_fin);
        paramIndex++;
      }

      // Formation filter
      if (filters.formation_id) {
        conditions.push(`s.formation_pro_id = $${paramIndex}`);
        params.push(filters.formation_id);
        paramIndex++;
      }

      // Search filter (code_session or formation title)
      if (filters.search) {
        conditions.push(
          `(s.code_session ILIKE $${paramIndex} OR f.titre ILIKE $${paramIndex})`
        );
        params.push(`%${filters.search}%`);
        paramIndex++;
      }

      const whereClause = conditions.join(" AND ");

      // Count total
      const countQuery = `
        SELECT COUNT(DISTINCT s.id)::integer as total
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sf.session_id = s.id AND sf.tenant_id = s.tenant_id
        INNER JOIN ${getTableName(tenantId, 'formations_professionnelles')} f ON f.id = s.formation_pro_id AND f.tenant_id = s.tenant_id
        WHERE ${whereClause}
      `;
      const countResult = await client.query(countQuery, params);
      const total = countResult.rows[0].total;

      // Fetch sessions
      const sessionsQuery = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.horaires,
          s.mode_formation,
          s.lieu,
          s.lien_visio,
          s.statut,
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          jsonb_build_object(
            'id', f.id,
            'titre', f.titre,
            'slug', f.slug
          ) as formation,
          (
            SELECT COUNT(*)::integer
            FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
            WHERE i.session_id = s.id
              AND i.tenant_id = s.tenant_id
              AND i.statut = 'confirmee'
          ) as nb_inscrits
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sf.session_id = s.id AND sf.tenant_id = s.tenant_id
        INNER JOIN ${getTableName(tenantId, 'formations_professionnelles')} f ON f.id = s.formation_pro_id AND f.tenant_id = s.tenant_id
        WHERE ${whereClause}
        ORDER BY s.date_debut DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(limit, offset);
      const sessionsResult = await client.query(sessionsQuery, params);

      const sessions = sessionsResult.rows.map((row: any) => ({
        id: row.id,
        code_session: row.code_session,
        formation: row.formation,
        date_debut: row.date_debut.toISOString().split('T')[0],
        date_fin: row.date_fin.toISOString().split('T')[0],
        horaires: row.horaires,
        mode_formation: this.normalizeModeFormation(row.mode_formation),
        lieu: row.lieu,
        lien_visio: row.lien_visio || undefined,
        statut: row.statut,
        places_totales: row.places_totales,
        places_reservees: row.places_reservees,
        places_disponibles: row.places_disponibles,
        nb_inscrits: row.nb_inscrits || 0,
      }));

      return {
        sessions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get detailed session information
   * T020: Session detail service method
   */
  async getSessionDetails(
    sessionId: string,
    formateurId: string,
    tenantId: string
  ): Promise<{
    session: {
      id: string;
      code_session: string;
      date_debut: string;
      date_fin: string;
      horaires?: string;
      mode_formation: string;
      lieu?: string;
      lien_visio?: string;
      statut: string;
      places_totales: number;
      places_reservees: number;
      places_disponibles: number;
      notes_formateur?: string;
      notes_updated_at?: string;
    };
    formation: {
      id: string;
      titre: string;
      slug?: string;
      description_courte?: string;
    };
    inscrits: Array<{
      id: string;
      inscription_id: string;
      apprenant: {
        id: string;
        nom: string;
        prenom: string;
        email: string;
        telephone?: string;
      };
      entreprise?: {
        id: string;
        nom: string;
      };
      statut_inscription: string;
      presence?: boolean;
      presence_marked_at?: string;
    }>;
    supports: Array<{
      id: string;
      titre: string;
      type_fichier: string;
      fichier_url: string;
    }>;
    notes_formateur?: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify session access
      const { verifySessionAccess } = await import("../utils/sessionAccess");
      await verifySessionAccess(this.pool, sessionId, formateurId, tenantId);

      // Fetch session details
      const sessionQuery = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.horaires,
          s.mode_formation,
          s.lieu,
          s.lien_visio,
          s.statut,
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          s.notes_formateur,
          s.notes_updated_at
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        WHERE s.id = $1 AND s.tenant_id = $2
      `;
      const sessionResult = await client.query(sessionQuery, [sessionId, tenantId]);
      const sessionRow = sessionResult.rows[0];

      // Fetch formation details
      const formationQuery = `
        SELECT 
          f.id,
          f.titre,
          f.slug,
          f.description_courte
        FROM ${getTableName(tenantId, 'formations_professionnelles')} f
        INNER JOIN ${getTableName(tenantId, 'sessions_professionnelles')} s ON s.formation_pro_id = f.id
        WHERE s.id = $1 AND f.tenant_id = $2
      `;
      const formationResult = await client.query(formationQuery, [sessionId, tenantId]);
      const formationRow = formationResult.rows[0];

      const inscriptionsTable = getTableName(tenantId, "inscriptions_professionnelles");
      const entreprisesTable = getTableName(tenantId, "entreprises_clientes");
      const attendanceTable = getTableName(tenantId, "session_attendance");
      const supportsTable = getTableName(tenantId, "supports_cours");
      const supportAssociationsTable = getTableName(tenantId, "support_session_associations");

      // Fetch enrolled learners
      const inscritsQuery = `
        SELECT 
          i.id as inscription_id,
          i.statut as statut_inscription,
          jsonb_strip_nulls(jsonb_build_object(
            'id', u.id,
            'nom', COALESCE(NULLIF(u.last_name, ''), NULLIF(split_part(COALESCE(u.name, ''), ' ', 2), ''), COALESCE(u.name, '')),
            'prenom', COALESCE(NULLIF(u.first_name, ''), NULLIF(split_part(COALESCE(u.name, ''), ' ', 1), ''), ''),
            'email', u.email,
            'telephone', NULL
          )) as apprenant,
          CASE 
            WHEN e.id IS NOT NULL THEN jsonb_build_object('id', e.id, 'nom', COALESCE(e.raison_sociale, ''))
            ELSE NULL
          END as entreprise,
          sa.present as presence,
          sa.marked_at as presence_marked_at
        FROM ${inscriptionsTable} i
        INNER JOIN users u ON i.apprenant_id = u.id AND u.tenant_id = $2
        LEFT JOIN ${entreprisesTable} e ON i.entreprise_id = e.id AND i.tenant_id = e.tenant_id
        LEFT JOIN ${attendanceTable} sa ON sa.inscription_id = i.id AND sa.session_id = $1 AND sa.tenant_id = $2
        WHERE i.session_id = $1 AND i.tenant_id = $2
        ORDER BY COALESCE(NULLIF(u.last_name, ''), COALESCE(u.name, '')), COALESCE(NULLIF(u.first_name, ''), '')
      `;
      const inscritsResult = await client.query(inscritsQuery, [sessionId, tenantId]);

      // Fetch associated course materials
      const supportsQuery = `
        SELECT 
          sc.id,
          sc.titre,
          sc.type_fichier,
          sc.fichier_url
        FROM ${supportsTable} sc
        INNER JOIN ${supportAssociationsTable} ssa ON sc.id = ssa.support_id AND sc.tenant_id = ssa.tenant_id
        WHERE ssa.session_id = $1 AND sc.tenant_id = $2
        ORDER BY sc.created_at DESC
      `;
      const supportsResult = await client.query(supportsQuery, [sessionId, tenantId]);

      return {
        session: {
          id: sessionRow.id,
          code_session: sessionRow.code_session,
          date_debut: sessionRow.date_debut.toISOString().split('T')[0],
          date_fin: sessionRow.date_fin.toISOString().split('T')[0],
          horaires: sessionRow.horaires || undefined,
          mode_formation: this.normalizeModeFormation(sessionRow.mode_formation),
          lieu: sessionRow.lieu || undefined,
          lien_visio: sessionRow.lien_visio || undefined,
          statut: sessionRow.statut,
          places_totales: sessionRow.places_totales,
          places_reservees: sessionRow.places_reservees,
          places_disponibles: sessionRow.places_disponibles,
          notes_formateur: sessionRow.notes_formateur || undefined,
          notes_updated_at: sessionRow.notes_updated_at
            ? sessionRow.notes_updated_at.toISOString()
            : undefined,
        },
        formation: {
          id: formationRow.id,
          titre: formationRow.titre,
          slug: formationRow.slug || undefined,
          description_courte: formationRow.description_courte || undefined,
        },
        inscrits: inscritsResult.rows.map((row: any) => ({
          id: row.inscription_id,
          inscription_id: row.inscription_id,
          apprenant: row.apprenant,
          entreprise: row.entreprise || undefined,
          statut_inscription: row.statut_inscription,
          presence: row.presence !== null ? row.presence : undefined,
          presence_marked_at: row.presence_marked_at
            ? row.presence_marked_at.toISOString()
            : undefined,
        })),
        supports: supportsResult.rows.map((row: any) => ({
          id: row.id,
          titre: row.titre,
          type_fichier: row.type_fichier,
          fichier_url: row.fichier_url,
        })),
        notes_formateur: sessionRow.notes_formateur || undefined,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get enrolled learners for a session
   * T021: Enrolled learners service method
   */
  async getSessionInscrits(
    sessionId: string,
    formateurId: string,
    tenantId: string
  ): Promise<{
    inscrits: Array<{
      id: string;
      inscription_id: string;
      apprenant: {
        id: string;
        nom: string;
        prenom: string;
        email: string;
        telephone?: string;
      };
      entreprise?: {
        id: string;
        nom: string;
      };
      statut_inscription: string;
      presence?: boolean;
      presence_marked_at?: string;
    }>;
    stats: {
      total_inscrits: number;
      confirmees: number;
      presents?: number;
      absents?: number;
    };
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify session access
      const { verifySessionAccess } = await import("../utils/sessionAccess");
      await verifySessionAccess(this.pool, sessionId, formateurId, tenantId);

      const inscriptionsTable = getTableName(tenantId, "inscriptions_professionnelles");
      const entreprisesTable = getTableName(tenantId, "entreprises_clientes");
      const attendanceTable = getTableName(tenantId, "session_attendance");

      // Fetch enrolled learners with attendance
      const inscritsQuery = `
        SELECT 
          i.id as inscription_id,
          i.statut as statut_inscription,
          jsonb_strip_nulls(jsonb_build_object(
            'id', u.id,
            'nom', COALESCE(NULLIF(u.last_name, ''), NULLIF(split_part(COALESCE(u.name, ''), ' ', 2), ''), COALESCE(u.name, '')),
            'prenom', COALESCE(NULLIF(u.first_name, ''), NULLIF(split_part(COALESCE(u.name, ''), ' ', 1), ''), ''),
            'email', u.email,
            'telephone', NULL
          )) as apprenant,
          CASE 
            WHEN e.id IS NOT NULL THEN jsonb_build_object('id', e.id, 'nom', COALESCE(e.raison_sociale, ''))
            ELSE NULL
          END as entreprise,
          sa.present as presence,
          sa.marked_at as presence_marked_at
        FROM ${inscriptionsTable} i
        INNER JOIN users u ON i.apprenant_id = u.id AND u.tenant_id = $2
        LEFT JOIN ${entreprisesTable} e ON i.entreprise_id = e.id AND i.tenant_id = e.tenant_id
        LEFT JOIN ${attendanceTable} sa ON sa.inscription_id = i.id AND sa.session_id = $1 AND sa.tenant_id = $2
        WHERE i.session_id = $1 AND i.tenant_id = $2
        ORDER BY COALESCE(NULLIF(u.last_name, ''), COALESCE(u.name, '')), COALESCE(NULLIF(u.first_name, ''), '')
      `;
      const inscritsResult = await client.query(inscritsQuery, [sessionId, tenantId]);

      // Calculate statistics
      const statsQuery = `
        SELECT 
          COUNT(*)::integer as total_inscrits,
          COUNT(*) FILTER (WHERE i.statut = 'confirmee')::integer as confirmees,
          COUNT(*) FILTER (WHERE sa.present = TRUE)::integer as presents,
          COUNT(*) FILTER (WHERE sa.present = FALSE)::integer as absents
        FROM ${inscriptionsTable} i
        LEFT JOIN ${attendanceTable} sa ON sa.inscription_id = i.id AND sa.session_id = $1 AND sa.tenant_id = $2
        WHERE i.session_id = $1 AND i.tenant_id = $2
      `;
      const statsResult = await client.query(statsQuery, [sessionId, tenantId]);
      const statsRow = statsResult.rows[0];

      return {
        inscrits: inscritsResult.rows.map((row: any) => ({
          id: row.inscription_id,
          inscription_id: row.inscription_id,
          apprenant: row.apprenant,
          entreprise: row.entreprise || undefined,
          statut_inscription: row.statut_inscription,
          presence: row.presence !== null ? row.presence : undefined,
          presence_marked_at: row.presence_marked_at
            ? row.presence_marked_at.toISOString()
            : undefined,
        })),
        stats: {
          total_inscrits: statsRow.total_inscrits,
          confirmees: statsRow.confirmees,
          presents: statsRow.presents > 0 ? statsRow.presents : undefined,
          absents: statsRow.absents > 0 ? statsRow.absents : undefined,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update session notes
   * T043: Session notes service method
   */
  async updateSessionNotes(
    sessionId: string,
    notes: string,
    formateurId: string,
    tenantId: string
  ): Promise<{
    session_id: string;
    notes: string;
    updated_at: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify session access
      const { verifySessionAccess } = await import("../utils/sessionAccess");
      await verifySessionAccess(this.pool, sessionId, formateurId, tenantId);

      // Validate notes length
      if (notes.length > 10000) {
        throw new Error("NOTES_TOO_LONG: Notes cannot exceed 10000 characters");
      }

      // Update notes
      const updateQuery = `
        UPDATE ${getTableName(tenantId, 'sessions_professionnelles')}
        SET notes_formateur = $1,
            notes_updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3
        RETURNING notes_formateur, notes_updated_at
      `;

      const result = await client.query(updateQuery, [notes, sessionId, tenantId]);

      if (result.rows.length === 0) {
        throw new Error("SESSION_NOT_FOUND: Session not found");
      }

      return {
        session_id: sessionId,
        notes: result.rows[0].notes_formateur || "",
        updated_at: result.rows[0].notes_updated_at.toISOString(),
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get trainer profile with statistics
   * T051: Profile service method
   */
  async getProfile(
    formateurId: string,
    tenantId: string
  ): Promise<{
    formateur: {
      id: string;
      nom: string;
      prenom: string;
      email: string;
      telephone?: string;
      bio?: string;
      specialites?: string[];
      linkedin_url?: string;
      photo_url?: string;
      cv_url?: string;
    };
    formations_assignees: Array<{
      id: string;
      titre: string;
    }>;
    statistiques: {
      nb_sessions_total: number;
      nb_apprenants_formes: number;
      heures_formation_total: number;
      nb_supports_crees: number;
    };
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get formateur info with user info
      const formateurQuery = `
        SELECT
          f.id,
          f.nom,
          f.prenom,
          f.email,
          f.telephone,
          f.bio,
          f.specialites,
          f.linkedin_url,
          f.photo_url,
          f.cv_url
        FROM ${getTableName(tenantId, 'formateurs')} f
        WHERE f.id = $1 AND f.tenant_id = $2
      `;
      const formateurResult = await client.query(formateurQuery, [formateurId, tenantId]);

      if (formateurResult.rows.length === 0) {
        throw new Error("FORMATEUR_NOT_FOUND: Trainer not found");
      }

      const formateurRow = formateurResult.rows[0];
      const formateur = {
        id: formateurRow.id,
        nom: formateurRow.nom,
        prenom: formateurRow.prenom,
        email: formateurRow.email,
        telephone: formateurRow.telephone || undefined,
        bio: formateurRow.bio || undefined,
        specialites: formateurRow.specialites || [],
        linkedin_url: formateurRow.linkedin_url || undefined,
        photo_url: formateurRow.photo_url || undefined,
        cv_url: formateurRow.cv_url || undefined,
      };

      // Get assigned training programs (via session_formateurs)
      const formationsQuery = `
        SELECT DISTINCT
          fp.id,
          fp.titre
        FROM ${getTableName(tenantId, 'formations_professionnelles')} fp
        INNER JOIN ${getTableName(tenantId, 'sessions_professionnelles')} sp ON fp.id = sp.formation_pro_id AND fp.tenant_id = sp.tenant_id
        INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sp.id = sf.session_id AND sp.tenant_id = sf.tenant_id
        WHERE sf.formateur_id = $1 AND sf.tenant_id = $2
        ORDER BY fp.titre
      `;
      const formationsResult = await client.query(formationsQuery, [formateurId, tenantId]);
      const formations_assignees = formationsResult.rows.map((row: any) => ({
        id: row.id,
        titre: row.titre,
      }));

      // Calculate statistics
      const supportsTable = getTableName(tenantId, "supports_cours");
      const statsQuery = `
        SELECT
          COUNT(DISTINCT sp.id)::integer AS nb_sessions_total,
          COUNT(DISTINCT ip.apprenant_id)::integer AS nb_apprenants_formes,
          COALESCE(SUM(EXTRACT(EPOCH FROM (sp.date_fin - sp.date_debut)) / 3600)::integer, 0) AS heures_formation_total,
          (SELECT COUNT(*)::integer FROM ${supportsTable} WHERE formateur_id = $1 AND tenant_id = $2) AS nb_supports_crees
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} sp
        INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sp.id = sf.session_id AND sp.tenant_id = sf.tenant_id
        LEFT JOIN ${getTableName(tenantId, 'inscriptions_professionnelles')} ip ON sp.id = ip.session_id AND sp.tenant_id = ip.tenant_id AND ip.statut = 'confirmee'
        WHERE sf.formateur_id = $1 AND sf.tenant_id = $2
      `;
      const statsResult = await client.query(statsQuery, [formateurId, tenantId]);
      const stats = statsResult.rows[0];

      return {
        formateur,
        formations_assignees,
        statistiques: {
          nb_sessions_total: stats.nb_sessions_total || 0,
          nb_apprenants_formes: stats.nb_apprenants_formes || 0,
          heures_formation_total: stats.heures_formation_total || 0,
          nb_supports_crees: stats.nb_supports_crees || 0,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update trainer profile
   * T052: Profile update service method
   */
  async updateProfile(
    formateurId: string,
    updates: {
      bio?: string;
      specialites?: string[];
      linkedin_url?: string;
      photo?: Buffer | string; // Buffer for file upload, string for URL
      photoContentType?: string;
    },
    tenantId: string
  ): Promise<{
    formateur: {
      id: string;
      bio?: string;
      specialites?: string[];
      linkedin_url?: string;
      photo_url?: string;
      updated_at: string;
    };
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify formateur exists
      const checkQuery = `SELECT id FROM formateurs WHERE id = $1 AND tenant_id = $2`;
      const checkResult = await client.query(checkQuery, [formateurId, tenantId]);
      if (checkResult.rows.length === 0) {
        throw new Error("FORMATEUR_NOT_FOUND: Trainer not found");
      }

      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      // Update bio
      if (updates.bio !== undefined) {
        updateFields.push(`bio = $${paramIndex++}`);
        updateValues.push(updates.bio || null);
      }

      // Update specialites
      if (updates.specialites !== undefined) {
        updateFields.push(`specialites = $${paramIndex++}`);
        updateValues.push(JSON.stringify(updates.specialites));
      }

      // Update linkedin_url
      if (updates.linkedin_url !== undefined) {
        updateFields.push(`linkedin_url = $${paramIndex++}`);
        updateValues.push(updates.linkedin_url || null);
      }

      // Handle photo upload
      let photoUrl: string | undefined;
      if (updates.photo !== undefined) {
        if (Buffer.isBuffer(updates.photo)) {
          // Validate photo type and size
          const allowedTypes = ["image/jpeg", "image/jpg", "image/png"];
          if (!updates.photoContentType || !allowedTypes.includes(updates.photoContentType)) {
            throw new Error("INVALID_PHOTO_TYPE: Photo must be JPG or PNG");
          }
          if (updates.photo.length > 5 * 1024 * 1024) {
            throw new Error("PHOTO_TOO_LARGE: Photo size must not exceed 5MB");
          }

          // Upload photo using FileStorageService
          const { getFileStorageService } = await import("./fileStorage");
          const fileStorageService = getFileStorageService();
          const uploadResult = await fileStorageService.uploadFile(updates.photo, {
            tenantId,
            courseId: "profile", // Use "profile" as courseId for profile photos
            fileName: `photo-${formateurId}.${updates.photoContentType.split("/")[1]}`,
            contentType: updates.photoContentType,
            metadata: {
              uploadedBy: formateurId,
              type: "profile_photo",
            },
          });

          photoUrl = `/api/v1/files/${uploadResult.key}`;
          updateFields.push(`photo_url = $${paramIndex++}`);
          updateValues.push(photoUrl);
        } else if (typeof updates.photo === "string") {
          // Photo URL provided directly
          photoUrl = updates.photo;
          updateFields.push(`photo_url = $${paramIndex++}`);
          updateValues.push(photoUrl);
        }
      }

      // Update updated_at
      updateFields.push(`updated_at = NOW()`);

      if (updateFields.length === 0) {
        // No updates, return current profile
        const currentQuery = `SELECT bio, specialites, linkedin_url, photo_url, updated_at FROM formateurs WHERE id = $1 AND tenant_id = $2`;
        const currentResult = await client.query(currentQuery, [formateurId, tenantId]);
        const current = currentResult.rows[0];
        return {
          formateur: {
            id: formateurId,
            bio: current.bio || undefined,
            specialites: current.specialites || [],
            linkedin_url: current.linkedin_url || undefined,
            photo_url: current.photo_url || undefined,
            updated_at: current.updated_at.toISOString(),
          },
        };
      }

      // Execute update
      const updateQuery = `
        UPDATE ${getTableName(tenantId, 'formateurs')}
        SET ${updateFields.join(", ")}
        WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex++}
        RETURNING bio, specialites, linkedin_url, photo_url, updated_at
      `;
      updateValues.push(formateurId, tenantId);
      const updateResult = await client.query(updateQuery, updateValues);

      const updated = updateResult.rows[0];
      return {
        formateur: {
          id: formateurId,
          bio: updated.bio || undefined,
          specialites: updated.specialites || [],
          linkedin_url: updated.linkedin_url || undefined,
          photo_url: updated.photo_url || undefined,
          updated_at: updated.updated_at.toISOString(),
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Upload trainer CV
   * T053: CV upload service method
   */
  async uploadCV(
    formateurId: string,
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    tenantId: string
  ): Promise<{
    cv_url: string;
    updated_at: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify formateur exists
      const checkQuery = `SELECT id FROM ${getTableName(tenantId, 'formateurs')} WHERE id = $1 AND tenant_id = $2`;
      const checkResult = await client.query(checkQuery, [formateurId, tenantId]);
      if (checkResult.rows.length === 0) {
        throw new Error("FORMATEUR_NOT_FOUND: Trainer not found");
      }

      // Validate file type (PDF only)
      if (contentType !== "application/pdf" && !fileName.toLowerCase().endsWith(".pdf")) {
        throw new Error("INVALID_CV_TYPE: CV must be a PDF file");
      }

      // Validate file size (max 10MB)
      if (fileBuffer.length > 10 * 1024 * 1024) {
        throw new Error("CV_TOO_LARGE: CV size must not exceed 10MB");
      }

      // Upload CV using FileStorageService
      const { getFileStorageService } = await import("./fileStorage");
      const fileStorageService = getFileStorageService();
      const uploadResult = await fileStorageService.uploadFile(fileBuffer, {
        tenantId,
        courseId: "profile", // Use "profile" as courseId for CVs
        fileName: `cv-${formateurId}.pdf`,
        contentType: "application/pdf",
        metadata: {
          uploadedBy: formateurId,
          type: "cv",
          originalFileName: fileName,
        },
      });

      const cvUrl = `/api/v1/files/${uploadResult.key}`;

      // Update cv_url in formateurs table
      const updateQuery = `
        UPDATE ${getTableName(tenantId, 'formateurs')}
        SET cv_url = $1, updated_at = NOW()
        WHERE id = $2 AND tenant_id = $3
        RETURNING updated_at
      `;
      const updateResult = await client.query(updateQuery, [cvUrl, formateurId, tenantId]);

      return {
        cv_url: cvUrl,
        updated_at: updateResult.rows[0].updated_at.toISOString(),
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get trainer notifications
   * T057: Notification service method
   */
  async getNotifications(
    formateurId: string,
    tenantId: string,
    filters: {
      page?: number;
      limit?: number;
      non_lues?: boolean;
    } = {}
  ): Promise<{
    notifications: Array<{
      id: string;
      type: string;
      titre: string;
      message: string;
      metadata?: Record<string, any>;
      lue: boolean;
      lue_at?: string;
      created_at: string;
    }>;
    nb_non_lues: number;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const page = filters.page || 1;
      const limit = Math.min(filters.limit || 20, 50);
      const offset = (page - 1) * limit;

      // Build WHERE clause
      const conditions: string[] = [
        "formateur_id = $1",
        "tenant_id = $2",
      ];
      const params: any[] = [formateurId, tenantId];
      let paramIndex = 3;

      if (filters.non_lues === true) {
        conditions.push(`lue = FALSE`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Get notifications
      const notificationsQuery = `
        SELECT
          id,
          type,
          titre,
          message,
          metadata,
          lue,
          lue_at,
          created_at
        FROM ${getTableName(tenantId, 'notifications_formateurs')}
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(limit, offset);
      const notificationsResult = await client.query(notificationsQuery, params);

      // Get total count
      const countQuery = `
        SELECT COUNT(*)::integer
        FROM ${getTableName(tenantId, 'notifications_formateurs')}
        ${whereClause}
      `;
      const countResult = await client.query(countQuery, params.slice(0, params.length - 2));
      const total = parseInt(countResult.rows[0].count, 10);

      // Get unread count
      const unreadCountQuery = `
        SELECT COUNT(*)::integer
        FROM ${getTableName(tenantId, 'notifications_formateurs')}
        WHERE formateur_id = $1 AND tenant_id = $2 AND lue = FALSE
      `;
      const unreadCountResult = await client.query(unreadCountQuery, [formateurId, tenantId]);
      const nb_non_lues = parseInt(unreadCountResult.rows[0].count, 10);

      const notifications = notificationsResult.rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        titre: row.titre,
        message: row.message,
        metadata: row.metadata || undefined,
        lue: row.lue,
        lue_at: row.lue_at ? row.lue_at.toISOString() : undefined,
        created_at: row.created_at.toISOString(),
      }));

      return {
        notifications,
        nb_non_lues,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Mark notification as read
   * T058: Mark notification as read service method
   */
  async markNotificationRead(
    notificationId: string,
    formateurId: string,
    tenantId: string
  ): Promise<{
    id: string;
    lue: boolean;
    lue_at: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify formateur ownership
      const checkQuery = `
        SELECT id
        FROM ${getTableName(tenantId, 'notifications_formateurs')}
        WHERE id = $1 AND formateur_id = $2 AND tenant_id = $3
      `;
      const checkResult = await client.query(checkQuery, [notificationId, formateurId, tenantId]);

      if (checkResult.rows.length === 0) {
        throw new Error("NOTIFICATION_NOT_FOUND: Notification not found or access denied");
      }

      // Update notification
      const updateQuery = `
        UPDATE ${getTableName(tenantId, 'notifications_formateurs')}
        SET lue = TRUE, lue_at = NOW()
        WHERE id = $1 AND formateur_id = $2 AND tenant_id = $3
        RETURNING id, lue, lue_at
      `;
      const updateResult = await client.query(updateQuery, [notificationId, formateurId, tenantId]);

      return {
        id: updateResult.rows[0].id,
        lue: updateResult.rows[0].lue,
        lue_at: updateResult.rows[0].lue_at.toISOString(),
      };
    } finally {
      client.release();
    }
  }
}
