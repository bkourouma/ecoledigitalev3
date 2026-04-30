/**
 * Reservation Cleanup Job
 * 
 * Background job that runs periodically to clean up expired temporary reservations.
 * This job:
 * - Finds expired reservations (expire_at < NOW())
 * - Cancels associated enrollments if no payment was made
 * - Releases reserved places in sessions
 * - Deletes expired reservation records
 * 
 * Should be scheduled to run every 5 minutes via cron or task scheduler.
 */

import { Pool } from 'pg';

export interface ReservationCleanupConfig {
  dbPool: Pool;
  runIntervalMinutes?: number; // Default: 5 minutes
}

export class ReservationCleanupJob {
  private dbPool: Pool;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(config: ReservationCleanupConfig) {
    this.dbPool = config.dbPool;
  }

  /**
   * Start the cleanup job with scheduled intervals
   */
  start(intervalMinutes: number = 5): void {
    if (this.intervalId) {
      console.log('Reservation cleanup job is already running');
      return;
    }

    console.log(`Starting reservation cleanup job (runs every ${intervalMinutes} minutes)`);

    // Run immediately on start
    this.runCleanup().catch((error) => {
      console.error('Error in initial reservation cleanup run:', error);
    });

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.runCleanup().catch((error) => {
        console.error('Error in scheduled reservation cleanup:', error);
      });
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop the cleanup job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Reservation cleanup job stopped');
    }
  }

  /**
   * Run cleanup process once
   */
  async runCleanup(): Promise<void> {
    if (this.isRunning) {
      console.log('Reservation cleanup already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      console.log('Starting reservation cleanup...');

      const client = await this.dbPool.connect();

      try {
        // Check if the table exists before proceeding
        const tableCheckQuery = `
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'reservations_temporaires'
          );
        `;
        
        const tableExistsResult = await client.query(tableCheckQuery);
        const tableExists = tableExistsResult.rows[0]?.exists;

        if (!tableExists) {
          console.log('⚠️  Table reservations_temporaires does not exist. Skipping cleanup. Please run migration: pnpm migrate:reservations-temporaires');
          return;
        }

        const sessionColResult = await client.query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'inscriptions_professionnelles'
              AND column_name = 'session_id'
          ) AS has_session_id;
        `);
        const hasInscriptionSessionId = Boolean(sessionColResult.rows[0]?.has_session_id);

        await client.query('BEGIN');

        // Find expired reservations with no validated payment
        const expiredReservationsQuery = hasInscriptionSessionId
          ? `
          SELECT 
            r.id as reservation_id,
            r.inscription_id,
            r.tenant_id,
            i.statut as inscription_statut,
            i.session_id,
            i.formation_pro_id
          FROM reservations_temporaires r
          JOIN inscriptions_professionnelles i ON r.inscription_id = i.id
          LEFT JOIN paiements_professionnels p ON p.inscription_id = i.id AND p.statut = 'valide'
          WHERE r.expire_at < NOW()
            AND i.statut = 'en_attente'
            AND p.id IS NULL
        `
          : `
          SELECT 
            r.id as reservation_id,
            r.inscription_id,
            r.tenant_id,
            i.statut as inscription_statut,
            NULL::uuid AS session_id,
            i.formation_pro_id
          FROM reservations_temporaires r
          JOIN inscriptions_professionnelles i ON r.inscription_id = i.id
          LEFT JOIN paiements_professionnels p ON p.inscription_id = i.id AND p.statut = 'valide'
          WHERE r.expire_at < NOW()
            AND i.statut = 'en_attente'
            AND p.id IS NULL
        `;

        const expiredResult = await client.query(expiredReservationsQuery);
        const expiredReservations = expiredResult.rows;

        if (expiredReservations.length === 0) {
          console.log('No expired reservations to clean up');
          await client.query('COMMIT');
          return;
        }

        console.log(`Found ${expiredReservations.length} expired reservation(s) to clean up`);

        // Process each expired reservation
        for (const reservation of expiredReservations) {
          const { reservation_id, inscription_id, tenant_id, session_id } = reservation;

          // Set tenant context for RLS (set_config accepts parameters; SET LOCAL does not)
          await client.query("SELECT set_config('app.tenant_id', $1::text, true)", [String(tenant_id)]);

          // Cancel the enrollment
          await client.query(
            `UPDATE inscriptions_professionnelles 
             SET statut = 'annulee', updated_at = NOW()
             WHERE id = $1`,
            [inscription_id]
          );

          // Libérer une place session (ASPCI / schéma avec sessions uniquement)
          if (session_id) {
            try {
              await client.query(
                `UPDATE sessions_professionnelles
                 SET places_reservees = GREATEST(places_reservees - 1, 0),
                     updated_at = NOW()
                 WHERE id = $1`,
                [session_id]
              );
            } catch (e) {
              console.warn("[reservation-cleanup] Skip session seat release:", e);
            }
          }

          // Delete the expired reservation
          await client.query(
            `DELETE FROM reservations_temporaires WHERE id = $1`,
            [reservation_id]
          );

          console.log(`Cleaned up reservation ${reservation_id} for enrollment ${inscription_id}`);
        }

        await client.query('COMMIT');
        const duration = Date.now() - startTime;
        console.log(`Reservation cleanup completed in ${duration}ms. Processed ${expiredReservations.length} reservation(s)`);
      } catch (error) {
        if (client.query) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            // Ignore rollback errors
          }
        }
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error during reservation cleanup:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Manual cleanup trigger (for testing or one-off runs)
   */
  async runOnce(): Promise<void> {
    await this.runCleanup();
  }
}

// Export function to initialize and start the job
export function initializeReservationCleanupJob(dbPool: Pool, intervalMinutes: number = 5): ReservationCleanupJob {
  const job = new ReservationCleanupJob({ dbPool });
  job.start(intervalMinutes);
  return job;
}

