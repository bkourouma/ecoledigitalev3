import type { PoolClient } from "pg";
import type {
  CreateProfessionalSemestre,
  CreateProfessionalSemestresBatch,
  CreateSessionsBySemestre,
  UpdateProfessionalSemestre,
} from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Service Semestre — Module Professionnel.
 *
 * Un Semestre appartient à une FILIÈRE (table `programmes`) et est composé d'UE
 * (`professional_ue`) de cette filière, sélectionnées à la création. Les sessions
 * (cohortes inscriptibles) sont créées APRÈS, à partir des UE du semestre.
 * Liaison : `professional_semestre_ue`.
 */

// Colonnes d'affichage d'une UE éligible / rattachée.
const UE_SELECT = `u.id, u.code, u.libelle, u.nb_uv::int AS nb_uv,
  u.prix, u.devise, u.statut, u.description`;

export class ProfessionalSemestreService extends ProfessionalBaseService {
  /** Toutes les UE de la filière `filiereId`, sélectionnables dans un semestre. */
  async listEligibleUe(tenantId: string, filiereId: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT ${UE_SELECT},
                (SELECT count(*)::int FROM professional_ue_ecue l
                 WHERE l.ue_id = u.id AND l.tenant_id = u.tenant_id) AS nb_ecue
         FROM professional_ue u
         WHERE u.tenant_id = $1 AND u.filiere_id = $2
         ORDER BY u.code`,
        [tenantId, filiereId]
      );
      return ok(res.rows);
    });
  }

  /** Liste des semestres (optionnellement filtrée par filière) avec nb d'UE et d'UV. */
  async listSemestres(
    tenantId: string,
    filters: { filiere_id?: string } = {}
  ): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const where: string[] = ["sm.tenant_id = $1"];
      const params: any[] = [tenantId];
      let i = 2;
      if (filters.filiere_id) {
        where.push(`sm.filiere_id = $${i++}`);
        params.push(filters.filiere_id);
      }
      const res = await client.query(
        `SELECT sm.id, sm.tenant_id, sm.filiere_id, sm.libelle,
                sm.created_by, sm.created_at, sm.updated_at,
                p.name AS filiere_nom,
                (SELECT count(*)::int FROM professional_semestre_ue su
                 WHERE su.semestre_id = sm.id AND su.tenant_id = sm.tenant_id) AS nb_ue,
                (SELECT COALESCE(SUM(u.nb_uv), 0)::int
                 FROM professional_semestre_ue su
                 JOIN professional_ue u ON u.id = su.ue_id AND u.tenant_id = su.tenant_id
                 WHERE su.semestre_id = sm.id AND su.tenant_id = sm.tenant_id) AS nb_uv,
                (SELECT count(DISTINCT s.id)::int
                 FROM professional_ue_sessions s
                 WHERE s.tenant_id = sm.tenant_id AND (
                   s.id IN (SELECT ue_session_id FROM professional_semestre_sessions
                            WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                   OR s.ue_id IN (SELECT ue_id FROM professional_semestre_ue
                                  WHERE semestre_id = sm.id AND tenant_id = sm.tenant_id)
                 )) AS nb_sessions
         FROM professional_semestres sm
         LEFT JOIN programmes p ON p.id = sm.filiere_id
         WHERE ${where.join(" AND ")}
         ORDER BY sm.created_at DESC`,
        params
      );
      return ok(res.rows);
    });
  }

  /** Détail d'un semestre : infos, UE composées (avec leurs ECUE) et agrégats. */
  async getSemestre(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const head = await client.query(
        `SELECT sm.id, sm.tenant_id, sm.filiere_id, sm.libelle,
                sm.created_by, sm.created_at, sm.updated_at,
                p.name AS filiere_nom, p.code AS filiere_code
         FROM professional_semestres sm
         LEFT JOIN programmes p ON p.id = sm.filiere_id
         WHERE sm.id = $1 AND sm.tenant_id = $2`,
        [id, tenantId]
      );
      if (head.rowCount === 0) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");

      // UE rattachées au semestre.
      const ueRes = await client.query(
        `SELECT ${UE_SELECT}
         FROM professional_semestre_ue su
         JOIN professional_ue u ON u.id = su.ue_id AND u.tenant_id = su.tenant_id
         WHERE su.semestre_id = $1 AND su.tenant_id = $2
         ORDER BY u.code`,
        [id, tenantId]
      );
      const ues = ueRes.rows;

      // ECUE de chacune de ces UE (composition).
      const ueIds = ues.map((u) => u.id);
      let ecueByUe = new Map<string, any[]>();
      if (ueIds.length > 0) {
        const ecueRes = await client.query(
          `SELECT l.ue_id, e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
                  e.credits::int AS ecue_credits, e.statut AS ecue_statut,
                  (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%') AS is_conduite,
                  l.coefficient::float8 AS coefficient, l.est_obligatoire, l.ordre
           FROM professional_ue_ecue l
           JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
           WHERE l.tenant_id = $1 AND l.ue_id = ANY($2::uuid[])
           ORDER BY l.ue_id, l.ordre, e.code`,
          [tenantId, ueIds]
        );
        for (const r of ecueRes.rows) {
          const arr = ecueByUe.get(r.ue_id) ?? [];
          arr.push(r);
          ecueByUe.set(r.ue_id, arr);
        }
      }
      const uesWithEcue = ues.map((u) => ({ ...u, ecues: ecueByUe.get(u.id) ?? [] }));

      const nb_uv = ues.reduce((a, u) => a + (u.nb_uv ?? 0), 0);
      const nb_credits_ecue = uesWithEcue.reduce(
        (a, u) => a + (u.ecues as any[]).reduce((b, e) => b + (e.ecue_credits ?? 0), 0),
        0
      );

      return ok({
        ...head.rows[0],
        nb_ue: ues.length,
        nb_uv,
        nb_credits_ecue,
        ues: uesWithEcue,
      });
    });
  }

  /**
   * Garde-fou : toutes les `ueIds` doivent appartenir à la filière `filiereId`.
   * Retourne la liste des ids invalides (vide si tout est OK).
   */
  private async invalidUeIds(
    client: PoolClient,
    tenantId: string,
    filiereId: string,
    ueIds: string[]
  ): Promise<string[]> {
    const res = await client.query(
      `SELECT id FROM professional_ue
       WHERE tenant_id = $1 AND filiere_id = $2 AND id = ANY($3::uuid[])`,
      [tenantId, filiereId, ueIds]
    );
    const valid = new Set(res.rows.map((r) => r.id));
    return ueIds.filter((id) => !valid.has(id));
  }

  /** Insère un semestre + ses liens UE dans une transaction ouverte. */
  private async insertSemestre(
    client: PoolClient,
    tenantId: string,
    filiereId: string,
    libelle: string,
    ueIds: string[],
    createdBy?: string
  ): Promise<{ id: string }> {
    const ins = await client.query(
      `INSERT INTO professional_semestres (tenant_id, filiere_id, libelle, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, filiereId, libelle.trim(), createdBy ?? null]
    );
    const semestreId = ins.rows[0].id as string;
    for (const ueId of ueIds) {
      await client.query(
        `INSERT INTO professional_semestre_ue (tenant_id, semestre_id, ue_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, semestre_id, ue_id) DO NOTHING`,
        [tenantId, semestreId, ueId]
      );
    }
    return { id: semestreId };
  }

  async createSemestre(
    tenantId: string,
    input: CreateProfessionalSemestre,
    createdBy?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const fil = await client.query(
        `SELECT 1 FROM programmes WHERE id = $1 AND tenant_id = $2`,
        [input.filiere_id, tenantId]
      );
      if (fil.rowCount === 0) return fail("FILIERE_NOT_FOUND", "Filière introuvable.");

      const ueIds = Array.from(new Set(input.ue_ids));
      const invalid = await this.invalidUeIds(client, tenantId, input.filiere_id, ueIds);
      if (invalid.length > 0) {
        return fail(
          "SEMESTRE_UE_INVALID",
          "Certaines UE sélectionnées n'appartiennent pas à la filière choisie."
        );
      }
      try {
        const r = await this.insertSemestre(
          client,
          tenantId,
          input.filiere_id,
          input.libelle,
          ueIds,
          createdBy
        );
        return ok(r);
      } catch (e: any) {
        if (e?.code === "23505") {
          return fail("DUPLICATE_SEMESTRE", "Un semestre de ce libellé existe déjà dans cette filière.");
        }
        throw e;
      }
    });
  }

  /** Création groupée de plusieurs semestres d'une même filière. */
  async createSemestresBatch(
    tenantId: string,
    input: CreateProfessionalSemestresBatch,
    createdBy?: string
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const fil = await client.query(
        `SELECT 1 FROM programmes WHERE id = $1 AND tenant_id = $2`,
        [input.filiere_id, tenantId]
      );
      if (fil.rowCount === 0) return fail("FILIERE_NOT_FOUND", "Filière introuvable.");

      const created: { id: string }[] = [];
      try {
        for (const sem of input.semestres) {
          const ueIds = Array.from(new Set(sem.ue_ids));
          const invalid = await this.invalidUeIds(client, tenantId, input.filiere_id, ueIds);
          if (invalid.length > 0) {
            return fail(
              "SEMESTRE_UE_INVALID",
              `Certaines UE du semestre « ${sem.libelle} » n'appartiennent pas à la filière choisie.`
            );
          }
          const r = await this.insertSemestre(
            client,
            tenantId,
            input.filiere_id,
            sem.libelle,
            ueIds,
            createdBy
          );
          created.push(r);
        }
      } catch (e: any) {
        if (e?.code === "23505") {
          return fail(
            "DUPLICATE_SEMESTRE",
            "Deux semestres portent le même libellé (ou il existe déjà) dans cette filière."
          );
        }
        throw e;
      }
      return ok({ ids: created.map((c) => c.id), count: created.length });
    });
  }

  async updateSemestre(
    tenantId: string,
    id: string,
    input: UpdateProfessionalSemestre
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const head = await client.query(
        `SELECT filiere_id FROM professional_semestres WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (head.rowCount === 0) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");
      const filiereId = head.rows[0].filiere_id as string;

      if (input.libelle !== undefined) {
        try {
          await client.query(
            `UPDATE professional_semestres SET libelle = $1, updated_at = now()
             WHERE id = $2 AND tenant_id = $3`,
            [input.libelle.trim(), id, tenantId]
          );
        } catch (e: any) {
          if (e?.code === "23505") {
            return fail("DUPLICATE_SEMESTRE", "Un semestre de ce libellé existe déjà dans cette filière.");
          }
          throw e;
        }
      }

      if (input.ue_ids !== undefined) {
        const ueIds = Array.from(new Set(input.ue_ids));
        const invalid = await this.invalidUeIds(client, tenantId, filiereId, ueIds);
        if (invalid.length > 0) {
          return fail(
            "SEMESTRE_UE_INVALID",
            "Certaines UE sélectionnées n'appartiennent pas à la filière du semestre."
          );
        }
        // Remplacement de l'ensemble des UE.
        await client.query(
          `DELETE FROM professional_semestre_ue WHERE semestre_id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
        for (const ueId of ueIds) {
          await client.query(
            `INSERT INTO professional_semestre_ue (tenant_id, semestre_id, ue_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, semestre_id, ue_id) DO NOTHING`,
            [tenantId, id, ueId]
          );
        }
        await client.query(
          `UPDATE professional_semestres SET updated_at = now() WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
      }

      return ok({ id });
    });
  }

  /**
   * Crée des SESSIONS par semestre : pour chaque bloc, une session par UE du
   * semestre (datée selon le bloc), rattachée au semestre via
   * `professional_semestre_sessions`. Permet « un semestre » ou « toute la
   * filière » (plusieurs blocs), à des dates indépendantes.
   */
  async createSessionsBySemestre(
    tenantId: string,
    input: CreateSessionsBySemestre
  ): Promise<ServiceResult<any>> {
    return this.withTenantTx(tenantId, async (client) => {
      const fil = await client.query(
        `SELECT 1 FROM programmes WHERE id = $1 AND tenant_id = $2`,
        [input.filiere_id, tenantId]
      );
      if (fil.rowCount === 0) return fail("FILIERE_NOT_FOUND", "Filière introuvable.");

      let sessionsCreated = 0;
      const semestresTouched: string[] = [];

      for (const block of input.blocks) {
        // Le semestre doit appartenir à la filière.
        const sem = await client.query(
          `SELECT id, libelle FROM professional_semestres
           WHERE id = $1 AND tenant_id = $2 AND filiere_id = $3`,
          [block.semestre_id, tenantId, input.filiere_id]
        );
        if (sem.rowCount === 0) {
          return fail("SEMESTRE_NOT_FOUND", "Un semestre sélectionné n'appartient pas à la filière.");
        }

        // UE composant le semestre.
        const ueRes = await client.query(
          `SELECT u.id, u.code
           FROM professional_semestre_ue su
           JOIN professional_ue u ON u.id = su.ue_id AND u.tenant_id = su.tenant_id
           WHERE su.semestre_id = $1 AND su.tenant_id = $2
           ORDER BY u.code`,
          [block.semestre_id, tenantId]
        );
        if (ueRes.rowCount === 0) {
          return fail(
            "SEMESTRE_EMPTY",
            `Le semestre « ${sem.rows[0].libelle} » ne contient aucune UE.`
          );
        }

        const statut = block.statut ?? "brouillon";
        // Affectations enseignant par ECUE pour ce bloc.
        const teacherByEcue = new Map<string, string>(
          (block.ecue_teachers ?? []).map((t) => [t.ecue_id, t.enseignant_id])
        );

        for (const ue of ueRes.rows) {
          const ins = await client.query(
            `INSERT INTO professional_ue_sessions
               (tenant_id, ue_id, libelle, date_debut, date_fin,
                inscription_ouverte_le, inscription_fermee_le, capacite_max, statut)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
              tenantId,
              ue.id,
              `${block.libelle.trim()} — ${ue.code}`,
              block.date_debut,
              block.date_fin,
              block.inscription_ouverte_le,
              block.inscription_fermee_le,
              block.capacite_max ?? null,
              statut,
            ]
          );
          const sessionId = ins.rows[0].id as string;
          // Rattachement de la session au semestre.
          await client.query(
            `INSERT INTO professional_semestre_sessions (tenant_id, semestre_id, ue_session_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, semestre_id, ue_session_id) DO NOTHING`,
            [tenantId, block.semestre_id, sessionId]
          );

          // Affecte les enseignants aux ECUE de cette UE (si fournis).
          if (teacherByEcue.size > 0) {
            const ecueRows = await client.query(
              `SELECT l.ecue_id,
                      (e.libelle ILIKE 'conduite%' OR e.code ILIKE '%EC-CON%') AS is_conduite
               FROM professional_ue_ecue l
               JOIN professional_ecue e ON e.id = l.ecue_id
               WHERE l.ue_id=$1 AND l.tenant_id=$2`,
              [ue.id, tenantId]
            );
            for (const er of ecueRows.rows) {
              // La Conduite ne reçoit jamais d'enseignant (note de semestre).
              if (er.is_conduite) continue;
              const enseignant = teacherByEcue.get(er.ecue_id);
              if (!enseignant) continue;
              await client.query(
                `INSERT INTO professional_session_ecue_teachers
                   (tenant_id, ue_session_id, ecue_id, enseignant_id)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (tenant_id, ue_session_id, ecue_id)
                 DO UPDATE SET enseignant_id = EXCLUDED.enseignant_id, updated_at = now()`,
                [tenantId, sessionId, er.ecue_id, enseignant]
              );
            }
          }
          sessionsCreated += 1;
        }
        semestresTouched.push(block.semestre_id);
      }

      return ok({ sessions_created: sessionsCreated, semestres: semestresTouched.length });
    });
  }

  async deleteSemestre(tenantId: string, id: string): Promise<ServiceResult<any>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM professional_semestres WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (res.rowCount === 0) return fail("SEMESTRE_NOT_FOUND", "Semestre introuvable.");
      return ok({ id });
    });
  }
}
