/**
 * CodePromoService
 * 
 * Business logic for promotional code validation and discount calculation.
 * Handles code validation, discount calculation, and usage tracking.
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from 'pg';
import { PromoCodeValidationRequest, PromoCodeValidationResponse } from '@ecoledigitale/contracts/src/codes-promo';

export interface PromoCode {
  id: string;
  code: string;
  type_reduction: 'pourcentage' | 'montant_fixe';
  valeur_reduction: number;
  description: string | null;
  date_debut: Date;
  date_fin: Date;
  utilisations_max: number | null;
  utilisations_actuelles: number;
  formations_applicables: string[] | null;
  actif: boolean;
}

export class CodePromoService {
  constructor(private pool: Pool) {}

  /**
   * Set tenant context for RLS policies
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Validate promotional code
   * @param client Optional database client (for transactions). If not provided, creates a new connection.
   */
  async validateCode(
    tenantId: string,
    request: PromoCodeValidationRequest,
    client?: any
  ): Promise<PromoCodeValidationResponse> {
    const shouldRelease = !client;
    if (!client) {
      client = await this.pool.connect();
    }
    try {
      await this.setTenantContext(client, tenantId);

      const codeUpper = request.code.toUpperCase().trim();

      // Query promotional code
      const query = `
        SELECT 
          id, code, type_reduction, valeur_reduction, description,
          date_debut, date_fin, utilisations_max, utilisations_actuelles,
          formations_applicables, actif
        FROM codes_promo
        WHERE code = $1
          AND tenant_id = $2
      `;

      const result = await client.query(query, [codeUpper, tenantId]);

      if (result.rows.length === 0) {
        return {
          valide: false,
          code_promo: null,
          reduction_montant: 0,
          nouveau_montant: request.montant,
          message: 'Code promotionnel invalide ou introuvable',
        };
      }

      const promoCode = result.rows[0];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check if code is active
      if (!promoCode.actif) {
        return {
          valide: false,
          code_promo: null,
          reduction_montant: 0,
          nouveau_montant: request.montant,
          message: 'Ce code promotionnel n\'est plus actif',
        };
      }

      // Check date validity
      const dateDebut = new Date(promoCode.date_debut);
      const dateFin = new Date(promoCode.date_fin);
      dateDebut.setHours(0, 0, 0, 0);
      dateFin.setHours(23, 59, 59, 999);

      if (today < dateDebut) {
        return {
          valide: false,
          code_promo: null,
          reduction_montant: 0,
          nouveau_montant: request.montant,
          message: `Ce code promotionnel n'est pas encore valide (valide à partir du ${dateDebut.toLocaleDateString('fr-FR')})`,
        };
      }

      if (today > dateFin) {
        return {
          valide: false,
          code_promo: null,
          reduction_montant: 0,
          nouveau_montant: request.montant,
          message: `Ce code promotionnel a expiré (expiré le ${dateFin.toLocaleDateString('fr-FR')})`,
        };
      }

      // Check usage limits
      if (promoCode.utilisations_max !== null && promoCode.utilisations_actuelles >= promoCode.utilisations_max) {
        return {
          valide: false,
          code_promo: null,
          reduction_montant: 0,
          nouveau_montant: request.montant,
          message: 'Ce code promotionnel a atteint sa limite d\'utilisation',
        };
      }

      // Check training applicability
      if (promoCode.formations_applicables !== null && Array.isArray(promoCode.formations_applicables)) {
        const formationId = request.formation_id || request.session_id; // Can use session_id to get formation_id
        if (formationId && !promoCode.formations_applicables.includes(formationId)) {
          return {
            valide: false,
            code_promo: null,
            reduction_montant: 0,
            nouveau_montant: request.montant,
            message: 'Ce code promotionnel n\'est pas applicable à cette formation',
          };
        }
      }

      // Calculate discount
      const discount = this.calculateDiscount(
        request.montant,
        promoCode.type_reduction,
        promoCode.valeur_reduction
      );

      return {
        valide: true,
        code_promo: {
          id: promoCode.id,
          code: promoCode.code,
          type_reduction: promoCode.type_reduction,
          valeur_reduction: promoCode.valeur_reduction,
          description: promoCode.description,
        },
        reduction_montant: discount,
        nouveau_montant: request.montant - discount,
        message: `Code promotionnel appliqué avec succès! Réduction de ${discount.toFixed(2)} FCFA`,
      };
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  }

  /**
   * Calculate discount amount
   */
  calculateDiscount(
    amount: number,
    type: 'pourcentage' | 'montant_fixe',
    value: number
  ): number {
    if (type === 'pourcentage') {
      const discount = (amount * value) / 100;
      // Ensure discount doesn't exceed amount
      return Math.min(discount, amount);
    } else {
      // Fixed amount - ensure discount doesn't exceed amount
      return Math.min(value, amount);
    }
  }

  /**
   * Increment usage count for a promotional code
   * @param client Optional database client (for transactions). If not provided, creates a new connection.
   */
  async incrementUsage(tenantId: string, codeId: string, client?: any): Promise<void> {
    const shouldRelease = !client;
    if (!client) {
      client = await this.pool.connect();
    }
    try {
      await this.setTenantContext(client, tenantId);

      const query = `
        UPDATE codes_promo
        SET utilisations_actuelles = utilisations_actuelles + 1,
            updated_at = NOW()
        WHERE id = $1
          AND tenant_id = $2
      `;

      await client.query(query, [codeId, tenantId]);
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  }

  /**
   * Get promotional code by ID (for validation after enrollment creation)
   */
  async getPromoCodeById(tenantId: string, codeId: string): Promise<PromoCode | null> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const query = `
        SELECT 
          id, code, type_reduction, valeur_reduction, description,
          date_debut, date_fin, utilisations_max, utilisations_actuelles,
          formations_applicables, actif
        FROM codes_promo
        WHERE id = $1
          AND tenant_id = $2
      `;

      const result = await client.query(query, [codeId, tenantId]);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } finally {
      client.release();
    }
  }
}

