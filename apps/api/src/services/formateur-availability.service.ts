/**
 * FormateurAvailabilityService
 * 
 * Business logic for trainer availability checking
 * Validates trainer scheduling conflicts before session creation/updates
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from "pg";
import { getTableName } from '../utils/table-names';

export interface TrainerAvailability {
  formateur_id: string;
  disponible: boolean;
  conflits?: Array<{
    session_id: string;
    code_session: string;
    formation: string;
    date_debut: string;
    date_fin: string;
  }>;
}

export class FormateurAvailabilityService {
  constructor(private pool: Pool) {}

  /**
   * Set tenant context for RLS policies
   * Must be called before any database query
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Check trainer availability for a given date range
   * Returns availability status and conflicts for each trainer
   * Excludes cancelled and completed sessions from conflict detection
   */
  async checkFormateursDisponibilite(
    tenantId: string,
    dateDebut: string, // YYYY-MM-DD
    dateFin: string, // YYYY-MM-DD
    formateurIds: string[],
    excludeSessionId?: string // Optional: exclude this session when checking (for updates)
  ): Promise<TrainerAvailability[]> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const results: TrainerAvailability[] = [];

      for (const formateurId of formateurIds) {
        // Check for conflicting sessions
        let conflictQuery = `
          SELECT 
            s.id as session_id,
            s.code_session,
            s.date_debut,
            s.date_fin,
            f.titre as formation
          FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
          INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf ON sf.session_id = s.id AND sf.tenant_id = s.tenant_id
          INNER JOIN ${getTableName(tenantId, 'formations_professionnelles')} f ON f.id = s.formation_pro_id
          WHERE sf.formateur_id = $1
            AND s.tenant_id = $2
            AND s.statut NOT IN ('annulee', 'terminee')
            AND (
              (s.date_debut <= $4::date AND s.date_fin >= $3::date)
            )
        `;

        const params: any[] = [formateurId, tenantId, dateDebut, dateFin];
        if (excludeSessionId) {
          conflictQuery += ` AND s.id != $5`;
          params.push(excludeSessionId);
        }

        const conflictResult = await client.query(conflictQuery, params);

        const conflits = conflictResult.rows.map((row) => ({
          session_id: row.session_id,
          code_session: row.code_session,
          formation: row.formation,
          date_debut: row.date_debut.toISOString().split("T")[0],
          date_fin: row.date_fin.toISOString().split("T")[0],
        }));

        // Get trainer name for response
        const trainerQuery = `
          SELECT nom, prenom
          FROM ${getTableName(tenantId, 'formateurs')}
          WHERE id = $1 AND tenant_id = $2
        `;
        const trainerResult = await client.query(trainerQuery, [formateurId, tenantId]);

        results.push({
          formateur_id: formateurId,
          disponible: conflits.length === 0,
          conflits: conflits.length > 0 ? conflits : undefined,
        });
      }

      return results;
    } finally {
      client.release();
    }
  }

  /**
   * T106: Get availability status for all or specific trainers
   * Returns availability status and conflicts for each trainer
   */
  async getFormateursDisponibilites(
    tenantId: string,
    dateDebut: string,
    dateFin: string,
    formateurIds?: string[]
  ): Promise<Array<{
    id: string;
    nom: string;
    prenom: string;
    disponible: boolean;
    conflits?: Array<{
      session_id: string;
      code_session: string;
      formation: string;
      date_debut: string;
      date_fin: string;
    }>;
  }>> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get trainers to check (all if not specified)
      let trainersQuery = `
        SELECT id, nom, prenom
        FROM ${getTableName(tenantId, 'formateurs')}
        WHERE tenant_id = $1 AND actif = true
      `;
      const queryParams: any[] = [tenantId];

      if (formateurIds && formateurIds.length > 0) {
        trainersQuery += ` AND id = ANY($2::uuid[])`;
        queryParams.push(formateurIds);
      }

      const trainersResult = await client.query(trainersQuery, queryParams);
      const trainers = trainersResult.rows;

      // Check availability for each trainer
      const results: Array<{
        id: string;
        nom: string;
        prenom: string;
        disponible: boolean;
        conflits?: Array<{
          session_id: string;
          code_session: string;
          formation: string;
          date_debut: string;
          date_fin: string;
        }>;
      }> = [];

      for (const trainer of trainers) {
        const availability = await this.checkFormateursDisponibilite(
          tenantId,
          dateDebut,
          dateFin,
          [trainer.id]
        );

        if (availability.length > 0) {
          const avail = availability[0];
          results.push({
            id: trainer.id,
            nom: trainer.nom,
            prenom: trainer.prenom,
            disponible: avail.disponible,
            conflits: avail.conflits,
          });
        }
      }

      return results;
    } finally {
      client.release();
    }
  }
}

