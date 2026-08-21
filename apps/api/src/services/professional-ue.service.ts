import type { PoolClient } from "pg";
import type {
  CreateProfessionalUe,
  UpdateProfessionalUe,
  ProfessionalUeEcueInput,
  UpdateProfessionalUeEcue,
  CreateProfessionalUeSession,
  UpdateProfessionalUeSession,
  ProfessionalUeSessionStatut,
  CreateProfessionalEcueSeance,
  UpdateProfessionalEcueSeance,
  MarkProfessionalAttendance,
  JustifyProfessionalAbsence,
} from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
import { basculerSeanceRealisee } from "./professional-seance-constat";

/**
 * Service UE — Module Professionnel (feature 030).
 *
 * L'UE (Unité d'Enseignement) est le pôle ADMINISTRATIF : rattachement à la
 * filière, prix/UV, composition (ECUE mutualisées), prérequis (entre UE),
 * cohortes (sessions) et séances pédagogiques (par ECUE) + présence.
 */

/**
 * Transitions MANUELLES de statut de cohorte. `complet` n'est jamais une cible
 * manuelle (piloté par la capacité, géré à l'inscription).
 *
 * Une cohorte vit ouverte puis, une fois achevée, passe à `termine` : l'étape
 * intermédiaire `en_cours` n'est plus proposée. Elle reste dans l'énumération
 * — des cohortes l'ont encore en base — et conserve sa sortie vers `termine`
 * pour qu'on puisse les clôturer.
 */
export const UE_SESSION_STATUS_TRANSITIONS: Record<
  ProfessionalUeSessionStatut,
  ProfessionalUeSessionStatut[]
> = {
  brouillon: ["ouvert", "annule"],
  ouvert: ["brouillon", "termine", "annule"],
  complet: ["ouvert", "termine", "annule"],
  en_cours: ["termine", "annule"],
  termine: [],
  annule: [],
};

/**
 * Détail d'une séance d'ECUE : colonnes + jointures partagées entre l'historique
 * des présences (liste) et la fiche d'une séance (détail), pour que les deux
 * décrivent la séance de la même manière.
 *
 * L'enseignant suit une cascade : celui de la séance, sinon celui affecté à
 * l'ECUE dans la session, sinon celui de la session ; `enseignant_source` dit
 * lequel a été retenu. `marque_par` / `marque_le` désignent l'utilisateur ayant
 * enregistré l'appel et le moment du dernier pointage.
 */
const SEANCE_DETAIL_COLS = `
  se.id AS seance_id, se.id, se.libelle, se.libelle AS seance_libelle,
  se.date::text AS date,
  se.heure_debut::text AS heure_debut, se.heure_fin::text AS heure_fin,
  COALESCE(EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 60, 0)::int
    AS duree_minutes,
  e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
  ue.id AS ue_id, ue.code AS ue_code, ue.libelle AS ue_libelle,
  s.id AS ue_session_id, s.libelle AS session_libelle,
  s.statut AS session_statut,
  sem.id AS semestre_id, sem.libelle AS semestre_libelle,
  cl.name AS salle,
  COALESCE(ens1.nom, ens2.nom, ens3.nom) AS enseignant_nom,
  CASE
    WHEN ens1.nom IS NOT NULL THEN 'seance'
    WHEN ens2.nom IS NOT NULL THEN 'ecue'
    WHEN ens3.nom IS NOT NULL THEN 'session'
  END AS enseignant_source,
  COALESCE(ens1.email, ens2.email, ens3.email) AS enseignant_email,
  att.marque_par, att.marque_le,
  inscrits.nb_inscrits,
  COALESCE(att.nb_present, 0) AS nb_present,
  COALESCE(att.nb_absent, 0)  AS nb_absent,
  COALESCE(att.nb_retard, 0)  AS nb_retard,
  COALESCE(att.nb_excuse, 0)  AS nb_excuse,
  COALESCE(att.nb_marques, 0) AS nb_marques
`;

const SEANCE_DETAIL_FROM = `
  FROM professional_ecue_seances se
  JOIN professional_ue_sessions s ON s.id = se.ue_session_id AND s.tenant_id = se.tenant_id
  JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
  JOIN professional_ecue e ON e.id = se.ecue_id AND e.tenant_id = se.tenant_id
  LEFT JOIN classrooms cl
    ON cl.id = COALESCE(se.classroom_id, s.classroom_id) AND cl.tenant_id = se.tenant_id
  LEFT JOIN LATERAL (
    SELECT sm.id, sm.libelle
    FROM professional_semestres sm
    WHERE sm.tenant_id = se.tenant_id
      AND (sm.id IN (SELECT ss.semestre_id FROM professional_semestre_sessions ss
                     WHERE ss.ue_session_id = s.id AND ss.tenant_id = se.tenant_id)
           OR sm.id IN (SELECT su.semestre_id FROM professional_semestre_ue su
                        WHERE su.ue_id = s.ue_id AND su.tenant_id = se.tenant_id))
    ORDER BY sm.libelle
    LIMIT 1
  ) sem ON true
  LEFT JOIN LATERAL (
    SELECT NULLIF(trim(coalesce(u1.first_name,'') || ' ' || coalesce(u1.last_name,'')), '') AS nom,
           u1.email
    FROM teachers t1 JOIN users u1 ON u1.id = t1.user_id
    WHERE t1.id = se.enseignant_id
  ) ens1 ON true
  LEFT JOIN LATERAL (
    SELECT NULLIF(trim(coalesce(u2.first_name,'') || ' ' || coalesce(u2.last_name,'')), '') AS nom,
           u2.email
    FROM professional_session_ecue_teachers ect
    JOIN teachers t2 ON t2.id = ect.enseignant_id
    JOIN users u2 ON u2.id = t2.user_id
    WHERE ect.ue_session_id = s.id AND ect.ecue_id = se.ecue_id
      AND ect.tenant_id = se.tenant_id
  ) ens2 ON true
  LEFT JOIN LATERAL (
    SELECT NULLIF(trim(coalesce(u3.first_name,'') || ' ' || coalesce(u3.last_name,'')), '') AS nom,
           u3.email
    FROM teachers t3 JOIN users u3 ON u3.id = t3.user_id
    WHERE t3.id = s.enseignant_id
  ) ens3 ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS nb_marques,
           count(*) FILTER (WHERE a.statut='present')::int AS nb_present,
           count(*) FILTER (WHERE a.statut='absent')::int  AS nb_absent,
           count(*) FILTER (WHERE a.statut='retard')::int  AS nb_retard,
           count(*) FILTER (WHERE a.statut='excuse')::int  AS nb_excuse,
           max(a.updated_at) AS marque_le,
           (SELECT trim(coalesce(u4.first_name,'') || ' ' || coalesce(u4.last_name,''))
            FROM professional_ecue_attendance a2
            JOIN users u4 ON u4.id = a2.marked_by
            WHERE a2.seance_id = se.id AND a2.marked_by IS NOT NULL
            ORDER BY a2.updated_at DESC
            LIMIT 1) AS marque_par
    FROM professional_ecue_attendance a
    WHERE a.seance_id = se.id AND a.tenant_id = se.tenant_id
  ) att ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS nb_inscrits
    FROM professional_enrollments en
    WHERE en.ue_session_id = s.id AND en.tenant_id = se.tenant_id
      AND en.statut IN ('confirmee','terminee')
  ) inscrits ON true
`;

