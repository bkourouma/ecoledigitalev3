import type { PoolClient } from "pg";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Service inscription — Module Professionnel (feature 030).
 * Catalogue étudiant (Filière → UE → ECUE), éligibilité, panier, commande.
 *
 * L'inscription porte sur une COHORTE D'UE (`ue_session_id`). Le prix figé est
 * le prix de l'UE. Les prérequis sont vérifiés AU NIVEAU UE (une UE prérequise
 * doit être validée : `student_professional_ue_results.statut = 'validee'`).
 */

/* ----------------------- Helpers purs (testables) ----------------------- */

export interface EligibilityInput {
  sessionStatut: string;
  inscriptionOuverteLe: string | Date;
  inscriptionFermeeLe: string | Date;
  capaciteMax: number | null;
  activeEnrollmentCount: number;
  studentAlreadyEnrolled: boolean;
  prerequisitesSatisfied: boolean;
  now?: Date;
}

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string; message: string };

/** Évalue l'éligibilité d'un étudiant à une cohorte d'UE (FR-022, FR-024). */
export function evaluateSessionEligibility(input: EligibilityInput): EligibilityResult {
  const now = input.now ?? new Date();
  if (input.sessionStatut !== "ouvert") {
    return {
      eligible: false,
      reason: "SESSION_NOT_ENROLLABLE",
      message: "La cohorte n'est pas ouverte aux inscriptions.",
    };
  }
  const open = new Date(input.inscriptionOuverteLe);
  const close = new Date(input.inscriptionFermeeLe);
  if (now < open || now > close) {
    return {
      eligible: false,
      reason: "SESSION_NOT_ENROLLABLE",
      message: "La cohorte est hors de sa fenêtre d'inscription.",
    };
  }
  if (input.studentAlreadyEnrolled) {
    return {
      eligible: false,
      reason: "DUPLICATE_ENROLLMENT",
      message: "Vous êtes déjà inscrit à cette cohorte.",
    };
  }
  if (input.capaciteMax != null && input.activeEnrollmentCount >= input.capaciteMax) {
    return { eligible: false, reason: "SESSION_FULL", message: "La cohorte est complète." };
  }
  if (!input.prerequisitesSatisfied) {
    return {
      eligible: false,
      reason: "UE_PREREQ_NOT_VALIDATED",
      message: "Les prérequis de l'UE ne sont pas tous validés.",
    };
  }
  return { eligible: true };
}

/** Montant total d'une commande = somme exacte des prix figés (FR-021). */
export function computeOrderTotal(unitPrices: Array<number | string>): number {
  return unitPrices.reduce<number>((sum, p) => sum + (Number(p) || 0), 0);
}

/** Nouveau statut d'une cohorte selon sa capacité. `null` si pas de changement. */
export function computeSessionCapacityStatus(
  currentStatut: string,
  capaciteMax: number | null,
  activeEnrollmentCount: number,
  withinWindow: boolean
): "complet" | "ouvert" | null {
  if (capaciteMax == null) return null; // capacité illimitée
  if (currentStatut === "ouvert" && activeEnrollmentCount >= capaciteMax) {
    return "complet";
  }
  if (currentStatut === "complet" && activeEnrollmentCount < capaciteMax && withinWindow) {
    return "ouvert";
  }
  return null;
}

/**
 * État des prérequis d'une UE (logique ET — FR-005) à partir des UE déjà
 * validées par l'étudiant.
 */
export function evaluatePrerequisites(
  prerequisites: Array<{ id: string; code?: string; libelle?: string }>,
  validatedUeIds: Set<string>
): { satisfait: boolean; manquants: any[] } {
  const manquants = prerequisites.filter((p) => !validatedUeIds.has(p.id));
  return { satisfait: manquants.length === 0, manquants };
}

/**
 * Préfixe fixe du matricule professionnel (institution). Format complet :
 * `IPAM` + code de la filière (nettoyé, ex. `L1DAF`) + numéro séquentiel sur
 * 3 chiffres (ex. `001`) → `IPAML1DAF001`.
 */
const MATRICULE_PREFIX = "IPAM";

