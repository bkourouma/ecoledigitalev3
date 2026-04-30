import { Pool } from "pg";
import {
  FormationListQuery,
  FormationListItem,
  FormationDetail,
  SessionListItem,
  ThemeItem,
  FormationStats,
  SimilarFormationsResponse,
} from "@ecoledigitale/contracts";
import { getTableName, usesSessionBasedProfessionalTraining } from "../utils/table-names";

function mapListCatalogueSupportRow(
  tenantId: string,
  row: {
    cat_sup_id?: string | null;
    cat_sup_titre?: string | null;
    cat_sup_type?: string | null;
    cat_sup_vp?: string | null;
  }
): FormationListItem["catalogue_support"] {
  if (usesSessionBasedProfessionalTraining(tenantId)) {
    return undefined;
  }
  if (!row.cat_sup_id) {
    return null;
  }
  const vp = row.cat_sup_vp;
  return {
    titre: row.cat_sup_titre ?? "",
    type_fichier: row.cat_sup_type ?? "",
    video_provider: vp === "vimeo" || vp === "local" ? vp : null,
  };
}

export class FormationProService {
  constructor(private pool: Pool) {}

  /**
   * Search and filter professional training programs
   */
  async searchFormations(
    tenantId: string,
    query: FormationListQuery
  ): Promise<{ formations: FormationListItem[]; total: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      const page = query.page || 1;
      const limit = query.limit || 20;
      const offset = (page - 1) * limit;

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      
      // Debug: Check what tenant_ids exist in the database
      const debugResult = await client.query(
        `SELECT DISTINCT tenant_id, COUNT(*) as count FROM ${formationsTable} WHERE actif = true GROUP BY tenant_id`
      );
      console.log(`[FormationProService] Searching with tenantId: ${tenantId}, table: ${formationsTable}`);
      console.log(`[FormationProService] Available tenant_ids in ${formationsTable}:`, debugResult.rows);
      
      // Also check the other table to see if there's data there
      const otherTable = tenantId === '52da6ca7-81ad-47ad-b5c3-6f437f64ba37' 
        ? 'formations_professionnelles' 
        : 'formations_professionnelles_aspci';
      try {
        const otherTableResult = await client.query(
          `SELECT DISTINCT tenant_id, COUNT(*) as count FROM ${otherTable} WHERE actif = true GROUP BY tenant_id`
        );
        console.log(`[FormationProService] Available tenant_ids in ${otherTable}:`, otherTableResult.rows);
      } catch (e) {
        console.log(`[FormationProService] Could not check ${otherTable}:`, e instanceof Error ? e.message : String(e));
      }

      // Build WHERE conditions
      const whereConditions: string[] = ["f.tenant_id = $1", "f.actif = true"];
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      // Full-text search
      if (query.search && query.search.trim()) {
        whereConditions.push(
          `to_tsvector('french', COALESCE(f.titre, '') || ' ' || COALESCE(f.description_courte, '')) @@ plainto_tsquery('french', $${paramIndex})`
        );
        queryParams.push(query.search.trim());
        paramIndex++;
      }

      // Theme filter
      if (query.themes && query.themes.length > 0) {
        whereConditions.push(`f.themes ?| array[${query.themes.map((_, i) => `$${paramIndex + i}`).join(", ")}]`);
        queryParams.push(...query.themes);
        paramIndex += query.themes.length;
      }

      // Duration filters
      if (query.duree_min !== undefined) {
        whereConditions.push(`(f.duree_jours >= $${paramIndex} OR f.duree_heures >= $${paramIndex})`);
        queryParams.push(query.duree_min);
        paramIndex++;
      }
      if (query.duree_max !== undefined) {
        whereConditions.push(`(f.duree_jours <= $${paramIndex} OR f.duree_heures <= $${paramIndex})`);
        queryParams.push(query.duree_max);
        paramIndex++;
      }

      // Price filters
      if (query.prix_min !== undefined) {
        whereConditions.push(`f.prix_ttc >= $${paramIndex}`);
        queryParams.push(query.prix_min);
        paramIndex++;
      }
      if (query.prix_max !== undefined) {
        whereConditions.push(`f.prix_ttc <= $${paramIndex}`);
        queryParams.push(query.prix_max);
        paramIndex++;
      }

      // Level filter
      if (query.niveau) {
        whereConditions.push(`f.niveau = $${paramIndex}`);
        queryParams.push(query.niveau);
        paramIndex++;
      }

      // Certification filter
      if (query.certification !== undefined) {
        if (query.certification) {
          whereConditions.push(`f.type_certification IS NOT NULL`);
        } else {
          whereConditions.push(`f.type_certification IS NULL`);
        }
      }

      // Mode filter (via sessions) — uniquement ASPCI / tenant avec sessions
      if (
        usesSessionBasedProfessionalTraining(tenantId) &&
        query.mode &&
        query.mode.length > 0
      ) {
        const modePlaceholders = query.mode.map((_, i) => `$${paramIndex + i}`).join(", ");
        whereConditions.push(
          `EXISTS (
            SELECT 1 FROM ${sessionsTable} sp
            WHERE sp.formation_pro_id = f.id
              AND sp.tenant_id = $1
              AND sp.statut IN ('planifiee', 'ouverte')
              AND sp.date_debut >= (CURRENT_DATE - INTERVAL '365 days')
              AND sp.mode_formation::text = ANY(ARRAY[${modePlaceholders}])
          )`
        );
        queryParams.push(...query.mode);
        paramIndex += query.mode.length;
      }

      // Count total
      const countSql = `
        SELECT COUNT(DISTINCT f.id) as total
        FROM ${formationsTable} f
        WHERE ${whereConditions.join(" AND ")}
      `;
      const countResult = await client.query(countSql, queryParams);
      const total = parseInt(countResult.rows[0].total);

      // Build ORDER BY clause
      // Par défaut, trier par date de création décroissante (les plus récentes en premier)
      let orderBy = "f.created_at DESC, f.titre ASC";
      if (query.sort) {
        switch (query.sort) {
          case "prix_asc":
            orderBy = "f.prix_ttc ASC, f.created_at DESC, f.titre ASC";
            break;
          case "prix_desc":
            orderBy = "f.prix_ttc DESC, f.created_at DESC, f.titre ASC";
            break;
          case "titre_asc":
            orderBy = "f.titre ASC, f.created_at DESC";
            break;
          case "date_asc":
            orderBy = "prochaine_session_date ASC NULLS LAST, f.created_at DESC, f.titre ASC";
            break;
          case "pertinence":
            if (query.search) {
              orderBy = `ts_rank_cd(
                to_tsvector('french', COALESCE(f.titre, '') || ' ' || COALESCE(f.description_courte, '')),
                plainto_tsquery('french', $${queryParams.indexOf(query.search.trim()) + 1})
              ) DESC, f.created_at DESC, f.titre ASC`;
            } else {
              // Même sans recherche, trier par date de création décroissante
              orderBy = "f.created_at DESC, f.titre ASC";
            }
            break;
        }
      }

      const sessionLateral = usesSessionBasedProfessionalTraining(tenantId)
        ? `LEFT JOIN LATERAL (
          SELECT sp.date_debut, sp.mode_formation
          FROM ${sessionsTable} sp
          WHERE sp.formation_pro_id = f.id
            AND sp.tenant_id = $1
            AND sp.statut IN ('planifiee', 'ouverte')
            AND sp.date_debut >= (CURRENT_DATE - INTERVAL '365 days')
          ORDER BY sp.date_debut ASC
          LIMIT 1
        ) next_session ON true`
        : `LEFT JOIN (SELECT NULL::date AS date_debut, NULL::varchar AS mode_formation) next_session ON true`;

      const supportsTable = getTableName(tenantId, "supports_cours");
      const supportLateral = usesSessionBasedProfessionalTraining(tenantId)
        ? ""
        : `LEFT JOIN LATERAL (
          SELECT sc.id AS cat_sup_id, sc.titre AS cat_sup_titre, sc.type_fichier AS cat_sup_type, sc.video_provider::text AS cat_sup_vp
          FROM ${supportsTable} sc
          WHERE sc.tenant_id = f.tenant_id AND sc.formation_id = f.id
          LIMIT 1
        ) cat_sup ON true`;
      const supportSelectCols = usesSessionBasedProfessionalTraining(tenantId)
        ? ""
        : `,
          cat_sup.cat_sup_id,
          cat_sup.cat_sup_titre,
          cat_sup.cat_sup_type,
          cat_sup.cat_sup_vp`;

      // Main query
      const sql = `
        SELECT 
          f.id,
          f.titre,
          f.slug,
          f.description_courte,
          f.duree_jours,
          f.duree_heures,
          f.prix_ttc,
          f.niveau,
          f.type_certification,
          f.themes,
          next_session.date_debut as prochaine_session_date,
          next_session.mode_formation as prochaine_session_mode
          ${supportSelectCols}
        FROM ${formationsTable} f
        ${sessionLateral}
        ${supportLateral}
        WHERE ${whereConditions.join(" AND ")}
        ORDER BY ${orderBy}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      queryParams.push(limit, offset);
      const result = await client.query(sql, queryParams);

      // Debug: Log les résultats pour voir ce qui est retourné
      if (result.rows.length > 0) {
        console.log('🔍 DEBUG - First row from query:', {
          id: result.rows[0].id,
          titre: result.rows[0].titre,
          prochaine_session_date: result.rows[0].prochaine_session_date,
          prochaine_session_date_type: typeof result.rows[0].prochaine_session_date,
          prochaine_session_mode: result.rows[0].prochaine_session_mode,
        });
      }

      // Fonction pour mapper le mode de formation de la base vers le format attendu
      const mapDeliveryMode = (mode: string | null | undefined): "presentiel" | "distanciel" | "hybride" | null => {
        if (!mode) return null;
        const modeMap: Record<string, "presentiel" | "distanciel" | "hybride"> = {
          'presential': 'presentiel',
          'remote': 'distanciel',
          'hybrid': 'hybride',
          'elearning': 'distanciel', // e-learning est considéré comme distanciel
          'presentiel': 'presentiel', // Si déjà en français
          'distanciel': 'distanciel',
          'hybride': 'hybride',
        };
        return modeMap[mode.toLowerCase()] || null;
      };

      const formations: FormationListItem[] = result.rows.map((row) => {
        // Convertir la date de manière sécurisée
        let dateDebut: string | null = null;
        if (row.prochaine_session_date) {
          try {
            // PostgreSQL retourne souvent un objet Date ou un objet avec toISOString
            // Vérifier d'abord si c'est un objet Date JavaScript
            if (row.prochaine_session_date instanceof Date) {
              dateDebut = row.prochaine_session_date.toISOString().split("T")[0];
            } 
            // Vérifier si c'est un objet avec une méthode toISOString (dates PostgreSQL)
            else if (typeof row.prochaine_session_date === 'object' && row.prochaine_session_date !== null && typeof row.prochaine_session_date.toISOString === 'function') {
              dateDebut = row.prochaine_session_date.toISOString().split("T")[0];
            }
            // Si c'est déjà une chaîne au format ISO ou YYYY-MM-DD, l'utiliser directement
            else if (typeof row.prochaine_session_date === 'string') {
              // Vérifier si c'est déjà au format YYYY-MM-DD
              if (/^\d{4}-\d{2}-\d{2}/.test(row.prochaine_session_date)) {
                dateDebut = row.prochaine_session_date.split('T')[0];
              } else {
                // Sinon, essayer de la parser
                const date = new Date(row.prochaine_session_date);
                if (!isNaN(date.getTime())) {
                  dateDebut = date.toISOString().split("T")[0];
                }
              }
            }
            // Si c'est un nombre (timestamp), le convertir
            else if (typeof row.prochaine_session_date === 'number') {
              const date = new Date(row.prochaine_session_date);
              if (!isNaN(date.getTime())) {
                dateDebut = date.toISOString().split("T")[0];
              }
            }
          } catch (error) {
            console.error('Error parsing date:', error, row.prochaine_session_date, typeof row.prochaine_session_date);
            dateDebut = null;
          }
        }

        const mappedMode = mapDeliveryMode(row.prochaine_session_mode);

        // Debug: Log pour la première formation
        if (row.id === result.rows[0]?.id) {
          console.log('🔍 DEBUG - After mapping:', {
            dateDebut,
            dateDebutType: typeof dateDebut,
            dateDebutValue: dateDebut,
            mappedMode,
            mappedModeType: typeof mappedMode,
            mappedModeValue: mappedMode,
            originalMode: row.prochaine_session_mode,
            willCreateSession: !!(dateDebut && mappedMode),
            dateType: typeof row.prochaine_session_date,
            isDate: row.prochaine_session_date instanceof Date,
            hasToISOString: row.prochaine_session_date && typeof row.prochaine_session_date.toISOString === 'function',
          });
        }

        // Créer l'objet prochaine_session de manière explicite
        let prochaineSession: { date_debut: string; mode_formation: string } | null = null;
        
        // Vérifier que dateDebut et mappedMode sont des valeurs valides (non null, non undefined, non vide)
        const dateDebutStr = dateDebut ? String(dateDebut).trim() : null;
        const mappedModeStr = mappedMode ? String(mappedMode).trim() : null;
        
        if (dateDebutStr && dateDebutStr !== '' && mappedModeStr && mappedModeStr !== '') {
          prochaineSession = {
            date_debut: dateDebutStr,
            mode_formation: mappedModeStr,
          };
          
          // Debug pour la première formation
          if (row.id === result.rows[0]?.id) {
            console.log('🔍 DEBUG - prochaine_session créé:', JSON.stringify(prochaineSession));
            console.log('🔍 DEBUG - dateDebut:', dateDebut, '->', dateDebutStr);
            console.log('🔍 DEBUG - mappedMode:', mappedMode, '->', mappedModeStr);
          }
        } else {
          // Debug pour comprendre pourquoi prochaine_session n'est pas créé
          if (row.id === result.rows[0]?.id) {
            console.log('🔍 DEBUG - prochaine_session NON créé:', {
              dateDebut,
              dateDebutStr,
              dateDebutValid: !!(dateDebutStr && dateDebutStr !== ''),
              mappedMode,
              mappedModeStr,
              mappedModeValid: !!(mappedModeStr && mappedModeStr !== ''),
            });
          }
          // S'assurer que c'est bien null et pas undefined
          prochaineSession = null;
        }

        // S'assurer que prochaine_session est soit un objet valide, soit null (jamais undefined ou objet vide)
        const finalProchaineSession = (prochaineSession && 
                                        typeof prochaineSession === 'object' && 
                                        prochaineSession.date_debut && 
                                        prochaineSession.mode_formation) 
          ? prochaineSession 
          : null;

        // Debug final pour la première formation
        if (row.id === result.rows[0]?.id) {
          console.log('🔍 DEBUG - Final prochaine_session:', JSON.stringify(finalProchaineSession));
          console.log('🔍 DEBUG - Is null?', finalProchaineSession === null);
          console.log('🔍 DEBUG - Type:', typeof finalProchaineSession);
        }

        const listItem: FormationListItem = {
          id: row.id,
          titre: row.titre,
          slug: row.slug,
          description_courte: row.description_courte,
          duree_jours: row.duree_jours,
          duree_heures: row.duree_heures,
          prix_ttc: parseFloat(row.prix_ttc),
          niveau: row.niveau,
          type_certification: row.type_certification,
          themes: Array.isArray(row.themes) ? row.themes : row.themes ? JSON.parse(row.themes) : [],
          prochaine_session: finalProchaineSession,
        };
        const listSupport = mapListCatalogueSupportRow(tenantId, row);
        if (listSupport !== undefined) {
          listItem.catalogue_support = listSupport;
        }
        return listItem;
      });

      return { formations, total };
    } finally {
      client.release();
    }
  }

  /**
   * Get training detail by slug
   */
  async getFormationBySlug(tenantId: string, slug: string): Promise<FormationDetail | null> {
    const client = await this.pool.connect();
    try {
      console.log(`[FormationProService] getFormationBySlug called with:`, { tenantId, slug });
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      console.log(`[FormationProService] Tenant context set successfully`);

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

      const sql = usesSessionBasedProfessionalTraining(tenantId)
        ? `
        SELECT 
          f.*,
          COALESCE(
            json_agg(
              json_build_object(
                'id', sp.id,
                'code_session', sp.code_session,
                'date_debut', sp.date_debut,
                'date_fin', sp.date_fin,
                'horaires', sp.horaires,
                'mode_formation', sp.mode_formation,
                'lieu', sp.lieu,
                'places_disponibles', sp.places_disponibles,
                'prix_ttc', sp.prix_ttc
              ) ORDER BY sp.date_debut ASC
            ) FILTER (WHERE sp.id IS NOT NULL),
            '[]'::json
          ) as sessions
        FROM ${formationsTable} f
        LEFT JOIN ${sessionsTable} sp ON f.id = sp.formation_pro_id
          AND sp.tenant_id = $1
          AND sp.statut IN ('planifiee', 'ouverte')
          AND sp.date_debut >= CURRENT_DATE
        WHERE f.tenant_id = $1
          AND f.slug = $2
          AND f.actif = true
        GROUP BY f.id
      `
        : `
        SELECT f.*, '[]'::json as sessions
        FROM ${formationsTable} f
        WHERE f.tenant_id = $1
          AND f.slug = $2
          AND f.actif = true
      `;

      console.log(`[FormationProService] DEBUG - Executing query with:`, { tenantId, slug });
      
      let result;
      try {
        result = await client.query(sql, [tenantId, slug]);
        console.log(`[FormationProService] DEBUG - Query executed successfully, rowCount: ${result.rowCount}`);
      } catch (queryError: any) {
        console.error(`[FormationProService] DEBUG - Query error:`, {
          message: queryError.message,
          stack: queryError.stack,
          code: queryError.code,
        });
        throw queryError;
      }
      
      console.log(`[FormationProService] DEBUG - Query result:`, {
        rowCount: result.rows.length,
        firstRowKeys: result.rows.length > 0 ? Object.keys(result.rows[0]) : [],
        firstRowId: result.rows.length > 0 ? result.rows[0].id : null,
        firstRowTitre: result.rows.length > 0 ? result.rows[0].titre : null,
        firstRowSlug: result.rows.length > 0 ? result.rows[0].slug : null,
      });

      if (result.rows.length === 0) {
        console.log(`[FormationProService] DEBUG - No rows found for tenantId: ${tenantId}, slug: ${slug}`);
        return null;
      }

      const row = result.rows[0];
      
      // Safely parse JSON fields
      let objectifs: string[] = [];
      try {
        objectifs = Array.isArray(row.objectifs) 
          ? row.objectifs 
          : row.objectifs 
            ? (typeof row.objectifs === 'string' ? JSON.parse(row.objectifs) : [])
            : [];
      } catch (e) {
        console.error('[FormationProService] Error parsing objectifs:', e);
        objectifs = [];
      }
      
      let programme_detaille: any = null;
      try {
        if (row.programme_detaille) {
          programme_detaille = typeof row.programme_detaille === "string"
            ? JSON.parse(row.programme_detaille)
            : row.programme_detaille;
        }
      } catch (e) {
        console.error('[FormationProService] Error parsing programme_detaille:', e);
        programme_detaille = null;
      }
      
      let themes: string[] = [];
      try {
        themes = Array.isArray(row.themes) 
          ? row.themes 
          : row.themes 
            ? (typeof row.themes === 'string' ? JSON.parse(row.themes) : [])
            : [];
      } catch (e) {
        console.error('[FormationProService] Error parsing themes:', e);
        themes = [];
      }
      
      let sessions: any[] = [];
      try {
        const sessionsRaw = Array.isArray(row.sessions) 
          ? row.sessions 
          : row.sessions 
            ? (typeof row.sessions === 'string' ? JSON.parse(row.sessions) : [])
            : [];
        sessions = sessionsRaw.map((s: any) => {
          let dateDebut = null;
          let dateFin = null;
          
          if (s.date_debut) {
            if (s.date_debut instanceof Date) {
              dateDebut = s.date_debut.toISOString().split("T")[0];
            } else if (typeof s.date_debut === 'string') {
              dateDebut = s.date_debut.split('T')[0];
            } else if (typeof s.date_debut === 'object' && s.date_debut !== null && typeof s.date_debut.toISOString === 'function') {
              dateDebut = s.date_debut.toISOString().split("T")[0];
            }
          }
          
          if (s.date_fin) {
            if (s.date_fin instanceof Date) {
              dateFin = s.date_fin.toISOString().split("T")[0];
            } else if (typeof s.date_fin === 'string') {
              dateFin = s.date_fin.split('T')[0];
            } else if (typeof s.date_fin === 'object' && s.date_fin !== null && typeof s.date_fin.toISOString === 'function') {
              dateFin = s.date_fin.toISOString().split("T")[0];
            }
          }
          
          // Map delivery_mode to frontend format
          const mapDeliveryMode = (mode: string | null | undefined): "presentiel" | "distanciel" | "hybride" | null => {
            if (!mode) return null;
            const modeMap: Record<string, "presentiel" | "distanciel" | "hybride"> = {
              'presential': 'presentiel',
              'remote': 'distanciel',
              'hybrid': 'hybride',
              'elearning': 'distanciel',
              'presentiel': 'presentiel',
              'distanciel': 'distanciel',
              'hybride': 'hybride',
            };
            return modeMap[mode.toLowerCase()] || null;
          };

          return {
            id: s.id,
            code_session: s.code_session,
            date_debut: dateDebut,
            date_fin: dateFin,
            horaires: s.horaires,
            mode_formation: mapDeliveryMode(s.mode_formation) || 'presentiel', // Default to presentiel if mapping fails
            lieu: s.lieu,
            places_disponibles: s.places_disponibles,
            prix_ttc: parseFloat(s.prix_ttc),
          };
        });
      } catch (e) {
        console.error('[FormationProService] Error parsing sessions:', e);
        sessions = [];
      }
      
      let catalogue_support: FormationDetail["catalogue_support"] = null;
      if (!usesSessionBasedProfessionalTraining(tenantId)) {
        const supportsTable = getTableName(tenantId, "supports_cours");
        const supRes = await client.query(
          `SELECT id, titre, description, type_fichier, fichier_url, video_provider, video_id
           FROM ${supportsTable}
           WHERE tenant_id = $1 AND formation_id = $2
           LIMIT 1`,
          [tenantId, row.id]
        );
        if (supRes.rows.length > 0) {
          const s = supRes.rows[0];
          catalogue_support = {
            id: s.id,
            titre: s.titre,
            description: s.description ?? null,
            type_fichier: s.type_fichier,
            fichier_url: s.fichier_url,
            video_provider: s.video_provider ?? null,
            video_id: s.video_id ?? null,
          };
        }
      }

      const formationResult: FormationDetail = {
        id: row.id,
        titre: row.titre,
        slug: row.slug,
        description_courte: row.description_courte,
        objectifs,
        programme_detaille,
        prerequis: row.prerequis,
        public_cible: row.public_cible,
        duree_jours: row.duree_jours,
        duree_heures: row.duree_heures,
        prix_ht: row.prix_ht ? parseFloat(row.prix_ht) : null,
        prix_ttc: parseFloat(row.prix_ttc),
        type_certification: row.type_certification,
        nom_certification: row.nom_certification,
        themes,
        niveau: row.niveau,
        carriere: row.carriere,
        sessions,
        catalogue_support,
      };
      
      // Test de sérialisation avant de retourner
      try {
        const testJson = JSON.stringify(formationResult);
        console.log(`[FormationProService] DEBUG - Result serialization successful, length: ${testJson.length}`);
      } catch (serializationError: any) {
        console.error(`[FormationProService] DEBUG - Result serialization failed:`, serializationError);
        throw new Error(`Failed to serialize formation result: ${serializationError.message}`);
      }
      
      return formationResult;
    } catch (error: any) {
      console.error('[FormationProService] Error in getFormationBySlug:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        tenantId,
        slug,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get training sessions for a specific formation
   */
  async getFormationSessions(
    tenantId: string,
    formationId: string,
    limit: number = 50
  ): Promise<{ sessions: SessionListItem[]; total: number }> {
    if (!usesSessionBasedProfessionalTraining(tenantId)) {
      return { sessions: [], total: 0 };
    }
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

      const sql = `
        SELECT 
          sp.id,
          sp.code_session,
          sp.date_debut,
          sp.date_fin,
          sp.horaires,
          sp.mode_formation,
          sp.lieu,
          sp.places_disponibles,
          sp.prix_ttc
        FROM ${sessionsTable} sp
        WHERE sp.tenant_id = $1
          AND sp.formation_pro_id = $2
          AND sp.statut IN ('planifiee', 'ouverte')
          AND sp.date_debut >= CURRENT_DATE
        ORDER BY sp.date_debut ASC
        LIMIT $3
      `;

      const result = await client.query(sql, [tenantId, formationId, limit]);

      const sessions: SessionListItem[] = result.rows.map((row) => ({
        id: row.id,
        code_session: row.code_session,
        date_debut: row.date_debut.toISOString().split("T")[0],
        date_fin: row.date_fin.toISOString().split("T")[0],
        horaires: row.horaires,
        mode_formation: row.mode_formation,
        lieu: row.lieu,
        places_disponibles: row.places_disponibles,
        prix_ttc: parseFloat(row.prix_ttc),
      }));

      return { sessions, total: sessions.length };
    } finally {
      client.release();
    }
  }

  /**
   * Get similar trainings based on themes, level, duration, and price
   */
  async getSimilarFormations(
    tenantId: string,
    formationId: string
  ): Promise<FormationListItem[]> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      const sessionNextLateralSimilar = usesSessionBasedProfessionalTraining(tenantId)
        ? `LEFT JOIN LATERAL (
          SELECT sp.date_debut, sp.mode_formation
          FROM ${sessionsTable} sp
          WHERE sp.formation_pro_id = f.id
            AND sp.tenant_id = $1
            AND sp.statut IN ('planifiee', 'ouverte')
            AND sp.date_debut >= (CURRENT_DATE - INTERVAL '365 days')
          ORDER BY sp.date_debut ASC
          LIMIT 1
        ) next_session ON true`
        : `LEFT JOIN (SELECT NULL::date AS date_debut, NULL::varchar AS mode_formation) next_session ON true`;
      const supportsSimilarTable = getTableName(tenantId, "supports_cours");
      const similarSupportTailColumns = usesSessionBasedProfessionalTraining(tenantId)
        ? ""
        : `cat_sup.cat_sup_id,
          cat_sup.cat_sup_titre,
          cat_sup.cat_sup_type,
          cat_sup.cat_sup_vp,`;
      const similarSupportJoin = usesSessionBasedProfessionalTraining(tenantId)
        ? ""
        : `LEFT JOIN LATERAL (
          SELECT sc.id AS cat_sup_id, sc.titre AS cat_sup_titre, sc.type_fichier AS cat_sup_type, sc.video_provider::text AS cat_sup_vp
          FROM ${supportsSimilarTable} sc
          WHERE sc.tenant_id = f.tenant_id AND sc.formation_id = f.id
          LIMIT 1
        ) cat_sup ON true`;

      // First, get the current formation's characteristics
      const currentFormationSql = `
        SELECT themes, niveau, duree_jours, prix_ttc
        FROM ${formationsTable}
        WHERE id = $1 AND tenant_id = $2 AND actif = true
      `;
      const currentResult = await client.query(currentFormationSql, [formationId, tenantId]);

      if (currentResult.rows.length === 0) {
        return [];
      }

      const current = currentResult.rows[0];
      const currentThemes = Array.isArray(current.themes)
        ? current.themes
        : current.themes
        ? JSON.parse(current.themes)
        : [];

      // Calculate similarity score for each candidate
      const similaritySql = `
        WITH current_formation AS (
          SELECT 
            $3::jsonb as themes,
            $4::varchar as niveau,
            $5::integer as duree_jours,
            $6::decimal as prix_ttc
        )
        SELECT 
          f.id,
          f.titre,
          f.slug,
          f.description_courte,
          f.duree_jours,
          f.duree_heures,
          f.prix_ttc,
          f.niveau,
          f.type_certification,
          f.themes,
          next_session.date_debut as prochaine_session_date,
          next_session.mode_formation as prochaine_session_mode,
          ${similarSupportTailColumns}
          (
            (SELECT COUNT(*) FROM jsonb_array_elements_text(f.themes) 
             WHERE value = ANY(SELECT jsonb_array_elements_text($3::jsonb))) * 3
          ) +
          (CASE WHEN f.niveau = $4 THEN 2 ELSE 0 END) +
          (CASE WHEN ABS(COALESCE(f.duree_jours, 0) - $5) <= 2 THEN 1 ELSE 0 END) +
          (CASE WHEN f.prix_ttc BETWEEN $6 * 0.7 AND $6 * 1.3 THEN 1 ELSE 0 END) as similarity_score
        FROM ${formationsTable} f
        ${sessionNextLateralSimilar}
        ${similarSupportJoin}
        CROSS JOIN current_formation cf
        WHERE f.tenant_id = $1
          AND f.actif = true
          AND f.id != $2
          AND (
            (SELECT COUNT(*) FROM jsonb_array_elements_text(f.themes) 
             WHERE value = ANY(SELECT jsonb_array_elements_text($3::jsonb))) * 3
          ) +
          (CASE WHEN f.niveau = $4 THEN 2 ELSE 0 END) +
          (CASE WHEN ABS(COALESCE(f.duree_jours, 0) - $5) <= 2 THEN 1 ELSE 0 END) +
          (CASE WHEN f.prix_ttc BETWEEN $6 * 0.7 AND $6 * 1.3 THEN 1 ELSE 0 END) > 0
        ORDER BY similarity_score DESC, f.titre ASC
        LIMIT 4
      `;

      const result = await client.query(similaritySql, [
        tenantId,
        formationId,
        JSON.stringify(currentThemes),
        current.niveau,
        current.duree_jours || 0,
        current.prix_ttc,
      ]);

      // Fonction pour mapper le mode de formation de la base vers le format attendu
      const mapDeliveryMode = (mode: string | null | undefined): "presentiel" | "distanciel" | "hybride" | null => {
        if (!mode) return null;
        const modeMap: Record<string, "presentiel" | "distanciel" | "hybride"> = {
          'presential': 'presentiel',
          'remote': 'distanciel',
          'hybrid': 'hybride',
          'elearning': 'distanciel', // e-learning est considéré comme distanciel
          'presentiel': 'presentiel', // Si déjà en français
          'distanciel': 'distanciel',
          'hybride': 'hybride',
        };
        return modeMap[mode.toLowerCase()] || null;
      };

      return result.rows.map((row) => {
        // Convertir la date de manière sécurisée
        let dateDebut: string | null = null;
        if (row.prochaine_session_date) {
          try {
            // PostgreSQL retourne souvent un objet Date ou un objet avec toISOString
            // Vérifier d'abord si c'est un objet Date JavaScript
            if (row.prochaine_session_date instanceof Date) {
              dateDebut = row.prochaine_session_date.toISOString().split("T")[0];
            } 
            // Vérifier si c'est un objet avec une méthode toISOString (dates PostgreSQL)
            else if (typeof row.prochaine_session_date === 'object' && row.prochaine_session_date !== null && typeof row.prochaine_session_date.toISOString === 'function') {
              dateDebut = row.prochaine_session_date.toISOString().split("T")[0];
            }
            // Si c'est déjà une chaîne au format ISO ou YYYY-MM-DD, l'utiliser directement
            else if (typeof row.prochaine_session_date === 'string') {
              // Vérifier si c'est déjà au format YYYY-MM-DD
              if (/^\d{4}-\d{2}-\d{2}/.test(row.prochaine_session_date)) {
                dateDebut = row.prochaine_session_date.split('T')[0];
              } else {
                // Sinon, essayer de la parser
                const date = new Date(row.prochaine_session_date);
                if (!isNaN(date.getTime())) {
                  dateDebut = date.toISOString().split("T")[0];
                }
              }
            }
            // Si c'est un nombre (timestamp), le convertir
            else if (typeof row.prochaine_session_date === 'number') {
              const date = new Date(row.prochaine_session_date);
              if (!isNaN(date.getTime())) {
                dateDebut = date.toISOString().split("T")[0];
              }
            }
          } catch (error) {
            console.error('Error parsing date:', error, row.prochaine_session_date, typeof row.prochaine_session_date);
            dateDebut = null;
          }
        }

        const mappedMode = mapDeliveryMode(row.prochaine_session_mode);

        const similarItem: FormationListItem = {
          id: row.id,
          titre: row.titre,
          slug: row.slug,
          description_courte: row.description_courte,
          duree_jours: row.duree_jours,
          duree_heures: row.duree_heures,
          prix_ttc: parseFloat(row.prix_ttc),
          niveau: row.niveau,
          type_certification: row.type_certification,
          themes: Array.isArray(row.themes) ? row.themes : row.themes ? JSON.parse(row.themes) : [],
          prochaine_session: dateDebut && mappedMode
            ? {
                date_debut: dateDebut,
                mode_formation: mappedMode,
              }
            : null,
        };
        const similarSupport = mapListCatalogueSupportRow(tenantId, row);
        if (similarSupport !== undefined) {
          similarItem.catalogue_support = similarSupport;
        }
        return similarItem;
      });
    } finally {
      client.release();
    }
  }

  /**
   * Get all available themes with counts
   */
  async getThemes(tenantId: string): Promise<ThemeItem[]> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');

      const sql = `
        SELECT 
          theme.value as value,
          theme.value as label,
          COUNT(DISTINCT f.id) as count
        FROM ${formationsTable} f,
        LATERAL jsonb_array_elements_text(f.themes) as theme
        WHERE f.tenant_id = $1
          AND f.actif = true
        GROUP BY theme.value
        ORDER BY count DESC, theme.value ASC
      `;

      const result = await client.query(sql, [tenantId]);

      return result.rows.map((row) => ({
        value: row.value,
        label: row.value, // Can be enhanced with a mapping table later
        count: parseInt(row.count),
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Get statistics for filter initialization
   */
  async getStats(tenantId: string): Promise<FormationStats> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');

      // Après migration 0051, la table sessions_professionnelles n’existe plus côté « base » (Imhotep Data).
      let sql: string;
      if (usesSessionBasedProfessionalTraining(tenantId)) {
        const sessionsTable = getTableName(tenantId, "sessions_professionnelles");
        sql = `
        SELECT 
          COALESCE(MIN(f.prix_ttc), 0) as prix_min,
          COALESCE(MAX(f.prix_ttc), 0) as prix_max,
          COALESCE(MIN(f.duree_jours), 0) as duree_min,
          COALESCE(MAX(f.duree_jours), 0) as duree_max,
          COUNT(DISTINCT f.id) FILTER (WHERE f.actif = true) as total_formations,
          COUNT(DISTINCT sp.id) FILTER (
            WHERE sp.statut IN ('planifiee', 'ouverte')
            AND sp.date_debut >= (CURRENT_DATE - INTERVAL '365 days')
          ) as total_sessions
        FROM ${formationsTable} f
        LEFT JOIN ${sessionsTable} sp ON f.id = sp.formation_pro_id
          AND sp.tenant_id = $1
        WHERE f.tenant_id = $1
      `;
      } else {
        sql = `
        SELECT 
          COALESCE(MIN(f.prix_ttc), 0) as prix_min,
          COALESCE(MAX(f.prix_ttc), 0) as prix_max,
          COALESCE(MIN(f.duree_jours), 0) as duree_min,
          COALESCE(MAX(f.duree_jours), 0) as duree_max,
          COUNT(DISTINCT f.id) FILTER (WHERE f.actif = true) as total_formations,
          0::bigint as total_sessions
        FROM ${formationsTable} f
        WHERE f.tenant_id = $1
      `;
      }

      const result = await client.query(sql, [tenantId]);
      const row = result.rows[0];

      return {
        prix: {
          min: parseFloat(row.prix_min) || 0,
          max: parseFloat(row.prix_max) || 0,
        },
        duree: {
          min: parseInt(row.duree_min) || 0,
          max: parseInt(row.duree_max) || 0,
        },
        total_formations: parseInt(row.total_formations) || 0,
        total_sessions: parseInt(row.total_sessions) || 0,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Create a new professional training program
   */
  async createFormation(
    tenantId: string,
    userId: string | null,
    data: {
      titre: string;
      description_courte?: string | null;
      objectifs?: string[];
      prerequis?: string | null;
      public_cible?: string | null;
      duree_jours?: number | null;
      duree_heures?: number | null;
      prix_ht?: number | null;
      prix_ttc: number;
      type_certification?: string | null;
      nom_certification?: string | null;
      themes?: string[];
      niveau?: string | null;
      carriere?: string | null;
    }
  ): Promise<{ id: string; slug: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Generate slug from titre
      const slug = data.titre
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      console.log(`[FormationProService] createFormation - Using table: ${formationsTable} for tenantId: ${tenantId}`);

      // Check if slug already exists for this tenant
      const existingCheck = await client.query(
        `SELECT id FROM ${formationsTable} WHERE tenant_id = $1 AND slug = $2`,
        [tenantId, slug]
      );

      let finalSlug = slug;
      if (existingCheck.rows.length > 0) {
        // Append timestamp if slug exists
        finalSlug = `${slug}-${Date.now()}`;
      }

      const insertQuery = `
        INSERT INTO ${formationsTable} (
          tenant_id,
          titre,
          slug,
          description_courte,
          objectifs,
          prerequis,
          public_cible,
          duree_jours,
          duree_heures,
          prix_ht,
          prix_ttc,
          type_certification,
          nom_certification,
          themes,
          niveau,
          carriere,
          actif,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true, $17)
        RETURNING id, slug
      `;

      try {
        console.log(`[FormationProService] createFormation - Executing INSERT with params:`, {
          tenantId,
          titre: data.titre,
          slug: finalSlug,
          userId,
          table: formationsTable
        });
        
        const result = await client.query(insertQuery, [
          tenantId,
          data.titre,
          finalSlug,
          data.description_courte || null,
          data.objectifs ? JSON.stringify(data.objectifs) : JSON.stringify([]),
          data.prerequis || null,
          data.public_cible || null,
          data.duree_jours || null,
          data.duree_heures || null,
          data.prix_ht || null,
          data.prix_ttc,
          data.type_certification || null,
          data.nom_certification || null,
          data.themes ? JSON.stringify(data.themes) : JSON.stringify([]),
          data.niveau || null,
          data.carriere || null,
          userId,
        ]);
        
        console.log(`[FormationProService] createFormation - INSERT successful, created formation:`, {
          id: result.rows[0]?.id,
          slug: result.rows[0]?.slug
        });

        return {
          id: result.rows[0].id,
          slug: result.rows[0].slug,
        };
      } catch (dbError: any) {
        console.error("Database error in createFormation:", {
          message: dbError.message,
          code: dbError.code,
          detail: dbError.detail,
          hint: dbError.hint,
        });
        throw new Error(`Database error: ${dbError.message || "Unknown error"}`);
      }

      return {
        id: result.rows[0].id,
        slug: result.rows[0].slug,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing professional training program by slug
   */
  async updateFormation(
    tenantId: string,
    slug: string,
    data: {
      titre?: string;
      description_courte?: string | null;
      objectifs?: string[];
      prerequis?: string | null;
      public_cible?: string | null;
      duree_jours?: number | null;
      duree_heures?: number | null;
      prix_ht?: number | null;
      prix_ttc?: number;
      type_certification?: string | null;
      nom_certification?: string | null;
      themes?: string[];
      niveau?: string | null;
      carriere?: string | null;
      actif?: boolean;
    }
  ): Promise<{ id: string; slug: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');

      // Check if formation exists
      const existingCheck = await client.query(
        `SELECT id, slug FROM ${formationsTable} WHERE tenant_id = $1 AND slug = $2`,
        [tenantId, slug]
      );

      if (existingCheck.rows.length === 0) {
        throw new Error("Formation not found");
      }

      const formationId = existingCheck.rows[0].id;
      let finalSlug = existingCheck.rows[0].slug;

      // If titre is being updated, regenerate slug
      if (data.titre) {
        const newSlug = data.titre
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

        // Check if new slug already exists for another formation
        const slugCheck = await client.query(
          `SELECT id FROM ${formationsTable} WHERE tenant_id = $1 AND slug = $2 AND id != $3`,
          [tenantId, newSlug, formationId]
        );

        if (slugCheck.rows.length > 0) {
          // Append timestamp if slug exists
          finalSlug = `${newSlug}-${Date.now()}`;
        } else {
          finalSlug = newSlug;
        }
      }

      // Build update query dynamically based on provided fields
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (data.titre !== undefined) {
        updateFields.push(`titre = $${paramIndex++}`);
        updateValues.push(data.titre);
        // If titre is updated, also update slug
        updateFields.push(`slug = $${paramIndex++}`);
        updateValues.push(finalSlug);
      }
      if (data.description_courte !== undefined) {
        updateFields.push(`description_courte = $${paramIndex++}`);
        updateValues.push(data.description_courte);
      }
      if (data.objectifs !== undefined) {
        updateFields.push(`objectifs = $${paramIndex++}`);
        updateValues.push(JSON.stringify(data.objectifs));
      }
      if (data.prerequis !== undefined) {
        updateFields.push(`prerequis = $${paramIndex++}`);
        updateValues.push(data.prerequis);
      }
      if (data.public_cible !== undefined) {
        updateFields.push(`public_cible = $${paramIndex++}`);
        updateValues.push(data.public_cible);
      }
      if (data.duree_jours !== undefined) {
        updateFields.push(`duree_jours = $${paramIndex++}`);
        updateValues.push(data.duree_jours);
      }
      if (data.duree_heures !== undefined) {
        updateFields.push(`duree_heures = $${paramIndex++}`);
        updateValues.push(data.duree_heures);
      }
      if (data.prix_ht !== undefined) {
        updateFields.push(`prix_ht = $${paramIndex++}`);
        updateValues.push(data.prix_ht);
      }
      if (data.prix_ttc !== undefined) {
        updateFields.push(`prix_ttc = $${paramIndex++}`);
        updateValues.push(data.prix_ttc);
      }
      if (data.type_certification !== undefined) {
        updateFields.push(`type_certification = $${paramIndex++}`);
        updateValues.push(data.type_certification);
      }
      if (data.nom_certification !== undefined) {
        updateFields.push(`nom_certification = $${paramIndex++}`);
        updateValues.push(data.nom_certification);
      }
      if (data.themes !== undefined) {
        updateFields.push(`themes = $${paramIndex++}`);
        updateValues.push(JSON.stringify(data.themes));
      }
      if (data.niveau !== undefined) {
        updateFields.push(`niveau = $${paramIndex++}`);
        updateValues.push(data.niveau);
      }
      if (data.carriere !== undefined) {
        updateFields.push(`carriere = $${paramIndex++}`);
        updateValues.push(data.carriere);
      }
      if (data.actif !== undefined) {
        updateFields.push(`actif = $${paramIndex++}`);
        updateValues.push(data.actif);
      }

      // Always update updated_at
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

      if (updateFields.length === 0) {
        // No fields to update, return existing formation
        return {
          id: formationId,
          slug: finalSlug,
        };
      }

      updateValues.push(tenantId, slug);

      const updateQuery = `
        UPDATE ${formationsTable}
        SET ${updateFields.join(", ")}
        WHERE tenant_id = $${paramIndex} AND slug = $${paramIndex + 1}
        RETURNING id, slug
      `;

      const result = await client.query(updateQuery, updateValues);

      if (result.rows.length === 0) {
        throw new Error("Formation not found or update failed");
      }

      return {
        id: result.rows[0].id,
        slug: result.rows[0].slug,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Create a new training session for a professional training program
   */
  async createSession(
    tenantId: string,
    userId: string | null,
    data: {
      formation_pro_id: string;
      code_session?: string;
      date_debut: string; // ISO date string (YYYY-MM-DD)
      date_fin: string; // ISO date string (YYYY-MM-DD)
      horaires?: string;
      mode_formation: "presential" | "remote" | "hybrid" | "elearning";
      lieu?: string;
      lien_visio?: string;
      places_totales: number;
      prix_ht?: number | null;
      prix_ttc?: number | null;
      notes_internes?: string;
    }
  ): Promise<{ id: string; code_session: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

      // Verify formation exists
      const formationCheck = await client.query(
        `SELECT id FROM ${formationsTable} WHERE id = $1 AND tenant_id = $2 AND actif = true`,
        [data.formation_pro_id, tenantId]
      );

      if (formationCheck.rows.length === 0) {
        throw new Error("Formation not found or inactive");
      }

      // Generate code_session if not provided
      let codeSession = data.code_session;
      if (!codeSession) {
        // Get formation title to generate code
        const formationResult = await client.query(
          `SELECT titre FROM ${formationsTable} WHERE id = $1`,
          [data.formation_pro_id]
        );
        const formationTitle = formationResult.rows[0]?.titre || "FORM";
        
        // Generate code from title and date
        const titleCode = formationTitle
          .substring(0, 4)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "");
        const dateCode = data.date_debut.replace(/-/g, "").substring(0, 6);
        codeSession = `${titleCode}-${dateCode}`;
      }

      // Check if code_session already exists for this tenant
      const codeCheck = await client.query(
        `SELECT id FROM ${sessionsTable} WHERE tenant_id = $1 AND code_session = $2`,
        [tenantId, codeSession]
      );

      if (codeCheck.rows.length > 0) {
        // Append sequence number if code exists
        let counter = 1;
        let finalCode = `${codeSession}-${counter}`;
        while (true) {
          const check = await client.query(
            `SELECT id FROM ${sessionsTable} WHERE tenant_id = $1 AND code_session = $2`,
            [tenantId, finalCode]
          );
          if (check.rows.length === 0) break;
          counter++;
          finalCode = `${codeSession}-${counter}`;
        }
        codeSession = finalCode;
      }

      // Validate dates
      const dateDebut = new Date(data.date_debut);
      const dateFin = new Date(data.date_fin);
      
      if (dateFin < dateDebut) {
        throw new Error("La date de fin doit être postérieure à la date de début");
      }

      // Map mode_formation to database enum value
      const modeMap: Record<string, string> = {
        'presentiel': 'presential',
        'distanciel': 'remote',
        'hybride': 'hybrid',
        'presential': 'presential',
        'remote': 'remote',
        'hybrid': 'hybrid',
        'elearning': 'elearning',
      };
      const dbMode = modeMap[data.mode_formation.toLowerCase()] || 'presential';

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
        )
        VALUES ($1, $2, $3, $4, $5, $6, CAST($7 AS delivery_mode), $8, $9, $10, 0, $11, $12, 'planifiee', $13)
        RETURNING id, code_session
      `;

      console.log('[FormationProService] Creating session with params:', {
        tenantId,
        formation_pro_id: data.formation_pro_id,
        codeSession,
        date_debut: data.date_debut,
        date_fin: data.date_fin,
        mode_formation: dbMode,
        places_totales: data.places_totales,
      });

      const result = await client.query(insertQuery, [
        tenantId,
        data.formation_pro_id,
        codeSession,
        data.date_debut,
        data.date_fin,
        data.horaires || null,
        dbMode,
        data.lieu || null,
        data.lien_visio || null,
        data.places_totales,
        data.prix_ht || null,
        data.prix_ttc || null,
        data.notes_internes || null,
      ]);

      if (result.rows.length === 0) {
        throw new Error("Failed to create session - no rows returned");
      }

      console.log('[FormationProService] Session created successfully:', {
        id: result.rows[0].id,
        code_session: result.rows[0].code_session,
      });

      return {
        id: result.rows[0].id,
        code_session: result.rows[0].code_session,
      };
    } catch (error: any) {
      console.error('[FormationProService] Error creating session:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        hint: error.hint,
        stack: error.stack,
        mode_formation_input: data.mode_formation,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing training session
   */
  async updateSession(
    tenantId: string,
    sessionId: string,
    data: {
      code_session?: string;
      date_debut?: string;
      date_fin?: string;
      horaires?: string;
      mode_formation?: "presential" | "remote" | "hybrid" | "elearning";
      lieu?: string | null;
      lien_visio?: string | null;
      places_totales?: number;
      prix_ht?: number | null;
      prix_ttc?: number | null;
      notes_internes?: string | null;
      statut?: "planifiee" | "ouverte" | "complete" | "en_cours" | "terminee" | "annulee";
    }
  ): Promise<{ id: string; code_session: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

      // Verify session exists
      const sessionCheck = await client.query(
        `SELECT id FROM ${sessionsTable} WHERE id = $1 AND tenant_id = $2`,
        [sessionId, tenantId]
      );

      if (sessionCheck.rows.length === 0) {
        throw new Error("Session not found");
      }

      // Build update query dynamically
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (data.code_session !== undefined) {
        updateFields.push(`code_session = $${paramIndex++}`);
        updateValues.push(data.code_session);
      }
      if (data.date_debut !== undefined) {
        updateFields.push(`date_debut = $${paramIndex++}`);
        updateValues.push(data.date_debut);
      }
      if (data.date_fin !== undefined) {
        updateFields.push(`date_fin = $${paramIndex++}`);
        updateValues.push(data.date_fin);
      }
      if (data.horaires !== undefined) {
        updateFields.push(`horaires = $${paramIndex++}`);
        updateValues.push(data.horaires);
      }
      if (data.mode_formation !== undefined) {
        const modeMap: Record<string, string> = {
          'presentiel': 'presential',
          'distanciel': 'remote',
          'hybride': 'hybrid',
          'presential': 'presential',
          'remote': 'remote',
          'hybrid': 'hybrid',
          'elearning': 'elearning',
        };
        const dbMode = modeMap[data.mode_formation.toLowerCase()] || 'presential';
        updateFields.push(`mode_formation = CAST($${paramIndex++} AS delivery_mode)`);
        updateValues.push(dbMode);
      }
      if (data.lieu !== undefined) {
        updateFields.push(`lieu = $${paramIndex++}`);
        updateValues.push(data.lieu);
      }
      if (data.lien_visio !== undefined) {
        updateFields.push(`lien_visio = $${paramIndex++}`);
        updateValues.push(data.lien_visio);
      }
      if (data.places_totales !== undefined) {
        updateFields.push(`places_totales = $${paramIndex++}`);
        updateValues.push(data.places_totales);
      }
      if (data.prix_ht !== undefined) {
        updateFields.push(`prix_ht = $${paramIndex++}`);
        updateValues.push(data.prix_ht);
      }
      if (data.prix_ttc !== undefined) {
        updateFields.push(`prix_ttc = $${paramIndex++}`);
        updateValues.push(data.prix_ttc);
      }
      if (data.notes_internes !== undefined) {
        updateFields.push(`notes_internes = $${paramIndex++}`);
        updateValues.push(data.notes_internes);
      }
      if (data.statut !== undefined) {
        updateFields.push(`statut = CAST($${paramIndex++} AS session_professional_status)`);
        updateValues.push(data.statut);
      }

      // Always update updated_at
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

      if (updateFields.length === 0) {
        // No fields to update, return existing session
        const existingResult = await client.query(
          `SELECT id, code_session FROM ${sessionsTable} WHERE id = $1`,
          [sessionId]
        );
        return {
          id: existingResult.rows[0].id,
          code_session: existingResult.rows[0].code_session,
        };
      }

      updateValues.push(tenantId, sessionId);

      const updateQuery = `
        UPDATE ${sessionsTable}
        SET ${updateFields.join(", ")}
        WHERE tenant_id = $${paramIndex} AND id = $${paramIndex + 1}
        RETURNING id, code_session
      `;

      const result = await client.query(updateQuery, updateValues);

      if (result.rows.length === 0) {
        throw new Error("Session not found or update failed");
      }

      return {
        id: result.rows[0].id,
        code_session: result.rows[0].code_session,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Delete a training session
   */
  async deleteSession(tenantId: string, sessionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get tenant-specific table names
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

      // Verify session exists
      const sessionCheck = await client.query(
        `SELECT id FROM ${sessionsTable} WHERE id = $1 AND tenant_id = $2`,
        [sessionId, tenantId]
      );

      if (sessionCheck.rows.length === 0) {
        throw new Error("Session not found");
      }

      // Delete the session
      const deleteResult = await client.query(
        `DELETE FROM ${sessionsTable} WHERE tenant_id = $1 AND id = $2`,
        [tenantId, sessionId]
      );

      if (deleteResult.rowCount === 0) {
        throw new Error("Failed to delete session");
      }
    } finally {
      client.release();
    }
  }

  /**
   * Delete a formation (soft delete by setting actif to false)
   */
  async deleteFormation(tenantId: string, formationId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      // Get tenant-specific table names
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');
      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');

      // Check if formation exists
      const formationCheck = await client.query(
        `SELECT id, titre FROM ${formationsTable} WHERE id = $1 AND tenant_id = $2`,
        [formationId, tenantId]
      );

      if (formationCheck.rows.length === 0) {
        throw new Error("FORMATION_NOT_FOUND");
      }

      if (usesSessionBasedProfessionalTraining(tenantId)) {
        const sessionsCheck = await client.query(
          `SELECT COUNT(*)::integer as count
           FROM ${sessionsTable}
           WHERE formation_pro_id = $1 
             AND tenant_id = $2
             AND statut IN ('planifiee', 'ouverte', 'en_cours')`,
          [formationId, tenantId]
        );

        const activeSessionsCount = parseInt(sessionsCheck.rows[0].count) || 0;

        if (activeSessionsCount > 0) {
          throw new Error(`FORMATION_HAS_ACTIVE_SESSIONS:${activeSessionsCount}`);
        }
      }

      // Check if formation has enrollments
      const enrollmentsCheck = usesSessionBasedProfessionalTraining(tenantId)
        ? await client.query(
            `SELECT COUNT(*)::integer as count
             FROM ${inscriptionsTable} i
             JOIN ${sessionsTable} s ON i.session_id = s.id
             WHERE s.formation_pro_id = $1 
               AND i.tenant_id = $2
               AND i.statut IN ('en_attente', 'confirmee')`,
            [formationId, tenantId]
          )
        : await client.query(
            `SELECT COUNT(*)::integer as count
             FROM ${inscriptionsTable} i
             WHERE i.formation_pro_id = $1 
               AND i.tenant_id = $2
               AND i.statut IN ('en_attente', 'confirmee')`,
            [formationId, tenantId]
          );

      const enrollmentsCount = parseInt(enrollmentsCheck.rows[0].count) || 0;

      if (enrollmentsCount > 0) {
        throw new Error(`FORMATION_HAS_ENROLLMENTS:${enrollmentsCount}`);
      }

      // Soft delete: set actif to false
      const updateResult = await client.query(
        `UPDATE ${formationsTable} SET actif = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [formationId, tenantId]
      );

      if (updateResult.rowCount === 0) {
        throw new Error("Failed to delete formation");
      }
    } finally {
      client.release();
    }
  }
}

