import { Pool, PoolClient } from "pg";

/**
 * Socle commun des services du Module Professionnel (feature 028).
 * Fournit le contexte tenant (RLS) et l'enveloppe de réponse partagée.
 */

export interface ServiceSuccess<T> {
  success: true;
  data: T;
}

export interface ServiceFailure {
  success: false;
  error: string;
  message: string;
}

export type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure;

/** Enveloppe de succès — `{ success: true, data }`. */
export function ok<T>(data: T): ServiceSuccess<T> {
  return { success: true, data };
}

/** Enveloppe d'erreur — `{ success: false, error, message }`. */
export function fail(error: string, message: string): ServiceFailure {
  return { success: false, error, message };
}

/**
 * Classe de base des services professionnels. Les services concrets
 * (catalogue, inscription, paiement) en héritent.
 */
export abstract class ProfessionalBaseService {
  constructor(protected readonly pool: Pool) {}

  /**
   * Exécute `fn` sur une connexion dont le contexte tenant (GUC `app.tenant_id`)
   * est positionné — l'isolation RLS s'applique à toutes les requêtes de `fn`.
   */
  protected async withTenant<T>(
    tenantId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /**
   * Variante transactionnelle de `withTenant` : `fn` s'exécute dans une
   * transaction (BEGIN/COMMIT, ROLLBACK en cas d'erreur).
   */
  protected async withTenantTx<T>(
    tenantId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    return this.withTenant(tenantId, async (client) => {
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }
}
