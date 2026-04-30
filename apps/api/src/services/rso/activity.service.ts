/**
 * RSO Activity Service
 * Handles RSO security activities (full CRUD implementation)
 */

import { FastifyInstance } from 'fastify';

export interface RSOActivity {
  id: number;
  tenantId: string;
  installationId: number;
  type: string; // e.g., 'inspection', 'drill', 'incident', 'maintenance'
  titre: string;
  description: string;
  dateActivite: Date;
  statut: string; // e.g., 'planifie', 'en_cours', 'termine', 'annule'
  createdBy?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RSOActivityFilters {
  installationId?: number;
  year?: number;
  type?: string;
  statut?: string;
  page?: number;
  limit?: number;
}

export interface CreateRSOActivityRequest {
  installationId: number;
  type: string;
  titre: string;
  description?: string;
  dateActivite: Date | string;
  statut?: string;
}

export interface UpdateRSOActivityRequest {
  installationId?: number;
  type?: string;
  titre?: string;
  description?: string;
  dateActivite?: Date | string;
  statut?: string;
}

export interface RSOActivityListResponse {
  activities: RSOActivity[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * List activities with filters
 */
export async function listActivities(
  fastify: FastifyInstance,
  tenantId: string,
  filters: RSOActivityFilters,
  userInstallationId?: number
): Promise<RSOActivityListResponse> {
  const client = await fastify.pg.connect();
  try {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    // Build WHERE clause
    const conditions: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    let paramIndex = 2;

    // Enforce installation restriction for PFSO agents
    const installationId = userInstallationId || filters.installationId;
    if (installationId) {
      conditions.push(`installation_id = $${paramIndex}`);
      params.push(installationId);
      paramIndex++;
    }

    // Filter by year (extract year from date_activite)
    if (filters.year) {
      conditions.push(`EXTRACT(YEAR FROM date_activite) = $${paramIndex}`);
      params.push(filters.year);
      paramIndex++;
    }

    // Filter by type
    if (filters.type) {
      conditions.push(`type = $${paramIndex}`);
      params.push(filters.type);
      paramIndex++;
    }

    // Filter by statut
    if (filters.statut) {
      conditions.push(`statut = $${paramIndex}`);
      params.push(filters.statut);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM rso_activities WHERE ${whereClause}`;
    const countResult = await client.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Get activities
    const query = `
      SELECT 
        id, tenant_id, installation_id, type, titre, description,
        date_activite, statut, created_by, created_at, updated_at
      FROM rso_activities
      WHERE ${whereClause}
      ORDER BY date_activite DESC, created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const result = await client.query(query, params);

    const activities: RSOActivity[] = result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      installationId: row.installation_id,
      type: row.type,
      titre: row.titre,
      description: row.description || '',
      dateActivite: row.date_activite,
      statut: row.statut,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return {
      activities,
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
 * Get activity by ID
 */
export async function getActivityById(
  fastify: FastifyInstance,
  tenantId: string,
  activityId: number,
  userInstallationId?: number
): Promise<RSOActivity | null> {
  const client = await fastify.pg.connect();
  try {
    let query = `
      SELECT 
        id, tenant_id, installation_id, type, titre, description,
        date_activite, statut, created_by, created_at, updated_at
      FROM rso_activities
      WHERE id = $1 AND tenant_id = $2
    `;
    const params: any[] = [activityId, tenantId];

    // Enforce installation restriction for PFSO agents
    if (userInstallationId) {
      query += ' AND installation_id = $3';
      params.push(userInstallationId);
    }

    const result = await client.query(query, params);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      installationId: row.installation_id,
      type: row.type,
      titre: row.titre,
      description: row.description || '',
      dateActivite: row.date_activite,
      statut: row.statut,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } finally {
    client.release();
  }
}

/**
 * Create a new activity
 */
export async function createActivity(
  fastify: FastifyInstance,
  tenantId: string,
  activityData: CreateRSOActivityRequest,
  createdBy: number
): Promise<RSOActivity> {
  const client = await fastify.pg.connect();
  try {
    // Set tenant context for RLS
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    
    // Normalize date - convert string to Date if needed, or use as-is if already Date
    let dateValue: Date | string = activityData.dateActivite;
    if (typeof dateValue === 'string') {
      // If it's an ISO string, parse it to ensure it's valid
      dateValue = new Date(dateValue);
      if (isNaN(dateValue.getTime())) {
        throw new Error('Format de date invalide');
      }
    }
    
    const result = await client.query(
      `INSERT INTO rso_activities 
       (tenant_id, installation_id, type, titre, description, date_activite, statut, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tenant_id, installation_id, type, titre, description,
                 date_activite, statut, created_by, created_at, updated_at`,
      [
        tenantId,
        activityData.installationId,
        activityData.type,
        activityData.titre.trim(),
        activityData.description?.trim() || null,
        dateValue,
        activityData.statut || 'planifie',
        createdBy,
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      installationId: row.installation_id,
      type: row.type,
      titre: row.titre,
      description: row.description || '',
      dateActivite: row.date_activite,
      statut: row.statut,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error: any) {
    console.error('[createActivity] Error creating activity:', error);
    console.error('[createActivity] Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      position: error.position,
      activityData,
      tenantId,
    });
    
    // Provide more specific error messages
    if (error.code === '23503') {
      throw new Error('L\'installation spécifiée n\'existe pas ou n\'appartient pas à votre tenant');
    } else if (error.code === '23505') {
      throw new Error('Une activité similaire existe déjà');
    } else if (error.message) {
      throw error;
    } else {
      throw new Error(`Erreur lors de la création de l'activité: ${error.message || 'Erreur inconnue'}`);
    }
  } finally {
    client.release();
  }
}

/**
 * Update an existing activity
 */
export async function updateActivity(
  fastify: FastifyInstance,
  tenantId: string,
  activityId: number,
  activityData: UpdateRSOActivityRequest,
  userInstallationId?: number
): Promise<RSOActivity | null> {
  const client = await fastify.pg.connect();
  try {
    // First, check if activity exists and user has access
    const existing = await getActivityById(fastify, tenantId, activityId, userInstallationId);
    if (!existing) {
      return null;
    }

    // Build UPDATE query dynamically
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (activityData.installationId !== undefined) {
      updates.push(`installation_id = $${paramIndex}`);
      params.push(activityData.installationId);
      paramIndex++;
    }
    if (activityData.type !== undefined) {
      updates.push(`type = $${paramIndex}`);
      params.push(activityData.type.trim());
      paramIndex++;
    }
    if (activityData.titre !== undefined) {
      updates.push(`titre = $${paramIndex}`);
      params.push(activityData.titre.trim());
      paramIndex++;
    }
    if (activityData.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(activityData.description.trim() || null);
      paramIndex++;
    }
    if (activityData.dateActivite !== undefined) {
      updates.push(`date_activite = $${paramIndex}`);
      params.push(activityData.dateActivite);
      paramIndex++;
    }
    if (activityData.statut !== undefined) {
      updates.push(`statut = $${paramIndex}`);
      params.push(activityData.statut);
      paramIndex++;
    }

    if (updates.length === 0) {
      // No updates, return existing
      return existing;
    }

    params.push(activityId, tenantId);
    const query = `
      UPDATE rso_activities
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
      RETURNING id, tenant_id, installation_id, type, titre, description,
                date_activite, statut, created_by, created_at, updated_at
    `;

    const result = await client.query(query, params);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      installationId: row.installation_id,
      type: row.type,
      titre: row.titre,
      description: row.description || '',
      dateActivite: row.date_activite,
      statut: row.statut,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } finally {
    client.release();
  }
}

/**
 * Delete an activity
 */
export async function deleteActivity(
  fastify: FastifyInstance,
  tenantId: string,
  activityId: number,
  userInstallationId?: number
): Promise<boolean> {
  const client = await fastify.pg.connect();
  try {
    // First, check if activity exists and user has access
    const existing = await getActivityById(fastify, tenantId, activityId, userInstallationId);
    if (!existing) {
      return false;
    }

    let query = 'DELETE FROM rso_activities WHERE id = $1 AND tenant_id = $2';
    const params: any[] = [activityId, tenantId];

    // Enforce installation restriction for PFSO agents
    if (userInstallationId) {
      query += ' AND installation_id = $3';
      params.push(userInstallationId);
    }

    const result = await client.query(query, params);
    return result.rowCount > 0;
  } finally {
    client.release();
  }
}

/**
 * Get activity types (for dropdown)
 */
export function getActivityTypes(): string[] {
  return [
    'inspection',
    'drill',
    'incident',
    'maintenance',
    'audit',
    'training',
  ];
}

