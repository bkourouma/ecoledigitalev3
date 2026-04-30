/**
 * InscriptionProService
 * 
 * Business logic for professional training enrollment management.
 * Handles enrollment creation, availability checking, temporary reservations,
 * and user account auto-creation for new participants.
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { IndividualEnrollmentRequest, CompanyEnrollmentRequest } from '@ecoledigitale/contracts/src/inscriptions-pro';
import { emailService } from './email.service';
import { CodePromoService } from './code-promo.service';
import { getTableName, usesSessionBasedProfessionalTraining } from '../utils/table-names';

export interface SessionAvailability {
  disponible: boolean;
  places_restantes: number;
  message: string;
  session: {
    id: string;
    code_session: string;
    date_debut: Date;
    date_fin: Date;
    places_totales: number;
    places_reservees: number;
    places_disponibles: number;
    statut: string;
  };
}

export interface CreatedEnrollment {
  id: string;
  numero_inscription: string;
  session_id?: string;
  formation_pro_id?: string;
  apprenant_id: string;
  entreprise_id: string | null;
  type_inscription: 'individuelle' | 'entreprise';
  statut: 'en_attente' | 'confirmee' | 'annulee' | 'terminee';
  montant_ht: number;
  montant_ttc: number;
  code_promo_utilise: string | null;
  reduction_appliquee: number;
  date_inscription: Date;
  facture_numero: string | null;
  facture_url: string | null;
}

export class InscriptionProService {
  private codePromoService: CodePromoService;

  constructor(private pool: Pool) {
    this.codePromoService = new CodePromoService(pool);
  }

  /**
   * Set tenant context for RLS policies
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Check session or catalogue formation availability
   */
  async checkDisponibilite(
    tenantId: string,
    params: { session_id?: string; formation_pro_id?: string }
  ): Promise<SessionAvailability & { formation?: { id: string; titre: string; slug: string; prix_ttc: number; actif: boolean } }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      if (params.formation_pro_id && !usesSessionBasedProfessionalTraining(tenantId)) {
        const fq = `
          SELECT id, titre, slug, prix_ttc, actif
          FROM ${getTableName(tenantId, 'formations_professionnelles')}
          WHERE id = $1 AND tenant_id = $2
        `;
        const fr = await client.query(fq, [params.formation_pro_id, tenantId]);
        if (fr.rows.length === 0) {
          throw new Error('Formation not found');
        }
        const f = fr.rows[0];
        const disponible = f.actif === true;
        const formation = {
          id: f.id,
          titre: f.titre,
          slug: f.slug,
          prix_ttc: parseFloat(f.prix_ttc),
          actif: f.actif,
        };
        return {
          disponible,
          places_restantes: disponible ? 1 : 0,
          message: disponible
            ? 'Formation disponible à l’achat'
            : 'Cette formation n’est pas disponible pour le moment',
          session: undefined as any,
          formation,
        };
      }

      const sessionId = params.session_id;
      if (!sessionId) {
        throw new Error('Session not found');
      }

      const query = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          s.statut
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        WHERE s.id = $1
          AND s.tenant_id = $2
      `;

      const result = await client.query(query, [sessionId, tenantId]);

      if (result.rows.length === 0) {
        throw new Error('Session not found');
      }

      const session = result.rows[0];
      const disponible = session.places_disponibles > 0 && session.statut === 'ouverte';
      const places_restantes = Math.max(0, session.places_disponibles);

      let message = '';
      if (!disponible) {
        if (session.statut !== 'ouverte') {
          message = `La session n'est pas ouverte aux inscriptions (statut: ${session.statut})`;
        } else if (session.places_disponibles <= 0) {
          message = 'La session est complète, plus de places disponibles';
        }
      } else {
        message = `${places_restantes} place(s) disponible(s)`;
      }

      return {
        disponible,
        places_restantes,
        message,
        session: {
          id: session.id,
          code_session: session.code_session,
          date_debut: session.date_debut,
          date_fin: session.date_fin,
          places_totales: session.places_totales,
          places_reservees: session.places_reservees,
          places_disponibles: session.places_disponibles,
          statut: session.statut,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Create or find user account for enrollment
   */
  async createApprenantAccount(
    tenantId: string,
    apprenantData: {
      civilite?: string;
      nom: string;
      prenom: string;
      email: string;
      telephone: string;
      poste?: string;
    }
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Check if user already exists
      const existingUserQuery = `
        SELECT id FROM users
        WHERE tenant_id = $1 AND email = $2
      `;
      const existingResult = await client.query(existingUserQuery, [tenantId, apprenantData.email]);

      if (existingResult.rows.length > 0) {
        return existingResult.rows[0].id;
      }

      // Generate temporary password
      const tempPassword = this.generateTemporaryPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      // Create user
      const fullName = `${apprenantData.prenom} ${apprenantData.nom}`;
      const createUserQuery = `
        INSERT INTO users (
          tenant_id, email, name, first_name, last_name, password_hash, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING id
      `;

      const userResult = await client.query(createUserQuery, [
        tenantId,
        apprenantData.email,
        fullName,
        apprenantData.prenom,
        apprenantData.nom,
        passwordHash,
      ]);

      const userId = userResult.rows[0].id;

      // Send account creation email with temporary password
      try {
        await emailService.sendEmail({
          to: apprenantData.email,
          subject: 'Compte créé - EcoleDigitale',
          html: `
            <h2>Votre compte a été créé</h2>
            <p>Bonjour ${apprenantData.prenom},</p>
            <p>Un compte a été créé pour vous sur la plateforme EcoleDigitale.</p>
            <p><strong>Email:</strong> ${apprenantData.email}</p>
            <p><strong>Mot de passe temporaire:</strong> ${tempPassword}</p>
            <p>Veuillez changer votre mot de passe lors de votre première connexion.</p>
            <p>Cordialement,<br>L'équipe EcoleDigitale</p>
          `,
        });
      } catch (emailError) {
        console.error('Failed to send account creation email:', emailError);
        // Don't fail enrollment if email fails
      }

      return userId;
    } finally {
      client.release();
    }
  }

  /**
   * Generate temporary password for new user accounts
   */
  private generateTemporaryPassword(): string {
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
  }

  /**
   * Generate enrollment number using database function or fallback to manual generation
   */
  async generateEnrollmentNumber(tenantId: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Try to use database function first
      try {
        const result = await client.query('SELECT generate_enrollment_number($1) as numero', [tenantId]);
        return result.rows[0].numero;
      } catch (dbError: any) {
        // If function doesn't exist, generate manually
        if (dbError?.message?.includes('n\'existe pas') || 
            dbError?.message?.includes('does not exist') ||
            dbError?.code === '42883') {
          console.warn('generate_enrollment_number function does not exist, using manual generation');
          
          // Manual generation: INS-DATA-YYYYMMDD-XXX
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, '0');
          const day = String(today.getDate()).padStart(2, '0');
          const prefix = `INS-DATA-${year}${month}${day}-`;
          
          // Get the highest number for today
          const countQuery = `
            SELECT COALESCE(MAX(CAST(SUBSTRING(numero_inscription FROM LENGTH($1) + 1) AS INTEGER)), 0) + 1 as next_num
            FROM inscriptions_professionnelles
            WHERE tenant_id = $2
              AND numero_inscription LIKE $1 || '%'
          `;
          const countResult = await client.query(countQuery, [prefix, tenantId]);
          const nextNum = countResult.rows[0].next_num;
          
          return `${prefix}${String(nextNum).padStart(3, '0')}`;
        } else {
          throw dbError;
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Create temporary reservation (15 minutes)
   * @param client - Optional database client (if provided, uses existing transaction)
   */
  async createTemporaryReservation(
    tenantId: string,
    inscriptionId: string,
    ref: { sessionId?: string; formationProId?: string },
    client?: any
  ): Promise<Date> {
    const shouldRelease = !client;
    if (!client) {
      client = await this.pool.connect();
    }
    
    try {
      await this.setTenantContext(client, tenantId);

      const expireAt = new Date();
      expireAt.setMinutes(expireAt.getMinutes() + 15);

      if (usesSessionBasedProfessionalTraining(tenantId)) {
        if (!ref.sessionId) {
          throw new Error('sessionId required for reservation');
        }
        const query = `
          INSERT INTO ${getTableName(tenantId, 'reservations_temporaires')} (
            tenant_id, inscription_id, session_id, expire_at, created_at
          )
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING expire_at
        `;
        const result = await client.query(query, [tenantId, inscriptionId, ref.sessionId, expireAt]);
        return result.rows[0].expire_at;
      }

      if (!ref.formationProId) {
        throw new Error('formationProId required for reservation');
      }
      const query = `
        INSERT INTO ${getTableName(tenantId, 'reservations_temporaires')} (
          tenant_id, inscription_id, formation_pro_id, expire_at, created_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING expire_at
      `;
      const result = await client.query(query, [tenantId, inscriptionId, ref.formationProId, expireAt]);
      return result.rows[0].expire_at;
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  }

  /**
   * Inscription individuelle sur le catalogue (sans session) — tenant Imhotep / tables base
   */
  private async createCatalogIndividualEnrollment(
    tenantId: string,
    request: IndividualEnrollmentRequest
  ): Promise<CreatedEnrollment> {
    const formationId = request.formation_pro_id;
    if (!formationId) {
      throw new Error('formation_pro_id is required');
    }

    const client = await this.pool.connect();
    const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');
    const formationsTable = getTableName(tenantId, 'formations_professionnelles');

    try {
      await client.query('BEGIN');
      await this.setTenantContext(client, tenantId);

      const lockFormation = await client.query(
        `SELECT * FROM ${formationsTable} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [formationId, tenantId]
      );
      if (lockFormation.rows.length === 0) {
        throw new Error('Formation not found');
      }
      const formationRow = lockFormation.rows[0];
      if (!formationRow.actif) {
        throw new Error('Cette formation n’est pas disponible pour le moment');
      }

      let montantHT = parseFloat(formationRow.prix_ht) || 0;
      let montantTTC = parseFloat(formationRow.prix_ttc) || 0;
      let reduction = 0;
      let codePromoUtilise = null;

      if (request.code_promo) {
        const promoValidation = await this.codePromoService.validateCode(
          tenantId,
          {
            code: request.code_promo,
            formation_id: formationId,
            montant: montantTTC,
          },
          client
        );

        if (promoValidation.valide && promoValidation.code_promo) {
          reduction = promoValidation.reduction_montant;
          montantTTC = promoValidation.nouveau_montant;
          codePromoUtilise = promoValidation.code_promo.code;
          await this.codePromoService.incrementUsage(tenantId, promoValidation.code_promo.id, client);
        } else {
          throw new Error(promoValidation.message || 'Code promotionnel invalide');
        }
      }

      let apprenantId = request.apprenant_id;
      if (!apprenantId && request.apprenant) {
        const existingUserQuery = `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`;
        const existingResult = await client.query(existingUserQuery, [tenantId, request.apprenant.email]);

        if (existingResult.rows.length > 0) {
          apprenantId = existingResult.rows[0].id;
        } else {
          const tempPassword = this.generateTemporaryPassword();
          const passwordHash = await bcrypt.hash(tempPassword, 10);
          const fullName = `${request.apprenant.prenom} ${request.apprenant.nom}`;
          const createUserQuery = `
            INSERT INTO users (
              tenant_id, email, name, first_name, last_name, password_hash, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            RETURNING id
          `;
          const userResult = await client.query(createUserQuery, [
            tenantId,
            request.apprenant.email,
            fullName,
            request.apprenant.prenom,
            request.apprenant.nom,
            passwordHash,
          ]);
          apprenantId = userResult.rows[0].id;

          try {
            await emailService.sendEmail({
              to: request.apprenant.email,
              subject: 'Compte créé - EcoleDigitale',
              html: `
                <h2>Votre compte a été créé</h2>
                <p>Bonjour ${request.apprenant.prenom},</p>
                <p>Un compte a été créé pour vous sur la plateforme EcoleDigitale.</p>
                <p><strong>Email:</strong> ${request.apprenant.email}</p>
                <p><strong>Mot de passe temporaire:</strong> ${tempPassword}</p>
                <p>Veuillez changer votre mot de passe lors de votre première connexion.</p>
                <p>Cordialement,<br>L'équipe EcoleDigitale</p>
              `,
            });
          } catch (emailError) {
            console.error('Failed to send account creation email:', emailError);
          }
        }
      }

      if (!apprenantId) {
        throw new Error('Apprenant ID is required');
      }

      let numeroInscription: string;
      try {
        const result = await client.query('SELECT generate_enrollment_number($1) as numero', [tenantId]);
        numeroInscription = result.rows[0].numero;
      } catch (dbError: any) {
        if (
          dbError?.message?.includes("n'existe pas") ||
          dbError?.message?.includes('does not exist') ||
          dbError?.code === '42883'
        ) {
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, '0');
          const day = String(today.getDate()).padStart(2, '0');
          const prefix = `INS-DATA-${year}${month}${day}-`;
          const countQuery = `
            SELECT COALESCE(MAX(CAST(SUBSTRING(numero_inscription FROM LENGTH($1) + 1) AS INTEGER)), 0) + 1 as next_num
            FROM ${inscriptionsTable}
            WHERE tenant_id = $2
              AND numero_inscription LIKE $1 || '%'
          `;
          const countResult = await client.query(countQuery, [prefix, tenantId]);
          numeroInscription = `${prefix}${String(countResult.rows[0].next_num).padStart(3, '0')}`;
        } else {
          throw dbError;
        }
      }

      const enrollmentResult = await client.query(
        `
        INSERT INTO ${inscriptionsTable} (
          tenant_id, numero_inscription, formation_pro_id, apprenant_id, entreprise_id,
          type_inscription, statut, montant_ht, montant_ttc,
          code_promo_utilise, reduction_appliquee, date_inscription
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING 
          id, numero_inscription, formation_pro_id, apprenant_id, entreprise_id,
          type_inscription, statut, montant_ht, montant_ttc,
          code_promo_utilise, reduction_appliquee, date_inscription
      `,
        [
          tenantId,
          numeroInscription,
          formationId,
          apprenantId,
          null,
          'individuelle',
          'en_attente',
          montantHT,
          montantTTC,
          codePromoUtilise,
          reduction,
        ]
      );

      const enrollment = enrollmentResult.rows[0];

      try {
        await client.query('SAVEPOINT before_reservation');
        await this.createTemporaryReservation(
          tenantId,
          enrollment.id,
          { formationProId: formationId },
          client
        );
        await client.query('RELEASE SAVEPOINT before_reservation');
      } catch (reservationError: any) {
        await client.query('ROLLBACK TO SAVEPOINT before_reservation').catch(() => {});
        if (
          reservationError?.message?.includes("n'existe pas") ||
          reservationError?.message?.includes('does not exist') ||
          reservationError?.code === '42P01'
        ) {
          console.warn('reservations_temporaires table does not exist, skipping reservation creation');
        } else {
          throw reservationError;
        }
      }

      await client.query('COMMIT');

      return {
        id: enrollment.id,
        numero_inscription: enrollment.numero_inscription,
        formation_pro_id: enrollment.formation_pro_id,
        apprenant_id: enrollment.apprenant_id,
        entreprise_id: enrollment.entreprise_id,
        type_inscription: enrollment.type_inscription,
        statut: enrollment.statut,
        montant_ht: parseFloat(enrollment.montant_ht),
        montant_ttc: parseFloat(enrollment.montant_ttc),
        code_promo_utilise: enrollment.code_promo_utilise,
        reduction_appliquee: parseFloat(enrollment.reduction_appliquee),
        date_inscription: enrollment.date_inscription,
        facture_numero: null,
        facture_url: null,
      };
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create individual enrollment with transaction
   */
  async createIndividualEnrollment(
    tenantId: string,
    request: IndividualEnrollmentRequest
  ): Promise<CreatedEnrollment> {
    if (!usesSessionBasedProfessionalTraining(tenantId)) {
      return this.createCatalogIndividualEnrollment(tenantId, request);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.setTenantContext(client, tenantId);

      if (!request.session_id) {
        throw new Error('session_id is required');
      }

      // Lock session row to prevent concurrent enrollments
      const lockQuery = `
        SELECT * FROM ${getTableName(tenantId, 'sessions_professionnelles')}
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE
      `;
      await client.query(lockQuery, [request.session_id, tenantId]);

      // Check availability again (after lock) - use transaction client
      const availabilityQuery = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          s.statut
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        WHERE s.id = $1
          AND s.tenant_id = $2
      `;
      const availabilityResult = await client.query(availabilityQuery, [request.session_id, tenantId]);
      if (availabilityResult.rows.length === 0) {
        throw new Error('Session not found');
      }
      const sessionData = availabilityResult.rows[0];
      const disponible = sessionData.places_disponibles > 0 && sessionData.statut === 'ouverte';
      if (!disponible) {
        let message = '';
        if (sessionData.statut !== 'ouverte') {
          message = `La session n'est pas ouverte aux inscriptions (statut: ${sessionData.statut})`;
        } else if (sessionData.places_disponibles <= 0) {
          message = 'La session est complète, plus de places disponibles';
        }
        throw new Error(message || 'Session not available');
      }

      // Get session pricing and formation_id
      const sessionQuery = `
        SELECT prix_ht, prix_ttc, formation_pro_id
        FROM ${getTableName(tenantId, 'sessions_professionnelles')}
        WHERE id = $1
      `;
      const sessionResult = await client.query(sessionQuery, [request.session_id]);
      if (sessionResult.rows.length === 0) {
        throw new Error('Session not found');
      }

      const session = sessionResult.rows[0];
      let montantHT = parseFloat(session.prix_ht) || 0;
      let montantTTC = parseFloat(session.prix_ttc) || 0;
      let reduction = 0;
      let codePromoUtilise = null;

      // Apply promotional code if provided
      if (request.code_promo) {
        const promoValidation = await this.codePromoService.validateCode(tenantId, {
          code: request.code_promo,
          formation_id: session.formation_pro_id,
          session_id: request.session_id,
          montant: montantTTC,
        }, client);

        if (promoValidation.valide && promoValidation.code_promo) {
          reduction = promoValidation.reduction_montant;
          montantTTC = promoValidation.nouveau_montant;
          codePromoUtilise = promoValidation.code_promo.code;
          
          // Increment usage count (will be committed with transaction)
          await this.codePromoService.incrementUsage(tenantId, promoValidation.code_promo.id, client);
        } else {
          throw new Error(promoValidation.message || 'Code promotionnel invalide');
        }
      }

      // Create or find user account (within transaction)
      let apprenantId = request.apprenant_id;
      if (!apprenantId && request.apprenant) {
        // Check if user already exists
        const existingUserQuery = `
          SELECT id FROM users
          WHERE tenant_id = $1 AND email = $2
        `;
        const existingResult = await client.query(existingUserQuery, [tenantId, request.apprenant.email]);
        
        if (existingResult.rows.length > 0) {
          apprenantId = existingResult.rows[0].id;
        } else {
          // Create user within transaction
          const tempPassword = this.generateTemporaryPassword();
          const passwordHash = await bcrypt.hash(tempPassword, 10);
          const fullName = `${request.apprenant.prenom} ${request.apprenant.nom}`;
          const createUserQuery = `
            INSERT INTO users (
              tenant_id, email, name, first_name, last_name, password_hash, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            RETURNING id
          `;
          const userResult = await client.query(createUserQuery, [
            tenantId,
            request.apprenant.email,
            fullName,
            request.apprenant.prenom,
            request.apprenant.nom,
            passwordHash,
          ]);
          apprenantId = userResult.rows[0].id;
          
          // Try to send email (don't fail if email fails)
          try {
            await emailService.sendEmail({
              to: request.apprenant.email,
              subject: 'Compte créé - EcoleDigitale',
              html: `
                <h2>Votre compte a été créé</h2>
                <p>Bonjour ${request.apprenant.prenom},</p>
                <p>Un compte a été créé pour vous sur la plateforme EcoleDigitale.</p>
                <p><strong>Email:</strong> ${request.apprenant.email}</p>
                <p><strong>Mot de passe temporaire:</strong> ${tempPassword}</p>
                <p>Veuillez changer votre mot de passe lors de votre première connexion.</p>
                <p>Cordialement,<br>L'équipe EcoleDigitale</p>
              `,
            });
          } catch (emailError) {
            console.error('Failed to send account creation email:', emailError);
            // Don't fail enrollment if email fails
          }
        }
      }

      if (!apprenantId) {
        throw new Error('Apprenant ID is required');
      }

      // Generate enrollment number (within transaction)
      let numeroInscription: string;
      try {
        // Try to use database function first
        const result = await client.query('SELECT generate_enrollment_number($1) as numero', [tenantId]);
        numeroInscription = result.rows[0].numero;
      } catch (dbError: any) {
        // If function doesn't exist, generate manually
        if (dbError?.message?.includes('n\'existe pas') || 
            dbError?.message?.includes('does not exist') ||
            dbError?.code === '42883') {
          console.warn('generate_enrollment_number function does not exist, using manual generation');
          
          // Manual generation: INS-DATA-YYYYMMDD-XXX
          const today = new Date();
          const year = today.getFullYear();
          const month = String(today.getMonth() + 1).padStart(2, '0');
          const day = String(today.getDate()).padStart(2, '0');
          const prefix = `INS-DATA-${year}${month}${day}-`;
          
          // Get the highest number for today
          const countQuery = `
            SELECT COALESCE(MAX(CAST(SUBSTRING(numero_inscription FROM LENGTH($1) + 1) AS INTEGER)), 0) + 1 as next_num
            FROM inscriptions_professionnelles
            WHERE tenant_id = $2
              AND numero_inscription LIKE $1 || '%'
          `;
          const countResult = await client.query(countQuery, [prefix, tenantId]);
          const nextNum = countResult.rows[0].next_num;
          
          numeroInscription = `${prefix}${String(nextNum).padStart(3, '0')}`;
        } else {
          throw dbError;
        }
      }

      // Create enrollment record
      const enrollmentQuery = `
        INSERT INTO ${getTableName(tenantId, 'inscriptions_professionnelles')} (
          tenant_id, numero_inscription, session_id, apprenant_id, entreprise_id,
          type_inscription, statut, montant_ht, montant_ttc,
          code_promo_utilise, reduction_appliquee, date_inscription
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        RETURNING 
          id, numero_inscription, session_id, apprenant_id, entreprise_id,
          type_inscription, statut, montant_ht, montant_ttc,
          code_promo_utilise, reduction_appliquee, date_inscription
      `;

      const enrollmentResult = await client.query(enrollmentQuery, [
        tenantId,
        numeroInscription,
        request.session_id,
        apprenantId,
        null, // entreprise_id (null for individual)
        'individuelle',
        'en_attente',
        montantHT,
        montantTTC,
        codePromoUtilise,
        reduction,
      ]);

      const enrollment = enrollmentResult.rows[0];

      // Create temporary reservation (using same transaction client)
      // Note: This is optional - if the table doesn't exist, we'll skip it
      // Use SAVEPOINT to isolate this optional operation from the main transaction
      try {
        await client.query('SAVEPOINT before_reservation');
        await this.createTemporaryReservation(
          tenantId,
          enrollment.id,
          { sessionId: request.session_id },
          client
        );
        await client.query('RELEASE SAVEPOINT before_reservation');
      } catch (reservationError: any) {
        // Rollback to savepoint to restore transaction state
        await client.query('ROLLBACK TO SAVEPOINT before_reservation').catch(() => {
          // Ignore if savepoint doesn't exist (shouldn't happen, but be safe)
        });
        
        // If reservations_temporaires table doesn't exist, log and continue
        if (reservationError?.message?.includes('n\'existe pas') || 
            reservationError?.message?.includes('does not exist') ||
            reservationError?.code === '42P01') {
          console.warn('reservations_temporaires table does not exist, skipping reservation creation');
        } else {
          // Re-throw other errors
          throw reservationError;
        }
      }

      // Update session places (increment places_reservees)
      const updateSessionQuery = `
        UPDATE ${getTableName(tenantId, 'sessions_professionnelles')}
        SET places_reservees = places_reservees + 1,
            updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `;
      const updateResult = await client.query(updateSessionQuery, [request.session_id, tenantId]);
      
      if (updateResult.rowCount === 0) {
        throw new Error('Failed to update session places - session not found or already updated');
      }

      await client.query('COMMIT');

      return {
        id: enrollment.id,
        numero_inscription: enrollment.numero_inscription,
        session_id: enrollment.session_id,
        apprenant_id: enrollment.apprenant_id,
        entreprise_id: enrollment.entreprise_id,
        type_inscription: enrollment.type_inscription,
        statut: enrollment.statut,
        montant_ht: parseFloat(enrollment.montant_ht),
        montant_ttc: parseFloat(enrollment.montant_ttc),
        code_promo_utilise: enrollment.code_promo_utilise,
        reduction_appliquee: parseFloat(enrollment.reduction_appliquee),
        date_inscription: enrollment.date_inscription,
        facture_numero: null, // Column does not exist in table
        facture_url: null,   // Column does not exist in table
      };
    } catch (error: any) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('Error during rollback:', rollbackError);
      });
      
      // Log the error with details
      console.error('Error in createIndividualEnrollment:', {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
        code: error?.code,
      });
      
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get user enrollments with filtering and pagination
   */
  async getUserEnrollments(
    tenantId: string,
    userId: string,
    filters: {
      statut?: 'en_attente' | 'confirmee' | 'annulee' | 'terminee' | 'toutes';
      date_debut?: string;
      date_fin?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{
    inscriptions: Array<{
      id: string;
      numero_inscription: string;
      session: {
        code_session: string;
        date_debut: string;
        date_fin: string;
        formation: {
          titre: string;
          slug: string;
        };
      };
      statut: string;
      montant_ht: number;
      montant_ttc: number;
      reduction_appliquee: number;
      code_promo_utilise: string | null;
      date_inscription: string;
      facture_numero: string | null;
      facture_url: string | null;
      paiement_statut: string | null;
      paiement_methode: string | null;
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
      const limit = Math.min(filters.limit || 10, 50);
      const offset = (page - 1) * limit;

      // Build WHERE conditions
      const whereConditions: string[] = ['i.apprenant_id = $1', 'i.tenant_id = $2'];
      const queryParams: any[] = [userId, tenantId];
      let paramIndex = 3;

      // Status filter
      if (filters.statut && filters.statut !== 'toutes') {
        whereConditions.push(`i.statut = $${paramIndex}`);
        queryParams.push(filters.statut);
        paramIndex++;
      }

      // Date range filter
      if (filters.date_debut) {
        whereConditions.push(`i.date_inscription >= $${paramIndex}`);
        queryParams.push(filters.date_debut);
        paramIndex++;
      }

      if (filters.date_fin) {
        whereConditions.push(`i.date_inscription <= $${paramIndex}`);
        queryParams.push(filters.date_fin);
        paramIndex++;
      }

      // Search filter (training title or session code)
      if (filters.search) {
        if (usesSessionBasedProfessionalTraining(tenantId)) {
          whereConditions.push(
            `(f.titre ILIKE $${paramIndex} OR s.code_session ILIKE $${paramIndex})`
          );
        } else {
          whereConditions.push(`(f.titre ILIKE $${paramIndex})`);
        }
        queryParams.push(`%${filters.search}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.join(' AND ');

      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

      const joinBlock = usesSessionBasedProfessionalTraining(tenantId)
        ? `
        JOIN ${sessionsTable} s ON i.session_id = s.id
        JOIN ${formationsTable} f ON s.formation_pro_id = f.id
      `
        : `
        JOIN ${formationsTable} f ON i.formation_pro_id = f.id
      `;

      // Get total count
      const countQuery = `
        SELECT COUNT(*)::integer as total
        FROM ${inscriptionsTable} i
        ${joinBlock}
        WHERE ${whereClause}
      `;
      const countResult = await client.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total) || 0;
      const totalPages = Math.ceil(total / limit);

      const sessionSelect = usesSessionBasedProfessionalTraining(tenantId)
        ? `s.code_session,
          s.date_debut,
          s.date_fin,`
        : `NULL::varchar as code_session,
          i.date_inscription as date_debut,
          i.date_inscription as date_fin,`;

      // Get enrollments with related data
      const enrollmentsQuery = `
        SELECT 
          i.id,
          i.numero_inscription,
          i.statut,
          i.montant_ht,
          i.montant_ttc,
          i.reduction_appliquee,
          i.code_promo_utilise,
          i.date_inscription,
          i.facture_numero,
          i.facture_url,
          ${sessionSelect}
          f.titre as formation_titre,
          f.slug as formation_slug,
          COALESCE(
            (SELECT p.statut 
             FROM ${getTableName(tenantId, 'paiements_professionnels')} p 
             WHERE p.inscription_id = i.id 
             AND p.tenant_id = $2
             ORDER BY p.created_at DESC 
             LIMIT 1),
            'en_attente'
          ) as paiement_statut,
          COALESCE(
            (SELECT p.methode_paiement 
             FROM ${getTableName(tenantId, 'paiements_professionnels')} p 
             WHERE p.inscription_id = i.id 
             AND p.tenant_id = $2
             ORDER BY p.created_at DESC 
             LIMIT 1),
            NULL
          ) as paiement_methode
        FROM ${inscriptionsTable} i
        ${joinBlock}
        WHERE ${whereClause}
        ORDER BY i.date_inscription DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      const enrollmentsResult = await client.query(enrollmentsQuery, [
        ...queryParams,
        limit,
        offset,
      ]);

      const inscriptions = enrollmentsResult.rows.map((row) => ({
        id: row.id,
        numero_inscription: row.numero_inscription,
        session: {
          code_session: row.code_session,
          date_debut: row.date_debut.toISOString(),
          date_fin: row.date_fin.toISOString(),
          formation: {
            titre: row.formation_titre,
            slug: row.formation_slug,
          },
        },
        statut: row.statut,
        montant_ht: parseFloat(row.montant_ht),
        montant_ttc: parseFloat(row.montant_ttc),
        reduction_appliquee: parseFloat(row.reduction_appliquee || '0'),
        code_promo_utilise: row.code_promo_utilise,
        date_inscription: row.date_inscription.toISOString(),
        facture_numero: row.facture_numero,
        facture_url: row.facture_url,
        paiement_statut: row.paiement_statut,
        paiement_methode: row.paiement_methode,
      }));

      return {
        inscriptions,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get all enrollments with filtering and pagination (admin only)
   */
  async getAllEnrollments(
    tenantId: string,
    filters: {
      statut?: 'en_attente' | 'confirmee' | 'annulee' | 'terminee';
      session_id?: string;
      formation_pro_id?: string;
      date_debut?: string;
      date_fin?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{
    inscriptions: Array<{
      id: string;
      numero_inscription: string;
      session: {
        id: string;
        code_session: string;
        date_debut: string;
        date_fin: string;
        formation: {
          id: string;
          titre: string;
          slug: string;
        };
      };
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
      type_inscription: 'individuelle' | 'entreprise';
      statut: string;
      montant_ht: number;
      montant_ttc: number;
      reduction_appliquee: number;
      code_promo_utilise: string | null;
      date_inscription: string;
      facture_numero: string | null;
      facture_url: string | null;
      paiement_statut: string | null;
      paiement_methode: string | null;
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
      const limit = Math.min(filters.limit || 20, 100);
      const offset = (page - 1) * limit;

      // Build WHERE conditions
      const whereConditions: string[] = ['i.tenant_id = $1'];
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      // Status filter
      if (filters.statut) {
        whereConditions.push(`i.statut = $${paramIndex}`);
        queryParams.push(filters.statut);
        paramIndex++;
      }

      // Session / formation filter
      if (usesSessionBasedProfessionalTraining(tenantId)) {
        if (filters.session_id) {
          whereConditions.push(`i.session_id = $${paramIndex}`);
          queryParams.push(filters.session_id);
          paramIndex++;
        }
      } else if (filters.formation_pro_id) {
        whereConditions.push(`i.formation_pro_id = $${paramIndex}`);
        queryParams.push(filters.formation_pro_id);
        paramIndex++;
      }

      // Date range filter
      if (filters.date_debut) {
        whereConditions.push(`i.date_inscription >= $${paramIndex}`);
        queryParams.push(filters.date_debut);
        paramIndex++;
      }

      if (filters.date_fin) {
        whereConditions.push(`i.date_inscription <= $${paramIndex}`);
        queryParams.push(filters.date_fin);
        paramIndex++;
      }

      // Search filter (participant name, email, session code, or training title)
      if (filters.search) {
        if (usesSessionBasedProfessionalTraining(tenantId)) {
          whereConditions.push(
            `(u.last_name ILIKE $${paramIndex} OR u.first_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex} OR s.code_session ILIKE $${paramIndex} OR f.titre ILIKE $${paramIndex} OR i.numero_inscription ILIKE $${paramIndex})`
          );
        } else {
          whereConditions.push(
            `(u.last_name ILIKE $${paramIndex} OR u.first_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex} OR f.titre ILIKE $${paramIndex} OR i.numero_inscription ILIKE $${paramIndex})`
          );
        }
        queryParams.push(`%${filters.search}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.join(' AND ');

      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');
      const formationsTable = getTableName(tenantId, 'formations_professionnelles');
      const sessionsTable = getTableName(tenantId, 'sessions_professionnelles');

      const adminJoin = usesSessionBasedProfessionalTraining(tenantId)
        ? `
        JOIN ${sessionsTable} s ON i.session_id = s.id
        JOIN ${formationsTable} f ON s.formation_pro_id = f.id
      `
        : `
        JOIN ${formationsTable} f ON i.formation_pro_id = f.id
      `;

      const adminSelect = usesSessionBasedProfessionalTraining(tenantId)
        ? `s.id as session_id,
          s.code_session,
          s.date_debut,
          s.date_fin,`
        : `f.id as session_id,
          'catalogue'::varchar as code_session,
          i.date_inscription as date_debut,
          i.date_inscription as date_fin,`;

      // Get total count
      const countQuery = `
        SELECT COUNT(*)::integer as total
        FROM ${inscriptionsTable} i
        ${adminJoin}
        LEFT JOIN users u ON i.apprenant_id = u.id AND u.tenant_id = $1
        WHERE ${whereClause} AND i.apprenant_id IS NOT NULL
      `;
      const countResult = await client.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total) || 0;
      const totalPages = Math.ceil(total / limit);

      // Get enrollments with related data
      const enrollmentsQuery = `
        SELECT 
          i.id,
          i.numero_inscription,
          i.type_inscription,
          i.statut,
          i.montant_ht,
          i.montant_ttc,
          i.reduction_appliquee,
          i.code_promo_utilise,
          i.date_inscription,
          ${adminSelect}
          f.id as formation_id,
          f.titre as formation_titre,
          f.slug as formation_slug,
          u.id as apprenant_id,
          u.last_name as apprenant_nom,
          u.first_name as apprenant_prenom,
          u.email as apprenant_email,
          e.id as entreprise_id,
          e.raison_sociale as entreprise_nom,
          COALESCE(
            (SELECT p.statut 
             FROM ${getTableName(tenantId, 'paiements_professionnels')} p 
             WHERE p.inscription_id = i.id 
             AND p.tenant_id = $1
             ORDER BY p.created_at DESC 
             LIMIT 1),
            'en_attente'
          ) as paiement_statut,
          COALESCE(
            (SELECT p.methode_paiement 
             FROM ${getTableName(tenantId, 'paiements_professionnels')} p 
             WHERE p.inscription_id = i.id 
             AND p.tenant_id = $1
             ORDER BY p.created_at DESC 
             LIMIT 1),
            NULL
          ) as paiement_methode
        FROM ${inscriptionsTable} i
        ${adminJoin}
        LEFT JOIN users u ON i.apprenant_id = u.id AND u.tenant_id = $1
        LEFT JOIN ${getTableName(tenantId, 'entreprises_clientes')} e ON e.id = i.entreprise_id AND e.tenant_id = $1
        WHERE ${whereClause}
        ORDER BY i.date_inscription DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      const enrollmentsResult = await client.query(enrollmentsQuery, [
        ...queryParams,
        limit,
        offset,
      ]);

      console.log('[getAllEnrollments] Query result:', {
        rowCount: enrollmentsResult.rows.length,
        firstRow: enrollmentsResult.rows[0] || null,
        sampleRow: enrollmentsResult.rows[0] ? {
          id: enrollmentsResult.rows[0].id,
          numero_inscription: enrollmentsResult.rows[0].numero_inscription,
          apprenant_id: enrollmentsResult.rows[0].apprenant_id,
          apprenant_nom: enrollmentsResult.rows[0].apprenant_nom,
          apprenant_prenom: enrollmentsResult.rows[0].apprenant_prenom,
        } : null,
      });

      const inscriptions = enrollmentsResult.rows
        .filter((row) => {
          const isValid = row.id && row.apprenant_id;
          if (!isValid) {
            console.warn('[getAllEnrollments] Filtered out row:', {
              id: row.id,
              apprenant_id: row.apprenant_id,
              apprenant_nom: row.apprenant_nom,
              apprenant_prenom: row.apprenant_prenom,
            });
          }
          return isValid;
        })
        .map((row) => {
          const inscription: any = {
            id: row.id,
            numero_inscription: row.numero_inscription,
            session: {
              id: row.session_id,
              code_session: row.code_session,
              date_debut: row.date_debut.toISOString(),
              date_fin: row.date_fin.toISOString(),
              formation: {
                id: row.formation_id,
                titre: row.formation_titre,
                slug: row.formation_slug,
              },
            },
            apprenant: {
              id: row.apprenant_id,
              nom: row.apprenant_nom || '',
              prenom: row.apprenant_prenom || '',
              email: row.apprenant_email || '',
            },
            type_inscription: row.type_inscription,
            statut: row.statut,
            montant_ht: parseFloat(row.montant_ht),
            montant_ttc: parseFloat(row.montant_ttc),
            reduction_appliquee: parseFloat(row.reduction_appliquee || '0'),
            code_promo_utilise: row.code_promo_utilise,
            date_inscription: row.date_inscription.toISOString(),
            facture_numero: null,
            facture_url: null,
            paiement_statut: row.paiement_statut,
            paiement_methode: row.paiement_methode,
          };
          
          // Only add entreprise if it exists
          if (row.entreprise_id) {
            inscription.entreprise = {
              id: row.entreprise_id,
              nom: row.entreprise_nom,
            };
          }
          
          return inscription;
        });

      console.log('[getAllEnrollments] Final result:', {
        inscriptionsCount: inscriptions.length,
        total,
        pagination: { page, limit, totalPages },
        firstInscription: inscriptions[0] || null,
        firstInscriptionStringified: inscriptions[0] ? JSON.stringify(inscriptions[0]) : null,
      });

      // Force clean serialization by stringifying and parsing (removes any non-serializable values)
      const result = {
        inscriptions,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      };

      // Test serialization to catch any issues
      try {
        const testSerialization = JSON.stringify(result);
        console.log('[getAllEnrollments] Serialization test successful, length:', testSerialization.length);
        const parsed = JSON.parse(testSerialization);
        console.log('[getAllEnrollments] Parsed test - inscriptions count:', parsed.inscriptions?.length);
        console.log('[getAllEnrollments] Parsed test - first inscription keys:', parsed.inscriptions?.[0] ? Object.keys(parsed.inscriptions[0]) : []);
      } catch (error) {
        console.error('[getAllEnrollments] Serialization test failed:', error);
      }

      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Search companies by raison_sociale or SIRET
   */
  async searchCompanies(
    tenantId: string,
    query: string
  ): Promise<Array<{
    id: string;
    raison_sociale: string;
    siret: string | null;
    adresse: string | null;
    code_postal: string | null;
    ville: string | null;
    pays: string | null;
    telephone: string | null;
    email: string | null;
  }>> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const searchQuery = `
        SELECT 
          id,
          raison_sociale,
          siret,
          adresse,
          code_postal,
          ville,
          pays,
          telephone,
          email
        FROM ${getTableName(tenantId, 'entreprises_clientes')}
        WHERE tenant_id = $1
          AND (
            LOWER(raison_sociale) LIKE LOWER($2)
            OR siret = $3
          )
        ORDER BY raison_sociale
        LIMIT 20
      `;

      const searchPattern = `%${query}%`;
      const result = await client.query(searchQuery, [tenantId, searchPattern, query]);

      return result.rows.map((row) => ({
        id: row.id,
        raison_sociale: row.raison_sociale,
        siret: row.siret,
        adresse: row.adresse,
        code_postal: row.code_postal,
        ville: row.ville,
        pays: row.pays,
        telephone: row.telephone,
        email: row.email,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Create or get company by SIRET or create new
   */
  async createOrGetEntreprise(
    tenantId: string,
    entrepriseData: {
      raison_sociale: string;
      siret?: string;
      adresse?: string;
      code_postal?: string;
      ville?: string;
      pays?: string;
      telephone?: string;
      email?: string;
    },
    client?: any
  ): Promise<string> {
    const shouldRelease = !client;
    if (!client) {
      client = await this.pool.connect();
      await client.query('BEGIN');
    }

    try {
      await this.setTenantContext(client, tenantId);

      // If SIRET provided, search by SIRET first
      if (entrepriseData.siret) {
        const searchQuery = `
          SELECT id
          FROM ${getTableName(tenantId, 'entreprises_clientes')}
          WHERE tenant_id = $1 AND siret = $2
          LIMIT 1
        `;
        const searchResult = await client.query(searchQuery, [tenantId, entrepriseData.siret]);
        
        if (searchResult.rows.length > 0) {
          return searchResult.rows[0].id;
        }
      }

      // Create new company
      const insertQuery = `
        INSERT INTO ${getTableName(tenantId, 'entreprises_clientes')} (
          tenant_id,
          raison_sociale,
          siret,
          adresse,
          code_postal,
          ville,
          pays,
          telephone,
          email,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING id
      `;

      const insertResult = await client.query(insertQuery, [
        tenantId,
        entrepriseData.raison_sociale,
        entrepriseData.siret || null,
        entrepriseData.adresse || null,
        entrepriseData.code_postal || null,
        entrepriseData.ville || null,
        entrepriseData.pays || null,
        entrepriseData.telephone || null,
        entrepriseData.email || null,
      ]);

      if (!shouldRelease) {
        // If using existing transaction, commit will be handled by caller
        return insertResult.rows[0].id;
      } else {
        await client.query('COMMIT');
        return insertResult.rows[0].id;
      }
    } catch (error) {
      if (!shouldRelease) {
        throw error; // Let caller handle rollback
      } else {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  }

  /**
   * Inscription entreprise sur le catalogue (sans session)
   */
  private async createCatalogCompanyEnrollment(tenantId: string, request: any): Promise<CreatedEnrollment> {
    const formationId = request.formation_pro_id as string | undefined;
    if (!formationId) {
      throw new Error('formation_pro_id is required');
    }

    const client = await this.pool.connect();
    const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');
    const formationsTable = getTableName(tenantId, 'formations_professionnelles');

    try {
      await client.query('BEGIN');
      await this.setTenantContext(client, tenantId);

      const lockFormation = await client.query(
        `SELECT * FROM ${formationsTable} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [formationId, tenantId]
      );
      if (lockFormation.rows.length === 0) {
        throw new Error('Formation not found');
      }
      const formationRow = lockFormation.rows[0];
      if (!formationRow.actif) {
        throw new Error('Cette formation n’est pas disponible pour le moment');
      }

      let baseMontantHT = parseFloat(formationRow.prix_ht) || 0;
      let baseMontantTTC = parseFloat(formationRow.prix_ttc) || 0;

      const entrepriseId = await this.createOrGetEntreprise(tenantId, request.entreprise, client);
      const apprenantId = await this.createApprenantAccount(tenantId, request.apprenant);

      let reduction = 0;
      let codePromoUtilise = null;
      if (request.code_promo) {
        const validationResult = await this.codePromoService.validateCode(
          tenantId,
          {
            code: request.code_promo,
            formation_id: formationId,
            montant: baseMontantTTC,
          },
          client
        );

        if (validationResult.valide) {
          reduction = validationResult.reduction_montant || 0;
          codePromoUtilise = request.code_promo;
          await this.codePromoService.incrementUsage(tenantId, request.code_promo, client);
        }
      }

      const montantHT = baseMontantHT;
      const montantTTC = Math.max(0, baseMontantTTC - reduction);
      const numeroInscription = await this.generateEnrollmentNumber(tenantId);

      const enrollmentResult = await client.query(
        `
        INSERT INTO ${inscriptionsTable} (
          tenant_id,
          numero_inscription,
          formation_pro_id,
          apprenant_id,
          entreprise_id,
          type_inscription,
          statut,
          montant_ht,
          montant_ttc,
          code_promo_utilise,
          reduction_appliquee,
          date_inscription,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NOW())
        RETURNING id, numero_inscription, formation_pro_id, apprenant_id, entreprise_id,
                  type_inscription, statut, montant_ht, montant_ttc, code_promo_utilise,
                  reduction_appliquee, date_inscription, facture_numero, facture_url
      `,
        [
          tenantId,
          numeroInscription,
          formationId,
          apprenantId,
          entrepriseId,
          'entreprise',
          'en_attente',
          montantHT,
          montantTTC,
          codePromoUtilise,
          reduction,
        ]
      );

      const enrollment = enrollmentResult.rows[0];

      try {
        await this.createTemporaryReservation(tenantId, enrollment.id, { formationProId: formationId }, client);
      } catch (reservationError: any) {
        console.warn('[createCatalogCompanyEnrollment] Could not create temporary reservation:', reservationError.message);
      }

      await client.query('COMMIT');

      return {
        id: enrollment.id,
        numero_inscription: enrollment.numero_inscription,
        formation_pro_id: enrollment.formation_pro_id,
        apprenant_id: enrollment.apprenant_id,
        entreprise_id: enrollment.entreprise_id,
        type_inscription: 'entreprise',
        statut: enrollment.statut,
        montant_ht: parseFloat(enrollment.montant_ht),
        montant_ttc: parseFloat(enrollment.montant_ttc),
        code_promo_utilise: enrollment.code_promo_utilise,
        reduction_appliquee: parseFloat(enrollment.reduction_appliquee),
        date_inscription: enrollment.date_inscription,
        facture_numero: enrollment.facture_numero,
        facture_url: enrollment.facture_url,
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create company enrollment
   */
  async createCompanyEnrollment(
    tenantId: string,
    request: any // CompanyEnrollmentRequest
  ): Promise<CreatedEnrollment> {
    if (!usesSessionBasedProfessionalTraining(tenantId)) {
      return this.createCatalogCompanyEnrollment(tenantId, request);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.setTenantContext(client, tenantId);

      if (!request.session_id) {
        throw new Error('session_id is required');
      }

      // Lock session row to prevent concurrent enrollments
      const lockQuery = `
        SELECT * FROM ${getTableName(tenantId, 'sessions_professionnelles')}
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE
      `;
      await client.query(lockQuery, [request.session_id, tenantId]);

      // Check availability (same logic as individual enrollment)
      const availabilityQuery = `
        SELECT 
          s.id,
          s.code_session,
          s.date_debut,
          s.date_fin,
          s.places_totales,
          s.places_reservees,
          s.places_disponibles,
          s.statut
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        WHERE s.id = $1
          AND s.tenant_id = $2
      `;
      const availabilityResult = await client.query(availabilityQuery, [request.session_id, tenantId]);
      if (availabilityResult.rows.length === 0) {
        throw new Error('Session not found');
      }
      const sessionData = availabilityResult.rows[0];
      const disponible = sessionData.places_disponibles > 0 && sessionData.statut === 'ouverte';
      if (!disponible) {
        let message = '';
        if (sessionData.statut !== 'ouverte') {
          message = `La session n'est pas ouverte aux inscriptions (statut: ${sessionData.statut})`;
        } else if (sessionData.places_disponibles <= 0) {
          message = 'La session est complète, plus de places disponibles';
        }
        throw new Error(message || 'Session not available');
      }

      // Get session pricing
      const sessionQuery = `
        SELECT prix_ht, prix_ttc, formation_pro_id
        FROM ${getTableName(tenantId, 'sessions_professionnelles')}
        WHERE id = $1 AND tenant_id = $2
      `;
      const sessionResult = await client.query(sessionQuery, [request.session_id, tenantId]);
      const session = sessionResult.rows[0];
      const baseMontantHT = session.prix_ht || 0;
      const baseMontantTTC = session.prix_ttc || 0;

      // Create or get company (within transaction)
      const entrepriseId = await this.createOrGetEntreprise(tenantId, request.entreprise, client);

      // Create or get apprenant account
      const apprenantId = await this.createApprenantAccount(tenantId, request.apprenant);

      // Validate and apply promotional code if provided
      let reduction = 0;
      let codePromoUtilise = null;
      if (request.code_promo) {
        const validationResult = await this.codePromoService.validateCode(
          tenantId,
          {
            code: request.code_promo,
            formation_id: session.formation_pro_id,
            montant: baseMontantTTC,
          },
          client
        );

        if (validationResult.valide) {
          reduction = validationResult.reduction_montant || 0;
          codePromoUtilise = request.code_promo;
          // Increment usage
          await this.codePromoService.incrementUsage(tenantId, request.code_promo, client);
        }
      }

      const montantHT = baseMontantHT;
      const montantTTC = Math.max(0, baseMontantTTC - reduction);

      // Generate enrollment number
      const numeroInscription = await this.generateEnrollmentNumber(tenantId);

      // Create enrollment
      const enrollmentQuery = `
        INSERT INTO ${getTableName(tenantId, 'inscriptions_professionnelles')} (
          tenant_id,
          numero_inscription,
          session_id,
          apprenant_id,
          entreprise_id,
          type_inscription,
          statut,
          montant_ht,
          montant_ttc,
          code_promo_utilise,
          reduction_appliquee,
          date_inscription,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NOW())
        RETURNING id, numero_inscription, session_id, apprenant_id, entreprise_id,
                  type_inscription, statut, montant_ht, montant_ttc, code_promo_utilise,
                  reduction_appliquee, date_inscription, facture_numero, facture_url
      `;

      const enrollmentResult = await client.query(enrollmentQuery, [
        tenantId,
        numeroInscription,
        request.session_id,
        apprenantId,
        entrepriseId,
        'entreprise',
        'en_attente',
        montantHT,
        montantTTC,
        codePromoUtilise,
        reduction,
      ]);

      const enrollment = enrollmentResult.rows[0];

      // Update session places
      const updateSessionQuery = `
        UPDATE ${getTableName(tenantId, 'sessions_professionnelles')}
        SET places_reservees = places_reservees + 1,
            places_disponibles = places_disponibles - 1,
            updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `;
      await client.query(updateSessionQuery, [request.session_id, tenantId]);

      // Create temporary reservation
      let reservationExpiresAt: Date;
      try {
        reservationExpiresAt = await this.createTemporaryReservation(
          tenantId,
          enrollment.id,
          { sessionId: request.session_id },
          client
        );
      } catch (reservationError: any) {
        // If reservation table doesn't exist, log warning and continue
        console.warn('[createCompanyEnrollment] Could not create temporary reservation:', reservationError.message);
        reservationExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
      }

      await client.query('COMMIT');

      return {
        id: enrollment.id,
        numero_inscription: enrollment.numero_inscription,
        session_id: enrollment.session_id,
        apprenant_id: enrollment.apprenant_id,
        entreprise_id: enrollment.entreprise_id,
        type_inscription: 'entreprise',
        statut: enrollment.statut,
        montant_ht: parseFloat(enrollment.montant_ht),
        montant_ttc: parseFloat(enrollment.montant_ttc),
        code_promo_utilise: enrollment.code_promo_utilise,
        reduction_appliquee: parseFloat(enrollment.reduction_appliquee),
        date_inscription: enrollment.date_inscription,
        facture_numero: enrollment.facture_numero,
        facture_url: enrollment.facture_url,
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Error in createCompanyEnrollment:', {
        error: error.message,
        stack: error.stack,
        code: error.code,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cancel enrollment
   * Validates that cancellation is allowed (session not started), updates status, releases place, initiates refund if payment made
   */
  async cancelInscription(
    tenantId: string,
    inscriptionId: string,
    userId?: string // Optional: to verify user owns the enrollment
  ): Promise<{
    success: boolean;
    message: string;
    refundInitiated: boolean;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.setTenantContext(client, tenantId);

      const inscriptionsTable = getTableName(tenantId, 'inscriptions_professionnelles');

      const lockQuery = usesSessionBasedProfessionalTraining(tenantId)
        ? `
        SELECT 
          i.*,
          s.date_debut,
          s.statut as session_statut,
          COUNT(p.id) FILTER (WHERE p.statut = 'valide') as paiements_valides
        FROM ${inscriptionsTable} i
        INNER JOIN ${getTableName(tenantId, 'sessions_professionnelles')} s ON s.id = i.session_id AND s.tenant_id = $1
        LEFT JOIN ${getTableName(tenantId, 'paiements_professionnels')} p ON p.inscription_id = i.id AND p.tenant_id = $1
        WHERE i.id = $2 AND i.tenant_id = $1
        FOR UPDATE OF i
        GROUP BY i.id, s.date_debut, s.statut
      `
        : `
        SELECT 
          i.*,
          i.date_inscription as date_debut,
          NULL::text as session_statut,
          COUNT(p.id) FILTER (WHERE p.statut = 'valide') as paiements_valides
        FROM ${inscriptionsTable} i
        LEFT JOIN ${getTableName(tenantId, 'paiements_professionnels')} p ON p.inscription_id = i.id AND p.tenant_id = $1
        WHERE i.id = $2 AND i.tenant_id = $1
        FOR UPDATE OF i
        GROUP BY i.id, i.date_inscription
      `;
      const lockResult = await client.query(lockQuery, [tenantId, inscriptionId]);

      if (lockResult.rows.length === 0) {
        throw new Error('Enrollment not found');
      }

      const enrollment = lockResult.rows[0];

      // Verify user owns enrollment if userId provided
      if (userId && enrollment.apprenant_id !== userId) {
        throw new Error('You do not have permission to cancel this enrollment');
      }

      // Check if cancellation is allowed (sessions planifiées uniquement pour ASPCI)
      if (usesSessionBasedProfessionalTraining(tenantId)) {
        const sessionDateDebut = new Date(enrollment.date_debut);
        const now = new Date();
        if (sessionDateDebut <= now) {
          throw new Error('Cannot cancel enrollment: session has already started or completed');
        }
      }

      // Check if already cancelled
      if (enrollment.statut === 'annulee') {
        return {
          success: true,
          message: 'Enrollment already cancelled',
          refundInitiated: false,
        };
      }

      // Update enrollment status
      const updateQuery = `
        UPDATE ${getTableName(tenantId, 'inscriptions_professionnelles')}
        SET statut = 'annulee',
            updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING id
      `;
      await client.query(updateQuery, [inscriptionId, tenantId]);

      if (usesSessionBasedProfessionalTraining(tenantId) && enrollment.session_id) {
        const releasePlaceQuery = `
          UPDATE ${getTableName(tenantId, 'sessions_professionnelles')}
          SET places_reservees = GREATEST(0, places_reservees - 1),
              places_disponibles = LEAST(places_totales, places_disponibles + 1),
              updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
        `;
        await client.query(releasePlaceQuery, [enrollment.session_id, tenantId]);
      }

      // Delete temporary reservation if exists
      try {
        await client.query(
          `DELETE FROM ${getTableName(tenantId, 'reservations_temporaires')} WHERE inscription_id = $1 AND tenant_id = $2`,
          [inscriptionId, tenantId]
        );
      } catch (error: any) {
        // Ignore if table doesn't exist
        console.warn('[cancelInscription] Could not delete temporary reservation:', error.message);
      }

      // Check if payment was made and initiate refund
      let refundInitiated = false;
      const paiementsValides = parseInt(enrollment.paiements_valides) || 0;
      
      if (paiementsValides > 0) {
        // Mark payments for refund (admin will process manually)
        const refundQuery = `
          UPDATE ${getTableName(tenantId, 'paiements_professionnels')}
          SET statut = 'rembourse',
              updated_at = NOW()
          WHERE inscription_id = $1 
            AND tenant_id = $2
            AND statut = 'valide'
        `;
        await client.query(refundQuery, [inscriptionId, tenantId]);
        refundInitiated = true;
      }

      await client.query('COMMIT');

      return {
        success: true,
        message: 'Enrollment cancelled successfully',
        refundInitiated,
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Error cancelling enrollment:', {
        error: error.message,
        stack: error.stack,
        code: error.code,
      });
      throw error;
    } finally {
      client.release();
    }
  }
}

