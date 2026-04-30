/**
 * SessionProService
 * 
 * Business logic for professional training session management
 * Handles session CRUD operations, capacity management, and status updates
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from "pg";
import {
  SessionListQuery,
  SessionListItem,
  CalendarEvent,
  SessionDetail,
  UpdateSessionSchema,
  EnrollmentListQuerySchema,
  EnrollmentDetail,
} from "@ecoledigitale/contracts/src/sessions-pro";
import { AdminSessionListQuerySchema } from "@ecoledigitale/contracts/src/sessions-pro/admin.schema";
import { z } from "zod";

type AdminSessionListQuery = z.infer<typeof AdminSessionListQuerySchema>;
type UpdateSessionData = z.infer<typeof UpdateSessionSchema>;
type EnrollmentListQuery = z.infer<typeof EnrollmentListQuerySchema>;
import { FormateurAvailabilityService } from "./formateur-availability.service";
import { getTableName } from "../utils/table-names";

export class SessionProService {
  constructor(
    private pool: Pool,
    private availabilityService?: FormateurAvailabilityService
  ) {}

  /**
   * Convert French delivery mode values to English enum values for database
   */
  private mapModeFormationToDb(mode: string): string {
    const mapping: Record<string, string> = {
      'presentiel': 'presential',
      'distanciel': 'remote',
      'hybride': 'hybrid',
    };
    return mapping[mode] || mode;
  }

  /**
   * Convert English enum values from database to French values for frontend
   */
  private mapModeFormationFromDb(mode: string): string {
    const mapping: Record<string, string> = {
      'presential': 'presentiel',
      'remote': 'distanciel',
      'hybrid': 'hybride',
      'elearning': 'elearning', // Keep as is if needed
    };
    return mapping[mode] || mode;
  }

  /**
   * Set tenant context for RLS policies
   * Must be called before any database query
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Get list of sessions with filtering, pagination, and sorting
   * Excludes cancelled sessions for public access
   */
  async getSessionsList(
    tenantId: string,
    query: SessionListQuery,
    excludeCancelled: boolean = true
  ): Promise<{ sessions: SessionListItem[]; total: number }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const page = query.page || 1;
      const limit = query.limit || 20;
      const offset = (page - 1) * limit;

      // Build WHERE conditions
      const whereConditions: string[] = ["s.tenant_id = $1"];
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      // Exclude cancelled sessions for public access
      if (excludeCancelled) {
        whereConditions.push("s.statut != 'annulee'");
      }

      // Formation filter
      if (query.formation_id) {
        whereConditions.push(`s.formation_pro_id = $${paramIndex}`);
        queryParams.push(query.formation_id);
        paramIndex++;
      }

      // Mode filter
      if (query.mode && query.mode.length > 0) {
        whereConditions.push(`s.mode_formation = ANY($${paramIndex}::delivery_mode[])`);
        queryParams.push(query.mode);
        paramIndex++;
      }

      // Date range filters
      if (query.date_debut) {
        whereConditions.push(`s.date_debut >= $${paramIndex}::date`);
        queryParams.push(query.date_debut);
        paramIndex++;
      }
      if (query.date_fin) {
        whereConditions.push(`s.date_fin <= $${paramIndex}::date`);
        queryParams.push(query.date_fin);
        paramIndex++;
      }

      // Status filter
      if (query.statut && query.statut.length > 0) {
        whereConditions.push(`s.statut = ANY($${paramIndex}::session_professional_status[])`);
        queryParams.push(query.statut);
        paramIndex++;
      }

      // Trainer filter
      if (query.formateur_id) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM session_formateurs sf
          WHERE sf.session_id = s.id
          AND sf.formateur_id = $${paramIndex}
          AND sf.tenant_id = $1
        )`);
        queryParams.push(query.formateur_id);
        paramIndex++;
      }

      // Month filter (YYYY-MM format)
      if (query.mois) {
        const [year, month] = query.mois.split("-");
        whereConditions.push(`EXTRACT(YEAR FROM s.date_debut) = $${paramIndex}::integer`);
        queryParams.push(parseInt(year));
        paramIndex++;
        whereConditions.push(`EXTRACT(MONTH FROM s.date_debut) = $${paramIndex}::integer`);
        queryParams.push(parseInt(month));
        paramIndex++;
      }

      // Year filter
      if (query.annee) {
        whereConditions.push(`EXTRACT(YEAR FROM s.date_debut) = $${paramIndex}::integer`);
        queryParams.push(query.annee);
        paramIndex++;
      }

      // Build ORDER BY clause
      let orderBy = "s.date_debut ASC";
      if (query.sort) {
        switch (query.sort) {
          case "date_asc":
            orderBy = "s.date_debut ASC";
            break;
          case "date_desc":
            orderBy = "s.date_debut DESC";
            break;
          case "prix_asc":
            orderBy = "COALESCE(s.prix_ttc, s.prix_ht, 0) ASC";
            break;
          case "prix_desc":
            orderBy = "COALESCE(s.prix_ttc, s.prix_ht, 0) DESC";
            break;
        }
      }

      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const formateursTable = getTableName(tenantId, 'formateurs');
      const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

      // Trainer filter - update if not already done
      if (query.formateur_id && !whereConditions.some(c => c.includes('session_formateurs'))) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM ${sessionFormateursTable} sf
          WHERE sf.session_id = s.id
          AND sf.formateur_id = $${paramIndex}
          AND sf.tenant_id = $1
        )`);
        queryParams.push(query.formateur_id);
        paramIndex++;
      }

      // Count total matching sessions
      const countQuery = `
        SELECT COUNT(*) as total
        FROM ${sessionsTable} s
        WHERE ${whereConditions.join(" AND ")}
      `;
      const countResult = await client.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total);

      // Add limit and offset parameters
      const limitParamIndex = paramIndex;
      const offsetParamIndex = paramIndex + 1;
      queryParams.push(limit, offset);

      // Fetch sessions with related data
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
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          s.statut,
          s.prix_ht,
          s.prix_ttc,
          jsonb_build_object(
            'id', f.id,
            'titre', f.titre,
            'slug', f.slug
          ) as formation,
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'id', form.id,
                'nom', form.nom,
                'prenom', form.prenom
              )
            ) FILTER (WHERE form.id IS NOT NULL),
            '[]'::jsonb
          ) as formateurs
        FROM ${sessionsTable} s
        INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id
        LEFT JOIN ${sessionFormateursTable} sf ON sf.session_id = s.id AND sf.tenant_id = s.tenant_id
        LEFT JOIN ${formateursTable} form ON form.id = sf.formateur_id AND form.tenant_id = s.tenant_id
        WHERE ${whereConditions.join(" AND ")}
        GROUP BY s.id, f.id, f.titre, f.slug
        ORDER BY ${orderBy}
        LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      `;

      // Log the query and params for debugging
      console.log('🔍 [getSessionsList] SQL Query:', {
        query: sessionsQuery,
        params: queryParams,
        paramCount: queryParams.length,
      });

      const sessionsResult = await client.query(sessionsQuery, queryParams);

      console.log('📊 [getSessionsList] Query Result:', {
        rowCount: sessionsResult.rows.length,
        firstRow: sessionsResult.rows[0] || null,
        firstRowKeys: sessionsResult.rows[0] ? Object.keys(sessionsResult.rows[0]) : null,
        firstRowStringified: sessionsResult.rows[0] ? JSON.stringify(sessionsResult.rows[0], null, 2) : null,
      });

      const sessions: SessionListItem[] = sessionsResult.rows.map((row, index) => {
        console.log(`🔬 [getSessionsList] Mapping row ${index}:`, {
          row,
          rowKeys: Object.keys(row),
          id: row.id,
          code_session: row.code_session,
          formation: row.formation,
          date_debut: row.date_debut,
          date_debutType: typeof row.date_debut,
        });

        try {
          // Ensure all values are JSON-serializable and match SessionListItemSchema
          const session: SessionListItem = {
            id: String(row.id),
            code_session: row.code_session ? String(row.code_session) : "",
            formation: row.formation ? {
              id: String(row.formation.id || ""),
              titre: String(row.formation.titre || ""),
              slug: String(row.formation.slug || ""),
            } : { id: "", titre: "", slug: "" },
            date_debut: row.date_debut ? (row.date_debut instanceof Date ? row.date_debut.toISOString().split("T")[0] : String(row.date_debut).split("T")[0]) : "",
            date_fin: row.date_fin ? (row.date_fin instanceof Date ? row.date_fin.toISOString().split("T")[0] : String(row.date_fin).split("T")[0]) : "",
            horaires: row.horaires ? String(row.horaires) : null, // nullable per schema
            mode_formation: (() => {
              const mode = row.mode_formation ? String(row.mode_formation) : "presentiel";
              // Convert database values to schema values
              if (mode === "presential") return "presentiel";
              if (mode === "remote") return "distanciel";
              if (mode === "hybrid") return "hybride";
              return mode as "presentiel" | "distanciel" | "hybride";
            })(),
            lieu: row.lieu ? String(row.lieu) : null,
            lien_visio: row.lien_visio ? String(row.lien_visio) : null,
            places_totales: Number(row.places_totales) || 0,
            places_reservees: Number(row.places_reservees) || 0,
            places_disponibles: Number(row.places_disponibles) || 0,
            statut: (row.statut ? String(row.statut) : "planifiee") as "planifiee" | "ouverte" | "complete" | "en_cours" | "terminee" | "annulee",
            prix_ht: row.prix_ht ? parseFloat(String(row.prix_ht)) : null,
            prix_ttc: row.prix_ttc ? parseFloat(String(row.prix_ttc)) : null,
            formateurs: Array.isArray(row.formateurs) ? row.formateurs.map((f: any) => ({
              id: String(f.id || ""),
              nom: String(f.nom || ""),
              prenom: String(f.prenom || ""),
            })) : [],
          };
          return session;
        } catch (error) {
          console.error(`❌ [getSessionsList] Error mapping row ${index}:`, error, row);
          throw error;
        }
      });

      // Safe logging - avoid JSON.stringify errors
      try {
        const firstSession = sessions[0] || null;
        console.log('✅ [getSessionsList] Final sessions:', {
          sessionsCount: sessions.length,
          firstSessionKeys: firstSession ? Object.keys(firstSession) : null,
          firstSessionId: firstSession?.id,
          firstSessionCode: firstSession?.code_session,
          firstSessionFormation: firstSession?.formation,
        });
      } catch (logError) {
        console.error('❌ [getSessionsList] Error logging final sessions:', logError);
      }

      // Force plain objects for JSON serialization
      // This ensures all properties are enumerable and serializable
      const serializedSessions = sessions.map(session => {
        return {
          id: session.id,
          code_session: session.code_session,
          formation: session.formation,
          date_debut: session.date_debut,
          date_fin: session.date_fin,
          horaires: session.horaires,
          mode_formation: session.mode_formation,
          lieu: session.lieu,
          lien_visio: session.lien_visio,
          places_totales: session.places_totales,
          places_reservees: session.places_reservees,
          places_disponibles: session.places_disponibles,
          statut: session.statut,
          prix_ht: session.prix_ht,
          prix_ttc: session.prix_ttc,
          formateurs: session.formateurs,
        };
      });

      console.log('🔄 [getSessionsList] Serialized sessions:', {
        sessionsCount: serializedSessions.length,
        firstSerializedSession: serializedSessions[0] || null,
        firstSerializedSessionKeys: serializedSessions[0] ? Object.keys(serializedSessions[0]) : null,
      });

      return { sessions: serializedSessions, total };
    } finally {
      client.release();
    }
  }

  /**
   * Get sessions formatted for calendar display (FullCalendar format)
   */
  async getSessionsCalendar(
    tenantId: string,
    annee: number,
    mois?: number,
    formationIds?: string[],
    modes?: string[]
  ): Promise<CalendarEvent[]> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);
      
      // Debug: Log input parameters
      console.log('🔍 getSessionsCalendar called with:');
      console.log('  tenantId:', tenantId);
      console.log('  annee:', annee);
      console.log('  mois:', mois);
      console.log('  formationIds:', formationIds);
      console.log('  modes:', modes);
      
      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const formateursTable = getTableName(tenantId, 'formateurs');
      const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

      // First, check if any sessions exist for this tenant
      const countQuery = `SELECT COUNT(*) as total FROM ${sessionsTable} WHERE tenant_id = $1`;
      const countResult = await client.query(countQuery, [tenantId]);
      console.log('📊 Total sessions for tenant:', countResult.rows[0]?.total || 0);

      // Build WHERE conditions
      const whereConditions: string[] = [
        "s.tenant_id = $1",
        "s.statut != 'annulee'", // Exclude cancelled sessions
      ];
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      // Year and month filter - include sessions that overlap with the requested month
      // A session is included if it starts or ends within the requested month/year
      // or if it spans across the requested month
      if (mois) {
        // Calculate first and last day of the requested month
        const monthStart = `${annee}-${String(mois).padStart(2, '0')}-01`;
        // Get last day of month: new Date(year, month, 0) returns last day of (month-1)
        // Since mois is 1-indexed (1-12), we need mois+1 to get the last day of the requested month
        const lastDay = new Date(annee, mois, 0).getDate();
        const monthEnd = `${annee}-${String(mois).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        
        // Session overlaps with the month if:
        // - It starts in this month/year, OR
        // - It ends in this month/year, OR
        // - It starts before month start and ends after month start
        whereConditions.push(`
          (
            (s.date_debut >= $${paramIndex}::date AND s.date_debut <= $${paramIndex + 1}::date)
            OR
            (s.date_fin >= $${paramIndex}::date AND s.date_fin <= $${paramIndex + 1}::date)
            OR
            (s.date_debut < $${paramIndex}::date AND s.date_fin >= $${paramIndex}::date)
          )
        `);
        queryParams.push(monthStart, monthEnd);
        paramIndex += 2;
      } else {
        // Only year filter - include sessions that overlap with the requested year
        const yearStart = `${annee}-01-01`;
        const yearEnd = `${annee}-12-31`;
        whereConditions.push(`
          (
            (s.date_debut >= $${paramIndex}::date AND s.date_debut <= $${paramIndex + 1}::date)
            OR
            (s.date_fin >= $${paramIndex}::date AND s.date_fin <= $${paramIndex + 1}::date)
            OR
            (s.date_debut < $${paramIndex}::date AND s.date_fin >= $${paramIndex}::date)
          )
        `);
        queryParams.push(yearStart, yearEnd);
        paramIndex += 2;
      }

      // Formation filter
      if (formationIds && formationIds.length > 0) {
        whereConditions.push(`s.formation_pro_id = ANY($${paramIndex}::uuid[])`);
        queryParams.push(formationIds);
        paramIndex++;
      }

      // Mode filter
      if (modes && modes.length > 0) {
        whereConditions.push(`s.mode_formation = ANY($${paramIndex}::delivery_mode[])`);
        queryParams.push(modes);
        paramIndex++;
      }

      // Fetch sessions with related data
      const sessionsQuery = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.mode_formation,
          s.lieu,
          s.places_disponibles,
          s.statut,
          f.titre as formation_titre,
          COALESCE(
            string_agg(DISTINCT form.prenom || ' ' || form.nom, ', ' ORDER BY form.prenom || ' ' || form.nom),
            ''
          ) as formateurs_noms
        FROM ${sessionsTable} s
        INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id AND f.tenant_id = s.tenant_id AND f.actif = true
        LEFT JOIN ${sessionFormateursTable} sf ON sf.session_id = s.id AND sf.tenant_id = s.tenant_id
        LEFT JOIN ${formateursTable} form ON form.id = sf.formateur_id AND form.tenant_id = s.tenant_id
        WHERE ${whereConditions.join(" AND ")}
        GROUP BY s.id, s.code_session, s.date_debut, s.date_fin, s.mode_formation, s.lieu, s.places_disponibles, s.statut, f.titre
        ORDER BY s.date_debut ASC
      `;

      // Debug: Log query and params
      console.log('\n🔍 Calendar Query Debug:');
      console.log('Query:', sessionsQuery);
      console.log('Params:', JSON.stringify(queryParams, null, 2));
      console.log('Where Conditions:', whereConditions.join(' AND '));

      const sessionsResult = await client.query(sessionsQuery, queryParams);
      
      // Debug: Log results
      console.log('\n📊 Query Results:');
      console.log('Rows found:', sessionsResult.rows.length);
      if (sessionsResult.rows.length > 0) {
        console.log('First row:', JSON.stringify(sessionsResult.rows[0], null, 2));
        console.log('All rows:', JSON.stringify(sessionsResult.rows.map(r => ({
          id: r.id,
          code_session: r.code_session,
          date_debut: r.date_debut,
          date_fin: r.date_fin,
          statut: r.statut,
          formation_titre: r.formation_titre
        })), null, 2));
      } else {
        console.log('⚠️  No sessions found. Running diagnostic queries...');
        
        // Try a simpler query to see if sessions exist at all
        try {
          const testQuery1 = `
            SELECT 
              COUNT(*) as total, 
              COUNT(*) FILTER (WHERE statut != 'annulee') as not_cancelled,
              COUNT(*) FILTER (WHERE statut = 'annulee') as cancelled
            FROM ${sessionsTable}
            WHERE tenant_id = $1
          `;
          const testResult1 = await client.query(testQuery1, [queryParams[0]]);
          console.log('📈 Session Statistics (all):', testResult1.rows[0]);
          
          // Check sessions in the date range (using the same month as the query)
          if (mois) {
            const monthStart = `${annee}-${String(mois).padStart(2, '0')}-01`;
            const lastDay = new Date(annee, mois, 0).getDate();
            const monthEnd = `${annee}-${String(mois).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
            
            try {
              const testQuery2 = `
                SELECT 
                  COUNT(*)::integer as total_in_range,
                  COUNT(*) FILTER (WHERE statut != 'annulee')::integer as not_cancelled_in_range,
                  array_agg(code_session) FILTER (WHERE code_session IS NOT NULL) as session_codes,
                  array_agg(date_debut::text) FILTER (WHERE date_debut IS NOT NULL) as start_dates,
                  array_agg(statut::text) FILTER (WHERE statut IS NOT NULL) as statuses
                FROM ${sessionsTable}
                WHERE tenant_id = $1
                  AND (
                    (date_debut >= $2::date AND date_debut <= $3::date)
                    OR
                    (date_fin >= $2::date AND date_fin <= $3::date)
                    OR
                    (date_debut < $2::date AND date_fin >= $2::date)
                  )
              `;
              const testResult2 = await client.query(testQuery2, [queryParams[0], monthStart, monthEnd]);
              console.log('📈 Session Statistics (date range):', testResult2.rows[0]);
              
              // Also check December 2025 specifically since that's where the sessions are
              if (mois === 11) {
                console.log('\n🔍 Checking December 2025 (where sessions actually are)...');
                const decStart = '2025-12-01';
                const decEnd = '2025-12-31';
                const decQuery = `
                  SELECT 
                    COUNT(*)::integer as total_in_dec,
                    array_agg(code_session) FILTER (WHERE code_session IS NOT NULL) as session_codes
                  FROM ${sessionsTable}
                  WHERE tenant_id = $1
                    AND statut != 'annulee'
                    AND (
                      (date_debut >= $2::date AND date_debut <= $3::date)
                      OR
                      (date_fin >= $2::date AND date_fin <= $3::date)
                      OR
                      (date_debut < $2::date AND date_fin >= $2::date)
                    )
                `;
                const decResult = await client.query(decQuery, [queryParams[0], decStart, decEnd]);
                console.log('📈 Sessions in December 2025:', decResult.rows[0]);
              }
            } catch (testError2: any) {
              console.log('⚠️  Could not run date range test query:', testError2.message);
            }
          }
          
          // Check if formations are active
          const testQuery3 = `
            SELECT 
              s.id,
              s.code_session,
              s.date_debut,
              s.date_fin,
              s.statut,
              f.titre as formation_titre,
              f.actif as formation_active
            FROM ${sessionsTable} s
            INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id AND f.tenant_id = s.tenant_id
            WHERE s.tenant_id = $1
              AND s.statut != 'annulee'
            LIMIT 5
          `;
          const testResult3 = await client.query(testQuery3, [queryParams[0]]);
          console.log('📈 Sample sessions with formation status:', JSON.stringify(testResult3.rows, null, 2));
        } catch (testError: any) {
          console.error('⚠️  Could not run test query:', testError.message);
          console.error('  Stack:', testError.stack);
        }
      }

      const events: CalendarEvent[] = sessionsResult.rows.map((row) => {
        const startDate = new Date(row.date_debut);
        const endDate = new Date(row.date_fin);
        // Note: We don't add a day to end date because allDaySlot is false
        // FullCalendar will display timed events correctly with the actual end time

        return {
          id: row.id,
          title: row.formation_titre,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          backgroundColor: this.getColorByMode(row.mode_formation),
          borderColor: this.getColorByStatut(row.statut),
          extendedProps: {
            code_session: row.code_session,
            mode: row.mode_formation,
            lieu: row.lieu || null,
            formateurs: row.formateurs_noms || "",
            places_disponibles: row.places_disponibles,
            statut: row.statut,
          },
        };
      });

      return events;
    } catch (error: any) {
      console.error('❌ Error in getSessionsCalendar:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      throw error; // Re-throw to be handled by route handler
    } finally {
      client.release();
    }
  }

  /**
   * Get color for calendar event based on delivery mode
   */
  getColorByMode(mode: string): string {
    switch (mode) {
      case "presentiel":
        return "#3b82f6"; // Blue
      case "distanciel":
        return "#10b981"; // Green
      case "hybride":
        return "#f59e0b"; // Amber
      default:
        return "#6b7280"; // Gray
    }
  }

  /**
   * Get border color for calendar event based on status
   */
  getColorByStatut(statut: string): string {
    switch (statut) {
      case "planifiee":
        return "#6b7280"; // Gray
      case "ouverte":
        return "#10b981"; // Green
      case "complete":
        return "#ef4444"; // Red
      case "en_cours":
        return "#3b82f6"; // Blue
      case "terminee":
        return "#6b7280"; // Gray
      default:
        return "#6b7280"; // Gray
    }
  }

  /**
   * Get session by ID with full details (formation, formateurs, inscriptions count)
   */
  async getSessionById(
    tenantId: string,
    sessionId: string
  ): Promise<SessionDetail | null> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const formateursTable = getTableName(tenantId, 'formateurs');
      const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

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
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          s.statut,
          s.prix_ht,
          s.prix_ttc,
          jsonb_build_object(
            'id', f.id,
            'titre', f.titre,
            'slug', f.slug,
            'description_courte', f.description_courte,
            'objectifs', f.objectifs,
            'programme', f.programme_detaille
          ) as formation,
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'id', form.id,
                'nom', form.nom,
                'prenom', form.prenom,
                'bio', form.bio,
                'photo', form.photo_url,
                'specialites', COALESCE(form.specialites, '[]'::jsonb)
              )
            ) FILTER (WHERE form.id IS NOT NULL),
            '[]'::jsonb
          ) as formateurs,
          (
            SELECT COUNT(*)::integer
            FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} ip
            WHERE ip.session_id = s.id
            AND ip.tenant_id = s.tenant_id
          ) as inscriptions_count
        FROM ${sessionsTable} s
        INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id
        LEFT JOIN ${sessionFormateursTable} sf ON sf.session_id = s.id AND sf.tenant_id = s.tenant_id
        LEFT JOIN ${formateursTable} form ON form.id = sf.formateur_id AND form.tenant_id = s.tenant_id
        WHERE s.id = $1 AND s.tenant_id = $2
        GROUP BY s.id, f.id, f.titre, f.slug, f.description_courte, f.objectifs, f.programme_detaille
      `;

      const result = await client.query(sessionQuery, [sessionId, tenantId]);

      console.log('🔍 [getSessionById] Query result:', {
        rowCount: result.rows.length,
        firstRow: result.rows[0] || null,
        firstRowKeys: result.rows[0] ? Object.keys(result.rows[0]) : null,
      });

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      console.log('🔬 [getSessionById] Raw row data:', {
        id: row.id,
        code_session: row.code_session,
        formation: row.formation,
        formationType: typeof row.formation,
        formationStringified: row.formation ? JSON.stringify(row.formation) : null,
        date_debut: row.date_debut,
        date_debutType: typeof row.date_debut,
        formateurs: row.formateurs,
        formateursType: typeof row.formateurs,
        formateursIsArray: Array.isArray(row.formateurs),
        formateursStringified: row.formateurs ? JSON.stringify(row.formateurs) : null,
      });

      // Parse JSONB objects if they are strings
      let formationObj: any = row.formation;
      if (typeof row.formation === 'string') {
        try {
          formationObj = JSON.parse(row.formation);
        } catch (e) {
          console.error('❌ [getSessionById] Failed to parse formation JSONB:', e);
          formationObj = null;
        }
      }

      let formateursArray: any[] = row.formateurs || [];
      if (typeof row.formateurs === 'string') {
        try {
          formateursArray = JSON.parse(row.formateurs);
        } catch (e) {
          console.error('❌ [getSessionById] Failed to parse formateurs JSONB:', e);
          formateursArray = [];
        }
      }
      if (!Array.isArray(formateursArray)) {
        formateursArray = [];
      }

      // Ensure all values are JSON-serializable and match SessionDetailSchema
      const session: SessionDetail = {
        id: String(row.id),
        code_session: row.code_session ? String(row.code_session) : "",
        formation: formationObj ? {
          id: String(formationObj.id || ""),
          titre: String(formationObj.titre || ""),
          slug: String(formationObj.slug || ""),
          description_courte: formationObj.description_courte ? String(formationObj.description_courte) : null,
          objectifs: Array.isArray(formationObj.objectifs) ? formationObj.objectifs.map((o: any) => String(o)) : (formationObj.objectifs ? [String(formationObj.objectifs)] : []),
          programme: formationObj.programme ? (typeof formationObj.programme === 'string' ? formationObj.programme : JSON.stringify(formationObj.programme)) : null,
        } : {
          id: "",
          titre: "",
          slug: "",
          description_courte: null,
          objectifs: [],
          programme: null,
        },
        date_debut: row.date_debut ? (row.date_debut instanceof Date ? row.date_debut.toISOString().split("T")[0] : String(row.date_debut).split("T")[0]) : "",
        date_fin: row.date_fin ? (row.date_fin instanceof Date ? row.date_fin.toISOString().split("T")[0] : String(row.date_fin).split("T")[0]) : "",
        horaires: row.horaires ? String(row.horaires) : null,
        mode_formation: (() => {
          const mode = row.mode_formation ? String(row.mode_formation) : "presentiel";
          // Convert database values to schema values
          if (mode === "presential") return "presentiel";
          if (mode === "remote") return "distanciel";
          if (mode === "hybrid") return "hybride";
          return mode as "presentiel" | "distanciel" | "hybride";
        })(),
        lieu: row.lieu ? String(row.lieu) : null,
        lien_visio: row.lien_visio ? String(row.lien_visio) : null,
        places_totales: Number(row.places_totales) || 0,
        places_reservees: Number(row.places_reservees) || 0,
        places_disponibles: Number(row.places_disponibles) || 0,
        statut: (row.statut ? String(row.statut) : "planifiee") as "planifiee" | "ouverte" | "complete" | "en_cours" | "terminee" | "annulee",
        prix_ht: row.prix_ht ? parseFloat(String(row.prix_ht)) : null,
        prix_ttc: row.prix_ttc ? parseFloat(String(row.prix_ttc)) : null,
        formateurs: formateursArray.map((f: any) => ({
          id: String(f.id || ""),
          nom: String(f.nom || ""),
          prenom: String(f.prenom || ""),
          bio: f.bio ? String(f.bio) : null,
          photo: f.photo ? String(f.photo) : null,
          specialites: Array.isArray(f.specialites) ? f.specialites.map((s: any) => String(s)) : (f.specialites ? [String(f.specialites)] : []),
        })),
        inscriptions_count: Number(row.inscriptions_count) || 0,
      };

      console.log('✅ [getSessionById] Mapped session:', {
        sessionId: session.id,
        sessionKeys: Object.keys(session),
        formationKeys: session.formation ? Object.keys(session.formation) : null,
        formateursCount: session.formateurs.length,
      });

      return session;
    } finally {
      client.release();
    }
  }

  /**
   * Get real-time availability information for a session
   */
  async getSessionAvailability(
    tenantId: string,
    sessionId: string
  ): Promise<{
    places_disponibles: number;
    places_reservees: number;
    places_totales: number;
    peut_inscrire: boolean;
    message?: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

      const availabilityQuery = `
        SELECT 
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          s.statut
        FROM ${sessionsTable} s
        WHERE s.id = $1 AND s.tenant_id = $2
      `;

      const result = await client.query(availabilityQuery, [sessionId, tenantId]);

      if (result.rows.length === 0) {
        throw new Error("SESSION_NOT_FOUND");
      }

      const row = result.rows[0];
      const places_disponibles = row.places_disponibles;
      const places_reservees = row.places_reservees;
      const places_totales = row.places_totales;
      const statut = row.statut;

      // Determine if enrollment is possible
      let peut_inscrire = false;
      let message: string | undefined;

      if (statut === "annulee") {
        peut_inscrire = false;
        message = "Cette session a été annulée";
      } else if (statut === "terminee") {
        peut_inscrire = false;
        message = "Cette session est terminée";
      } else if (statut === "en_cours") {
        peut_inscrire = false;
        message = "Cette session est en cours";
      } else if (statut === "complete" || places_disponibles === 0) {
        peut_inscrire = false;
        message = "Session complète";
      } else if (statut === "planifiee") {
        peut_inscrire = false;
        message = "Les inscriptions ne sont pas encore ouvertes";
      } else if (statut === "ouverte" && places_disponibles > 0) {
        peut_inscrire = true;
      }

      return {
        places_disponibles,
        places_reservees,
        places_totales,
        peut_inscrire,
        message,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Generate session code in format PREFIX-YEAR-NUMBER (e.g., DATA-2024-001)
   * PREFIX: First 4 uppercase alphanumeric characters from formation slug
   * YEAR: Current year (4 digits)
   * NUMBER: Sequential 3-digit number per formation per year
   */
  async generateCodeSession(
    tenantId: string,
    formationId: string,
    year?: number
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

      // Get formation slug
      const formationQuery = `
        SELECT slug
        FROM ${formationsTable}
        WHERE id = $1 AND tenant_id = $2
      `;
      const formationResult = await client.query(formationQuery, [formationId, tenantId]);

      if (formationResult.rows.length === 0) {
        throw new Error("FORMATION_NOT_FOUND");
      }

      const slug = formationResult.rows[0].slug || "FORM";
      
      // Extract prefix: first 4 uppercase alphanumeric characters
      const prefix = slug
        .substring(0, 4)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .padEnd(4, "X"); // Pad with X if less than 4 chars

      // Get current year or use provided year
      const currentYear = year || new Date().getFullYear();
      const yearStr = currentYear.toString();

      // Count existing sessions for this formation in this year
      const countQuery = `
        SELECT COUNT(*)::integer as count
        FROM ${sessionsTable}
        WHERE tenant_id = $1
          AND formation_pro_id = $2
          AND code_session LIKE $3
      `;
      const pattern = `${prefix}-${yearStr}-%`;
      const countResult = await client.query(countQuery, [tenantId, formationId, pattern]);

      const existingCount = parseInt(countResult.rows[0].count) || 0;
      const nextNumber = existingCount + 1;
      const numberStr = nextNumber.toString().padStart(3, "0");

      const codeSession = `${prefix}-${yearStr}-${numberStr}`;

      // Check if code already exists (unlikely but handle edge case)
      const checkQuery = `
        SELECT id
        FROM ${sessionsTable}
        WHERE tenant_id = $1 AND code_session = $2
      `;
      const checkResult = await client.query(checkQuery, [tenantId, codeSession]);

      if (checkResult.rows.length > 0) {
        // If exists, append timestamp suffix
        const timestamp = Date.now().toString().slice(-4);
        return `${prefix}-${yearStr}-${numberStr}-${timestamp}`;
      }

      return codeSession;
    } finally {
      client.release();
    }
  }

  /**
   * Assign trainers to a session
   * @param client - Database client (optional, will create new connection if not provided)
   */
  async assignFormateurs(
    tenantId: string,
    sessionId: string,
    formateurIds: string[],
    role: "principal" | "assistant" | "intervenant" = "principal",
    client?: any
  ): Promise<void> {
    const shouldReleaseClient = !client;
    if (!client) {
      client = await this.pool.connect();
    }
    
    try {
      await this.setTenantContext(client, tenantId);

      // Get tenant-specific table names
      const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');
      const formateursTable = getTableName(tenantId, 'formateurs');

      // Validate that all formateurs exist in the correct tenant table
      if (formateurIds.length > 0) {
        const formateursCheck = await client.query(
          `SELECT id FROM ${formateursTable} WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
          [formateurIds, tenantId]
        );

        const foundFormateurIds = formateursCheck.rows.map((row: any) => row.id);
        const missingFormateurIds = formateurIds.filter(id => !foundFormateurIds.includes(id));

        if (missingFormateurIds.length > 0) {
          throw new Error(
            `FORMATEUR_NOT_FOUND: The following formateurs do not exist in the tenant's table: ${missingFormateurIds.join(', ')}`
          );
        }
      }

      // Delete existing assignments for this session
      await client.query(
        `DELETE FROM ${sessionFormateursTable} WHERE session_id = $1 AND tenant_id = $2`,
        [sessionId, tenantId]
      );

      // Insert new assignments
      for (const formateurId of formateurIds) {
        await client.query(
          `INSERT INTO ${sessionFormateursTable} (session_id, formateur_id, tenant_id, role)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, session_id, formateur_id) DO UPDATE SET role = $4`,
          [sessionId, formateurId, tenantId, role]
        );
      }
    } finally {
      if (shouldReleaseClient) {
        client.release();
      }
    }
  }

  /**
   * Create a new training session
   */
  async createSession(
    tenantId: string,
    data: {
      formation_id: string;
      date_debut: string; // YYYY-MM-DD
      date_fin: string; // YYYY-MM-DD
      horaires: string;
      mode_formation: "presentiel" | "distanciel" | "hybride";
      lieu?: string;
      lien_visio?: string;
      places_totales: number;
      prix_ht?: number;
      prix_ttc?: number;
      formateur_ids: string[];
      statut?: "planifiee" | "ouverte";
      notes_internes?: string;
    }
  ): Promise<SessionDetail> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Start transaction
      await client.query("BEGIN");

      try {
        // Get tenant-specific table names
        const formationsTable = getTableName(tenantId, 'formations_professionnelles');
        const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
        const formateursTable = getTableName(tenantId, 'formateurs');
        const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

        // Validate formation exists (allow inactive formations for admin)
        // First check if formation exists at all (without tenant filter for debugging)
        const formationCheckAll = await client.query(
          `SELECT id, slug, tenant_id, actif
           FROM ${formationsTable}
           WHERE id = $1`,
          [data.formation_id]
        );

        if (formationCheckAll.rows.length === 0) {
          throw new Error("FORMATION_NOT_FOUND: The specified formation does not exist in the database");
        }

        // Now check with tenant filter
        const formationCheck = await client.query(
          `SELECT id, slug, prix_ht as formation_prix_ht, prix_ttc as formation_prix_ttc, actif
           FROM ${formationsTable}
           WHERE id = $1 AND tenant_id = $2`,
          [data.formation_id, tenantId]
        );

        if (formationCheck.rows.length === 0) {
          const foundTenantId = formationCheckAll.rows[0].tenant_id;
          throw new Error(`FORMATION_NOT_FOUND: Formation exists but belongs to tenant ${foundTenantId}, not ${tenantId}`);
        }

        // Warn if formation is inactive (but allow creation)
        if (!formationCheck.rows[0].actif) {
          this.log?.warn(`Creating session for inactive formation: ${data.formation_id}`);
        }

        const formation = formationCheck.rows[0];

        // Validate dates
        // Parse dates as local dates (YYYY-MM-DD format)
        const dateDebutParts = data.date_debut.split('-').map(Number);
        const dateFinParts = data.date_fin.split('-').map(Number);
        const dateDebut = new Date(dateDebutParts[0], dateDebutParts[1] - 1, dateDebutParts[2]);
        const dateFin = new Date(dateFinParts[0], dateFinParts[1] - 1, dateFinParts[2]);
        
        // Get today's date in local timezone (set to midnight)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (dateFin <= dateDebut) {
          throw new Error("INVALID_DATES: date_fin must be after date_debut");
        }

        // Compare dates (both set to midnight in local timezone)
        dateDebut.setHours(0, 0, 0, 0);
        dateFin.setHours(0, 0, 0, 0);
        
        // Allow sessions starting today or in the future
        // Use <= instead of < to allow sessions starting today
        if (dateDebut < today) {
          const dateDebutStr = dateDebut.toLocaleDateString('fr-FR');
          const todayStr = today.toLocaleDateString('fr-FR');
          throw new Error(`INVALID_DATES: Cannot create sessions in the past. Date de début: ${dateDebutStr}, Date actuelle: ${todayStr}`);
        }

        // Validate mode requirements
        if (data.mode_formation === "presentiel" && !data.lieu) {
          throw new Error("VALIDATION_ERROR: lieu is required for presentiel mode");
        }

        if (
          (data.mode_formation === "distanciel" || data.mode_formation === "hybride") &&
          !data.lien_visio
        ) {
          throw new Error("VALIDATION_ERROR: lien_visio is required for distanciel or hybride mode");
        }

        // Validate capacity
        if (data.places_totales <= 0) {
          throw new Error("VALIDATION_ERROR: places_totales must be greater than 0");
        }

        // Validate trainers
        if (!data.formateur_ids || data.formateur_ids.length === 0) {
          throw new Error("VALIDATION_ERROR: At least one trainer must be assigned");
        }

        // Check trainer availability if availabilityService is provided
        if (this.availabilityService) {
          const availabilityResults = await this.availabilityService.checkFormateursDisponibilite(
            tenantId,
            data.date_debut,
            data.date_fin,
            data.formateur_ids
          );

          const trainersWithConflicts = availabilityResults.filter((r) => !r.disponible);
          if (trainersWithConflicts.length > 0) {
            // Get trainer names for better error messages
            const client = await this.pool.connect();
            try {
              await this.setTenantContext(client, tenantId);
              const trainerIds = trainersWithConflicts.map(t => t.formateur_id);
              const trainerNamesQuery = await client.query(
                `SELECT id, nom, prenom FROM ${formateursTable} WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
                [trainerIds, tenantId]
              );
              const trainerNamesMap = new Map(
                trainerNamesQuery.rows.map((row: any) => [row.id, `${row.prenom} ${row.nom}`])
              );

              const conflictMessages = trainersWithConflicts.map((t) => {
                const trainerName = trainerNamesMap.get(t.formateur_id) || t.formateur_id;
                const conflictsList = t.conflits?.map(c => 
                  `"${c.formation}" (${c.code_session}) du ${c.date_debut} au ${c.date_fin}`
                ).join(', ') || 'conflit inconnu';
                return `Le formateur ${trainerName} a un conflit avec: ${conflictsList}`;
              });
              
              throw new Error(`TRAINER_CONFLICT: ${conflictMessages.join('; ')}`);
            } finally {
              client.release();
            }
          }
        }

        // Generate session code
        const year = dateDebut.getFullYear();
        const codeSession = await this.generateCodeSession(tenantId, data.formation_id, year);

        // Use formation prices as defaults if not provided
        const prix_ht = data.prix_ht ?? formation.formation_prix_ht;
        const prix_ttc =
          data.prix_ttc ?? (prix_ht ? parseFloat((prix_ht * 1.18).toFixed(2)) : formation.formation_prix_ttc);

        // Validate pricing
        if (prix_ht !== null && prix_ttc !== null && prix_ttc < prix_ht) {
          throw new Error("VALIDATION_ERROR: prix_ttc must be >= prix_ht");
        }

        // Map French delivery mode values to English enum values for database
        const dbModeFormation = this.mapModeFormationToDb(data.mode_formation);

        // Insert session
        const insertQuery = `
          INSERT INTO ${sessionsTable} (
            tenant_id,
            formation_pro_id,
            code_session,
            date_debut,
            date_fin,
            horaires,
            mode_formation,
            lieu,
            lien_visio,
            places_totales,
            places_reservees,
            prix_ht,
            prix_ttc,
            statut,
            notes_internes
          ) VALUES ($1, $2, $3, $4, $5, $6, CAST($7 AS delivery_mode), $8, $9, $10, 0, $11, $12, $13, $14)
          RETURNING id
        `;

        const insertResult = await client.query(insertQuery, [
          tenantId,
          data.formation_id,
          codeSession,
          data.date_debut,
          data.date_fin,
          data.horaires,
          dbModeFormation,
          data.lieu || null,
          data.lien_visio || null,
          data.places_totales,
          prix_ht || null,
          prix_ttc || null,
          data.statut || "planifiee",
          data.notes_internes || null,
        ]);

        const sessionId = insertResult.rows[0].id;

        // Assign trainers (use same client for transaction)
        await this.assignFormateurs(tenantId, sessionId, data.formateur_ids, "principal", client);

        // Commit transaction
        await client.query("COMMIT");

        // Fetch and return created session
        const session = await this.getSessionById(tenantId, sessionId);
        if (!session) {
          throw new Error("Failed to retrieve created session");
        }

        return session;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing session with validation and change detection
   * T077, T082, T087: Validation, capacity constraints, change detection
   */
  async updateSession(
    tenantId: string,
    sessionId: string,
    data: UpdateSessionData
  ): Promise<SessionDetail> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Start transaction
      await client.query("BEGIN");

      try {
        // Get current session data
        const currentSession = await this.getSessionById(tenantId, sessionId);
        if (!currentSession) {
          throw new Error("SESSION_NOT_FOUND");
        }

        // T083: Status restrictions - cannot modify en_cours/terminee except to annulee
        if (currentSession.statut === "en_cours" || currentSession.statut === "terminee") {
          // Only allow status change to 'annulee'
          if (data.statut && data.statut !== "annulee") {
            throw new Error("SESSION_LOCKED: Cannot modify sessions with status 'en_cours' or 'terminee' except to change status to 'annulee'");
          }
          // Block all other field changes
          const allowedFields = ["statut"];
          const providedFields = Object.keys(data).filter(key => data[key as keyof UpdateSessionData] !== undefined);
          const disallowedFields = providedFields.filter(field => !allowedFields.includes(field));
          if (disallowedFields.length > 0) {
            throw new Error(`SESSION_LOCKED: Cannot modify fields [${disallowedFields.join(", ")}] for sessions with status '${currentSession.statut}'`);
          }
        }

        // T087: Change detection - identify which fields changed
        const changes: {
          dates?: boolean;
          location?: boolean;
          videoLink?: boolean;
          trainers?: boolean;
          capacity?: boolean;
          pricing?: boolean;
        } = {};

        if (data.date_debut && data.date_debut !== currentSession.date_debut) {
          changes.dates = true;
        }
        if (data.date_fin && data.date_fin !== currentSession.date_fin) {
          changes.dates = true;
        }
        if (data.lieu !== undefined && data.lieu !== currentSession.lieu) {
          changes.location = true;
        }
        if (data.lien_visio !== undefined && data.lien_visio !== currentSession.lien_visio) {
          changes.videoLink = true;
        }
        if (data.formateur_ids && data.formateur_ids.length > 0) {
          const currentTrainerIds = currentSession.formateurs.map(f => f.id).sort();
          const newTrainerIds = [...data.formateur_ids].sort();
          if (JSON.stringify(currentTrainerIds) !== JSON.stringify(newTrainerIds)) {
            changes.trainers = true;
          }
        }
        if (data.places_totales !== undefined && data.places_totales !== currentSession.places_totales) {
          changes.capacity = true;
        }
        if (data.prix_ht !== undefined && data.prix_ht !== currentSession.prix_ht) {
          changes.pricing = true;
        }
        if (data.prix_ttc !== undefined && data.prix_ttc !== currentSession.prix_ttc) {
          changes.pricing = true;
        }

        // Validate formation if changed
        let formationId = currentSession.formation.id;
        // Get tenant-specific table names
        const formationsTable = getTableName(tenantId, 'formations_professionnelles');
        const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
        const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

        if (data.formation_id) {
          const formationCheck = await client.query(
            `SELECT id, slug, prix_ht as formation_prix_ht, prix_ttc as formation_prix_ttc
             FROM ${formationsTable}
             WHERE id = $1 AND tenant_id = $2 AND actif = true`,
            [data.formation_id, tenantId]
          );

          if (formationCheck.rows.length === 0) {
            throw new Error("FORMATION_NOT_FOUND");
          }

          formationId = data.formation_id;
        }

        // Validate dates if changed
        let dateDebut = new Date(currentSession.date_debut);
        let dateFin = new Date(currentSession.date_fin);
        
        if (data.date_debut) {
          dateDebut = new Date(data.date_debut);
        }
        if (data.date_fin) {
          dateFin = new Date(data.date_fin);
        }

        if (dateFin <= dateDebut) {
          throw new Error("INVALID_DATES: date_fin must be after date_debut");
        }

        // Validate mode requirements if changed
        const modeFormation = data.mode_formation || currentSession.mode_formation;
        if (modeFormation === "presentiel" && !data.lieu && !currentSession.lieu) {
          throw new Error("VALIDATION_ERROR: lieu is required for presentiel mode");
        }
        if ((modeFormation === "distanciel" || modeFormation === "hybride") && !data.lien_visio && !currentSession.lien_visio) {
          throw new Error("VALIDATION_ERROR: lien_visio is required for distanciel or hybride mode");
        }

        // T082: Validate capacity - prevent reduction below places_reservees
        const placesTotales = data.places_totales ?? currentSession.places_totales;
        if (placesTotales < currentSession.places_reservees) {
          throw new Error(`CAPACITY_CONFLICT: Cannot reduce places_totales below current places_reservees (${currentSession.places_reservees})`);
        }

        // T077: Re-validate trainer availability if dates or trainers change
        if (changes.dates || changes.trainers) {
          const trainerIds = data.formateur_ids || currentSession.formateurs.map(f => f.id);
          
          if (this.availabilityService && trainerIds.length > 0) {
            // Check availability, excluding current session
            const availabilityResults = await this.availabilityService.checkFormateursDisponibilite(
              tenantId,
              dateDebut.toISOString().split('T')[0],
              dateFin.toISOString().split('T')[0],
              trainerIds,
              sessionId // Exclude current session from conflict check
            );

            const trainersWithConflicts = availabilityResults.filter((r) => !r.disponible);
            if (trainersWithConflicts.length > 0) {
              const conflictMessages = trainersWithConflicts.map(
                (t) => `Trainer ${t.formateur_id} has conflicts: ${JSON.stringify(t.conflits)}`
              );
              throw new Error(`TRAINER_CONFLICT: ${conflictMessages.join("; ")}`);
            }
          }
        }

        // Build update query dynamically
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (data.formation_id) {
          updateFields.push(`formation_pro_id = $${paramIndex}`);
          updateValues.push(data.formation_id);
          paramIndex++;
        }
        if (data.date_debut) {
          updateFields.push(`date_debut = $${paramIndex}`);
          updateValues.push(data.date_debut);
          paramIndex++;
        }
        if (data.date_fin) {
          updateFields.push(`date_fin = $${paramIndex}`);
          updateValues.push(data.date_fin);
          paramIndex++;
        }
        if (data.horaires) {
          updateFields.push(`horaires = $${paramIndex}`);
          updateValues.push(data.horaires);
          paramIndex++;
        }
        if (data.mode_formation) {
          updateFields.push(`mode_formation = CAST($${paramIndex} AS delivery_mode)`);
          updateValues.push(this.mapModeFormationToDb(data.mode_formation));
          paramIndex++;
        }
        if (data.lieu !== undefined) {
          updateFields.push(`lieu = $${paramIndex}`);
          updateValues.push(data.lieu || null);
          paramIndex++;
        }
        if (data.lien_visio !== undefined) {
          updateFields.push(`lien_visio = $${paramIndex}`);
          updateValues.push(data.lien_visio || null);
          paramIndex++;
        }
        if (data.places_totales !== undefined) {
          updateFields.push(`places_totales = $${paramIndex}`);
          updateValues.push(data.places_totales);
          paramIndex++;
          // Recalculate places_disponibles
          updateFields.push(`places_disponibles = places_totales - places_reservees`);
        }
        if (data.prix_ht !== undefined) {
          updateFields.push(`prix_ht = $${paramIndex}`);
          updateValues.push(data.prix_ht);
          paramIndex++;
        }
        if (data.prix_ttc !== undefined) {
          updateFields.push(`prix_ttc = $${paramIndex}`);
          updateValues.push(data.prix_ttc);
          paramIndex++;
        }
        if (data.statut) {
          updateFields.push(`statut = $${paramIndex}`);
          updateValues.push(data.statut);
          paramIndex++;
        }
        if (data.notes_internes !== undefined) {
          updateFields.push(`notes_internes = $${paramIndex}`);
          updateValues.push(data.notes_internes || null);
          paramIndex++;
        }

        // Update session if there are fields to update
        if (updateFields.length > 0) {
          updateFields.push(`updated_at = NOW()`);
          updateValues.push(tenantId, sessionId);

          const updateQuery = `
            UPDATE ${sessionsTable}
            SET ${updateFields.join(", ")}
            WHERE tenant_id = $${paramIndex} AND id = $${paramIndex + 1}
            RETURNING id
          `;

          await client.query(updateQuery, updateValues);
        }

        // T078: Update trainers if changed
        if (changes.trainers && data.formateur_ids) {
          await this.assignFormateurs(tenantId, sessionId, data.formateur_ids, "principal", client);
        }

        // T079: Notify enrolled participants if critical fields changed
        if (changes.dates || changes.location || changes.videoLink) {
          await this.notifyInscrits(tenantId, sessionId, changes);
        }

        // Commit transaction
        await client.query("COMMIT");

        // Fetch and return updated session
        const updatedSession = await this.getSessionById(tenantId, sessionId);
        if (!updatedSession) {
          throw new Error("Failed to retrieve updated session");
        }

        return updatedSession;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * T078: Update trainers for a session
   */
  async updateFormateurs(
    tenantId: string,
    sessionId: string,
    formateurIds: string[]
  ): Promise<void> {
    await this.assignFormateurs(tenantId, sessionId, formateurIds, "principal");
  }

  /**
   * T079, T109: Notify enrolled participants when critical fields change
   */
  async notifyInscrits(
    tenantId: string,
    sessionId: string,
    changes: {
      dates?: boolean;
      location?: boolean;
      videoLink?: boolean;
    }
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get session details
      const session = await this.getSessionById(tenantId, sessionId);
      if (!session) {
        return; // Session not found, skip notification
      }

      // Get tenant-specific table names
      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');

      // Get enrolled participants
      const enrollmentsQuery = `
        SELECT 
          i.id,
          u.email,
          u.last_name as nom,
          u.first_name as prenom
        FROM ${inscriptionsTable} i
        INNER JOIN users u ON u.id = i.apprenant_id
        WHERE i.session_id = $1 AND i.tenant_id = $2 AND i.statut = 'confirmee'
      `;
      const enrollmentsResult = await client.query(enrollmentsQuery, [sessionId, tenantId]);
      const participants = enrollmentsResult.rows;

      if (participants.length === 0) {
        return; // No participants to notify
      }

      // Build email content based on changes
      const changeMessages: string[] = [];
      if (changes.dates) {
        changeMessages.push(`Les dates de la session ont été modifiées. Nouvelle période: ${session.date_debut} au ${session.date_fin}`);
      }
      if (changes.location && session.lieu) {
        changeMessages.push(`Le lieu de la session a été modifié. Nouveau lieu: ${session.lieu}`);
      }
      if (changes.videoLink && session.lien_visio) {
        changeMessages.push(`Le lien de visioconférence a été mis à jour: ${session.lien_visio}`);
      }

      if (changeMessages.length === 0) {
        return; // No relevant changes to notify
      }

      const subject = `Modification de la session ${session.code_session}`;
      const body = `
Bonjour,

Nous vous informons que des modifications ont été apportées à la session "${session.formation.titre}" (${session.code_session}) à laquelle vous êtes inscrit(e).

${changeMessages.join('\n\n')}

Pour plus d'informations, veuillez consulter votre espace personnel ou nous contacter.

Cordialement,
L'équipe de formation
      `.trim();

      // TODO: Integrate with actual email service (e.g., SendGrid, AWS SES, etc.)
      // For now, log the notification
      console.log(`[notifyInscrits] Session ${sessionId} - Sending notifications to ${participants.length} participants`);
      console.log(`Subject: ${subject}`);
      console.log(`Body: ${body}`);
      
      // In production, this would call the notification service:
      // await notificationService.sendBulkEmail({
      //   recipients: participants.map(p => ({ email: p.email, name: `${p.prenom} ${p.nom}` })),
      //   subject,
      //   body,
      //   template: 'session-modification'
      // });
    } finally {
      client.release();
    }
  }

  /**
   * T110: Notify enrolled participants when session is cancelled
   */
  async notifySessionCancellation(tenantId: string, sessionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get session details
      const session = await this.getSessionById(tenantId, sessionId);
      if (!session) {
        return;
      }

      // Get tenant-specific table names
      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');

      // Get enrolled participants
      const enrollmentsQuery = `
        SELECT 
          i.id,
          u.email,
          u.last_name as nom,
          u.first_name as prenom,
          i.montant_ttc
        FROM ${inscriptionsTable} i
        INNER JOIN users u ON u.id = i.apprenant_id
        WHERE i.session_id = $1 AND i.tenant_id = $2 AND i.statut = 'confirmee'
      `;
      const enrollmentsResult = await client.query(enrollmentsQuery, [sessionId, tenantId]);
      const participants = enrollmentsResult.rows;

      if (participants.length === 0) {
        return;
      }

      const subject = `Annulation de la session ${session.code_session}`;
      const body = `
Bonjour,

Nous vous informons que la session "${session.formation.titre}" (${session.code_session}) à laquelle vous étiez inscrit(e) a été annulée.

Un remboursement sera initié dans les plus brefs délais si vous aviez effectué un paiement.

Pour toute question, veuillez nous contacter.

Cordialement,
L'équipe de formation
      `.trim();

      // TODO: Integrate with actual email service and payment/refund system
      console.log(`[notifySessionCancellation] Session ${sessionId} - Sending cancellation notifications to ${participants.length} participants`);
      console.log(`Subject: ${subject}`);
      
      // In production:
      // 1. Send email notifications
      // 2. Initiate refunds for paid enrollments
      // await notificationService.sendBulkEmail({...});
      // await refundService.initiateRefunds(enrollments);
    } finally {
      client.release();
    }
  }

  /**
   * T085: Update session status with transition validation and notification triggers
   */
  async updateSessionStatus(
    tenantId: string,
    sessionId: string,
    newStatus: "planifiee" | "ouverte" | "complete" | "en_cours" | "terminee" | "annulee"
  ): Promise<{
    id: string;
    statut: string;
    updated_at: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get current session
      const currentSession = await this.getSessionById(tenantId, sessionId);
      if (!currentSession) {
        throw new Error("SESSION_NOT_FOUND");
      }

      const currentStatus = currentSession.statut;

      // Validate status transition
      const validTransitions: Record<string, string[]> = {
        planifiee: ["ouverte", "annulee"],
        ouverte: ["complete", "en_cours", "annulee"],
        complete: ["en_cours", "annulee"],
        en_cours: ["terminee", "annulee"],
        terminee: [], // Terminal state
        annulee: [], // Terminal state
      };

      const allowedTransitions = validTransitions[currentStatus] || [];
      if (!allowedTransitions.includes(newStatus)) {
        throw new Error(`INVALID_STATUS_TRANSITION: Cannot transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedTransitions.join(", ")}`);
      }

      // Start transaction
      await client.query("BEGIN");

      try {
        // Get tenant-specific table names
        const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

        // Update status
        const updateQuery = `
          UPDATE ${sessionsTable}
          SET statut = $1, updated_at = NOW()
          WHERE tenant_id = $2 AND id = $3
          RETURNING id, statut, updated_at
        `;

        const result = await client.query(updateQuery, [newStatus, tenantId, sessionId]);

        if (result.rows.length === 0) {
          throw new Error("SESSION_NOT_FOUND");
        }

        const row = result.rows[0];

        // T085: If status changes to 'annulee', notify enrolled participants
        if (newStatus === "annulee" && currentStatus !== "annulee") {
          // T110: Notify participants and initiate refunds
          await this.notifySessionCancellation(tenantId, sessionId);
        }

        // Commit transaction
        await client.query("COMMIT");

        return {
          id: row.id,
          statut: row.statut,
          updated_at: row.updated_at.toISOString(),
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Get admin list of sessions with extended filters, search, and statistics
   * Includes all statuses (including cancelled) and notes_internes
   */
  async getAdminSessionsList(
    tenantId: string,
    query: AdminSessionListQuery
  ): Promise<{ 
    sessions: (SessionListItem & { notes_internes?: string | null })[];
    total: number;
    statistics: {
      sessions_actives: number;
      sessions_ce_mois: number;
      taux_remplissage: number;
      ca_previsionnel: number;
    };
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const page = query.page || 1;
      const limit = query.limit || 20;
      const offset = (page - 1) * limit;

      // Build WHERE conditions
      const whereConditions: string[] = ["s.tenant_id = $1"];
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      // Admin can see all statuses including cancelled
      // No exclusion of cancelled sessions

      // Search filter (code_session or formation title)
      if (query.search) {
        whereConditions.push(`(
          s.code_session ILIKE $${paramIndex} OR
          f.titre ILIKE $${paramIndex}
        )`);
        queryParams.push(`%${query.search}%`);
        paramIndex++;
      }

      // Formation filter
      if (query.formation_id) {
        whereConditions.push(`s.formation_pro_id = $${paramIndex}`);
        queryParams.push(query.formation_id);
        paramIndex++;
      }

      // Mode filter
      if (query.mode && query.mode.length > 0) {
        whereConditions.push(`s.mode_formation = ANY($${paramIndex}::delivery_mode[])`);
        queryParams.push(query.mode);
        paramIndex++;
      }

      // Date range filters
      if (query.date_debut) {
        whereConditions.push(`s.date_debut >= $${paramIndex}::date`);
        queryParams.push(query.date_debut);
        paramIndex++;
      }
      if (query.date_fin) {
        whereConditions.push(`s.date_fin <= $${paramIndex}::date`);
        queryParams.push(query.date_fin);
        paramIndex++;
      }

      // Status filter (admin can filter by any status)
      if (query.statut && query.statut.length > 0) {
        whereConditions.push(`s.statut = ANY($${paramIndex}::session_professional_status[])`);
        queryParams.push(query.statut);
        paramIndex++;
      }

      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const formateursTable = getTableName(tenantId, 'formateurs');
      const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

      // Trainer filter
      if (query.formateur_id) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM ${sessionFormateursTable} sf
          WHERE sf.session_id = s.id
          AND sf.formateur_id = $${paramIndex}
          AND sf.tenant_id = $1
        )`);
        queryParams.push(query.formateur_id);
        paramIndex++;
      }

      // Month filter (YYYY-MM format)
      if (query.mois) {
        const [year, month] = query.mois.split("-");
        whereConditions.push(`EXTRACT(YEAR FROM s.date_debut) = $${paramIndex}::integer`);
        queryParams.push(parseInt(year));
        paramIndex++;
        whereConditions.push(`EXTRACT(MONTH FROM s.date_debut) = $${paramIndex}::integer`);
        queryParams.push(parseInt(month));
        paramIndex++;
      }

      // Year filter
      if (query.annee) {
        whereConditions.push(`EXTRACT(YEAR FROM s.date_debut) = $${paramIndex}::integer`);
        queryParams.push(query.annee);
        paramIndex++;
      }

      // Build ORDER BY clause
      let orderBy = "s.date_debut ASC";
      if (query.sort) {
        switch (query.sort) {
          case "date_asc":
            orderBy = "s.date_debut ASC";
            break;
          case "date_desc":
            orderBy = "s.date_debut DESC";
            break;
          case "prix_asc":
            orderBy = "COALESCE(s.prix_ttc, s.prix_ht, 0) ASC";
            break;
          case "prix_desc":
            orderBy = "COALESCE(s.prix_ttc, s.prix_ht, 0) DESC";
            break;
        }
      }

      // Calculate statistics
      const statsQuery = `
        SELECT 
          COUNT(*) FILTER (WHERE s.statut IN ('planifiee', 'ouverte', 'complete', 'en_cours')) as sessions_actives,
          COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM s.date_debut) = EXTRACT(YEAR FROM CURRENT_DATE)
            AND EXTRACT(MONTH FROM s.date_debut) = EXTRACT(MONTH FROM CURRENT_DATE)) as sessions_ce_mois,
          COALESCE(AVG(
            CASE 
              WHEN s.places_totales > 0 
              THEN (s.places_reservees::numeric / s.places_totales::numeric) * 100
              ELSE 0
            END
          ), 0) as taux_remplissage,
          COALESCE(SUM(COALESCE(s.prix_ttc, s.prix_ht, 0) * s.places_reservees), 0) as ca_previsionnel
        FROM ${sessionsTable} s
        WHERE s.tenant_id = $1
      `;
      const statsResult = await client.query(statsQuery, [tenantId]);
      const stats = statsResult.rows[0];

      // Count total matching sessions
      const countQuery = `
        SELECT COUNT(*) as total
        FROM ${sessionsTable} s
        INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id
        WHERE ${whereConditions.join(" AND ")}
      `;
      console.log('🔍 [getAdminSessionsList] Count query:', {
        query: countQuery,
        params: queryParams,
        whereConditions: whereConditions,
      });
      const countResult = await client.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total);
      console.log('📊 [getAdminSessionsList] Total sessions found:', total);

      // Add limit and offset parameters
      const limitParamIndex = paramIndex;
      const offsetParamIndex = paramIndex + 1;
      queryParams.push(limit, offset);

      // Fetch sessions with related data (including notes_internes)
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
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          s.statut,
          s.prix_ht,
          s.prix_ttc,
          s.notes_internes,
          jsonb_build_object(
            'id', f.id,
            'titre', f.titre,
            'slug', f.slug
          ) as formation,
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'id', form.id,
                'nom', form.nom,
                'prenom', form.prenom
              )
            ) FILTER (WHERE form.id IS NOT NULL),
            '[]'::jsonb
          ) as formateurs
        FROM ${sessionsTable} s
        INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id
        LEFT JOIN ${sessionFormateursTable} sf ON sf.session_id = s.id AND sf.tenant_id = s.tenant_id
        LEFT JOIN ${formateursTable} form ON form.id = sf.formateur_id AND form.tenant_id = s.tenant_id
        WHERE ${whereConditions.join(" AND ")}
        GROUP BY s.id, f.id, f.titre, f.slug
        ORDER BY ${orderBy}
        LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
      `;

      console.log('🔍 [getAdminSessionsList] Sessions query:', {
        query: sessionsQuery,
        params: queryParams,
        limitParamIndex,
        offsetParamIndex,
      });

      const sessionsResult = await client.query(sessionsQuery, queryParams);

      console.log('🔍 [getAdminSessionsList] Query result:', {
        rowCount: sessionsResult.rows.length,
        total: total,
        firstRow: sessionsResult.rows[0] || null,
      });

      const sessions = sessionsResult.rows.map((row) => {
        // Parse JSONB objects if they are strings
        let formationObj: any = row.formation;
        if (typeof row.formation === 'string') {
          try {
            formationObj = JSON.parse(row.formation);
          } catch (e) {
            console.error('❌ [getAdminSessionsList] Failed to parse formation JSONB:', e);
            formationObj = { id: "", titre: "", slug: "" };
          }
        }
        // Ensure formationObj is an object
        if (!formationObj || typeof formationObj !== 'object') {
          console.warn('⚠️ [getAdminSessionsList] Invalid formation object:', formationObj);
          formationObj = { id: "", titre: "", slug: "" };
        }

        let formateursArray: any[] = [];
        if (row.formateurs) {
          if (typeof row.formateurs === 'string') {
            try {
              const parsed = JSON.parse(row.formateurs);
              formateursArray = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
              console.error('❌ [getAdminSessionsList] Failed to parse formateurs JSONB:', e);
              formateursArray = [];
            }
          } else if (Array.isArray(row.formateurs)) {
            formateursArray = row.formateurs;
          }
        }
        // Ensure formateursArray is always an array
        if (!Array.isArray(formateursArray)) {
          console.warn('⚠️ [getAdminSessionsList] formateursArray is not an array:', formateursArray);
          formateursArray = [];
        }

        const session: SessionListItem & { notes_internes?: string | null } = {
          id: String(row.id),
          code_session: row.code_session ? String(row.code_session) : "",
          formation: {
            id: String(formationObj?.id || ""),
            titre: String(formationObj?.titre || ""),
            slug: String(formationObj?.slug || ""),
          },
          date_debut: row.date_debut ? new Date(row.date_debut).toISOString().split("T")[0] : "",
          date_fin: row.date_fin ? new Date(row.date_fin).toISOString().split("T")[0] : "",
          horaires: row.horaires ? String(row.horaires) : null,
          mode_formation: (() => {
            const mode = row.mode_formation ? String(row.mode_formation) : "presentiel";
            // Convert "presential" to "presentiel" for compatibility
            if (mode === "presential") return "presentiel";
            return mode as "presentiel" | "distanciel" | "hybride";
          })(),
          lieu: row.lieu ? String(row.lieu) : null,
          lien_visio: row.lien_visio ? String(row.lien_visio) : null,
          places_totales: Number(row.places_totales) || 0,
          places_reservees: Number(row.places_reservees) || 0,
          places_disponibles: Number(row.places_disponibles) || 0,
          statut: (row.statut ? String(row.statut) : "planifiee") as "planifiee" | "ouverte" | "complete" | "en_cours" | "terminee" | "annulee",
          prix_ht: row.prix_ht ? parseFloat(String(row.prix_ht)) : null,
          prix_ttc: row.prix_ttc ? parseFloat(String(row.prix_ttc)) : null,
          formateurs: formateursArray.map((f: any) => ({
            id: String(f.id || ""),
            nom: String(f.nom || ""),
            prenom: String(f.prenom || ""),
          })),
          notes_internes: row.notes_internes ? String(row.notes_internes) : null,
        };
        return session;
      });

      // Force plain objects for JSON serialization (same as getSessionsList)
      // This ensures all properties are enumerable and serializable
      const serializedSessions = sessions.map(session => ({
        id: session.id,
        code_session: session.code_session,
        formation: session.formation,
        date_debut: session.date_debut,
        date_fin: session.date_fin,
        horaires: session.horaires,
        mode_formation: session.mode_formation,
        lieu: session.lieu,
        lien_visio: session.lien_visio,
        places_totales: session.places_totales,
        places_reservees: session.places_reservees,
        places_disponibles: session.places_disponibles,
        statut: session.statut,
        prix_ht: session.prix_ht,
        prix_ttc: session.prix_ttc,
        formateurs: session.formateurs,
        notes_internes: session.notes_internes,
      }));

      // Debug: Log first session structure
      if (serializedSessions.length > 0) {
        console.log('🔍 [getAdminSessionsList] First serialized session structure:', {
          id: serializedSessions[0].id,
          code_session: serializedSessions[0].code_session,
          formation: serializedSessions[0].formation,
          formationType: typeof serializedSessions[0].formation,
          formationKeys: serializedSessions[0].formation ? Object.keys(serializedSessions[0].formation) : [],
          formationTitre: serializedSessions[0].formation?.titre,
          formateurs: serializedSessions[0].formateurs,
          formateursType: typeof serializedSessions[0].formateurs,
          formateursIsArray: Array.isArray(serializedSessions[0].formateurs),
          allKeys: Object.keys(serializedSessions[0]),
        });
      }

      return {
        sessions: serializedSessions,
        total,
        statistics: {
          sessions_actives: parseInt(stats.sessions_actives) || 0,
          sessions_ce_mois: parseInt(stats.sessions_ce_mois) || 0,
          taux_remplissage: parseFloat(stats.taux_remplissage) || 0,
          ca_previsionnel: parseFloat(stats.ca_previsionnel) || 0,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Export sessions to Excel file
   */
  async exportSessionsToExcel(
    tenantId: string,
    query: AdminSessionListQuery,
    sessionIds?: string[]
  ): Promise<Buffer> {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sessions");

    // Set column headers with formatting
    worksheet.columns = [
      { header: "Code Session", key: "code_session", width: 15 },
      { header: "Formation", key: "formation", width: 30 },
      { header: "Date Début", key: "date_debut", width: 12 },
      { header: "Date Fin", key: "date_fin", width: 12 },
      { header: "Horaires", key: "horaires", width: 12 },
      { header: "Mode", key: "mode_formation", width: 12 },
      { header: "Lieu", key: "lieu", width: 25 },
      { header: "Formateurs", key: "formateurs", width: 30 },
      { header: "Places Totales", key: "places_totales", width: 12 },
      { header: "Places Réservées", key: "places_reservees", width: 15 },
      { header: "Places Disponibles", key: "places_disponibles", width: 18 },
      { header: "Prix HT", key: "prix_ht", width: 12 },
      { header: "Prix TTC", key: "prix_ttc", width: 12 },
      { header: "Statut", key: "statut", width: 12 },
      { header: "Notes Internes", key: "notes_internes", width: 40 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };
    worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

      // Fetch sessions (either filtered by IDs or by query)
      const client = await this.pool.connect();
      try {
        await this.setTenantContext(client, tenantId);

        // Get tenant-specific table names
        const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
        const formationsTable = getTableName(tenantId, 'formations_professionnelles');
        const formateursTable = getTableName(tenantId, 'formateurs');
        const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

        let sessionsQuery: string;
        let queryParams: any[] = [tenantId];
        let paramIndex = 2;

        if (sessionIds && sessionIds.length > 0) {
          // Export specific sessions
          sessionsQuery = `
          SELECT 
            s.id,
            s.code_session,
            s.date_debut,
            s.date_fin,
            s.horaires,
            s.mode_formation,
            s.lieu,
            s.lien_visio,
            s.places_totales,
            s.places_reservees,
            s.places_disponibles,
            s.statut,
            s.prix_ht,
            s.prix_ttc,
            s.notes_internes,
            f.titre as formation_titre,
            COALESCE(
              jsonb_agg(
                DISTINCT jsonb_build_object(
                  'nom', form.nom,
                  'prenom', form.prenom
                )
              ) FILTER (WHERE form.id IS NOT NULL),
              '[]'::jsonb
            ) as formateurs
          FROM ${sessionsTable} s
          INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id
          LEFT JOIN ${sessionFormateursTable} sf ON sf.session_id = s.id AND sf.tenant_id = s.tenant_id
          LEFT JOIN ${formateursTable} form ON form.id = sf.formateur_id AND form.tenant_id = s.tenant_id
          WHERE s.tenant_id = $1 AND s.id = ANY($${paramIndex}::uuid[])
          GROUP BY s.id, f.titre
          ORDER BY s.date_debut ASC
        `;
        queryParams.push(sessionIds);
      } else {
        // Apply query filters (similar to getAdminSessionsList)
        const whereConditions: string[] = ["s.tenant_id = $1"];
        
        if (query.search) {
          whereConditions.push(`(
            s.code_session ILIKE $${paramIndex} OR
            f.titre ILIKE $${paramIndex}
          )`);
          queryParams.push(`%${query.search}%`);
          paramIndex++;
        }

        if (query.formation_id) {
          whereConditions.push(`s.formation_pro_id = $${paramIndex}`);
          queryParams.push(query.formation_id);
          paramIndex++;
        }

        if (query.mode && query.mode.length > 0) {
          whereConditions.push(`s.mode_formation = ANY($${paramIndex}::delivery_mode[])`);
          queryParams.push(query.mode);
          paramIndex++;
        }

        if (query.date_debut) {
          whereConditions.push(`s.date_debut >= $${paramIndex}::date`);
          queryParams.push(query.date_debut);
          paramIndex++;
        }
        if (query.date_fin) {
          whereConditions.push(`s.date_fin <= $${paramIndex}::date`);
          queryParams.push(query.date_fin);
          paramIndex++;
        }

        if (query.statut && query.statut.length > 0) {
          whereConditions.push(`s.statut = ANY($${paramIndex}::session_professional_status[])`);
          queryParams.push(query.statut);
          paramIndex++;
        }

        // Build ORDER BY
        let orderBy = "s.date_debut ASC";
        if (query.sort) {
          switch (query.sort) {
            case "date_asc":
              orderBy = "s.date_debut ASC";
              break;
            case "date_desc":
              orderBy = "s.date_debut DESC";
              break;
            case "prix_asc":
              orderBy = "COALESCE(s.prix_ttc, s.prix_ht, 0) ASC";
              break;
            case "prix_desc":
              orderBy = "COALESCE(s.prix_ttc, s.prix_ht, 0) DESC";
              break;
          }
        }

        sessionsQuery = `
          SELECT 
            s.id,
            s.code_session,
            s.date_debut,
            s.date_fin,
            s.horaires,
            s.mode_formation,
            s.lieu,
            s.lien_visio,
            s.places_totales,
            s.places_reservees,
            s.places_disponibles,
            s.statut,
            s.prix_ht,
            s.prix_ttc,
            s.notes_internes,
            f.titre as formation_titre,
            COALESCE(
              jsonb_agg(
                DISTINCT jsonb_build_object(
                  'nom', form.nom,
                  'prenom', form.prenom
                )
              ) FILTER (WHERE form.id IS NOT NULL),
              '[]'::jsonb
            ) as formateurs
          FROM ${sessionsTable} s
          INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id
          LEFT JOIN ${sessionFormateursTable} sf ON sf.session_id = s.id AND sf.tenant_id = s.tenant_id
          LEFT JOIN ${formateursTable} form ON form.id = sf.formateur_id AND form.tenant_id = s.tenant_id
          WHERE ${whereConditions.join(" AND ")}
          GROUP BY s.id, f.titre
          ORDER BY ${orderBy}
        `;
      }

      const sessionsResult = await client.query(sessionsQuery, queryParams);

      // Add data rows
      sessionsResult.rows.forEach((row) => {
        const formateurs = Array.isArray(row.formateurs)
          ? row.formateurs.map((f: any) => `${f.prenom} ${f.nom}`).join(", ")
          : "";

        worksheet.addRow({
          code_session: row.code_session || "",
          formation: row.formation_titre || "",
          date_debut: row.date_debut ? new Date(row.date_debut).toLocaleDateString("fr-FR") : "",
          date_fin: row.date_fin ? new Date(row.date_fin).toLocaleDateString("fr-FR") : "",
          horaires: row.horaires || "",
          mode_formation: row.mode_formation || "",
          lieu: row.lieu || "",
          formateurs: formateurs,
          places_totales: row.places_totales || 0,
          places_reservees: row.places_reservees || 0,
          places_disponibles: row.places_disponibles || 0,
          prix_ht: row.prix_ht ? parseFloat(String(row.prix_ht)).toFixed(2) : "",
          prix_ttc: row.prix_ttc ? parseFloat(String(row.prix_ttc)).toFixed(2) : "",
          statut: row.statut || "",
          notes_internes: row.notes_internes || "",
        });
      });

      // Auto-fit columns
      worksheet.columns.forEach((column) => {
        if (column.width) {
          column.width = Math.min(column.width || 10, 50);
        }
      });

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } finally {
      client.release();
    }
  }

  /**
   * T089: Get session enrollments with filtering
   */
  async getSessionEnrollments(
    tenantId: string,
    sessionId: string,
    query: EnrollmentListQuery = {}
  ): Promise<{
    inscrits: EnrollmentDetail[];
    total: number;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);
      
      console.log('[getSessionEnrollments] Starting:', {
        tenantId,
        sessionId,
        query,
      });

      // Get tenant-specific table names
      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');
      const paiementsTable = getTableName(tenantId, 'paiements_professionnels');
      const entreprisesTable = getTableName(tenantId, 'entreprises_clientes');

      // Build WHERE conditions
      const whereConditions: string[] = [
        "i.tenant_id = $1",
        "i.session_id = $2"
      ];
      const queryParams: any[] = [tenantId, sessionId];
      let paramIndex = 3;

      // Enrollment status filter
      if (query.statut && query.statut.length > 0) {
        whereConditions.push(`i.statut = ANY($${paramIndex}::enrollment_professional_status[])`);
        queryParams.push(query.statut);
        paramIndex++;
      }

      // Payment status filter (based on latest payment)
      if (query.paiement && query.paiement.length > 0) {
        // We'll filter by payment status in a subquery
        whereConditions.push(`EXISTS (
          SELECT 1 FROM ${paiementsTable} p
          WHERE p.inscription_id = i.id
          AND p.tenant_id = $1
          AND p.statut = ANY($${paramIndex}::payment_professional_status[])
          ORDER BY p.created_at DESC
          LIMIT 1
        )`);
        queryParams.push(query.paiement);
        paramIndex++;
      }

      // Search filter (participant name or email)
      if (query.search) {
        whereConditions.push(`(
          u.last_name ILIKE $${paramIndex} OR
          u.first_name ILIKE $${paramIndex} OR
          u.email ILIKE $${paramIndex} OR
          CONCAT(u.first_name, ' ', u.last_name) ILIKE $${paramIndex}
        )`);
        queryParams.push(`%${query.search}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.join(" AND ");

      // Get total count
      const countQuery = `
        SELECT COUNT(*)::integer as total
        FROM ${inscriptionsTable} i
        INNER JOIN users u ON u.id = i.apprenant_id
        WHERE ${whereClause}
      `;
      const countResult = await client.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total) || 0;

      // Get enrollments with related data
      const enrollmentsQuery = `
        SELECT 
          i.id,
          i.type_inscription,
          i.statut,
          i.date_inscription,
          i.montant_ht,
          i.montant_ttc,
          -- Apprenant data
          u.id as apprenant_id,
          u.last_name as apprenant_nom,
          u.first_name as apprenant_prenom,
          u.email as apprenant_email,
          -- Entreprise data (if exists)
          e.id as entreprise_id,
          e.raison_sociale as entreprise_nom,
          -- Payment status (from latest payment)
          COALESCE(
            (SELECT p.statut 
             FROM ${paiementsTable} p 
             WHERE p.inscription_id = i.id 
             AND p.tenant_id = $1
             ORDER BY p.created_at DESC 
             LIMIT 1),
            'en_attente'
          ) as statut_paiement
        FROM ${inscriptionsTable} i
        INNER JOIN users u ON u.id = i.apprenant_id
        LEFT JOIN ${entreprisesTable} e ON e.id = i.entreprise_id AND e.tenant_id = $1
        WHERE ${whereClause}
        ORDER BY i.date_inscription DESC
      `;

      console.log('[getSessionEnrollments] Executing query:', {
        query: enrollmentsQuery.substring(0, 200),
        paramsCount: queryParams.length,
      });

      const enrollmentsResult = await client.query(enrollmentsQuery, queryParams);

      console.log('[getSessionEnrollments] Query result:', {
        rowsCount: enrollmentsResult.rows.length,
        total,
      });

      const inscrits: EnrollmentDetail[] = enrollmentsResult.rows.map((row) => ({
        id: row.id,
        apprenant: {
          id: row.apprenant_id,
          nom: row.apprenant_nom,
          prenom: row.apprenant_prenom,
          email: row.apprenant_email,
          telephone: null, // Column doesn't exist in users table
        },
        entreprise: row.entreprise_id
          ? {
              id: row.entreprise_id,
              nom: row.entreprise_nom,
            }
          : null,
        type_inscription: row.type_inscription as "individuelle" | "entreprise",
        statut: row.statut as "confirmee" | "en_attente" | "annulee",
        statut_paiement: row.statut_paiement as "valide" | "en_attente" | "echec",
        date_inscription: row.date_inscription.toISOString(),
      }));

      return {
        inscrits,
        total,
      };
    } catch (error: any) {
      console.error('[getSessionEnrollments] Error:', {
        message: error.message,
        name: error.name,
        code: error.code,
        detail: error.detail,
        hint: error.hint,
        stack: error.stack,
        tenantId,
        sessionId,
        query,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * T098: Export enrollments to Excel
   */
  async exportEnrollmentsToExcel(
    tenantId: string,
    sessionId: string,
    query: EnrollmentListQuery = {}
  ): Promise<Buffer> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get enrollments
      const enrollmentsData = await this.getSessionEnrollments(tenantId, sessionId, query);
      const enrollments = enrollmentsData.inscrits;

      // Get session info for filename
      const session = await this.getSessionById(tenantId, sessionId);
      if (!session) {
        throw new Error("SESSION_NOT_FOUND");
      }

      const ExcelJS = require("exceljs");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Inscriptions");

      // Define columns
      worksheet.columns = [
        { header: "Numéro", key: "numero", width: 15 },
        { header: "Nom", key: "nom", width: 20 },
        { header: "Prénom", key: "prenom", width: 20 },
        { header: "Email", key: "email", width: 30 },
        { header: "Téléphone", key: "telephone", width: 15 },
        { header: "Type", key: "type", width: 15 },
        { header: "Entreprise", key: "entreprise", width: 30 },
        { header: "Statut", key: "statut", width: 15 },
        { header: "Paiement", key: "paiement", width: 15 },
        { header: "Date inscription", key: "date", width: 20 },
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };

      // Add data rows
      enrollments.forEach((enrollment, index) => {
        worksheet.addRow({
          numero: `INS-${index + 1}`,
          nom: enrollment.apprenant.nom,
          prenom: enrollment.apprenant.prenom,
          email: enrollment.apprenant.email,
          telephone: enrollment.apprenant.telephone || "",
          type: enrollment.type_inscription === "individuelle" ? "Individuelle" : "Entreprise",
          entreprise: enrollment.entreprise?.nom || "",
          statut: enrollment.statut === "confirmee" ? "Confirmée" : enrollment.statut === "en_attente" ? "En attente" : "Annulée",
          paiement: enrollment.statut_paiement === "valide" ? "Payé" : enrollment.statut_paiement === "en_attente" ? "En attente" : "Échec",
          date: new Date(enrollment.date_inscription).toLocaleDateString("fr-FR"),
        });
      });

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } finally {
      client.release();
    }
  }

  /**
   * T100: Get session statistics
   */
  async getSessionStats(
    tenantId: string,
    sessionId: string
  ): Promise<{
    total_inscriptions: number;
    inscriptions_confirmees: number;
    taux_remplissage: number;
    revenus_totaux: number;
    inscriptions_timeline: Array<{ date: string; count: number }>;
    type_distribution: Array<{ type: string; count: number }>;
    payment_status: Array<{ status: string; count: number }>;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify session exists
      const session = await this.getSessionById(tenantId, sessionId);
      if (!session) {
        throw new Error("SESSION_NOT_FOUND");
      }

      // Get tenant-specific table names
      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');
      const paiementsTable = getTableName(tenantId, 'paiements_professionnels');

      // Get enrollment statistics
      const statsQuery = `
        SELECT 
          COUNT(*)::integer as total_inscriptions,
          COUNT(*) FILTER (WHERE i.statut = 'confirmee')::integer as inscriptions_confirmees,
          COALESCE(SUM(i.montant_ttc), 0) as revenus_totaux
        FROM ${inscriptionsTable} i
        WHERE i.tenant_id = $1 AND i.session_id = $2
      `;
      const statsResult = await client.query(statsQuery, [tenantId, sessionId]);
      const stats = statsResult.rows[0];

      // Calculate fill rate
      const taux_remplissage = session.places_totales > 0
        ? (session.places_reservees / session.places_totales) * 100
        : 0;

      // Get timeline (enrollments per day)
      const timelineQuery = `
        SELECT 
          DATE(i.date_inscription) as date,
          COUNT(*)::integer as count
        FROM ${inscriptionsTable} i
        WHERE i.tenant_id = $1 AND i.session_id = $2
        GROUP BY DATE(i.date_inscription)
        ORDER BY date ASC
      `;
      const timelineResult = await client.query(timelineQuery, [tenantId, sessionId]);
      const inscriptions_timeline = timelineResult.rows.map((row) => ({
        date: row.date.toISOString().split("T")[0],
        count: parseInt(row.count),
      }));

      // Get type distribution
      const typeQuery = `
        SELECT 
          i.type_inscription as type,
          COUNT(*)::integer as count
        FROM ${inscriptionsTable} i
        WHERE i.tenant_id = $1 AND i.session_id = $2
        GROUP BY i.type_inscription
      `;
      const typeResult = await client.query(typeQuery, [tenantId, sessionId]);
      const type_distribution = typeResult.rows.map((row) => ({
        type: row.type,
        count: parseInt(row.count),
      }));

      // Get payment status distribution
      const paymentQuery = `
        SELECT 
          COALESCE(
            (SELECT p.statut 
             FROM ${paiementsTable} p 
             WHERE p.inscription_id = i.id 
             AND p.tenant_id = $1
             ORDER BY p.created_at DESC 
             LIMIT 1),
            'en_attente'
          ) as status,
          COUNT(*)::integer as count
        FROM ${inscriptionsTable} i
        WHERE i.tenant_id = $1 AND i.session_id = $2
        GROUP BY status
      `;
      const paymentResult = await client.query(paymentQuery, [tenantId, sessionId]);
      const payment_status = paymentResult.rows.map((row) => ({
        status: row.status,
        count: parseInt(row.count),
      }));

      return {
        total_inscriptions: parseInt(stats.total_inscriptions) || 0,
        inscriptions_confirmees: parseInt(stats.inscriptions_confirmees) || 0,
        taux_remplissage: parseFloat(taux_remplissage.toFixed(2)),
        revenus_totaux: parseFloat(stats.revenus_totaux) || 0,
        inscriptions_timeline,
        type_distribution,
        payment_status,
      };
    } finally {
      client.release();
    }
  }

  /**
   * T104: Duplicate a session with new dates
   */
  async duplicateSession(
    tenantId: string,
    sourceSessionId: string,
    newDateDebut: string,
    newDateFin: string
  ): Promise<SessionDetail> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get source session
      const sourceSession = await this.getSessionById(tenantId, sourceSessionId);
      if (!sourceSession) {
        throw new Error("SESSION_NOT_FOUND");
      }

      // Validate dates
      const dateDebut = new Date(newDateDebut);
      const dateFin = new Date(newDateFin);
      if (dateFin <= dateDebut) {
        throw new Error("INVALID_DATE_RANGE");
      }

      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

      // Get trainers from source session
      const formateursQuery = `
        SELECT formateur_id, role
        FROM ${sessionFormateursTable}
        WHERE session_id = $1 AND tenant_id = $2
      `;
      const formateursResult = await client.query(formateursQuery, [sourceSessionId, tenantId]);
      const formateurIds = formateursResult.rows.map((row) => row.formateur_id);

      // Check trainer availability for new dates
      if (this.availabilityService && formateurIds.length > 0) {
        const availability = await this.availabilityService.checkFormateursDisponibilite(
          tenantId,
          formateurIds,
          newDateDebut,
          newDateFin
        );

        const unavailable = availability.filter((a) => !a.disponible);
        if (unavailable.length > 0) {
          throw new Error("TRAINERS_NOT_AVAILABLE");
        }
      }

      // Generate new session code
      const year = dateDebut.getFullYear();
      const newCodeSession = await this.generateCodeSession(
        tenantId,
        sourceSession.formation.id,
        year
      );

      // Start transaction
      await client.query("BEGIN");

      try {
        // Insert new session (copy all fields except dates, code_session, and status)
        const insertQuery = `
          INSERT INTO ${sessionsTable} (
            tenant_id,
            code_session,
            formation_pro_id,
            date_debut,
            date_fin,
            horaires,
            mode_formation,
            lieu,
            lien_visio,
            places_totales,
            places_reservees,
            places_disponibles,
            prix_ht,
            prix_ttc,
            statut,
            publie,
            notes_internes,
            created_at,
            updated_at
          )
          SELECT 
            tenant_id,
            $1 as code_session,
            formation_pro_id,
            $2::date as date_debut,
            $3::date as date_fin,
            horaires,
            mode_formation,
            lieu,
            lien_visio,
            places_totales,
            0 as places_reservees,
            places_totales as places_disponibles,
            prix_ht,
            prix_ttc,
            'planifiee' as statut,
            false as publie,
            notes_internes,
            NOW() as created_at,
            NOW() as updated_at
          FROM ${sessionsTable}
          WHERE id = $4 AND tenant_id = $5
          RETURNING id
        `;
        const insertResult = await client.query(insertQuery, [
          newCodeSession,
          newDateDebut,
          newDateFin,
          sourceSessionId,
          tenantId,
        ]);

        if (insertResult.rows.length === 0) {
          throw new Error("DUPLICATION_FAILED");
        }

        const newSessionId = insertResult.rows[0].id;

        // Copy trainers
        if (formateursResult.rows.length > 0) {
          const insertFormateursQuery = `
            INSERT INTO ${sessionFormateursTable} (tenant_id, session_id, formateur_id, role)
            VALUES ($1, $2, $3, $4)
          `;
          for (const row of formateursResult.rows) {
            await client.query(insertFormateursQuery, [
              tenantId,
              newSessionId,
              row.formateur_id,
              row.role,
            ]);
          }
        }

        await client.query("COMMIT");

        // Return new session detail
        const newSession = await this.getSessionById(tenantId, newSessionId);
        if (!newSession) {
          throw new Error("SESSION_NOT_FOUND");
        }

        return newSession;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * T115: Delete session with soft delete (set status to 'annulee')
   */
  async deleteSession(tenantId: string, sessionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Check if session exists
      const session = await this.getSessionById(tenantId, sessionId);
      if (!session) {
        throw new Error("SESSION_NOT_FOUND");
      }

      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');
      const sessionFormateursTable = getTableName(tenantId, 'session_formateurs');

      // Check if session has enrollments
      const enrollmentsQuery = `
        SELECT COUNT(*)::integer as count
        FROM ${inscriptionsTable}
        WHERE session_id = $1 AND tenant_id = $2
      `;
      const enrollmentsResult = await client.query(enrollmentsQuery, [sessionId, tenantId]);
      const enrollmentCount = parseInt(enrollmentsResult.rows[0].count) || 0;

      if (enrollmentCount > 0) {
        // Soft delete: set status to 'annulee' instead of hard delete
        const updateQuery = `
          UPDATE ${sessionsTable}
          SET statut = 'annulee',
              updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
        `;
        await client.query(updateQuery, [sessionId, tenantId]);
      } else {
        // Hard delete if no enrollments
        // First delete related records
        await client.query(
          `DELETE FROM ${sessionFormateursTable} WHERE session_id = $1 AND tenant_id = $2`,
          [sessionId, tenantId]
        );
        
        // Then delete the session
        await client.query(
          `DELETE FROM ${sessionsTable} WHERE id = $1 AND tenant_id = $2`,
          [sessionId, tenantId]
        );
      }
    } finally {
      client.release();
    }
  }

  /**
   * T107: Update session capacity automatically
   * Updates places_reservees and statut (complete/ouverte) based on enrollments
   */
  async updateSessionCapacity(tenantId: string, sessionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get current session
      const session = await this.getSessionById(tenantId, sessionId);
      if (!session) {
        throw new Error("SESSION_NOT_FOUND");
      }

      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');

      // Count confirmed enrollments
      const enrollmentsQuery = `
        SELECT COUNT(*)::integer as count
        FROM ${inscriptionsTable}
        WHERE session_id = $1 AND tenant_id = $2 AND statut = 'confirmee'
      `;
      const enrollmentsResult = await client.query(enrollmentsQuery, [sessionId, tenantId]);
      const placesReservees = parseInt(enrollmentsResult.rows[0].count) || 0;

      // Calculate places available
      const placesDisponibles = Math.max(0, session.places_totales - placesReservees);

      // Determine new status
      let newStatut = session.statut;
      if (placesDisponibles === 0 && session.places_totales > 0) {
        // Session is full
        if (session.statut === "ouverte") {
          newStatut = "complete";
        }
      } else if (placesDisponibles > 0 && session.statut === "complete") {
        // Session has available places again
        newStatut = "ouverte";
      }

      // Update session
      const updateQuery = `
        UPDATE ${sessionsTable}
        SET places_reservees = $1,
            places_disponibles = $2,
            statut = $3,
            updated_at = NOW()
        WHERE id = $4 AND tenant_id = $5
      `;
      await client.query(updateQuery, [
        placesReservees,
        placesDisponibles,
        newStatut,
        sessionId,
        tenantId,
      ]);
    } finally {
      client.release();
    }
  }
}

