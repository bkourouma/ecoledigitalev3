/**
 * Supports Cours Service
 * 
 * Handles course material (supports de cours) management for trainers
 * T033-T037: Course materials service methods
 */

import { Pool } from "pg";
import { getFileStorageService } from "./fileStorage";
import { getTableName, usesSessionBasedProfessionalTraining } from '../utils/table-names';
import { VimeoService } from "./vimeo.service";

// Allowed file types and their MIME types
const ALLOWED_FILE_TYPES: Record<string, string[]> = {
  PDF: ["application/pdf"],
  PPT: ["application/vnd.ms-powerpoint"],
  PPTX: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  DOC: ["application/msword"],
  DOCX: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ZIP: ["application/zip", "application/x-zip-compressed"],
  Video: ["video/mp4", "video/avi", "video/x-msvideo", "video/quicktime", "video/webm"],
  Autre: [], // Allow other types
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB for non-video files
const MAX_VIDEO_FILE_SIZE = 1024 * 1024 * 1024; // 1GB for videos

export class SupportsCoursService {
  private readonly vimeoService = new VimeoService();
  constructor(private pool: Pool) {}

  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Get file type from MIME type
   */
  private getFileTypeFromMime(mimeType: string): string {
    for (const [type, mimes] of Object.entries(ALLOWED_FILE_TYPES)) {
      if (mimes.includes(mimeType)) {
        return type;
      }
    }
    return "Autre";
  }

  /**
   * Validate file type
   */
  private validateFileType(mimeType: string): void {
    const fileType = this.getFileTypeFromMime(mimeType);
    if (fileType === "Autre" && !ALLOWED_FILE_TYPES.Autre.length) {
      // Check if it's a known type
      const knownTypes = Object.values(ALLOWED_FILE_TYPES).flat();
      if (!knownTypes.includes(mimeType)) {
        throw new Error("INVALID_FILE_TYPE: File type not allowed");
      }
    }
  }

  /**
   * Upload a course material
   * T033: Course material upload service
   */
  async uploadSupport(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    metadata: {
      titre: string;
      description?: string;
      formation_id?: string;
      session_ids?: string[];
      visible_apprenants?: boolean;
      video_provider?: "local" | "vimeo";
      vimeo_url?: string;
      thumbnail_url?: string;
      thumbnail_file_buffer?: Buffer;
      thumbnail_file_name?: string;
      thumbnail_content_type?: string;
    },
    formateurId: string | null,
    tenantId: string
  ): Promise<{
    id: string;
    titre: string;
    description?: string;
    type_fichier: string;
    taille_fichier: number;
    fichier_url: string;
    video_provider?: "local" | "vimeo" | null;
    video_id?: string | null;
    url_thumbnail?: string | null;
    visible_apprenants: boolean;
    created_at: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Validate file type
      this.validateFileType(mimeType);

      const fileType = this.getFileTypeFromMime(mimeType);
      const maxFileSize = fileType === "Video" ? MAX_VIDEO_FILE_SIZE : MAX_FILE_SIZE;
      const primarySessionId = metadata.session_ids?.[0] || null;
      const sessionMode = usesSessionBasedProfessionalTraining(tenantId);

      if (sessionMode) {
        if (!metadata.formation_id && !primarySessionId) {
          throw new Error("FORMATION_OR_SESSION_REQUIRED: Une formation ou une session est requise");
        }
        if (!formateurId) {
          throw new Error("FORMATEUR_REQUIRED");
        }
      } else {
        if (!metadata.formation_id) {
          throw new Error("FORMATION_REQUIRED: L'identifiant de formation est requis");
        }
      }

      // Validate file size (1GB for videos, 100MB for other files)
      if (fileBuffer.length > maxFileSize) {
        const maxLabel = fileType === "Video" ? "1GB" : "100MB";
        throw new Error(`FILE_TOO_LARGE: File size exceeds ${maxLabel} limit`);
      }

      const supportsTable = getTableName(tenantId, "supports_cours");
      const supportSessionsTable = getTableName(tenantId, "support_session_associations");
      const configuredVideoProvider = (process.env.VIDEO_STORAGE_PROVIDER || "local").toLowerCase();
      const requestedVideoProvider = (metadata.video_provider || configuredVideoProvider) as "local" | "vimeo";
      const isVideo = fileType === "Video";

      let storedFileUrl = "";
      let storedVideoProvider: "local" | "vimeo" | null = null;
      let storedVideoId: string | null = null;
      let storedThumbnailUrl: string | null = metadata.thumbnail_url || null;

      if (isVideo && metadata.thumbnail_file_buffer) {
        if (
          !metadata.thumbnail_content_type ||
          !metadata.thumbnail_content_type.startsWith("image/")
        ) {
          throw new Error("INVALID_THUMBNAIL_TYPE: Thumbnail must be an image file");
        }
        if (metadata.thumbnail_file_buffer.length > 10 * 1024 * 1024) {
          throw new Error("THUMBNAIL_TOO_LARGE: Thumbnail exceeds 10MB limit");
        }

        const thumbnailStorage = getFileStorageService();
        const thumbnailUpload = await thumbnailStorage.uploadFile(metadata.thumbnail_file_buffer, {
          tenantId,
          courseId: metadata.formation_id || "supports-thumbnails",
          fileName: metadata.thumbnail_file_name || `thumb-${Date.now()}.jpg`,
          contentType: metadata.thumbnail_content_type,
          maxFileSizeBytes: 10 * 1024 * 1024,
          metadata: {
            originalFileName: metadata.thumbnail_file_name || "thumbnail",
            formateurId: formateurId || "catalogue",
            titre: `${metadata.titre}-thumbnail`,
          },
        });
        storedThumbnailUrl = `/api/v1/files/${thumbnailUpload.key}`;
      }

      if (isVideo && requestedVideoProvider === "vimeo") {
        if (metadata.vimeo_url) {
          const videoIdFromUrl = this.vimeoService.extractVideoIdFromUrl(metadata.vimeo_url);
          if (!videoIdFromUrl) {
            throw new Error("INVALID_VIMEO_URL: Impossible d'extraire l'identifiant vidéo Vimeo");
          }
          storedVideoId = videoIdFromUrl;
          storedFileUrl = `https://player.vimeo.com/video/${videoIdFromUrl}`;
          if (!storedThumbnailUrl) {
            storedThumbnailUrl = `https://vumbnail.com/${videoIdFromUrl}.jpg`;
          }
        } else {
          const uploaded = await this.vimeoService.uploadVideo(fileBuffer, {
            title: metadata.titre,
            description: metadata.description,
            mimeType,
          });
          storedVideoId = uploaded.videoId;
          storedFileUrl = uploaded.playerUrl;
          if (!storedThumbnailUrl) {
            storedThumbnailUrl = uploaded.thumbnailUrl;
          }
        }
        storedVideoProvider = "vimeo";
      } else {
        // Default local storage for documents and locally-hosted videos
        const fileStorageService = getFileStorageService();
        const uploadResult = await fileStorageService.uploadFile(fileBuffer, {
          tenantId,
          courseId: metadata.formation_id || "supports", // Use formation_id or default
          fileName: fileName,
          contentType: mimeType,
          maxFileSizeBytes: maxFileSize,
          metadata: {
            originalFileName: fileName,
            formateurId: formateurId || "catalogue",
            titre: metadata.titre,
          },
        });
        storedFileUrl = `/api/v1/files/${uploadResult.key}`;
        storedVideoProvider = isVideo ? "local" : null;
      }

      let support: any;

      if (sessionMode) {
        const insertQuery = `
        INSERT INTO ${supportsTable} (
          tenant_id,
          formateur_id,
          session_id,
          formation_id,
          titre,
          description,
          type_fichier,
          taille_fichier,
          fichier_url,
          video_provider,
          video_id,
          url_thumbnail,
          storage_provider,
          visible_apprenants
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id, titre, description, type_fichier, taille_fichier, fichier_url, video_provider, video_id, url_thumbnail, visible_apprenants, created_at
      `;

        const result = await client.query(insertQuery, [
          tenantId,
          formateurId,
          primarySessionId,
          metadata.formation_id || null,
          metadata.titre,
          metadata.description || null,
          fileType,
          fileBuffer.length,
          storedFileUrl,
          storedVideoProvider,
          storedVideoId,
          storedThumbnailUrl,
          isVideo ? requestedVideoProvider : "local",
          metadata.visible_apprenants !== false,
        ]);
        support = result.rows[0];
      } else {
        await client.query(
          `DELETE FROM ${supportsTable} WHERE tenant_id = $1 AND formation_id = $2`,
          [tenantId, metadata.formation_id]
        );
        const insertQuery = `
        INSERT INTO ${supportsTable} (
          tenant_id,
          formation_id,
          titre,
          description,
          type_fichier,
          taille_fichier,
          fichier_url,
          video_provider,
          video_id,
          url_thumbnail,
          storage_provider,
          visible_apprenants
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, titre, description, type_fichier, taille_fichier, fichier_url, video_provider, video_id, url_thumbnail, visible_apprenants, created_at
      `;
        const result = await client.query(insertQuery, [
          tenantId,
          metadata.formation_id,
          metadata.titre,
          metadata.description || null,
          fileType,
          fileBuffer.length,
          storedFileUrl,
          storedVideoProvider,
          storedVideoId,
          storedThumbnailUrl,
          isVideo ? requestedVideoProvider : "local",
          metadata.visible_apprenants !== false,
        ]);
        support = result.rows[0];
      }

      // Create session associations if provided
      if (sessionMode && metadata.session_ids && metadata.session_ids.length > 0) {
        const associationValues = metadata.session_ids
          .map((_, index) => `($1, $2, $${index + 3})`)
          .join(", ");

        const associationParams = [
          tenantId,
          support.id,
          ...metadata.session_ids,
        ];

        const associationQuery = `
          INSERT INTO ${supportSessionsTable} (tenant_id, support_id, session_id)
          VALUES ${associationValues}
        `;

        await client.query(associationQuery, associationParams);
      }

      return {
        id: support.id,
        titre: support.titre,
        description: support.description,
        type_fichier: support.type_fichier,
        taille_fichier: support.taille_fichier,
        fichier_url: support.fichier_url,
        video_provider: support.video_provider,
        video_id: support.video_id,
        url_thumbnail: support.url_thumbnail,
        visible_apprenants: support.visible_apprenants,
        created_at: support.created_at.toISOString(),
      };
    } catch (error) {
      // If database insert fails, try to clean up uploaded file
      // (FileStorageService should handle this, but we log it)
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get list of course materials with filters
   * T034: Course material list service
   */
  async getSupports(
    formateurId: string,
    tenantId: string,
    filters: {
      page?: number;
      limit?: number;
      formation_id?: string;
      session_id?: string;
      type_fichier?: string;
      search?: string;
    }
  ): Promise<{
    supports: Array<{
      id: string;
      titre: string;
      description?: string;
      type_fichier: string;
      taille_fichier: number;
      fichier_url: string;
      video_provider?: "local" | "vimeo" | null;
      video_id?: string | null;
      url_thumbnail?: string | null;
      formation?: {
        id: string;
        titre: string;
      };
      sessions: Array<{
        id: string;
        code_session: string;
      }>;
      visible_apprenants: boolean;
      nb_telechargements: number;
      created_at: string;
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
      const limit = filters.limit || 10;
      const offset = (page - 1) * limit;
      const sessionsTable = getTableName(tenantId, "sessions_professionnelles");
      const supportsTable = getTableName(tenantId, "supports_cours");
      const supportAssociationsTable = getTableName(tenantId, "support_session_associations");
      const supportDownloadsTable = getTableName(tenantId, "support_telechargements");
      const formationsTable = getTableName(tenantId, "formations_professionnelles");

      // Build WHERE clause
      const conditions: string[] = [
        "sc.formateur_id = $1",
        "sc.tenant_id = $2",
      ];
      const params: any[] = [formateurId, tenantId];
      let paramIndex = 3;

      // Formation filter
      if (filters.formation_id) {
        conditions.push(`sc.formation_id = $${paramIndex}`);
        params.push(filters.formation_id);
        paramIndex++;
      }

      // Session filter (via association)
      if (filters.session_id) {
        conditions.push(`EXISTS (
          SELECT 1 FROM ${getTableName(tenantId, 'support_session_associations')} ssa
          WHERE ssa.support_id = sc.id
            AND ssa.session_id = $${paramIndex}
            AND ssa.tenant_id = $2
        )`);
        params.push(filters.session_id);
        paramIndex++;
      }

      // File type filter
      if (filters.type_fichier) {
        conditions.push(`sc.type_fichier = $${paramIndex}`);
        params.push(filters.type_fichier);
        paramIndex++;
      }

      // Search filter
      if (filters.search) {
        conditions.push(`sc.titre ILIKE $${paramIndex}`);
        params.push(`%${filters.search}%`);
        paramIndex++;
      }

      const whereClause = conditions.join(" AND ");

      // Count total
      const countQuery = `
        SELECT COUNT(DISTINCT sc.id)::integer as total
        FROM ${supportsTable} sc
        WHERE ${whereClause}
      `;
      const countResult = await client.query(countQuery, params);
      const total = countResult.rows[0].total;

      // Fetch supports
      const supportsQuery = `
        SELECT 
          sc.id,
          sc.titre,
          sc.description,
          sc.type_fichier,
          sc.taille_fichier,
          sc.fichier_url,
          sc.video_provider,
          sc.video_id,
          sc.url_thumbnail,
          sc.visible_apprenants,
          sc.created_at,
          CASE 
            WHEN f.id IS NOT NULL THEN jsonb_build_object('id', f.id, 'titre', f.titre)
            ELSE NULL
          END as formation,
          (
            SELECT jsonb_agg(jsonb_build_object('id', s.id, 'code_session', s.code_session))
            FROM ${supportAssociationsTable} ssa
            INNER JOIN ${sessionsTable} s ON ssa.session_id = s.id AND ssa.tenant_id = s.tenant_id
            WHERE ssa.support_id = sc.id AND ssa.tenant_id = $2
          ) as sessions,
          (
            SELECT COUNT(*)::integer
            FROM ${supportDownloadsTable} st
            WHERE st.support_id = sc.id AND st.tenant_id = $2
          ) as nb_telechargements
        FROM ${supportsTable} sc
        LEFT JOIN ${formationsTable} f ON sc.formation_id = f.id AND sc.tenant_id = f.tenant_id
        WHERE ${whereClause}
        ORDER BY sc.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      params.push(limit, offset);
      const supportsResult = await client.query(supportsQuery, params);

      const supports = supportsResult.rows.map((row: any) => ({
        id: row.id,
        titre: row.titre,
        description: row.description,
        type_fichier: row.type_fichier,
        taille_fichier: row.taille_fichier,
        fichier_url: row.fichier_url,
        video_provider: row.video_provider,
        video_id: row.video_id,
        url_thumbnail: row.url_thumbnail,
        formation: row.formation,
        sessions: row.sessions || [],
        visible_apprenants: row.visible_apprenants,
        nb_telechargements: row.nb_telechargements || 0,
        created_at: row.created_at.toISOString(),
      }));

      return {
        supports,
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
   * Update course material metadata
   * T035: Course material update service
   */
  async updateSupport(
    supportId: string,
    updates: {
      titre?: string;
      description?: string;
      visible_apprenants?: boolean;
      session_ids?: string[];
    },
    formateurId: string,
    tenantId: string
  ): Promise<{
    id: string;
    titre: string;
    description?: string;
    type_fichier: string;
    taille_fichier: number;
    fichier_url: string;
    video_provider?: "local" | "vimeo" | null;
    video_id?: string | null;
    url_thumbnail?: string | null;
    visible_apprenants: boolean;
    created_at: string;
    updated_at?: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);
      const supportsTable = getTableName(tenantId, "supports_cours");
      const supportAssociationsTable = getTableName(tenantId, "support_session_associations");

      // Verify formateur ownership
      const ownershipQuery = `
        SELECT id FROM ${getTableName(tenantId, 'supports_cours')}
        WHERE id = $1 AND formateur_id = $2 AND tenant_id = $3
      `;
      const ownershipResult = await client.query(ownershipQuery, [supportId, formateurId, tenantId]);

      if (ownershipResult.rows.length === 0) {
        throw new Error("SUPPORT_NOT_FOUND: Course material not found or access denied");
      }

      // Build update query
      const updateFields: string[] = [];
      const updateParams: any[] = [];
      let paramIndex = 1;

      if (updates.titre !== undefined) {
        updateFields.push(`titre = $${paramIndex}`);
        updateParams.push(updates.titre);
        paramIndex++;
      }

      if (updates.description !== undefined) {
        updateFields.push(`description = $${paramIndex}`);
        updateParams.push(updates.description);
        paramIndex++;
      }

      if (updates.visible_apprenants !== undefined) {
        updateFields.push(`visible_apprenants = $${paramIndex}`);
        updateParams.push(updates.visible_apprenants);
        paramIndex++;
      }

      if (updateFields.length > 0) {
        updateFields.push(`updated_at = NOW()`);
        updateParams.push(supportId, tenantId);

        const updateQuery = `
          UPDATE ${supportsTable}
          SET ${updateFields.join(", ")}
          WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
          RETURNING id, titre, description, type_fichier, taille_fichier, fichier_url, video_provider, video_id, url_thumbnail, visible_apprenants, created_at, updated_at
        `;

        await client.query(updateQuery, updateParams);
      }

      // Update session associations if provided
      if (updates.session_ids !== undefined) {
        // Delete existing associations
        await client.query(
          `DELETE FROM ${getTableName(tenantId, 'support_session_associations')} WHERE support_id = $1 AND tenant_id = $2`,
          [supportId, tenantId]
        );

        // Create new associations
        if (updates.session_ids.length > 0) {
          const associationValues = updates.session_ids
            .map((_, index) => `($1, $2, $${index + 3})`)
            .join(", ");

          const associationParams = [
            tenantId,
            supportId,
            ...updates.session_ids,
          ];

          const associationQuery = `
            INSERT INTO ${supportAssociationsTable} (tenant_id, support_id, session_id)
            VALUES ${associationValues}
          `;

          await client.query(associationQuery, associationParams);
        }
      }

      // Fetch updated support
      const fetchQuery = `
        SELECT id, titre, description, type_fichier, taille_fichier, fichier_url, video_provider, video_id, url_thumbnail, visible_apprenants, created_at, updated_at
        FROM ${supportsTable}
        WHERE id = $1 AND tenant_id = $2
      `;
      const fetchResult = await client.query(fetchQuery, [supportId, tenantId]);

      const support = fetchResult.rows[0];

      return {
        id: support.id,
        titre: support.titre,
        description: support.description,
        type_fichier: support.type_fichier,
        taille_fichier: support.taille_fichier,
        fichier_url: support.fichier_url,
        video_provider: support.video_provider,
        video_id: support.video_id,
        url_thumbnail: support.url_thumbnail,
        visible_apprenants: support.visible_apprenants,
        created_at: support.created_at.toISOString(),
        updated_at: support.updated_at ? support.updated_at.toISOString() : undefined,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Delete course material
   * T036: Course material delete service
   */
  async deleteSupport(
    supportId: string,
    formateurId: string,
    tenantId: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);
      const supportsTable = getTableName(tenantId, "supports_cours");
      const supportAssociationsTable = getTableName(tenantId, "support_session_associations");
      const supportDownloadsTable = getTableName(tenantId, "support_telechargements");
      const sessionsTable = getTableName(tenantId, "sessions_professionnelles");

      // Verify formateur ownership and get file URL
      const ownershipQuery = `
        SELECT fichier_url FROM ${supportsTable}
        WHERE id = $1 AND formateur_id = $2 AND tenant_id = $3
      `;
      const ownershipResult = await client.query(ownershipQuery, [supportId, formateurId, tenantId]);

      if (ownershipResult.rows.length === 0) {
        throw new Error("SUPPORT_NOT_FOUND: Course material not found or access denied");
      }

      const fileUrl = ownershipResult.rows[0].fichier_url;

      // Delete session associations
      await client.query(
        `DELETE FROM ${supportAssociationsTable} WHERE support_id = $1 AND tenant_id = $2`,
        [supportId, tenantId]
      );

      // Delete download records
      await client.query(
        `DELETE FROM ${supportDownloadsTable} WHERE support_id = $1 AND tenant_id = $2`,
        [supportId, tenantId]
      );

      // Delete support record
      await client.query(
        `DELETE FROM ${supportsTable} WHERE id = $1 AND tenant_id = $2`,
        [supportId, tenantId]
      );

      // Delete file from storage (extract key from URL)
      try {
        const fileStorageService = getFileStorageService();
        // Extract key from URL like "/api/v1/files/{key}"
        const keyMatch = fileUrl.match(/\/api\/v1\/files\/(.+)/);
        if (keyMatch) {
          // Note: FileStorageService doesn't have a delete method in the interface we saw
          // We'll log this for now - file cleanup can be handled by a background job
          console.log(`File should be deleted: ${keyMatch[1]}`);
        }
      } catch (error) {
        // Log but don't fail - file cleanup can be handled separately
        console.error("Error deleting file from storage:", error);
      }
    } finally {
      client.release();
    }
  }

  /**
   * Get download statistics for a course material
   * T037: Download statistics service
   */
  async getSupportStatistics(
    supportId: string,
    formateurId: string,
    tenantId: string
  ): Promise<{
    nb_telechargements: number;
    dernier_telechargement?: string;
    telechargements_par_session: Array<{
      session_code: string;
      nb_telechargements: number;
    }>;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);
      const supportsTable = getTableName(tenantId, "supports_cours");
      const supportAssociationsTable = getTableName(tenantId, "support_session_associations");
      const supportDownloadsTable = getTableName(tenantId, "support_telechargements");
      const sessionsTable = getTableName(tenantId, "sessions_professionnelles");

      // Verify formateur ownership
      const ownershipQuery = `
        SELECT id FROM ${supportsTable}
        WHERE id = $1 AND formateur_id = $2 AND tenant_id = $3
      `;
      const ownershipResult = await client.query(ownershipQuery, [supportId, formateurId, tenantId]);

      if (ownershipResult.rows.length === 0) {
        throw new Error("SUPPORT_NOT_FOUND: Course material not found or access denied");
      }

      // Get statistics
      const statsQuery = `
        SELECT 
          COUNT(*)::integer as nb_telechargements,
          MAX(st.created_at) as dernier_telechargement
        FROM ${supportDownloadsTable} st
        WHERE st.support_id = $1 AND st.tenant_id = $2
      `;
      const statsResult = await client.query(statsQuery, [supportId, tenantId]);
      const stats = statsResult.rows[0];

      // Get downloads by session
      const sessionStatsQuery = `
        SELECT 
          s.code_session as session_code,
          COUNT(*)::integer as nb_telechargements
        FROM ${supportDownloadsTable} st
        INNER JOIN ${supportAssociationsTable} ssa ON st.support_id = ssa.support_id AND st.tenant_id = ssa.tenant_id
        INNER JOIN ${sessionsTable} s ON ssa.session_id = s.id AND ssa.tenant_id = s.tenant_id
        WHERE st.support_id = $1 AND st.tenant_id = $2
        GROUP BY s.code_session
        ORDER BY nb_telechargements DESC
      `;
      const sessionStatsResult = await client.query(sessionStatsQuery, [supportId, tenantId]);

      return {
        nb_telechargements: stats.nb_telechargements || 0,
        dernier_telechargement: stats.dernier_telechargement
          ? stats.dernier_telechargement.toISOString()
          : undefined,
        telechargements_par_session: sessionStatsResult.rows.map((row: any) => ({
          session_code: row.session_code,
          nb_telechargements: row.nb_telechargements,
        })),
      };
    } finally {
      client.release();
    }
  }
}