export function isValidUeSessionTransition(
  from: ProfessionalUeSessionStatut,
  to: ProfessionalUeSessionStatut
): boolean {
  if (to === "complet") return false; // automatique (capacité), jamais manuel
  return UE_SESSION_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Indique si rattacher `newPrerequisiteIds` comme prérequis de `ueId` créerait
 * un cycle dans le graphe de prérequis entre UE.
 *
 * `existingEdges` doit EXCLURE les arêtes sortantes actuelles de `ueId`. Chaque
 * arête `{ ue, prerequisite }` signifie « ue exige prerequisite ». Un cycle
 * existe si, depuis l'un des nouveaux prérequis, on peut atteindre `ueId`.
 */
export function wouldCreateUePrerequisiteCycle(
  existingEdges: Array<{ ue: string; prerequisite: string }>,
  ueId: string,
  newPrerequisiteIds: string[]
): boolean {
  const requires = new Map<string, string[]>();
  for (const edge of existingEdges) {
    const list = requires.get(edge.ue) ?? [];
    list.push(edge.prerequisite);
    requires.set(edge.ue, list);
  }
  for (const start of newPrerequisiteIds) {
    const stack: string[] = [start];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const node = stack.pop() as string;
      if (node === ueId) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of requires.get(node) ?? []) stack.push(next);
    }
  }
  return false;
}

const UE_COLS = `id, tenant_id, filiere_id, code, libelle, description, categorie,
  prix::float8 AS prix, devise, nb_uv, statut, created_by, created_at, updated_at`;

const UE_SESSION_COLS = `id, tenant_id, ue_id, libelle,
  date_debut::text AS date_debut, date_fin::text AS date_fin,
  inscription_ouverte_le, inscription_fermee_le, capacite_max,
  enseignant_id, classroom_id, statut, created_at, updated_at`;

const SEANCE_COLS = `id, tenant_id, ecue_id, ue_session_id, libelle,
  date::text AS date, heure_debut::text AS heure_debut, heure_fin::text AS heure_fin,
  enseignant_id, classroom_id, created_at, updated_at`;