/** Normalise un code de filière pour le matricule (alphanumérique majuscule). */
export function cleanFiliereCode(code: string | null | undefined): string {
  return (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || "XXX";
}

/* ------------------------------- Service -------------------------------- */

export class ProfessionalEnrollmentService extends ProfessionalBaseService {
  /**
   * Attribue (ou récupère) le matricule professionnel d'un étudiant pour une
   * filière : `IPAM<code filière><NNN>`. Le numéro est séquentiel et unique par
   * filière. Idempotent : renvoie le matricule existant si déjà attribué.
   *
   * La génération est sérialisée par filière via un verrou consultatif de
   * transaction (`pg_advisory_xact_lock`) pour éviter toute collision de
   * séquence entre inscriptions concurrentes.
   */
  private async ensureProfessionalMatricule(
    client: PoolClient,
    tenantId: string,
    filiereId: string,
    filiereCode: string,
    studentId: string
  ): Promise<string | null> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
      tenantId,
      filiereId,
    ]);
    const code = cleanFiliereCode(filiereCode);
    const ins = await client.query(
      `INSERT INTO professional_student_matricules
         (tenant_id, student_id, filiere_id, seq, matricule)
       SELECT $1, $2, $3, nxt, $4 || $5 || lpad(nxt::text, 3, '0')
       FROM (
         SELECT COALESCE(MAX(seq), 0) + 1 AS nxt
         FROM professional_student_matricules
         WHERE tenant_id = $1 AND filiere_id = $3
       ) q
       ON CONFLICT (tenant_id, student_id, filiere_id) DO NOTHING
       RETURNING matricule`,
      [tenantId, studentId, filiereId, MATRICULE_PREFIX, code]
    );
    if ((ins.rowCount ?? 0) > 0) return ins.rows[0].matricule as string;
    // Déjà présent → on renvoie le matricule existant.
    const existing = await client.query(
      `SELECT matricule FROM professional_student_matricules
       WHERE tenant_id = $1 AND student_id = $2 AND filiere_id = $3`,
      [tenantId, studentId, filiereId]
    );
    return existing.rowCount ? (existing.rows[0].matricule as string) : null;
  }

  /** Résout l'id `student_profiles` à partir de l'id `users` authentifié. */
  private async getStudentProfileId(
    client: PoolClient,
    tenantId: string,
    userId: string
  ): Promise<string | null> {
    const res = await client.query(
      `SELECT id FROM student_profiles WHERE user_id=$1 AND tenant_id=$2 LIMIT 1`,
      [userId, tenantId]
    );
    return res.rowCount && res.rowCount > 0 ? (res.rows[0].id as string) : null;
  }

  /** État des prérequis d'une UE pour un étudiant (logique ET — FR-022). */
  private async getPrerequisitesStatus(
    client: PoolClient,
    ueId: string,
    validatedUeIds: Set<string>
  ): Promise<{ satisfait: boolean; manquants: any[] }> {
    const prereqs = await client.query(
      `SELECT p.prerequisite_ue_id AS id, u.code, u.libelle
       FROM professional_ue_prerequisites p
       JOIN professional_ue u ON u.id = p.prerequisite_ue_id
       WHERE p.ue_id = $1`,
      [ueId]
    );
    return evaluatePrerequisites(prereqs.rows, validatedUeIds);
  }

  /** Recalcule le statut ouvert/complet d'une cohorte selon sa capacité. */
  private async syncSessionCapacity(client: PoolClient, ueSessionId: string): Promise<void> {
    const sess = await client.query(
      `SELECT capacite_max, statut, inscription_ouverte_le, inscription_fermee_le
       FROM professional_ue_sessions WHERE id=$1 FOR UPDATE`,
      [ueSessionId]
    );
    if (sess.rowCount === 0) return;
    const s = sess.rows[0];
    if (s.capacite_max == null) return;
    const cnt = await client.query(
      `SELECT count(*)::int AS n FROM professional_enrollments
       WHERE ue_session_id=$1 AND statut <> 'annulee'`,
      [ueSessionId]
    );
    const now = new Date();
    const withinWindow =
      now >= new Date(s.inscription_ouverte_le) && now <= new Date(s.inscription_fermee_le);
    const next = computeSessionCapacityStatus(s.statut, s.capacite_max, cnt.rows[0].n, withinWindow);
    if (next) {
      await client.query(
        `UPDATE professional_ue_sessions SET statut=$1, updated_at=now() WHERE id=$2`,
        [next, ueSessionId]
      );
    }
  }

  /** Ids des UE que l'étudiant a validées (`student_professional_ue_results`). */
  private async getValidatedUeIds(
    client: PoolClient,
    studentProfileId: string
  ): Promise<Set<string>> {
    const res = await client.query(
      `SELECT ue_id FROM student_professional_ue_results
       WHERE student_id = $1 AND statut = 'validee'`,
      [studentProfileId]
    );
    return new Set(res.rows.map((r: any) => r.ue_id));
  }

  /* --------------------------- Catalogue --------------------------- */

  /** Filières ayant au moins une UE inscriptible (FR-006). */
  async listFilieres(tenantId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT p.id, p.name, p.code,
                COUNT(DISTINCT ue.id)::int AS nb_ue_inscriptibles
         FROM programmes p
         JOIN professional_ue ue
           ON ue.filiere_id = p.id AND ue.tenant_id = $1 AND ue.statut = 'actif'
          AND ue.libelle NOT ILIKE 'conduite%'
         JOIN professional_ue_sessions s
           ON s.ue_id = ue.id AND s.tenant_id = $1
          AND s.statut = 'ouvert'
         WHERE p.tenant_id = $1
         GROUP BY p.id, p.name, p.code
         HAVING COUNT(DISTINCT ue.id) > 0
         ORDER BY p.name`,
        [tenantId]
      );
      return ok(res.rows);
    });
  }

  /** Catalogue d'une filière : UE + ECUE incluses + cohortes + état prérequis. */
  async getCatalog(
    tenantId: string,
    userId: string,
    filiereId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");

      const ueRes = await client.query(
        `SELECT id, code, libelle, nb_uv, prix::float8 AS prix, devise, filiere_id
         FROM professional_ue
         WHERE filiere_id = $1 AND statut = 'actif'
           -- La Conduite est une note de semestre (transversale) : pas d'auto-inscription.
           AND libelle NOT ILIKE 'conduite%'
         ORDER BY code`,
        [filiereId]
      );
      const ues = ueRes.rows;
      if (ues.length === 0) return ok([]);
      const ueIds = ues.map((u: any) => u.id);

      const ecueRes = await client.query(
        `SELECT l.ue_id, e.id, e.code, e.libelle,
                l.est_obligatoire, l.coefficient::float8 AS coefficient, l.ordre
         FROM professional_ue_ecue l
         JOIN professional_ecue e ON e.id = l.ecue_id
         WHERE l.ue_id = ANY($1::uuid[]) ORDER BY l.ordre, e.code`,
        [ueIds]
      );

      const sessionsRes = await client.query(
        `SELECT id, ue_id, libelle, date_debut::text AS date_debut, date_fin::text AS date_fin,
                inscription_ouverte_le, inscription_fermee_le, capacite_max, statut
         FROM professional_ue_sessions
         WHERE ue_id = ANY($1::uuid[]) ORDER BY date_debut`,
        [ueIds]
      );
      const sessionIds = sessionsRes.rows.map((s: any) => s.id);

      const counts = new Map<string, number>();
      const myEnrolled = new Set<string>();
      if (sessionIds.length > 0) {
        const countRes = await client.query(
          `SELECT ue_session_id, count(*)::int AS n
           FROM professional_enrollments
           WHERE ue_session_id = ANY($1::uuid[]) AND statut <> 'annulee'
           GROUP BY ue_session_id`,
          [sessionIds]
        );
        for (const r of countRes.rows) counts.set(r.ue_session_id, r.n);
        const mineRes = await client.query(
          `SELECT ue_session_id FROM professional_enrollments
           WHERE student_id = $1 AND ue_session_id = ANY($2::uuid[]) AND statut <> 'annulee'`,
          [studentId, sessionIds]
        );
        for (const r of mineRes.rows) myEnrolled.add(r.ue_session_id);
      }

      const validated = await this.getValidatedUeIds(client, studentId);
      const now = new Date();
      const items: any[] = [];
      for (const ue of ues) {
        const prereqStatus = await this.getPrerequisitesStatus(client, ue.id, validated);
        const ecue = ecueRes.rows
          .filter((e: any) => e.ue_id === ue.id)
          .map((e: any) => ({
            id: e.id,
            code: e.code,
            libelle: e.libelle,
            est_obligatoire: e.est_obligatoire,
            coefficient: e.coefficient,
            ordre: e.ordre,
          }));
        const sessions = sessionsRes.rows
          .filter((s: any) => s.ue_id === ue.id)
          .map((s: any) => {
            const activeCount = counts.get(s.id) ?? 0;
            const dejaInscrit = myEnrolled.has(s.id);
            const elig = evaluateSessionEligibility({
              sessionStatut: s.statut,
              inscriptionOuverteLe: s.inscription_ouverte_le,
              inscriptionFermeeLe: s.inscription_fermee_le,
              capaciteMax: s.capacite_max,
              activeEnrollmentCount: activeCount,
              studentAlreadyEnrolled: dejaInscrit,
              prerequisitesSatisfied: prereqStatus.satisfait,
              now,
            });
            return {
              id: s.id,
              libelle: s.libelle,
              date_debut: s.date_debut,
              date_fin: s.date_fin,
              inscription_ouverte_le: s.inscription_ouverte_le,
              inscription_fermee_le: s.inscription_fermee_le,
              capacite_max: s.capacite_max,
              places_restantes:
                s.capacite_max != null ? Math.max(0, s.capacite_max - activeCount) : null,
              statut: s.statut,
              inscriptible: elig.eligible,
              deja_inscrit: dejaInscrit,
            };
          });
        items.push({
          ue: {
            id: ue.id,
            code: ue.code,
            libelle: ue.libelle,
            nb_uv: ue.nb_uv,
            prix: ue.prix,
            devise: ue.devise,
            filiere_id: ue.filiere_id,
          },
          ecue,
          sessions,
          prerequisites_status: prereqStatus,
          verrouille: !prereqStatus.satisfait,
        });
      }
      return ok(items);
    });
  }

  /** ECUE débloquées par une inscription confirmée à une cohorte. */
  async listSessionEcueForStudent(
    tenantId: string,
    userId: string,
    ueSessionId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      const enrolled = await client.query(
        `SELECT 1 FROM professional_enrollments
         WHERE student_id=$1 AND ue_session_id=$2 AND statut IN ('confirmee','terminee') LIMIT 1`,
        [studentId, ueSessionId]
      );
      if ((enrolled.rowCount ?? 0) === 0) {
        return fail("FORBIDDEN", "Aucune inscription confirmée pour cette cohorte.");
      }
      const res = await client.query(
        `SELECT e.id, e.code, e.libelle, l.est_obligatoire,
                l.coefficient::float8 AS coefficient, l.ordre
         FROM professional_ue_sessions s
         JOIN professional_ue_ecue l ON l.ue_id = s.ue_id
         JOIN professional_ecue e ON e.id = l.ecue_id
         WHERE s.id=$1
           AND NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
         ORDER BY l.ordre, e.code`,
        [ueSessionId]
      );
      return ok(res.rows);
    });
  }

  /* ----------------------------- Panier ---------------------------- */

  private async ensureDraftOrder(
    client: PoolClient,
    tenantId: string,
    studentId: string
  ): Promise<any> {
    const existing = await client.query(
      `SELECT id, reference, montant_total::float8 AS montant_total, devise, statut
       FROM professional_orders
       WHERE tenant_id=$1 AND student_id=$2 AND statut='brouillon' LIMIT 1`,
      [tenantId, studentId]
    );
    if (existing.rowCount && existing.rowCount > 0) return existing.rows[0];

    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      const cntRes = await client.query(
        `SELECT count(*)::int AS n FROM professional_orders
         WHERE tenant_id=$1 AND reference LIKE $2`,
        [tenantId, `PRO-${year}-%`]
      );
      const reference = `PRO-${year}-${String((cntRes.rows[0].n as number) + 1 + attempt).padStart(6, "0")}`;
      try {
        const ins = await client.query(
          `INSERT INTO professional_orders (tenant_id, student_id, reference, montant_total, statut)
           VALUES ($1,$2,$3,0,'brouillon')
           RETURNING id, reference, montant_total::float8 AS montant_total, devise, statut`,
          [tenantId, studentId, reference]
        );
        return ins.rows[0];
      } catch (e: any) {
        if (e?.code === "23505" && attempt < 4) continue; // collision référence → retry
        throw e;
      }
    }
    throw new Error("Impossible de générer une référence de commande unique.");
  }

  /** Crée une commande avec une référence unique (statut fourni). */
  private async createOrderWithRef(
    client: PoolClient,
    tenantId: string,
    studentId: string,
    statut: string,
    devise: string
  ): Promise<any> {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      const cntRes = await client.query(
        `SELECT count(*)::int AS n FROM professional_orders
         WHERE tenant_id=$1 AND reference LIKE $2`,
        [tenantId, `PRO-${year}-%`]
      );
      const reference = `PRO-${year}-${String((cntRes.rows[0].n as number) + 1 + attempt).padStart(6, "0")}`;
      try {
        const ins = await client.query(
          `INSERT INTO professional_orders (tenant_id, student_id, reference, montant_total, devise, statut)
           VALUES ($1,$2,$3,0,$4,$5)
           RETURNING id`,
          [tenantId, studentId, reference, devise, statut]
        );
        return ins.rows[0];
      } catch (e: any) {
        if (e?.code === "23505" && attempt < 4) continue;
        throw e;
      }
    }
    throw new Error("Impossible de générer une référence de commande unique.");
  }

  /**
   * Inscription directe d'un étudiant à une session par un ADMIN — sans passer
   * par le panier ni le paiement. L'inscription est créée en statut `confirmee`
   * (l'étudiant compte comme inscrit), portée par une commande `en_attente_paiement`
   * (le paiement reste dû tant qu'il n'est pas enregistré).
   */
  async adminEnrollStudent(
    tenantId: string,
    ueSessionId: string,
    studentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const sessRes = await client.query(
        `SELECT s.id, ue.prix::float8 AS prix, COALESCE(ue.devise, 'XOF') AS devise,
                ue.filiere_id, p.code AS filiere_code
         FROM professional_ue_sessions s
         JOIN professional_ue ue ON ue.id = s.ue_id
         JOIN programmes p ON p.id = ue.filiere_id
         WHERE s.id = $1
         FOR UPDATE OF s`,
        [ueSessionId]
      );
      if (sessRes.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Session introuvable.");
      const session = sessRes.rows[0];

      const stRes = await client.query(
        `SELECT id FROM student_profiles WHERE id=$1 AND tenant_id=$2`,
        [studentId, tenantId]
      );
      if (stRes.rowCount === 0) return fail("STUDENT_NOT_FOUND", "Étudiant introuvable.");

      // Matricule professionnel de la filière (IPAM…) — attribué à la 1ère
      // inscription dans la filière, réutilisé ensuite.
      const matricule = await this.ensureProfessionalMatricule(
        client,
        tenantId,
        session.filiere_id,
        session.filiere_code,
        studentId
      );

      const dup = await client.query(
        `SELECT 1 FROM professional_enrollments
         WHERE student_id=$1 AND ue_session_id=$2 AND statut <> 'annulee' LIMIT 1`,
        [studentId, ueSessionId]
      );
      if ((dup.rowCount ?? 0) > 0) {
        return fail("ALREADY_ENROLLED", "Cet étudiant est déjà inscrit à cette session.");
      }

      const order = await this.createOrderWithRef(
        client,
        tenantId,
        studentId,
        "en_attente_paiement",
        session.devise
      );
      const ins = await client.query(
        `INSERT INTO professional_enrollments
           (tenant_id, order_id, student_id, ue_session_id, prix_unitaire, statut)
         VALUES ($1,$2,$3,$4,$5,'en_attente_paiement')
         RETURNING id`,
        [tenantId, order.id, studentId, ueSessionId, session.prix ?? 0]
      );
      await this.recomputeOrderTotal(client, order.id);
      await this.syncSessionCapacity(client, ueSessionId);
      return ok({
        id: ins.rows[0].id,
        order_id: order.id,
        statut: "en_attente_paiement",
        student_id: studentId,
        matricule,
      });
    });
  }

  /**
   * Inscription en lot : chaque (session × étudiant) est traitée indépendamment.
   * Renvoie un récapitulatif (créées / déjà inscrites / erreurs).
   */
  async adminEnrollBulk(
    tenantId: string,
    ueSessionIds: string[],
    studentIds: string[]
  ): Promise<ServiceResult<any>> {
    let created = 0;
    let skipped = 0;
    const errors: Array<{ ue_session_id: string; student_id: string; error: string; message: string }> = [];
    for (const sid of ueSessionIds) {
      for (const st of studentIds) {
        const r = await this.adminEnrollStudent(tenantId, sid, st);
        if (r.success) created += 1;
        else if (r.error === "ALREADY_ENROLLED") skipped += 1;
        else
          errors.push({
            ue_session_id: sid,
            student_id: st,
            error: r.error,
            message: r.message,
          });
      }
    }

    // Matricules professionnels attribués aux étudiants dans les filières
    // couvertes par les sessions sélectionnées (pour affichage côté admin).
    const matricules = await this.withTenant(tenantId, async (client) => {
      const res = await client.query<{
        student_id: string;
        matricule: string;
        filiere_code: string | null;
        filiere_nom: string | null;
        first_name: string | null;
        last_name: string | null;
      }>(
        `SELECT psm.student_id, psm.matricule, p.code AS filiere_code, p.name AS filiere_nom,
                u.first_name, u.last_name
         FROM professional_student_matricules psm
         JOIN programmes p ON p.id = psm.filiere_id
         JOIN student_profiles sp ON sp.id = psm.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE psm.tenant_id = $1
           AND psm.student_id = ANY($2::uuid[])
           AND psm.filiere_id IN (
             SELECT DISTINCT ue.filiere_id
             FROM professional_ue_sessions s
             JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
             WHERE s.tenant_id = $1 AND s.id = ANY($3::uuid[])
           )
         ORDER BY psm.matricule`,
        [tenantId, studentIds, ueSessionIds]
      );
      return res.rows;
    });

    return ok({
      total: ueSessionIds.length * studentIds.length,
      created,
      skipped,
      errors,
      matricules,
    });
  }

  private async recomputeOrderTotal(client: PoolClient, orderId: string): Promise<void> {
    await client.query(
      `UPDATE professional_orders
       SET montant_total = COALESCE(
             (SELECT sum(prix_unitaire) FROM professional_enrollments
              WHERE order_id=$1 AND statut <> 'annulee'), 0),
           updated_at = now()
       WHERE id=$1`,
      [orderId]
    );
  }

  private async loadCart(
    client: PoolClient,
    tenantId: string,
    studentId: string
  ): Promise<any | null> {
    const orderRes = await client.query(
      `SELECT id, reference, montant_total::float8 AS montant_total, devise, statut,
              created_at, updated_at
       FROM professional_orders
       WHERE tenant_id=$1 AND student_id=$2 AND statut='brouillon' LIMIT 1`,
      [tenantId, studentId]
    );
    if (orderRes.rowCount === 0) return null;
    const order = orderRes.rows[0];
    const itemsRes = await client.query(
      `SELECT e.id, e.ue_session_id, e.prix_unitaire::float8 AS prix_unitaire, e.statut,
              s.libelle AS session_libelle, s.date_debut::text AS date_debut,
              s.date_fin::text AS date_fin,
              ue.code AS ue_code, ue.libelle AS ue_libelle
       FROM professional_enrollments e
       JOIN professional_ue_sessions s ON s.id = e.ue_session_id
       JOIN professional_ue ue ON ue.id = s.ue_id
       WHERE e.order_id = $1 AND e.statut <> 'annulee'
       ORDER BY e.created_at`,
      [order.id]
    );
    return { ...order, items: itemsRes.rows };
  }

  async getCart(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      const cart = await this.loadCart(client, tenantId, studentId);
      return ok(cart ?? { items: [], montant_total: 0, statut: "brouillon" });
    });
  }

  async addToCart(
    tenantId: string,
    userId: string,
    ueSessionId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");

      const sessRes = await client.query(
        `SELECT s.id, s.statut, s.capacite_max,
                s.inscription_ouverte_le, s.inscription_fermee_le,
                ue.id AS ue_id, ue.prix::float8 AS prix, ue.statut AS ue_statut
         FROM professional_ue_sessions s
         JOIN professional_ue ue ON ue.id = s.ue_id
         WHERE s.id = $1
         FOR UPDATE OF s`,
        [ueSessionId]
      );
      if (sessRes.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Cohorte introuvable.");
      const session = sessRes.rows[0];
      if (session.ue_statut === "inactif") {
        return fail("UE_INACTIVE", "Cette UE n'accepte plus de nouvelle inscription.");
      }

      const countRes = await client.query(
        `SELECT count(*)::int AS n FROM professional_enrollments
         WHERE ue_session_id=$1 AND statut <> 'annulee'`,
        [ueSessionId]
      );
      const mineRes = await client.query(
        `SELECT 1 FROM professional_enrollments
         WHERE student_id=$1 AND ue_session_id=$2 AND statut <> 'annulee' LIMIT 1`,
        [studentId, ueSessionId]
      );
      const validated = await this.getValidatedUeIds(client, studentId);
      const prereq = await this.getPrerequisitesStatus(client, session.ue_id, validated);

      const elig = evaluateSessionEligibility({
        sessionStatut: session.statut,
        inscriptionOuverteLe: session.inscription_ouverte_le,
        inscriptionFermeeLe: session.inscription_fermee_le,
        capaciteMax: session.capacite_max,
        activeEnrollmentCount: countRes.rows[0].n,
        studentAlreadyEnrolled: (mineRes.rowCount ?? 0) > 0,
        prerequisitesSatisfied: prereq.satisfait,
      });
      if (!elig.eligible) {
        const e = elig as { reason: string; message: string };
        return fail(e.reason, e.message);
      }

      const order = await this.ensureDraftOrder(client, tenantId, studentId);
      await client.query(
        `INSERT INTO professional_enrollments
           (tenant_id, order_id, student_id, ue_session_id, prix_unitaire, statut)
         VALUES ($1,$2,$3,$4,$5,'en_attente_paiement')`,
        [tenantId, order.id, studentId, ueSessionId, session.prix]
      );
      await this.syncSessionCapacity(client, ueSessionId);
      await this.recomputeOrderTotal(client, order.id);
      const cart = await this.loadCart(client, tenantId, studentId);
      return ok(cart);
    });
  }

  /**
   * Auto-inscription directe d'un étudiant à une session (sans panier).
   * Crée une commande + inscription en statut `en_attente_paiement` :
   * l'inscription apparaît immédiatement dans le compte de l'étudiant, mais
   * reste à valider par l'administrateur après règlement (hors système).
   */
  async studentSelfEnroll(
    tenantId: string,
    userId: string,
    ueSessionId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");

      const sessRes = await client.query(
        `SELECT s.id, s.statut, s.capacite_max,
                s.inscription_ouverte_le, s.inscription_fermee_le,
                ue.id AS ue_id, ue.libelle AS ue_libelle, ue.prix::float8 AS prix,
                COALESCE(ue.devise, 'XOF') AS devise, ue.statut AS ue_statut
         FROM professional_ue_sessions s
         JOIN professional_ue ue ON ue.id = s.ue_id
         WHERE s.id = $1
         FOR UPDATE OF s`,
        [ueSessionId]
      );
      if (sessRes.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Session introuvable.");
      const session = sessRes.rows[0];
      if (session.ue_statut === "inactif") {
        return fail("UE_INACTIVE", "Cette UE n'accepte plus de nouvelle inscription.");
      }
      if (String(session.ue_libelle ?? "").toLowerCase().startsWith("conduite")) {
        return fail(
          "CONDUITE_NO_ENROLL",
          "La Conduite est une note de semestre : elle ne se prend pas en auto-inscription."
        );
      }

      if (session.statut === "annule" || session.statut === "termine") {
        return fail("SESSION_CLOSED", "Cette session n'accepte plus de nouvelle inscription.");
      }

      const mine = await client.query(
        `SELECT 1 FROM professional_enrollments
         WHERE student_id=$1 AND ue_session_id=$2 AND statut <> 'annulee' LIMIT 1`,
        [studentId, ueSessionId]
      );
      if ((mine.rowCount ?? 0) > 0) {
        return fail("ALREADY_ENROLLED", "Vous êtes déjà inscrit à cette session.");
      }

      // Contrôle de capacité (si définie) — sinon inscription directe libre.
      if (session.capacite_max != null) {
        const countRes = await client.query(
          `SELECT count(*)::int AS n FROM professional_enrollments
           WHERE ue_session_id=$1 AND statut <> 'annulee'`,
          [ueSessionId]
        );
        if (countRes.rows[0].n >= session.capacite_max) {
          return fail("SESSION_FULL", "Cette session est complète.");
        }
      }

      const order = await this.createOrderWithRef(
        client,
        tenantId,
        studentId,
        "en_attente_paiement",
        session.devise
      );
      const ins = await client.query(
        `INSERT INTO professional_enrollments
           (tenant_id, order_id, student_id, ue_session_id, prix_unitaire, statut)
         VALUES ($1,$2,$3,$4,$5,'en_attente_paiement')
         RETURNING id`,
        [tenantId, order.id, studentId, ueSessionId, session.prix ?? 0]
      );
      await this.syncSessionCapacity(client, ueSessionId);
      await this.recomputeOrderTotal(client, order.id);
      return ok({ id: ins.rows[0].id, statut: "en_attente_paiement" });
    });
  }

  async removeFromCart(
    tenantId: string,
    userId: string,
    enrollmentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      const del = await client.query(
        `DELETE FROM professional_enrollments e
         USING professional_orders o
         WHERE e.id=$1 AND e.order_id=o.id
           AND o.student_id=$2 AND o.statut='brouillon'
         RETURNING o.id AS order_id, e.ue_session_id`,
        [enrollmentId, studentId]
      );
      if (del.rowCount === 0) {
        return fail("NOT_FOUND", "Ligne de panier introuvable.");
      }
      await this.syncSessionCapacity(client, del.rows[0].ue_session_id);
      await this.recomputeOrderTotal(client, del.rows[0].order_id);
      const cart = await this.loadCart(client, tenantId, studentId);
      return ok(cart);
    });
  }

  /* ----------------------- Validation de commande ------------------ */

  async validateOrder(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");

      const orderRes = await client.query(
        `SELECT id FROM professional_orders
         WHERE tenant_id=$1 AND student_id=$2 AND statut='brouillon' LIMIT 1`,
        [tenantId, studentId]
      );
      if (orderRes.rowCount === 0) return fail("NOT_FOUND", "Aucun panier à valider.");
      const orderId = orderRes.rows[0].id;

      const linesRes = await client.query(
        `SELECT e.id, e.ue_session_id,
                s.statut AS session_statut, s.capacite_max,
                s.inscription_ouverte_le, s.inscription_fermee_le, s.ue_id
         FROM professional_enrollments e
         JOIN professional_ue_sessions s ON s.id = e.ue_session_id
         WHERE e.order_id=$1 AND e.statut <> 'annulee'`,
        [orderId]
      );
      if (linesRes.rowCount === 0) return fail("VALIDATION_ERROR", "Le panier est vide.");

      const validated = await this.getValidatedUeIds(client, studentId);
      const now = new Date();
      for (const line of linesRes.rows) {
        const othersCount = await client.query(
          `SELECT count(*)::int AS n FROM professional_enrollments
           WHERE ue_session_id=$1 AND statut <> 'annulee' AND order_id <> $2`,
          [line.ue_session_id, orderId]
        );
        const otherEnroll = await client.query(
          `SELECT 1 FROM professional_enrollments
           WHERE student_id=$1 AND ue_session_id=$2 AND statut <> 'annulee'
             AND order_id <> $3 LIMIT 1`,
          [studentId, line.ue_session_id, orderId]
        );
        const prereq = await this.getPrerequisitesStatus(client, line.ue_id, validated);
        const elig = evaluateSessionEligibility({
          sessionStatut: line.session_statut,
          inscriptionOuverteLe: line.inscription_ouverte_le,
          inscriptionFermeeLe: line.inscription_fermee_le,
          capaciteMax: line.capacite_max,
          activeEnrollmentCount: othersCount.rows[0].n,
          studentAlreadyEnrolled: (otherEnroll.rowCount ?? 0) > 0,
          prerequisitesSatisfied: prereq.satisfait,
          now,
        });
        if (!elig.eligible) {
        const e = elig as { reason: string; message: string };
        return fail(e.reason, e.message);
      }
      }

      await this.recomputeOrderTotal(client, orderId);
      const upd = await client.query(
        `UPDATE professional_orders SET statut='en_attente_paiement', updated_at=now()
         WHERE id=$1
         RETURNING id, reference, montant_total::float8 AS montant_total, devise, statut,
                   created_at, updated_at`,
        [orderId]
      );
      return ok(upd.rows[0]);
    });
  }

  /* ----------------------- Lecture (étudiant) ---------------------- */

  async listOrders(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      const res = await client.query(
        `SELECT id, reference, montant_total::float8 AS montant_total, devise, statut,
                created_at, updated_at
         FROM professional_orders WHERE student_id=$1 ORDER BY created_at DESC`,
        [studentId]
      );
      return ok(res.rows);
    });
  }

  async getOrder(
    tenantId: string,
    userId: string,
    orderId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      const res = await client.query(
        `SELECT id, reference, montant_total::float8 AS montant_total, devise, statut,
                created_at, updated_at
         FROM professional_orders WHERE id=$1 AND student_id=$2`,
        [orderId, studentId]
      );
      if (res.rowCount === 0) return fail("NOT_FOUND", "Commande introuvable.");
      const items = await client.query(
        `SELECT e.id, e.ue_session_id, e.prix_unitaire::float8 AS prix_unitaire, e.statut,
                s.libelle AS session_libelle,
                ue.code AS ue_code, ue.libelle AS ue_libelle
         FROM professional_enrollments e
         JOIN professional_ue_sessions s ON s.id = e.ue_session_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         WHERE e.order_id=$1 ORDER BY e.created_at`,
        [orderId]
      );
      return ok({ ...res.rows[0], items: items.rows });
    });
  }

  async listEnrollments(tenantId: string, userId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const studentId = await this.getStudentProfileId(client, tenantId, userId);
      if (!studentId) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      const res = await client.query(
        `SELECT e.id, e.ue_session_id, e.order_id,
                e.prix_unitaire::float8 AS prix_unitaire, e.statut, e.created_at,
                s.libelle AS session_libelle, s.date_debut::text AS date_debut,
                s.date_fin::text AS date_fin,
                ue.id AS ue_id, ue.code AS ue_code, ue.libelle AS ue_libelle,
                ue.filiere_id, p.name AS filiere_name,
                o.reference AS order_reference
         FROM professional_enrollments e
         JOIN professional_ue_sessions s ON s.id = e.ue_session_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         JOIN programmes p ON p.id = ue.filiere_id
         JOIN professional_orders o ON o.id = e.order_id
         WHERE e.student_id=$1
           AND ue.libelle NOT ILIKE 'conduite%'
         ORDER BY e.created_at DESC`,
        [studentId]
      );
      return ok(res.rows);
    });
  }

  /* ------------------- Achèvement & suivi admin -------------------- */

  /** Marque une inscription confirmée comme terminée. */
  async completeEnrollment(
    tenantId: string,
    enrollmentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      // RETURNING enrichi de `ue_id` (jointure cohorte) : permet de déclencher
      // le recalcul des résultats UE / diplômes (feature 030).
      const upd = await client.query(
        `UPDATE professional_enrollments e SET statut='terminee', updated_at=now()
         FROM professional_ue_sessions s
         WHERE e.id=$1 AND e.tenant_id=$2 AND e.statut='confirmee' AND s.id = e.ue_session_id
         RETURNING e.id, e.ue_session_id, e.student_id, e.statut, s.ue_id`,
        [enrollmentId, tenantId]
      );
      if (upd.rowCount === 0) {
        const exists = await client.query(
          `SELECT statut FROM professional_enrollments WHERE id=$1 AND tenant_id=$2`,
          [enrollmentId, tenantId]
        );
        if (exists.rowCount === 0) return fail("NOT_FOUND", "Inscription introuvable.");
        return fail(
          "VALIDATION_ERROR",
          "Seule une inscription confirmée peut être marquée terminée."
        );
      }
      return ok(upd.rows[0]);
    });
  }

  /** Liste des inscriptions (vue admin) avec filtres et pagination. */
  async adminListEnrollments(
    tenantId: string,
    filters: {
      filiere_id?: string;
      ue_session_id?: string;
      ue_id?: string;
      student_id?: string;
      statut?: string;
      page?: number;
      pageSize?: number;
    }
  ): Promise<ServiceResult<any>> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 20));
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ["e.tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;
      if (filters.filiere_id) {
        where.push(`ue.filiere_id = $${i++}`);
        params.push(filters.filiere_id);
      }
      if (filters.ue_session_id) {
        where.push(`e.ue_session_id = $${i++}`);
        params.push(filters.ue_session_id);
      }
      if (filters.ue_id) {
        where.push(`ue.id = $${i++}`);
        params.push(filters.ue_id);
      }
      if (filters.student_id) {
        where.push(`e.student_id = $${i++}`);
        params.push(filters.student_id);
      }
      if (filters.statut) {
        where.push(`e.statut = $${i++}`);
        params.push(filters.statut);
      }
      const baseFrom = `FROM professional_enrollments e
        JOIN professional_ue_sessions s ON s.id = e.ue_session_id
        JOIN professional_ue ue ON ue.id = s.ue_id
        JOIN programmes p ON p.id = ue.filiere_id
        JOIN professional_orders o ON o.id = e.order_id
        JOIN student_profiles sp ON sp.id = e.student_id
        JOIN users u ON u.id = sp.user_id
        LEFT JOIN professional_student_matricules psm
               ON psm.student_id = e.student_id AND psm.filiere_id = ue.filiere_id
              AND psm.tenant_id = e.tenant_id
        WHERE ${where.join(" AND ")}`;
      const countRes = await client.query(`SELECT count(*)::int AS total ${baseFrom}`, params);
      const listRes = await client.query(
        `SELECT e.id, e.statut, e.prix_unitaire::float8 AS prix_unitaire, e.created_at,
                e.ue_session_id, s.libelle AS session_libelle,
                s.date_debut::text AS date_debut, s.date_fin::text AS date_fin,
                s.statut AS session_statut,
                ue.id AS ue_id, ue.code AS ue_code, ue.libelle AS ue_libelle, ue.filiere_id,
                p.name AS filiere_nom, p.code AS filiere_code,
                e.student_id, COALESCE(psm.matricule, sp.student_number) AS matricule,
                u.first_name, u.last_name, u.email,
                o.reference AS order_reference, o.statut AS order_statut,
                o.montant_total::float8 AS order_montant,
                (SELECT COALESCE(sum(pm.montant),0)::float8 FROM professional_payments pm
                 WHERE pm.order_id = e.order_id AND pm.statut = 'confirme') AS montant_paye
         ${baseFrom}
         ORDER BY e.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return ok({ items: listRes.rows, total: countRes.rows[0].total, page, pageSize });
    });
  }

  /** Détail enrichi d'une inscription (admin). */
  async adminGetEnrollment(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT e.id, e.statut, e.prix_unitaire::float8 AS prix_unitaire, e.created_at, e.updated_at,
                e.ue_session_id, s.libelle AS session_libelle,
                s.date_debut::text AS date_debut, s.date_fin::text AS date_fin,
                s.statut AS session_statut,
                ue.id AS ue_id, ue.code AS ue_code, ue.libelle AS ue_libelle, ue.filiere_id,
                p.name AS filiere_nom, p.code AS filiere_code,
                e.student_id, COALESCE(psm.matricule, sp.student_number) AS matricule,
                u.first_name, u.last_name, u.email,
                o.id AS order_id, o.reference AS order_reference, o.statut AS order_statut,
                o.montant_total::float8 AS order_montant, o.devise AS order_devise,
                (SELECT COALESCE(sum(pm.montant),0)::float8 FROM professional_payments pm
                 WHERE pm.order_id = o.id AND pm.statut = 'confirme') AS montant_paye
         FROM professional_enrollments e
         JOIN professional_ue_sessions s ON s.id = e.ue_session_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         JOIN programmes p ON p.id = ue.filiere_id
         JOIN professional_orders o ON o.id = e.order_id
         JOIN student_profiles sp ON sp.id = e.student_id
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN professional_student_matricules psm
                ON psm.student_id = e.student_id AND psm.filiere_id = ue.filiere_id
               AND psm.tenant_id = e.tenant_id
         WHERE e.id = $1 AND e.tenant_id = $2`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("NOT_FOUND", "Inscription introuvable.");
      return ok(res.rows[0]);
    });
  }

  /** Met à jour le statut d'une inscription (admin). */
  async adminUpdateEnrollment(
    tenantId: string,
    id: string,
    statut: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const res = await client.query(
        `UPDATE professional_enrollments SET statut=$1, updated_at=now()
         WHERE id=$2 AND tenant_id=$3 RETURNING ue_session_id, order_id`,
        [statut, id, tenantId]
      );
      if (res.rowCount === 0) return fail("NOT_FOUND", "Inscription introuvable.");
      // Synchronise le statut de règlement de la commande.
      const orderStatut =
        statut === "confirmee" || statut === "terminee"
          ? "payee"
          : statut === "annulee"
          ? "annulee"
          : "en_attente_paiement";
      await client.query(
        `UPDATE professional_orders SET statut=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`,
        [orderStatut, res.rows[0].order_id, tenantId]
      );
      await this.syncSessionCapacity(client, res.rows[0].ue_session_id);
      await this.recomputeOrderTotal(client, res.rows[0].order_id);
      return ok({ id, statut });
    });
  }

  /** Supprime une inscription (admin). Supprime la commande devenue vide. */
  async adminDeleteEnrollment(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM professional_enrollments
         WHERE id=$1 AND tenant_id=$2 RETURNING ue_session_id, order_id`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("NOT_FOUND", "Inscription introuvable.");
      await this.syncSessionCapacity(client, res.rows[0].ue_session_id);
      await this.recomputeOrderTotal(client, res.rows[0].order_id);
      await client.query(
        `DELETE FROM professional_orders o
         WHERE o.id=$1 AND o.tenant_id=$2
           AND NOT EXISTS (SELECT 1 FROM professional_enrollments e WHERE e.order_id=o.id)`,
        [res.rows[0].order_id, tenantId]
      );
      return ok({ id, deleted: true });
    });
  }

  /* -------------------- Vues parent (lecture) ---------------------- */

  /** Vérifie qu'un enfant est rattaché au parent authentifié (`student_parents`). */
  private async isParentOfChild(
    client: PoolClient,
    tenantId: string,
    parentUserId: string,
    childStudentId: string
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM student_parents
       WHERE tenant_id=$1 AND parent_id=$2 AND student_id=$3 LIMIT 1`,
      [tenantId, parentUserId, childStudentId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Enfants rattachés au parent authentifié. */
  async parentListChildren(
    tenantId: string,
    parentUserId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT sp.id, sp.student_number, u.first_name, u.last_name, u.email,
                sp.date_of_birth::text AS date_of_birth
         FROM student_parents pr
         JOIN student_profiles sp ON sp.id = pr.student_id
         JOIN users u ON u.id = sp.user_id
         WHERE pr.tenant_id=$1 AND pr.parent_id=$2
         ORDER BY u.last_name, u.first_name`,
        [tenantId, parentUserId]
      );
      return ok(res.rows);
    });
  }

  /** Inscriptions professionnelles d'un enfant (lecture seule). */
  async parentListChildEnrollments(
    tenantId: string,
    parentUserId: string,
    childStudentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (!(await this.isParentOfChild(client, tenantId, parentUserId, childStudentId))) {
        return fail("FORBIDDEN", "Cet élève n'est pas rattaché à votre compte.");
      }
      const res = await client.query(
        `SELECT e.id, e.statut, e.prix_unitaire::float8 AS prix_unitaire, e.created_at,
                s.libelle AS session_libelle, s.date_debut::text AS date_debut,
                s.date_fin::text AS date_fin,
                ue.code AS ue_code, ue.libelle AS ue_libelle,
                o.reference AS order_reference
         FROM professional_enrollments e
         JOIN professional_ue_sessions s ON s.id = e.ue_session_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         JOIN professional_orders o ON o.id = e.order_id
         WHERE e.student_id=$1
           AND ue.libelle NOT ILIKE 'conduite%'
         ORDER BY e.created_at DESC`,
        [childStudentId]
      );
      return ok(res.rows);
    });
  }

  /** Paiements professionnels d'un enfant (lecture seule). */
  async parentListChildPayments(
    tenantId: string,
    parentUserId: string,
    childStudentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (!(await this.isParentOfChild(client, tenantId, parentUserId, childStudentId))) {
        return fail("FORBIDDEN", "Cet élève n'est pas rattaché à votre compte.");
      }
      const res = await client.query(
        `SELECT p.id, p.montant::float8 AS montant, p.mode, p.statut,
                p.reference_transaction, p.paid_at::text AS paid_at,
                p.created_at::text AS created_at, p.receipt_number,
                o.reference AS order_reference,
                o.montant_total::float8 AS order_montant,
                u.first_name, u.last_name,
                COALESCE(filmat.matricule, sp.student_number) AS matricule,
                fil.filiere_nom, fil.filiere_code, fil.ues
         FROM professional_payments p
         JOIN professional_orders o ON o.id = p.order_id
         JOIN student_profiles sp ON sp.id = o.student_id
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN LATERAL (
           SELECT prog.name AS filiere_nom, prog.code AS filiere_code, prog.id AS filiere_id,
                  json_agg(json_build_object(
                    'code', ue.code, 'libelle', ue.libelle, 'montant', en.prix_unitaire
                  )) AS ues
           FROM professional_enrollments en
           JOIN professional_ue_sessions s ON s.id = en.ue_session_id
           JOIN professional_ue ue ON ue.id = s.ue_id
           LEFT JOIN programmes prog ON prog.id = ue.filiere_id
           WHERE en.order_id = o.id
           GROUP BY prog.name, prog.code, prog.id
           ORDER BY prog.name
           LIMIT 1
         ) fil ON true
         LEFT JOIN LATERAL (
           SELECT m.matricule FROM professional_student_matricules m
           WHERE m.tenant_id = o.tenant_id AND m.student_id = o.student_id
             AND m.filiere_id = fil.filiere_id LIMIT 1
         ) filmat ON true
         WHERE o.student_id=$1 ORDER BY p.created_at DESC`,
        [childStudentId]
      );
      return ok(res.rows);
    });
  }

  /**
   * Historique de présence d'un enfant (parent, lecture seule) : toutes les
   * séances des cohortes où l'enfant est inscrit, avec son statut de présence
   * (present / absent / retard / excuse, ou null si non pointé). Alimente
   * l'affichage parent depuis les pointages faits par les enseignants
   * (/teacher/attendance) et l'admin (/professionnel/admin/presences).
   */
  async parentListChildAttendance(
    tenantId: string,
    parentUserId: string,
    childStudentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      if (!(await this.isParentOfChild(client, tenantId, parentUserId, childStudentId))) {
        return fail("FORBIDDEN", "Cet élève n'est pas rattaché à votre compte.");
      }
      const res = await client.query(
        `SELECT se.id AS seance_id, se.date::text AS date,
                se.heure_debut::text AS heure_debut, se.heure_fin::text AS heure_fin,
                se.libelle AS seance_libelle,
                e.code AS ecue_code, e.libelle AS ecue_libelle,
                ue.code AS ue_code, ue.libelle AS ue_libelle,
                p.name AS filiere_nom,
                a.statut AS statut, a.updated_at AS marked_at
         FROM professional_ecue_seances se
         JOIN professional_enrollments en
           ON en.ue_session_id = se.ue_session_id AND en.tenant_id = se.tenant_id
              AND en.student_id = $2 AND en.statut IN ('confirmee','terminee')
         JOIN professional_ecue e ON e.id = se.ecue_id AND e.tenant_id = se.tenant_id
         JOIN professional_ue_sessions s ON s.id = se.ue_session_id
         JOIN professional_ue ue ON ue.id = s.ue_id
         LEFT JOIN programmes p ON p.id = ue.filiere_id
         LEFT JOIN professional_ecue_attendance a
           ON a.seance_id = se.id AND a.student_id = $2 AND a.tenant_id = se.tenant_id
         WHERE se.tenant_id = $1
         ORDER BY se.date DESC, se.heure_debut DESC NULLS LAST`,
        [tenantId, childStudentId]
      );
      return ok(res.rows);
    });
  }
}