export interface UeListFilters {
  filiere_id?: string;
  statut?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export class ProfessionalUeService extends ProfessionalBaseService {
  /* ------------------------------- UE --------------------------------- */

  async createUe(
    tenantId: string,
    input: CreateProfessionalUe,
    userId?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      try {
        const res = await client.query(
          `INSERT INTO professional_ue
             (tenant_id, filiere_id, code, libelle, description, categorie, prix, devise, nb_uv,
              statut, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (tenant_id, code) DO NOTHING
           RETURNING ${UE_COLS}`,
          [
            tenantId,
            input.filiere_id,
            input.code,
            input.libelle,
            input.description ?? null,
            input.categorie ?? null,
            input.prix ?? 0,
            input.devise ?? "XOF",
            input.nb_uv ?? 0,
            input.statut ?? "actif",
            userId ?? null,
          ]
        );
        if (res.rowCount === 0) {
          return fail("DUPLICATE_CODE", `Une UE avec le code "${input.code}" existe déjà.`);
        }
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23503") {
          return fail("VALIDATION_ERROR", "La filière indiquée est introuvable.");
        }
        throw e;
      }
    });
  }

  async listUe(tenantId: string, filters: UeListFilters): Promise<ServiceResult<any>> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(1000, Math.max(1, filters.pageSize ?? 20));
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ["tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;
      if (filters.filiere_id) {
        where.push(`filiere_id = $${i++}`);
        params.push(filters.filiere_id);
      }
      if (filters.statut) {
        where.push(`statut = $${i++}`);
        params.push(filters.statut);
      }
      if (filters.q) {
        where.push(`(code ILIKE $${i} OR libelle ILIKE $${i})`);
        params.push(`%${filters.q}%`);
        i++;
      }
      const whereSql = where.join(" AND ");
      const countRes = await client.query(
        `SELECT count(*)::int AS total FROM professional_ue WHERE ${whereSql}`,
        params
      );
      const listRes = await client.query(
        `SELECT ${UE_COLS} FROM professional_ue
         WHERE ${whereSql} ORDER BY created_at DESC, id LIMIT $${i++} OFFSET $${i++}`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return ok({ items: listRes.rows, total: countRes.rows[0].total, page, pageSize });
    });
  }

  async getUe(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT ${UE_COLS} FROM professional_ue WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("UE_NOT_FOUND", "UE introuvable.");
      const ecue = await this.loadUeEcue(client, id);
      const prerequisites = await this.loadUePrerequisites(client, id);
      return ok({ ...res.rows[0], ecue, prerequisites });
    });
  }

  async updateUe(
    tenantId: string,
    id: string,
    input: UpdateProfessionalUe
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      const fields: (keyof UpdateProfessionalUe)[] = [
        "code",
        "libelle",
        "description",
        "categorie",
        "prix",
        "devise",
        "nb_uv",
        "statut",
      ];
      for (const key of fields) {
        if (input[key] !== undefined) {
          sets.push(`${key} = $${i++}`);
          params.push(input[key]);
        }
      }
      if (sets.length === 0) return this.getUe(tenantId, id);
      sets.push("updated_at = now()");
      params.push(id, tenantId);
      try {
        const res = await client.query(
          `UPDATE professional_ue SET ${sets.join(", ")}
           WHERE id=$${i++} AND tenant_id=$${i++} RETURNING ${UE_COLS}`,
          params
        );
        if (res.rowCount === 0) return fail("UE_NOT_FOUND", "UE introuvable.");
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23505") return fail("DUPLICATE_CODE", "Ce code d'UE est déjà utilisé.");
        throw e;
      }
    });
  }

  async deactivateUe(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `UPDATE professional_ue SET statut='inactif', updated_at=now()
         WHERE id=$1 AND tenant_id=$2 RETURNING ${UE_COLS}`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("UE_NOT_FOUND", "UE introuvable.");
      return ok(res.rows[0]);
    });
  }

  async deleteUe(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const enrolled = await client.query(
        `SELECT 1 FROM professional_enrollments e
         JOIN professional_ue_sessions s ON s.id = e.ue_session_id
         WHERE s.ue_id = $1 AND e.tenant_id = $2 LIMIT 1`,
        [id, tenantId]
      );
      if ((enrolled.rowCount ?? 0) > 0) {
        return fail(
          "UE_HAS_ENROLLMENTS",
          "Impossible de supprimer : des inscriptions existent pour cette UE. Désactivez-la à la place."
        );
      }
      const res = await client.query(
        `DELETE FROM professional_ue WHERE id=$1 AND tenant_id=$2 RETURNING id`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("UE_NOT_FOUND", "UE introuvable.");
      return ok({ id });
    });
  }

  /* ------------------------ Composition UE↔ECUE ----------------------- */

  private async loadUeEcue(client: PoolClient, ueId: string): Promise<any[]> {
    const res = await client.query(
      `SELECT l.id, l.ue_id, l.ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
              e.credits AS ecue_credits,
              l.est_obligatoire, l.coefficient::float8 AS coefficient, l.ordre
       FROM professional_ue_ecue l
       JOIN professional_ecue e ON e.id = l.ecue_id
       WHERE l.ue_id = $1
       ORDER BY l.ordre, e.code`,
      [ueId]
    );
    return res.rows;
  }

  async listUeEcue(tenantId: string, ueId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ue = await client.query(
        `SELECT 1 FROM professional_ue WHERE id=$1 AND tenant_id=$2`,
        [ueId, tenantId]
      );
      if (ue.rowCount === 0) return fail("UE_NOT_FOUND", "UE introuvable.");
      return ok(await this.loadUeEcue(client, ueId));
    });
  }

  async addEcueToUe(
    tenantId: string,
    ueId: string,
    input: ProfessionalUeEcueInput
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ue = await client.query(
        `SELECT 1 FROM professional_ue WHERE id=$1 AND tenant_id=$2`,
        [ueId, tenantId]
      );
      if (ue.rowCount === 0) return fail("UE_NOT_FOUND", "UE introuvable.");
      const ecue = await client.query(
        `SELECT 1 FROM professional_ecue WHERE id=$1 AND tenant_id=$2`,
        [input.ecue_id, tenantId]
      );
      if (ecue.rowCount === 0) return fail("ECUE_NOT_FOUND", "ECUE introuvable.");
      try {
        const res = await client.query(
          `INSERT INTO professional_ue_ecue
             (tenant_id, ue_id, ecue_id, est_obligatoire, coefficient, ordre)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id, ue_id, ecue_id) DO NOTHING
           RETURNING id`,
          [
            tenantId,
            ueId,
            input.ecue_id,
            input.est_obligatoire ?? true,
            input.coefficient ?? 1,
            input.ordre ?? 0,
          ]
        );
        if (res.rowCount === 0) {
          return fail("UE_ECUE_LINK_EXISTS", "Cette ECUE est déjà rattachée à l'UE.");
        }
        return ok(await this.loadUeEcue(client, ueId));
      } catch (e: any) {
        if (e?.code === "23514") {
          return fail("VALIDATION_ERROR", "Coefficient ou ordre invalide.");
        }
        throw e;
      }
    });
  }

  async updateUeEcueLink(
    tenantId: string,
    ueId: string,
    ecueId: string,
    input: UpdateProfessionalUeEcue
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      const fields: (keyof UpdateProfessionalUeEcue)[] = [
        "est_obligatoire",
        "coefficient",
        "ordre",
      ];
      for (const key of fields) {
        if (input[key] !== undefined) {
          sets.push(`${key} = $${i++}`);
          params.push(input[key]);
        }
      }
      if (sets.length === 0) return this.listUeEcue(tenantId, ueId);
      params.push(ueId, ecueId, tenantId);
      const res = await client.query(
        `UPDATE professional_ue_ecue SET ${sets.join(", ")}
         WHERE ue_id=$${i++} AND ecue_id=$${i++} AND tenant_id=$${i++} RETURNING id`,
        params
      );
      if (res.rowCount === 0) return fail("UE_ECUE_LINK_NOT_FOUND", "Liaison UE↔ECUE introuvable.");
      return ok(await this.loadUeEcue(client, ueId));
    });
  }

  async removeEcueFromUe(
    tenantId: string,
    ueId: string,
    ecueId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM professional_ue_ecue
         WHERE ue_id=$1 AND ecue_id=$2 AND tenant_id=$3 RETURNING id`,
        [ueId, ecueId, tenantId]
      );
      if (res.rowCount === 0) return fail("UE_ECUE_LINK_NOT_FOUND", "Liaison UE↔ECUE introuvable.");
      return ok({ ue_id: ueId, ecue_id: ecueId });
    });
  }

  /* --------------------------- Prérequis UE --------------------------- */

  private async loadUePrerequisites(client: PoolClient, ueId: string): Promise<any[]> {
    const res = await client.query(
      `SELECT u.id, u.code, u.libelle
       FROM professional_ue_prerequisites p
       JOIN professional_ue u ON u.id = p.prerequisite_ue_id
       WHERE p.ue_id = $1
       ORDER BY u.code`,
      [ueId]
    );
    return res.rows;
  }

  async getUePrerequisites(tenantId: string, ueId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ue = await client.query(
        `SELECT 1 FROM professional_ue WHERE id=$1 AND tenant_id=$2`,
        [ueId, tenantId]
      );
      if (ue.rowCount === 0) return fail("UE_NOT_FOUND", "UE introuvable.");
      return ok(await this.loadUePrerequisites(client, ueId));
    });
  }

  /**
   * Remplace les prérequis d'une UE. Rejette : auto-référence, prérequis d'une
   * autre filière (même filière exigée), cycle dans le graphe.
   */
  async setUePrerequisites(
    tenantId: string,
    ueId: string,
    prerequisiteIds: string[]
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const ue = await client.query(
        `SELECT filiere_id FROM professional_ue WHERE id=$1 AND tenant_id=$2`,
        [ueId, tenantId]
      );
      if (ue.rowCount === 0) return fail("UE_NOT_FOUND", "UE introuvable.");
      const filiereId = ue.rows[0].filiere_id;
      const uniqueIds = Array.from(new Set(prerequisiteIds));

      if (uniqueIds.includes(ueId)) {
        return fail("VALIDATION_ERROR", "Une UE ne peut pas être son propre prérequis.");
      }

      if (uniqueIds.length > 0) {
        const check = await client.query(
          `SELECT id FROM professional_ue
           WHERE id = ANY($1::uuid[]) AND tenant_id=$2 AND filiere_id=$3`,
          [uniqueIds, tenantId, filiereId]
        );
        if (check.rowCount !== uniqueIds.length) {
          return fail(
            "UE_PREREQ_NOT_SAME_FILIERE",
            "Tous les prérequis doivent exister et appartenir à la même filière que l'UE."
          );
        }
        const edges = await client.query(
          `SELECT ue_id AS ue, prerequisite_ue_id AS prerequisite
           FROM professional_ue_prerequisites
           WHERE tenant_id=$1 AND ue_id <> $2`,
          [tenantId, ueId]
        );
        if (wouldCreateUePrerequisiteCycle(edges.rows, ueId, uniqueIds)) {
          return fail("UE_PREREQ_CYCLE", "Cette définition de prérequis créerait un cycle.");
        }
      }

      await client.query(
        `DELETE FROM professional_ue_prerequisites WHERE tenant_id=$1 AND ue_id=$2`,
        [tenantId, ueId]
      );
      for (const prerequisiteId of uniqueIds) {
        await client.query(
          `INSERT INTO professional_ue_prerequisites (tenant_id, ue_id, prerequisite_ue_id)
           VALUES ($1,$2,$3)`,
          [tenantId, ueId, prerequisiteId]
        );
      }
      return ok(await this.loadUePrerequisites(client, ueId));
    });
  }

  /* --------------------------- Cohortes (UE) -------------------------- */

  async createSession(
    tenantId: string,
    ueId: string,
    input: CreateProfessionalUeSession
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ue = await client.query(
        `SELECT statut FROM professional_ue WHERE id=$1 AND tenant_id=$2`,
        [ueId, tenantId]
      );
      if (ue.rowCount === 0) return fail("UE_NOT_FOUND", "UE introuvable.");
      if (ue.rows[0].statut === "inactif") {
        return fail("UE_INACTIVE", "Une UE inactive n'accepte pas de nouvelle cohorte.");
      }
      try {
        const res = await client.query(
          `INSERT INTO professional_ue_sessions
             (tenant_id, ue_id, libelle, date_debut, date_fin,
              inscription_ouverte_le, inscription_fermee_le, capacite_max,
              enseignant_id, classroom_id, statut)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ouvert')
           RETURNING ${UE_SESSION_COLS}`,
          [
            tenantId,
            ueId,
            input.libelle,
            input.date_debut,
            input.date_fin,
            input.inscription_ouverte_le,
            input.inscription_fermee_le,
            input.capacite_max ?? null,
            input.enseignant_id ?? null,
            input.classroom_id ?? null,
          ]
        );
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23503") {
          return fail("VALIDATION_ERROR", "L'enseignant ou la salle indiqué(e) est introuvable.");
        }
        if (e?.code === "23514") {
          return fail("VALIDATION_ERROR", "Dates, fenêtre d'inscription ou capacité invalides.");
        }
        throw e;
      }
    });
  }

  async listSessions(tenantId: string, ueId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT ${UE_SESSION_COLS} FROM professional_ue_sessions
         WHERE ue_id=$1 AND tenant_id=$2 ORDER BY date_debut DESC`,
        [ueId, tenantId]
      );
      return ok(res.rows);
    });
  }

  async getSession(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT ${UE_SESSION_COLS},
                sem.semestre_id, sem.semestre_libelle,
                sem.filiere_id, sem.filiere_nom, sem.filiere_code
         FROM professional_ue_sessions s
         LEFT JOIN LATERAL (
           SELECT sm.id AS semestre_id, sm.libelle AS semestre_libelle,
                  p.id AS filiere_id, p.name AS filiere_nom, p.code AS filiere_code
           FROM professional_semestre_sessions ss
           JOIN professional_semestres sm ON sm.id = ss.semestre_id AND sm.tenant_id = ss.tenant_id
           LEFT JOIN programmes p ON p.id = sm.filiere_id
           WHERE ss.ue_session_id = s.id AND ss.tenant_id = s.tenant_id
           LIMIT 1
         ) sem ON true
         WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Cohorte introuvable.");
      const cnt = await client.query(
        `SELECT count(*)::int AS n FROM professional_enrollments
         WHERE ue_session_id=$1 AND tenant_id=$2 AND statut <> 'annulee'`,
        [id, tenantId]
      );
      return ok({ ...res.rows[0], nb_inscriptions_actives: cnt.rows[0].n });
    });
  }

  async updateSession(
    tenantId: string,
    id: string,
    input: UpdateProfessionalUeSession
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      const fields: (keyof UpdateProfessionalUeSession)[] = [
        "libelle",
        "date_debut",
        "date_fin",
        "inscription_ouverte_le",
        "inscription_fermee_le",
        "capacite_max",
        "enseignant_id",
        "classroom_id",
      ];
      for (const key of fields) {
        if (input[key] !== undefined) {
          sets.push(`${key} = $${i++}`);
          params.push(input[key]);
        }
      }
      if (sets.length === 0) return this.getSession(tenantId, id);
      sets.push("updated_at = now()");
      params.push(id, tenantId);
      try {
        const res = await client.query(
          `UPDATE professional_ue_sessions SET ${sets.join(", ")}
           WHERE id=$${i++} AND tenant_id=$${i++} RETURNING ${UE_SESSION_COLS}`,
          params
        );
        if (res.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Cohorte introuvable.");
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23503") {
          return fail("VALIDATION_ERROR", "L'enseignant ou la salle indiqué(e) est introuvable.");
        }
        if (e?.code === "23514") {
          return fail("VALIDATION_ERROR", "Dates, fenêtre d'inscription ou capacité invalides.");
        }
        throw e;
      }
    });
  }

  async transitionSessionStatus(
    tenantId: string,
    id: string,
    statut: ProfessionalUeSessionStatut
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const cur = await client.query(
        `SELECT statut FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2`,
        [id, tenantId]
      );
      if (cur.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Cohorte introuvable.");
      const from = cur.rows[0].statut as ProfessionalUeSessionStatut;
      if (from !== statut && !isValidUeSessionTransition(from, statut)) {
        return fail("INVALID_TRANSITION", `Transition de statut invalide : ${from} → ${statut}.`);
      }
      // Garde-fou : on ne peut ouvrir une session que si chaque ECUE obligatoire
      // de l'UE a un enseignant affecté.
      if (statut === "ouvert") {
        const missing = await client.query(
          `SELECT e.code
           FROM professional_ue_sessions s
           JOIN professional_ue_ecue l ON l.ue_id = s.ue_id AND l.tenant_id = s.tenant_id
           JOIN professional_ecue e ON e.id = l.ecue_id
           LEFT JOIN professional_session_ecue_teachers a
             ON a.ue_session_id = s.id AND a.ecue_id = l.ecue_id AND a.tenant_id = s.tenant_id
           WHERE s.id = $1 AND s.tenant_id = $2
             AND l.est_obligatoire = true
             AND a.enseignant_id IS NULL
             -- La Conduite est une note de semestre : pas d'enseignant requis.
             AND NOT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%')
           ORDER BY l.ordre, e.code`,
          [id, tenantId]
        );
        if ((missing.rowCount ?? 0) > 0) {
          const list = missing.rows.map((r) => r.code).join(", ");
          return fail(
            "SESSION_ECUE_TEACHERS_MISSING",
            `Impossible d'ouvrir la session : ${missing.rowCount} ECUE obligatoire(s) sans enseignant (${list}). Affectez un enseignant à chaque ECUE obligatoire (onglet « Enseignants »).`
          );
        }
      }
      const res = await client.query(
        `UPDATE professional_ue_sessions SET statut=$1, updated_at=now()
         WHERE id=$2 AND tenant_id=$3 RETURNING ${UE_SESSION_COLS}`,
        [statut, id, tenantId]
      );
      return ok(res.rows[0]);
    });
  }

  async deleteSession(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const enrolled = await client.query(
        `SELECT 1 FROM professional_enrollments WHERE ue_session_id=$1 AND tenant_id=$2 LIMIT 1`,
        [id, tenantId]
      );
      if ((enrolled.rowCount ?? 0) > 0) {
        return fail(
          "SESSION_HAS_ENROLLMENTS",
          "Impossible de supprimer : des inscriptions existent. Annulez la cohorte à la place."
        );
      }
      const res = await client.query(
        `DELETE FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2 RETURNING id`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Cohorte introuvable.");
      return ok({ id });
    });
  }

  /**
   * Rouvre des sessions terminées : prolonge la date de fin (et la fenêtre
   * d'inscription) puis repasse en « ouvert ». La nouvelle date de fin doit être
   * dans le futur, sinon la finalisation auto les re-clôturerait.
   */
  async reopenSessions(
    tenantId: string,
    input: { session_ids: string[]; date_fin: string }
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const ids = Array.from(new Set(input.session_ids));
      const fermeeLe = new Date(`${input.date_fin}T23:59:59`).toISOString();
      const res = await client.query(
        `UPDATE professional_ue_sessions
         SET date_fin = $1::date,
             inscription_fermee_le = $2,
             statut = 'ouvert',
             updated_at = now()
         WHERE tenant_id = $3 AND id = ANY($4::uuid[])
           AND $1::date >= date_debut
         RETURNING id`,
        [input.date_fin, fermeeLe, tenantId, ids]
      );
      return ok({ reopened: res.rowCount });
    });
  }

  async adminListSessions(
    tenantId: string,
    filters: { ue_id?: string; statut?: string; semestre_id?: string; page?: number; pageSize?: number }
  ): Promise<ServiceResult<any>> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 100));
    return this.withTenant(tenantId, async (client) => {
      // Finalisation automatique : toute session dont la date de fin est passée
      // passe à « termine » (sauf annulée / déjà terminée).
      await client.query(
        `UPDATE professional_ue_sessions
         SET statut = 'termine', updated_at = now()
         WHERE tenant_id = $1 AND date_fin < CURRENT_DATE
           AND statut NOT IN ('termine', 'annule')`,
        [tenantId]
      );

      const where: string[] = ["s.tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;
      if (filters.ue_id) {
        where.push(`s.ue_id = $${i++}`);
        params.push(filters.ue_id);
      }
      if (filters.statut) {
        where.push(`s.statut = $${i++}`);
        params.push(filters.statut);
      }
      if (filters.semestre_id) {
        where.push(
          `EXISTS (SELECT 1 FROM professional_semestre_sessions ss2
                   WHERE ss2.ue_session_id = s.id AND ss2.tenant_id = s.tenant_id
                     AND ss2.semestre_id = $${i++})`
        );
        params.push(filters.semestre_id);
      }
      const baseFrom = `FROM professional_ue_sessions s
        JOIN professional_ue u ON u.id = s.ue_id
        WHERE ${where.join(" AND ")}`;
      const countRes = await client.query(`SELECT count(*)::int AS total ${baseFrom}`, params);
      const listRes = await client.query(
        `SELECT s.id, s.ue_id, s.libelle,
                s.date_debut::text AS date_debut, s.date_fin::text AS date_fin,
                s.inscription_ouverte_le, s.inscription_fermee_le, s.capacite_max,
                s.enseignant_id, s.classroom_id, s.statut,
                u.code AS ue_code, u.libelle AS ue_libelle, u.nb_uv::int AS ue_nb_uv,
                sem.semestre_id, sem.semestre_libelle,
                sem.filiere_id, sem.filiere_nom, sem.filiere_code,
                (SELECT count(*)::int FROM professional_enrollments e
                 WHERE e.ue_session_id = s.id AND e.statut <> 'annulee')
                  AS nb_inscriptions_actives
         FROM professional_ue_sessions s
         JOIN professional_ue u ON u.id = s.ue_id
         LEFT JOIN LATERAL (
           SELECT sm.id AS semestre_id, sm.libelle AS semestre_libelle,
                  p.id AS filiere_id, p.name AS filiere_nom, p.code AS filiere_code
           FROM professional_semestre_sessions ss
           JOIN professional_semestres sm ON sm.id = ss.semestre_id AND sm.tenant_id = ss.tenant_id
           LEFT JOIN programmes p ON p.id = sm.filiere_id
           WHERE ss.ue_session_id = s.id AND ss.tenant_id = s.tenant_id
           LIMIT 1
         ) sem ON true
         WHERE ${where.join(" AND ")}
         ORDER BY s.date_debut DESC, s.libelle, s.id LIMIT $${i++} OFFSET $${i++}`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return ok({ items: listRes.rows, total: countRes.rows[0].total, page, pageSize });
    });
  }

  /* --------------------------- Séances ECUE --------------------------- */

  async createSeance(
    tenantId: string,
    ueSessionId: string,
    input: CreateProfessionalEcueSeance
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sess = await client.query(
        `SELECT ue_id FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2`,
        [ueSessionId, tenantId]
      );
      if (sess.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Cohorte introuvable.");
      // L'ECUE doit être rattachée à l'UE de la cohorte.
      const link = await client.query(
        `SELECT 1 FROM professional_ue_ecue
         WHERE ue_id=$1 AND ecue_id=$2 AND tenant_id=$3`,
        [sess.rows[0].ue_id, input.ecue_id, tenantId]
      );
      if (link.rowCount === 0) {
        return fail("ECUE_NOT_IN_UE", "L'ECUE n'est pas rattachée à l'UE de cette cohorte.");
      }
      try {
        const res = await client.query(
          `INSERT INTO professional_ecue_seances
             (tenant_id, ecue_id, ue_session_id, libelle, date, heure_debut, heure_fin,
              enseignant_id, classroom_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING ${SEANCE_COLS}`,
          [
            tenantId,
            input.ecue_id,
            ueSessionId,
            input.libelle ?? null,
            input.date,
            input.heure_debut ?? null,
            input.heure_fin ?? null,
            input.enseignant_id ?? null,
            input.classroom_id ?? null,
          ]
        );
        return ok(res.rows[0]);
      } catch (e: any) {
        if (e?.code === "23503") {
          return fail("VALIDATION_ERROR", "L'enseignant ou la salle indiqué(e) est introuvable.");
        }
        if (e?.code === "23514") {
          return fail("VALIDATION_ERROR", "Horaires de séance invalides.");
        }
        throw e;
      }
    });
  }

  async listSeances(tenantId: string, ueSessionId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT se.id, se.ecue_id, se.ue_session_id, se.libelle,
                se.date::text AS date, se.heure_debut::text AS heure_debut,
                se.heure_fin::text AS heure_fin, se.enseignant_id, se.classroom_id,
                se.created_at, se.updated_at,
                e.code AS ecue_code, e.libelle AS ecue_libelle
         FROM professional_ecue_seances se
         JOIN professional_ecue e ON e.id = se.ecue_id
         WHERE se.ue_session_id=$1 AND se.tenant_id=$2
         ORDER BY se.date, se.heure_debut NULLS FIRST`,
        [ueSessionId, tenantId]
      );
      return ok(res.rows);
    });
  }

  async updateSeance(
    tenantId: string,
    seanceId: string,
    input: UpdateProfessionalEcueSeance
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      const fields: (keyof UpdateProfessionalEcueSeance)[] = [
        "libelle",
        "date",
        "heure_debut",
        "heure_fin",
        "enseignant_id",
        "classroom_id",
      ];
      for (const key of fields) {
        if (input[key] !== undefined) {
          sets.push(`${key} = $${i++}`);
          params.push(input[key]);
        }
      }
      if (sets.length === 0) {
        const cur = await client.query(
          `SELECT ${SEANCE_COLS} FROM professional_ecue_seances WHERE id=$1 AND tenant_id=$2`,
          [seanceId, tenantId]
        );
        if (cur.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");
        return ok(cur.rows[0]);
      }
      sets.push("updated_at = now()");
      params.push(seanceId, tenantId);
      const res = await client.query(
        `UPDATE professional_ecue_seances SET ${sets.join(", ")}
         WHERE id=$${i++} AND tenant_id=$${i++} RETURNING ${SEANCE_COLS}`,
        params
      );
      if (res.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");
      return ok(res.rows[0]);
    });
  }

  async deleteSeance(tenantId: string, seanceId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM professional_ecue_seances WHERE id=$1 AND tenant_id=$2 RETURNING id`,
        [seanceId, tenantId]
      );
      if (res.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");
      return ok({ id: seanceId });
    });
  }

  /* ------------- Enseignants par ECUE (au sein d'une session) --------- */

  /**
   * Pour une session, liste chaque ECUE de l'UE avec l'enseignant affecté (le
   * cas échéant). Sert à l'écran d'affectation côté admin.
   */
  async listSessionEcueTeachers(
    tenantId: string,
    ueSessionId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sess = await client.query(
        `SELECT ue_id FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2`,
        [ueSessionId, tenantId]
      );
      if (sess.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Session introuvable.");
      const res = await client.query(
        `SELECT l.ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
                l.ordre, l.est_obligatoire,
                (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%') AS is_conduite,
                a.enseignant_id,
                u.first_name, u.last_name, u.email
         FROM professional_ue_ecue l
         JOIN professional_ecue e ON e.id = l.ecue_id
         LEFT JOIN professional_session_ecue_teachers a
           ON a.ue_session_id=$1 AND a.ecue_id=l.ecue_id AND a.tenant_id=l.tenant_id
         LEFT JOIN teachers t ON t.id = a.enseignant_id
         LEFT JOIN users u ON u.id = t.user_id
         WHERE l.ue_id=$2 AND l.tenant_id=$3
         ORDER BY l.ordre, e.code`,
        [ueSessionId, sess.rows[0].ue_id, tenantId]
      );
      return ok(res.rows);
    });
  }

  /**
   * Affecte (ou retire si enseignant_id=null) un enseignant à un ECUE d'une
   * session. L'ECUE doit appartenir à l'UE de la session.
   */
  async setSessionEcueTeacher(
    tenantId: string,
    ueSessionId: string,
    input: { ecue_id: string; enseignant_id: string | null }
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const sess = await client.query(
        `SELECT ue_id FROM professional_ue_sessions WHERE id=$1 AND tenant_id=$2`,
        [ueSessionId, tenantId]
      );
      if (sess.rowCount === 0) return fail("UE_SESSION_NOT_FOUND", "Session introuvable.");
      const link = await client.query(
        `SELECT (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%') AS is_conduite
         FROM professional_ue_ecue l
         JOIN professional_ecue e ON e.id = l.ecue_id
         WHERE l.ue_id=$1 AND l.ecue_id=$2 AND l.tenant_id=$3`,
        [sess.rows[0].ue_id, input.ecue_id, tenantId]
      );
      if (link.rowCount === 0) {
        return fail("ECUE_NOT_IN_UE", "L'ECUE n'est pas rattachée à l'UE de cette session.");
      }
      // La Conduite est une note de semestre (assiduité) : aucun enseignant ne lui est affecté.
      if (link.rows[0].is_conduite && input.enseignant_id != null) {
        return fail(
          "CONDUITE_NO_TEACHER",
          "La Conduite est une note de semestre : on ne lui affecte pas d'enseignant."
        );
      }
      if (input.enseignant_id == null) {
        await client.query(
          `DELETE FROM professional_session_ecue_teachers
           WHERE ue_session_id=$1 AND ecue_id=$2 AND tenant_id=$3`,
          [ueSessionId, input.ecue_id, tenantId]
        );
        return ok({ ecue_id: input.ecue_id, enseignant_id: null });
      }
      const teacher = await client.query(
        `SELECT 1 FROM teachers WHERE id=$1 AND tenant_id=$2`,
        [input.enseignant_id, tenantId]
      );
      if (teacher.rowCount === 0) return fail("VALIDATION_ERROR", "Enseignant introuvable.");
      await client.query(
        `INSERT INTO professional_session_ecue_teachers
           (tenant_id, ue_session_id, ecue_id, enseignant_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, ue_session_id, ecue_id)
         DO UPDATE SET enseignant_id = EXCLUDED.enseignant_id, updated_at = now()`,
        [tenantId, ueSessionId, input.ecue_id, input.enseignant_id]
      );
      return ok({ ecue_id: input.ecue_id, enseignant_id: input.enseignant_id });
    });
  }

  /* ------------------------ Présence (séance) ------------------------- */

  /**
   * Fiche de présence d'une séance : inscrits confirmés/terminés de la cohorte
   * avec leur statut de présence (null si l'appel n'a pas encore été fait).
   */
  async getSeanceAttendance(tenantId: string, seanceId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      // Même description de séance que l'historique des présences (fiche détail).
      const seance = await client.query(
        `SELECT ${SEANCE_DETAIL_COLS}, ue.filiere_id
         ${SEANCE_DETAIL_FROM}
         WHERE se.id = $1 AND se.tenant_id = $2`,
        [seanceId, tenantId]
      );
      if (seance.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");
      // Matricule : celui de la filière (IPAM-<CODE>-<NNNN>), comme le bulletin ;
      // `student_number` n'est qu'un numéro interne, il ne sert que de secours.
      const res = await client.query(
        `SELECT sp.id AS student_id, u.first_name, u.last_name,
                COALESCE(psm.matricule, sp.student_number) AS matricule,
                e.statut AS enrollment_statut,
                a.statut AS attendance_statut, a.updated_at AS marked_at,
                NULLIF(trim(coalesce(mu.first_name,'') || ' ' || coalesce(mu.last_name,'')), '')
                  AS marque_par,
                a.justification, a.justifie_le,
                NULLIF(trim(coalesce(ju.first_name,'') || ' ' || coalesce(ju.last_name,'')), '')
                  AS justifie_par,
                a.justificatif_nom, a.justificatif_mime, a.justificatif_taille,
                (a.justificatif_path IS NOT NULL) AS justificatif
         FROM professional_enrollments e
         JOIN student_profiles sp ON sp.id = e.student_id
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN professional_student_matricules psm
                ON psm.student_id = e.student_id AND psm.filiere_id = $3
               AND psm.tenant_id = e.tenant_id
         LEFT JOIN professional_ecue_attendance a
           ON a.seance_id = $1 AND a.student_id = e.student_id
         LEFT JOIN users mu ON mu.id = a.marked_by
         LEFT JOIN users ju ON ju.id = a.justifie_par
         WHERE e.ue_session_id = $2 AND e.statut IN ('confirmee','terminee')
         ORDER BY u.last_name, u.first_name`,
        [seanceId, seance.rows[0].ue_session_id, seance.rows[0].filiere_id]
      );
      return ok({ seance: seance.rows[0], items: res.rows });
    });
  }

  async markSeanceAttendance(
    tenantId: string,
    seanceId: string,
    input: MarkProfessionalAttendance,
    markedBy?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const seance = await client.query(
        `SELECT 1 FROM professional_ecue_seances WHERE id=$1 AND tenant_id=$2`,
        [seanceId, tenantId]
      );
      if (seance.rowCount === 0) return fail("SEANCE_NOT_FOUND", "Séance introuvable.");
      for (const entry of input.entries) {
        // Un pointage qui n'est plus 'excuse' perd sa justification : garder le
        // motif accroché à une présence ou à une absence non justifiée le
        // rendrait mensonger (et la contrainte 0100 l'interdit).
        await client.query(
          `INSERT INTO professional_ecue_attendance
             (tenant_id, seance_id, student_id, statut, marked_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, seance_id, student_id)
           DO UPDATE SET statut = EXCLUDED.statut, marked_by = EXCLUDED.marked_by,
                         justification = CASE WHEN EXCLUDED.statut = 'excuse'
                                              THEN professional_ecue_attendance.justification END,
                         justifie_par  = CASE WHEN EXCLUDED.statut = 'excuse'
                                              THEN professional_ecue_attendance.justifie_par END,
                         justifie_le   = CASE WHEN EXCLUDED.statut = 'excuse'
                                              THEN professional_ecue_attendance.justifie_le END,
                         updated_at = now()`,
          [tenantId, seanceId, entry.student_id, entry.statut, markedBy ?? null]
        );
      }

      /**
       * L'APPEL FAIT PASSER LA SÉANCE EN « RÉALISÉE ». La règle est partagée
       * avec le chemin enseignant — voir `professional-seance-constat.ts`.
       */
      const bascule = await basculerSeanceRealisee(client, tenantId, seanceId, markedBy);

      return ok({
        seance_id: seanceId,
        count: input.entries.length,
        /** true si l'appel vient de faire basculer la séance en « réalisée ». */
        statut_bascule: bascule,
      });
    });
  }

  /**
   * Justifie (ou dé-justifie) l'absence d'un étudiant sur une séance.
   *
   * `justifiee = true` fait passer le pointage en 'excuse' — la valeur que le
   * bulletin compte comme « absence justifiée » — et enregistre le motif, son
   * auteur et sa date. `false` repasse en 'absent' et efface les trois.
   * Seule une absence peut être justifiée : justifier une présence ou un
   * retard n'aurait pas de sens et fausserait le bulletin.
   */
  async setAttendanceJustification(
    tenantId: string,
    seanceId: string,
    studentId: string,
    input: JustifyProfessionalAbsence,
    justifiePar?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const current = await client.query(
        `SELECT statut, justificatif_path FROM professional_ecue_attendance
         WHERE tenant_id=$1 AND seance_id=$2 AND student_id=$3`,
        [tenantId, seanceId, studentId]
      );
      if (current.rowCount === 0) {
        return fail(
          "ATTENDANCE_NOT_FOUND",
          "Aucun pointage pour cet étudiant sur cette séance : faites d'abord l'appel."
        );
      }
      const statut = current.rows[0].statut as string;
      // Dé-justifier détache le justificatif : la route supprimera ce fichier.
      const ancienPath = input.justifiee ? null : (current.rows[0].justificatif_path ?? null);
      if (input.justifiee && statut !== "absent" && statut !== "excuse") {
        return fail(
          "ATTENDANCE_NOT_ABSENT",
          "Seule une absence peut être justifiée (pointage actuel : " + statut + ")."
        );
      }
      const motif = input.motif?.trim() ? input.motif.trim() : null;
      // Retirer la justification retire aussi le justificatif : le chemin est
      // renvoyé pour que la route supprime le fichier devenu orphelin.
      const res = await client.query(
        `UPDATE professional_ecue_attendance
            SET statut        = $4,
                justification = $5,
                justifie_par  = $6,
                justifie_le   = CASE WHEN $4 = 'excuse' THEN now() END,
                justificatif_path   = CASE WHEN $4 = 'excuse' THEN justificatif_path END,
                justificatif_nom    = CASE WHEN $4 = 'excuse' THEN justificatif_nom END,
                justificatif_mime   = CASE WHEN $4 = 'excuse' THEN justificatif_mime END,
                justificatif_taille = CASE WHEN $4 = 'excuse' THEN justificatif_taille END,
                updated_at    = now()
          WHERE tenant_id=$1 AND seance_id=$2 AND student_id=$3
        RETURNING id, statut, justification, justifie_le, justificatif_nom`,
        [
          tenantId,
          seanceId,
          studentId,
          input.justifiee ? "excuse" : "absent",
          input.justifiee ? motif : null,
          input.justifiee ? (justifiePar ?? null) : null,
        ]
      );
      return ok({ ...res.rows[0], ancien_justificatif_path: ancienPath });
    });
  }

  /**
   * Enregistre (ou remplace) le justificatif PDF d'une absence justifiée.
   * Le fichier a déjà été écrit sur disque par la route ; on ne stocke ici que
   * ses métadonnées, et on renvoie le chemin de l'éventuel fichier remplacé
   * pour que la route le supprime.
   */
  async setAttendanceJustificatif(
    tenantId: string,
    seanceId: string,
    studentId: string,
    fichier: { path: string; nom: string; mime: string; taille: number }
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const current = await client.query(
        `SELECT statut, justificatif_path FROM professional_ecue_attendance
         WHERE tenant_id=$1 AND seance_id=$2 AND student_id=$3`,
        [tenantId, seanceId, studentId]
      );
      if (current.rowCount === 0) {
        return fail("ATTENDANCE_NOT_FOUND", "Aucun pointage pour cet étudiant sur cette séance.");
      }
      if (current.rows[0].statut !== "excuse") {
        return fail(
          "ATTENDANCE_NOT_JUSTIFIED",
          "Justifiez d'abord l'absence : un justificatif ne peut être joint qu'à une absence justifiée."
        );
      }
      const res = await client.query(
        `UPDATE professional_ecue_attendance
            SET justificatif_path=$4, justificatif_nom=$5,
                justificatif_mime=$6, justificatif_taille=$7, updated_at=now()
          WHERE tenant_id=$1 AND seance_id=$2 AND student_id=$3
        RETURNING justificatif_nom, justificatif_mime, justificatif_taille`,
        [tenantId, seanceId, studentId, fichier.path, fichier.nom, fichier.mime, fichier.taille]
      );
      return ok({
        ...res.rows[0],
        ancien_justificatif_path: current.rows[0].justificatif_path ?? null,
      });
    });
  }

  /** Retire le justificatif (le pointage reste justifié, seul le fichier part). */
  async deleteAttendanceJustificatif(
    tenantId: string,
    seanceId: string,
    studentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const current = await client.query(
        `SELECT justificatif_path FROM professional_ecue_attendance
         WHERE tenant_id=$1 AND seance_id=$2 AND student_id=$3`,
        [tenantId, seanceId, studentId]
      );
      if (current.rowCount === 0) {
        return fail("ATTENDANCE_NOT_FOUND", "Aucun pointage pour cet étudiant sur cette séance.");
      }
      await client.query(
        `UPDATE professional_ecue_attendance
            SET justificatif_path=NULL, justificatif_nom=NULL,
                justificatif_mime=NULL, justificatif_taille=NULL, updated_at=now()
          WHERE tenant_id=$1 AND seance_id=$2 AND student_id=$3`,
        [tenantId, seanceId, studentId]
      );
      return ok({ ancien_justificatif_path: current.rows[0].justificatif_path ?? null });
    });
  }

  /** Métadonnées du justificatif, pour le servir en lecture. */
  async getAttendanceJustificatif(
    tenantId: string,
    seanceId: string,
    studentId: string
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT justificatif_path, justificatif_nom, justificatif_mime
         FROM professional_ecue_attendance
         WHERE tenant_id=$1 AND seance_id=$2 AND student_id=$3`,
        [tenantId, seanceId, studentId]
      );
      if (res.rowCount === 0 || !res.rows[0].justificatif_path) {
        return fail("JUSTIFICATIF_NOT_FOUND", "Aucun justificatif pour cette absence.");
      }
      return ok(res.rows[0]);
    });
  }

  /**
   * Historique complet des présences d'une filière (admin) : toutes les
   * séances (avec enseignant, durée et décomptes) + récapitulatif par
   * étudiant (heures d'absence calculées sur la durée réelle des cours).
   * Filtres : semestre (2 chemins de liaison) et statut de session
   * (en_cours = non terminée/annulée ; terminee = terminée/annulée).
   */
  async getPresencesHistory(
    tenantId: string,
    filiereId: string,
    semestreId?: string,
    statut?: "en_cours" | "terminee"
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const params: any[] = [tenantId, filiereId];
      let where = "";
      if (semestreId) {
        params.push(semestreId);
        where += ` AND (
          s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                   WHERE semestre_id = $${params.length} AND tenant_id = $1)
          OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                         WHERE semestre_id = $${params.length} AND tenant_id = $1)
        )`;
      }
      if (statut === "terminee") where += ` AND s.statut IN ('termine','annule')`;
      else if (statut === "en_cours") where += ` AND s.statut NOT IN ('termine','annule')`;

      // Séances (appels) : une ligne par séance d'ECUE, avec son rattachement
      // (UE, semestre, session, salle), son enseignant et ses décomptes de présence.
      const seances = await client.query(
        `SELECT ${SEANCE_DETAIL_COLS}
         ${SEANCE_DETAIL_FROM}
         WHERE se.tenant_id = $1 AND ue.filiere_id = $2 ${where}
         ORDER BY se.date DESC, se.heure_debut DESC NULLS LAST, ue.code, e.code`,
        params
      );

      // Récapitulatif par étudiant : heures d'absence selon la durée des cours.
      const students = await client.query(
        `SELECT a.student_id, u.first_name, u.last_name,
                COALESCE(psm.matricule, sp.student_number) AS matricule,
                count(*)::int AS nb_appels,
                count(*) FILTER (WHERE a.statut='present')::int AS nb_present,
                count(*) FILTER (WHERE a.statut='absent')::int  AS nb_absent,
                count(*) FILTER (WHERE a.statut='retard')::int  AS nb_retard,
                count(*) FILTER (WHERE a.statut='excuse')::int  AS nb_excuse,
                COALESCE(SUM(EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0)
                         FILTER (WHERE a.statut='absent'), 0)::float8 AS heures_absence,
                COALESCE(SUM(EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0)
                         FILTER (WHERE a.statut='excuse'), 0)::float8 AS heures_excusees,
                COALESCE(SUM(EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0),
                         0)::float8 AS heures_total
         FROM professional_ecue_attendance a
         JOIN professional_ecue_seances se ON se.id = a.seance_id AND se.tenant_id = a.tenant_id
         JOIN professional_ue_sessions s ON s.id = se.ue_session_id AND s.tenant_id = se.tenant_id
         JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
         JOIN student_profiles sp ON sp.id = a.student_id
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN professional_student_matricules psm
                ON psm.student_id = a.student_id AND psm.filiere_id = $2
               AND psm.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND ue.filiere_id = $2 ${where}
         GROUP BY a.student_id, u.first_name, u.last_name, sp.student_number, psm.matricule
         ORDER BY heures_absence DESC, u.last_name, u.first_name`,
        params
      );

      return ok({ seances: seances.rows, students: students.rows });
    });
  }

  /**
   * Détail de présence d'UN étudiant sur le périmètre choisi (filière, et le
   * cas échéant semestre / statut de session) : toutes les séances des cohortes
   * où il est inscrit, avec son statut de pointage (null s'il n'a pas été
   * pointé), plus son récapitulatif en heures.
   */
  async getStudentPresences(
    tenantId: string,
    studentId: string,
    filiereId: string,
    semestreId?: string,
    statut?: "en_cours" | "terminee"
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const student = await client.query(
        `SELECT sp.id AS student_id, u.first_name, u.last_name, u.email,
                COALESCE(psm.matricule, sp.student_number) AS matricule
         FROM student_profiles sp
         JOIN users u ON u.id = sp.user_id
         LEFT JOIN professional_student_matricules psm
                ON psm.student_id = sp.id AND psm.filiere_id = $3
               AND psm.tenant_id = sp.tenant_id
         WHERE sp.id = $1 AND sp.tenant_id = $2`,
        [studentId, tenantId, filiereId]
      );
      if (student.rowCount === 0) return fail("STUDENT_NOT_FOUND", "Étudiant introuvable.");

      const params: any[] = [tenantId, filiereId, studentId];
      let where = "";
      if (semestreId) {
        params.push(semestreId);
        where += ` AND (
          s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                   WHERE semestre_id = $${params.length} AND tenant_id = $1)
          OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                         WHERE semestre_id = $${params.length} AND tenant_id = $1)
        )`;
      }
      if (statut === "terminee") where += ` AND s.statut IN ('termine','annule')`;
      else if (statut === "en_cours") where += ` AND s.statut NOT IN ('termine','annule')`;

      const seances = await client.query(
        `SELECT ${SEANCE_DETAIL_COLS},
                ast.statut AS statut_etudiant,
                ast.updated_at AS pointe_le,
                NULLIF(trim(coalesce(mu.first_name,'') || ' ' || coalesce(mu.last_name,'')), '')
                  AS pointe_par,
                ast.justification, ast.justifie_le,
                NULLIF(trim(coalesce(ju.first_name,'') || ' ' || coalesce(ju.last_name,'')), '')
                  AS justifie_par
         ${SEANCE_DETAIL_FROM}
         JOIN professional_enrollments enr
           ON enr.ue_session_id = s.id AND enr.tenant_id = se.tenant_id
          AND enr.student_id = $3 AND enr.statut IN ('confirmee','terminee')
         LEFT JOIN professional_ecue_attendance ast
           ON ast.seance_id = se.id AND ast.student_id = $3 AND ast.tenant_id = se.tenant_id
         LEFT JOIN users mu ON mu.id = ast.marked_by
         LEFT JOIN users ju ON ju.id = ast.justifie_par
         WHERE se.tenant_id = $1 AND ue.filiere_id = $2 ${where}
         ORDER BY e.code, se.date DESC, se.heure_debut DESC NULLS LAST`,
        params
      );

      // Récapitulatif de l'étudiant : heures calculées sur la durée des séances.
      const recap = await client.query(
        `SELECT count(ast.*)::int AS nb_appels,
                count(ast.*) FILTER (WHERE ast.statut='present')::int AS nb_present,
                count(ast.*) FILTER (WHERE ast.statut='absent')::int  AS nb_absent,
                count(ast.*) FILTER (WHERE ast.statut='retard')::int  AS nb_retard,
                count(ast.*) FILTER (WHERE ast.statut='excuse')::int  AS nb_excuse,
                count(*) FILTER (WHERE ast.statut IS NULL)::int AS nb_non_pointe,
                count(*)::int AS nb_seances,
                COALESCE(SUM(EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0)
                         FILTER (WHERE ast.statut='absent'), 0)::float8 AS heures_absence,
                COALESCE(SUM(EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0)
                         FILTER (WHERE ast.statut='excuse'), 0)::float8 AS heures_excusees,
                COALESCE(SUM(EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0)
                         FILTER (WHERE ast.statut IS NOT NULL), 0)::float8 AS heures_total
         FROM professional_ecue_seances se
         JOIN professional_ue_sessions s ON s.id = se.ue_session_id AND s.tenant_id = se.tenant_id
         JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
         JOIN professional_enrollments enr
           ON enr.ue_session_id = s.id AND enr.tenant_id = se.tenant_id
          AND enr.student_id = $3 AND enr.statut IN ('confirmee','terminee')
         LEFT JOIN professional_ecue_attendance ast
           ON ast.seance_id = se.id AND ast.student_id = $3 AND ast.tenant_id = se.tenant_id
         WHERE se.tenant_id = $1 AND ue.filiere_id = $2 ${where}`,
        params
      );

      return ok({
        student: student.rows[0],
        seances: seances.rows,
        recap: recap.rows[0] ?? null,
      });
    });
  }
}
