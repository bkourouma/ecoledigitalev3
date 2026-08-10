import type { PoolClient } from "pg";
import type {
  DiplomaCreateInput,
  DiplomaUpdateInput,
  DiplomaRequirementInput,
  DiplomaDto,
  DiplomaDetailDto,
  DiplomaRequirementDto,
  DiplomaRequirementsSnapshot,
  StudentDiplomaDto,
<<<<<<< HEAD
=======
  StudentDiplomaStatut,
>>>>>>> 030-pedagogie-ue-ecue
  StudentDiplomaSummaryDto,
  DiplomaProgressDto,
  DiplomaAttestationDto,
} from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
<<<<<<< HEAD
=======
import {
  loadAllValidatedUeIdsWithConduite,
  loadCycleGroups,
  resolveCycleGroupFor,
  loadRequiredUeForCycle,
  loadMentionForFilieres,
  type CycleGroup,
} from "./professional-cycle-groups";
>>>>>>> 030-pedagogie-ue-ecue

/**
 * Service Diplômes Professionnels — feature 030.
 *
 * Le diplôme est rattaché à une Filière (`filiere_id`) et exige un ensemble
 * d'UE (`ue_id`). Les UV sont capitalisées au niveau UE : un étudiant « valide »
 * une UE via `student_professional_ue_results.statut = 'validee'`.
 */

/* ===================================================================== */
/* Fonctions pures d'éligibilité (testables unitairement)                 */
/* ===================================================================== */

/** Une exigence de diplôme, réduite aux champs utiles au calcul d'éligibilité. */
export interface DiplomaRequirementForEval {
  ue_id: string;
  nb_uv: number;
  est_obligatoire: boolean;
}

/** Résultat de l'évaluation d'éligibilité d'un étudiant à un diplôme. */
export interface DiplomaEligibilityResult {
  /** Cumul des UV des UE exigées validées (chaque UE comptée une fois). */
  uv_validees: number;
  /** Vrai si toutes les UE exigées obligatoires sont validées. */
  obligatoires_ok: boolean;
  /** Vrai si `obligatoires_ok` ET `uv_validees >= uv_required`. */
  eligible: boolean;
  validated_ue_ids: string[];
  missing_ue_ids: string[];
  missing_obligatoire_ue_ids: string[];
}

/**
 * Évalue l'éligibilité d'un étudiant à un diplôme, à partir de ses exigences et
 * de l'ensemble des UE validées (`student_professional_ue_results`). Logique
 * pure, sans accès base. Chaque UE exigée n'est comptée qu'une fois.
 */
export function evaluateDiplomaEligibility(
  requirements: DiplomaRequirementForEval[],
  uvRequired: number,
  validatedUeIds: Iterable<string>
): DiplomaEligibilityResult {
  const validated = new Set(validatedUeIds);

  // Dédoublonnage par ue_id ; une exigence obligatoire prime.
  const byUe = new Map<string, DiplomaRequirementForEval>();
  for (const req of requirements) {
    const existing = byUe.get(req.ue_id);
    if (!existing) {
      byUe.set(req.ue_id, req);
    } else if (req.est_obligatoire && !existing.est_obligatoire) {
      byUe.set(req.ue_id, { ...existing, est_obligatoire: true });
    }
  }

  let uv_validees = 0;
  let obligatoires_ok = true;
  const validated_ue_ids: string[] = [];
  const missing_ue_ids: string[] = [];
  const missing_obligatoire_ue_ids: string[] = [];

  for (const req of byUe.values()) {
    if (validated.has(req.ue_id)) {
      uv_validees += req.nb_uv;
      validated_ue_ids.push(req.ue_id);
    } else {
      missing_ue_ids.push(req.ue_id);
      if (req.est_obligatoire) {
        obligatoires_ok = false;
        missing_obligatoire_ue_ids.push(req.ue_id);
      }
    }
  }

  return {
    uv_validees,
    obligatoires_ok,
    eligible: obligatoires_ok && uv_validees >= uvRequired,
    validated_ue_ids,
    missing_ue_ids,
    missing_obligatoire_ue_ids,
  };
}

/** UE telle qu'affichée dans une vue de progression. */
export interface ProgressUe {
  ue_id: string;
  code: string;
  libelle: string;
  nb_uv: number;
  est_obligatoire: boolean;
}

/** Vue de progression d'un étudiant vers un diplôme (logique pure). */
export interface DiplomaProgressComputation {
  uv_validees: number;
  pourcentage: number;
  ue_validees: ProgressUe[];
  ue_restantes: ProgressUe[];
  ue_obligatoires_manquantes: ProgressUe[];
  eligible: boolean;
}

/** Dérive la vue de progression d'un étudiant vers un diplôme. Pure. */
export function computeDiplomaProgress(
  requirements: DiplomaRequirementDto[],
  uvRequired: number,
  validatedUeIds: Iterable<string>
): DiplomaProgressComputation {
  const validatedSet = new Set(validatedUeIds);
  const evalRes = evaluateDiplomaEligibility(
    requirements.map((r) => ({
      ue_id: r.ue_id,
      nb_uv: r.ue_nb_uv,
      est_obligatoire: r.est_obligatoire,
    })),
    uvRequired,
    validatedSet
  );
  const toUe = (r: DiplomaRequirementDto): ProgressUe => ({
    ue_id: r.ue_id,
    code: r.ue_code,
    libelle: r.ue_libelle,
    nb_uv: r.ue_nb_uv,
    est_obligatoire: r.est_obligatoire,
  });
  const ue_validees = requirements.filter((r) => validatedSet.has(r.ue_id)).map(toUe);
  const ue_restantes = requirements.filter((r) => !validatedSet.has(r.ue_id)).map(toUe);
  const ue_obligatoires_manquantes = ue_restantes.filter((m) => m.est_obligatoire);
  const pourcentage =
    uvRequired > 0 ? Math.min(100, Math.round((evalRes.uv_validees / uvRequired) * 100)) : 0;
  return {
    uv_validees: evalRes.uv_validees,
    pourcentage,
    ue_validees,
    ue_restantes,
    ue_obligatoires_manquantes,
    eligible: evalRes.eligible,
  };
}

/* ===================================================================== */
/* Service                                                               */
/* ===================================================================== */

/** Filtres de la liste admin des diplômes. */
export interface DiplomaListFilters {
  filiere_id?: string;
  statut?: string;
  q?: string;
}

<<<<<<< HEAD
/** Candidat à l'octroi manuel. */
=======
/** Candidat à l'octroi manuel, enrichi de sa progression vers le diplôme. */
>>>>>>> 030-pedagogie-ue-ecue
export interface DiplomaCandidate {
  student_id: string;
  student_number: string | null;
  nom_complet: string;
<<<<<<< HEAD
=======
  uv_validees: number;
  pourcentage: number;
  eligible: boolean;
  statut_octroi: StudentDiplomaStatut | null;
  reference: string | null;
  /** Date d'obtention (ISO) si le diplôme a été octroyé, sinon null. */
  date_obtention: string | null;
>>>>>>> 030-pedagogie-ue-ecue
}

const DIPLOMA_COLS = `id, tenant_id, filiere_id, code, libelle, description,
  uv_required, statut, created_by, created_at, updated_at`;

const STUDENT_DIPLOMA_COLS = `id, diploma_id, student_id, reference, statut,
  uv_total_validees, requirements_snapshot, date_obtention, date_revocation,
<<<<<<< HEAD
  motif_revocation, octroye_par, revoque_par, created_at, updated_at`;
=======
  motif_revocation, octroye_par, revoque_par, created_at, updated_at,
  authenticite_reference, authenticite_numero, authenticite_annee`;
>>>>>>> 030-pedagogie-ue-ecue

export class ProfessionalDiplomasService extends ProfessionalBaseService {
  /* ----------------------------- CRUD diplômes ----------------------- */

  async list(
    tenantId: string,
    filters: DiplomaListFilters = {}
  ): Promise<ServiceResult<DiplomaDto[]>> {
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
      const res = await client.query(
        `SELECT ${DIPLOMA_COLS} FROM professional_diplomas
         WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
        params
      );
      return ok(res.rows as DiplomaDto[]);
    });
  }

  async getById(tenantId: string, id: string): Promise<ServiceResult<DiplomaDetailDto>> {
    return this.withTenant(tenantId, async (client) => {
      const diploma = await this.selectDiploma(client, tenantId, id);
      if (!diploma) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
      const requirements = await this.loadRequirements(client, tenantId, id);
      const uv_total_atteignable = requirements.reduce((s, r) => s + r.ue_nb_uv, 0);
      const countRes = await client.query(
        `SELECT count(*)::int AS n FROM student_professional_diplomas
         WHERE diploma_id=$1 AND tenant_id=$2 AND statut='obtenu'`,
        [id, tenantId]
      );
      return ok({
        ...diploma,
        requirements,
        uv_total_atteignable,
        nb_diplomes_octroyes: countRes.rows[0].n as number,
      });
    });
  }

  async create(
    tenantId: string,
    input: DiplomaCreateInput,
    createdBy: string | null
  ): Promise<ServiceResult<DiplomaDto>> {
    return this.withTenant(tenantId, async (client) => {
      try {
        const res = await client.query(
          `INSERT INTO professional_diplomas
             (tenant_id, filiere_id, code, libelle, description, uv_required, statut, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (tenant_id, code) DO NOTHING
           RETURNING ${DIPLOMA_COLS}`,
          [
            tenantId,
            input.filiere_id,
            input.code,
            input.libelle,
            input.description ?? null,
            input.uv_required,
            input.statut ?? "actif",
            createdBy,
          ]
        );
        if (res.rowCount === 0) {
          return fail(
            "DUPLICATE_DIPLOMA_CODE",
            `Un diplôme avec le code "${input.code}" existe déjà.`
          );
        }
        return ok(res.rows[0] as DiplomaDto);
      } catch (e: any) {
        if (e?.code === "23503") {
          return fail("VALIDATION_ERROR", "La filière indiquée est introuvable.");
        }
        throw e;
      }
    });
  }

<<<<<<< HEAD
=======
  /* --------------------------- Cycles (Licence/Master) ---------------- */

  /**
   * Cycles disponibles (Licence 1→3, Master 1→2 d'une même spécialité),
   * limités à ceux ayant au moins un étudiant inscrit — pour le filtre de la
   * page Diplômes.
   */
  async listCycleGroups(tenantId: string): Promise<ServiceResult<CycleGroup[]>> {
    return this.withTenant(tenantId, async (client) => {
      return ok(await loadCycleGroups(client, tenantId));
    });
  }

  /**
   * Garantit l'existence d'un diplôme couvrant l'intégralité du cycle
   * (Licence 1→3 ou Master 1→2 d'une même spécialité) contenant `filiereId` —
   * l'étudiant doit valider toutes les UE de toutes les années du cycle, pas
   * seulement celles de la filière terminale. Resynchronise les exigences et
   * le total d'UV à chaque appel (une UE ajoutée/retirée à une filière du
   * cycle est immédiatement reflétée).
   */
  async ensureCycleDiploma(
    tenantId: string,
    filiereId: string,
    createdBy: string | null
  ): Promise<ServiceResult<DiplomaDto>> {
    return this.withTenantTx(tenantId, async (client) => {
      const group = await resolveCycleGroupFor(client, tenantId, filiereId);
      if (!group) return fail("VALIDATION_ERROR", "Filière introuvable.");

      const requiredUe = await loadRequiredUeForCycle(client, tenantId, group);
      if (requiredUe.length === 0) {
        return fail(
          "NO_UE_CONFIGURED",
          "Aucune UE n'est rattachée aux semestres de ce cycle."
        );
      }
      const uvRequired = requiredUe.reduce((s, u) => s + u.nb_uv, 0);
      const terminal = group.filieres[group.filieres.length - 1];
      const code = `DIP-${terminal.code.replace(/\d+/g, "")}`.slice(0, 50);
      const anneesLabel = group.filieres.map((f) => f.name).join(", ");

      let diploma = await this.selectDiplomaByCode(client, tenantId, code);
      if (!diploma) {
        const insertRes = await client.query(
          `INSERT INTO professional_diplomas
             (tenant_id, filiere_id, code, libelle, description, uv_required, statut, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'actif',$7)
           ON CONFLICT (tenant_id, code) DO NOTHING
           RETURNING ${DIPLOMA_COLS}`,
          [
            tenantId,
            terminal.id,
            code,
            group.libelle,
            `Diplôme généré automatiquement pour le cycle complet : ${anneesLabel}.`,
            uvRequired,
            createdBy,
          ]
        );
        diploma =
          insertRes.rowCount === 0
            ? await this.selectDiplomaByCode(client, tenantId, code)
            : (insertRes.rows[0] as DiplomaDto);
      } else if (diploma.uv_required !== uvRequired) {
        const updRes = await client.query(
          `UPDATE professional_diplomas SET uv_required=$1, updated_at=now()
           WHERE id=$2 AND tenant_id=$3 RETURNING ${DIPLOMA_COLS}`,
          [uvRequired, diploma.id, tenantId]
        );
        diploma = updRes.rows[0] as DiplomaDto;
      }
      if (!diploma) {
        return fail("DIPLOMA_NOT_FOUND", "Impossible de créer le diplôme du cycle.");
      }

      await client.query(
        `DELETE FROM professional_diploma_requirements WHERE diploma_id=$1 AND tenant_id=$2`,
        [diploma.id, tenantId]
      );
      for (let i = 0; i < requiredUe.length; i++) {
        await client.query(
          `INSERT INTO professional_diploma_requirements
             (tenant_id, diploma_id, ue_id, est_obligatoire, ordre)
           VALUES ($1,$2,$3,true,$4)`,
          [tenantId, diploma.id, requiredUe[i].ue_id, i]
        );
      }

      return ok(diploma);
    });
  }

>>>>>>> 030-pedagogie-ue-ecue
  async update(
    tenantId: string,
    id: string,
    input: DiplomaUpdateInput
  ): Promise<ServiceResult<DiplomaDto>> {
    return this.withTenant(tenantId, async (client) => {
      const sets: string[] = [];
      const params: any[] = [];
      let i = 1;
      const fields: (keyof DiplomaUpdateInput)[] = ["libelle", "description", "uv_required", "statut"];
      for (const key of fields) {
        if (input[key] !== undefined) {
          sets.push(`${key} = $${i++}`);
          params.push(input[key]);
        }
      }
      if (sets.length === 0) {
        const current = await this.selectDiploma(client, tenantId, id);
        if (!current) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
        return ok(current);
      }
      sets.push("updated_at = now()");
      params.push(id, tenantId);
      const res = await client.query(
        `UPDATE professional_diplomas SET ${sets.join(", ")}
         WHERE id=$${i++} AND tenant_id=$${i++} RETURNING ${DIPLOMA_COLS}`,
        params
      );
      if (res.rowCount === 0) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
      return ok(res.rows[0] as DiplomaDto);
    });
  }

  async delete(tenantId: string, id: string): Promise<ServiceResult<null>> {
    return this.withTenantTx(tenantId, async (client) => {
      const diploma = await this.selectDiploma(client, tenantId, id);
      if (!diploma) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
      const active = await client.query(
        `SELECT 1 FROM student_professional_diplomas
         WHERE diploma_id=$1 AND tenant_id=$2 AND statut <> 'revoque' LIMIT 1`,
        [id, tenantId]
      );
      if ((active.rowCount ?? 0) > 0) {
        return fail(
          "DIPLOMA_HAS_AWARDS",
          "Impossible de supprimer : ce diplôme a été octroyé à au moins un étudiant."
        );
      }
      await client.query(
        `DELETE FROM student_professional_diplomas WHERE diploma_id=$1 AND tenant_id=$2`,
        [id, tenantId]
      );
      await client.query(`DELETE FROM professional_diplomas WHERE id=$1 AND tenant_id=$2`, [
        id,
        tenantId,
      ]);
      return ok(null);
    });
  }

  /* ------------------------------ Exigences -------------------------- */

  async getRequirements(
    tenantId: string,
    diplomaId: string
  ): Promise<ServiceResult<DiplomaRequirementDto[]>> {
    return this.withTenant(tenantId, async (client) => {
      const diploma = await this.selectDiploma(client, tenantId, diplomaId);
      if (!diploma) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
      return ok(await this.loadRequirements(client, tenantId, diplomaId));
    });
  }

  /** Remplace atomiquement la liste des exigences (UE) d'un diplôme. */
  async replaceRequirements(
    tenantId: string,
    diplomaId: string,
    items: DiplomaRequirementInput[]
  ): Promise<ServiceResult<DiplomaRequirementDto[]>> {
    return this.withTenantTx(tenantId, async (client) => {
      const diploma = await this.selectDiploma(client, tenantId, diplomaId);
      if (!diploma) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");

      const ids = items.map((it) => it.ue_id);
      if (new Set(ids).size !== ids.length) {
        return fail("VALIDATION_ERROR", "Une UE ne peut figurer qu'une fois dans les exigences.");
      }

      // Toutes les UE doivent exister et appartenir à la filière du diplôme.
      if (ids.length > 0) {
        const ues = await client.query(
          `SELECT id, filiere_id FROM professional_ue
           WHERE id = ANY($1::uuid[]) AND tenant_id=$2`,
          [ids, tenantId]
        );
        if (ues.rowCount !== ids.length) {
          return fail("VALIDATION_ERROR", "Une UE référencée est introuvable.");
        }
        const crossFiliere = ues.rows.some((r: any) => r.filiere_id !== diploma.filiere_id);
        if (crossFiliere) {
          return fail(
            "DIPLOMA_UE_NOT_SAME_FILIERE",
            "Toutes les UE exigées doivent appartenir à la filière du diplôme."
          );
        }
      }

      await client.query(
        `DELETE FROM professional_diploma_requirements WHERE diploma_id=$1 AND tenant_id=$2`,
        [diplomaId, tenantId]
      );
      for (const it of items) {
        await client.query(
          `INSERT INTO professional_diploma_requirements
             (tenant_id, diploma_id, ue_id, est_obligatoire, ordre)
           VALUES ($1,$2,$3,$4,$5)`,
          [tenantId, diplomaId, it.ue_id, it.est_obligatoire ?? false, it.ordre ?? 0]
        );
      }
      return ok(await this.loadRequirements(client, tenantId, diplomaId));
    });
  }

  /* -------------------------- Progression étudiant ------------------- */

  async getStudentProfileId(tenantId: string, userId: string): Promise<ServiceResult<string>> {
    return this.withTenant(tenantId, async (client) => {
      const sid = await this.resolveStudentId(client, tenantId, userId);
      if (!sid) return fail("NOT_FOUND", "Profil étudiant introuvable.");
      return ok(sid);
    });
  }

  async computeProgress(
    tenantId: string,
    diplomaId: string,
    studentId: string
  ): Promise<ServiceResult<DiplomaProgressDto>> {
    return this.withTenant(tenantId, async (client) => {
      const diploma = await this.selectDiploma(client, tenantId, diplomaId);
      if (!diploma) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
      const requirements = await this.loadRequirements(client, tenantId, diplomaId);
<<<<<<< HEAD
      const validatedIds = await this.loadValidatedUeIds(client, tenantId, studentId);
=======
      const validatedIds = await loadAllValidatedUeIdsWithConduite(client, tenantId, studentId);
>>>>>>> 030-pedagogie-ue-ecue
      const view = computeDiplomaProgress(requirements, diploma.uv_required, validatedIds);
      const award = await this.loadStudentAward(client, tenantId, diplomaId, studentId);
      return ok({
        diploma,
        uv_required: diploma.uv_required,
        ...view,
        diplome_obtenu: award,
      });
    });
  }

  async listStudentDiplomas(
    tenantId: string,
    studentId: string
  ): Promise<ServiceResult<StudentDiplomaSummaryDto[]>> {
    return this.withTenant(tenantId, async (client) =>
      ok(await this.loadStudentDiplomaSummaries(client, tenantId, studentId))
    );
  }

  async listChildDiplomas(
    tenantId: string,
    parentUserId: string,
    childId: string
  ): Promise<ServiceResult<StudentDiplomaSummaryDto[]>> {
    return this.withTenant(tenantId, async (client) => {
      const linked = await this.isParentOfChild(client, tenantId, parentUserId, childId);
      if (!linked) {
        return fail("FORBIDDEN", "Cet enfant n'est pas rattaché à votre compte.");
      }
      return ok(await this.loadStudentDiplomaSummaries(client, tenantId, childId));
    });
  }

  async getAttestation(
    tenantId: string,
    diplomaId: string,
    studentId: string
  ): Promise<ServiceResult<DiplomaAttestationDto>> {
    return this.withTenant(tenantId, async (client) => {
      const award = await this.loadStudentAward(client, tenantId, diplomaId, studentId);
      if (!award || award.statut !== "obtenu") {
        return fail("DIPLOMA_NOT_AWARDED", "Ce diplôme n'a pas été obtenu par l'étudiant.");
      }
      const infoRes = await client.query(
        `SELECT d.code, d.libelle, p.name AS filiere_libelle,
                sp.id AS student_id,
                COALESCE(
                  NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),
                  u.computed_name, u.name, sp.student_number, ''
                ) AS nom_complet
         FROM professional_diplomas d
         JOIN programmes p ON p.id = d.filiere_id
         JOIN student_profiles sp ON sp.id = $2
         LEFT JOIN users u ON u.id = sp.user_id
         WHERE d.id=$1 AND d.tenant_id=$3`,
        [diplomaId, studentId, tenantId]
      );
      if (infoRes.rowCount === 0) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
      const info = infoRes.rows[0];
      const snapshot: any = award.requirements_snapshot;
      const ue_validees = (snapshot?.requirements ?? [])
        .filter((r: any) => r.validee)
        .map((r: any) => ({ code: r.code, libelle: r.libelle, nb_uv: r.nb_uv }));
<<<<<<< HEAD
      return ok({
        reference: award.reference,
=======

      const diploma = await this.selectDiploma(client, tenantId, diplomaId);
      const group = diploma ? await resolveCycleGroupFor(client, tenantId, diploma.filiere_id) : null;
      const filiereIds = group ? group.filieres.map((f) => f.id) : diploma ? [diploma.filiere_id] : [];
      const mention = await loadMentionForFilieres(client, tenantId, filiereIds, studentId);
      const authenticiteReference = await this.getOrAssignAuthenticiteReference(client, tenantId, award);

      return ok({
        reference: award.reference,
        authenticite_reference: authenticiteReference,
>>>>>>> 030-pedagogie-ue-ecue
        diplome: {
          code: info.code,
          libelle: info.libelle,
          filiere_libelle: info.filiere_libelle,
        },
        etudiant: { id: info.student_id, nom_complet: info.nom_complet ?? "" },
        date_obtention: award.date_obtention ?? "",
        uv_total_validees: award.uv_total_validees,
        ue_validees,
<<<<<<< HEAD
=======
        mention,
>>>>>>> 030-pedagogie-ue-ecue
      });
    });
  }

  /* --------------------------- Octroi / révocation ------------------- */

  async awardManual(
    tenantId: string,
    diplomaId: string,
    studentId: string,
    opts: { force?: boolean },
    awardedBy: string
  ): Promise<ServiceResult<StudentDiplomaDto>> {
    return this.withTenantTx(tenantId, async (client) => {
      const diploma = await this.selectDiploma(client, tenantId, diplomaId);
      if (!diploma) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");

      const studentExists = await client.query(
        `SELECT 1 FROM student_profiles WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
        [studentId, tenantId]
      );
      if ((studentExists.rowCount ?? 0) === 0) {
        return fail("VALIDATION_ERROR", "Étudiant introuvable.");
      }

      const existing = await client.query(
        `SELECT 1 FROM student_professional_diplomas
         WHERE diploma_id=$1 AND student_id=$2 AND tenant_id=$3 AND statut <> 'revoque' LIMIT 1`,
        [diplomaId, studentId, tenantId]
      );
      if ((existing.rowCount ?? 0) > 0) {
        return fail("DIPLOMA_ALREADY_AWARDED", "Cet étudiant détient déjà ce diplôme.");
      }

      const requirements = await this.loadRequirements(client, tenantId, diplomaId);
<<<<<<< HEAD
      const validatedSet = new Set(await this.loadValidatedUeIds(client, tenantId, studentId));
=======
      const validatedSet = new Set(await loadAllValidatedUeIdsWithConduite(client, tenantId, studentId));
>>>>>>> 030-pedagogie-ue-ecue
      const evalRes = evaluateDiplomaEligibility(
        requirements.map((r) => ({
          ue_id: r.ue_id,
          nb_uv: r.ue_nb_uv,
          est_obligatoire: r.est_obligatoire,
        })),
        diploma.uv_required,
        validatedSet
      );
      if (!evalRes.eligible && !opts.force) {
        return fail(
          "DIPLOMA_NOT_ELIGIBLE",
          "L'étudiant n'est pas éligible. Utilisez l'octroi forcé pour passer outre."
        );
      }

      const snapshot = this.buildSnapshot(diploma.uv_required, requirements, validatedSet);
      const award = await this.createAward(
        client,
        tenantId,
        diplomaId,
        studentId,
        awardedBy,
        evalRes.uv_validees,
        snapshot
      );
      if (!award) {
        return fail("DIPLOMA_ALREADY_AWARDED", "Cet étudiant détient déjà ce diplôme.");
      }
      return ok(award);
    });
  }

  async revoke(
    tenantId: string,
    diplomaId: string,
    studentId: string,
    motif: string,
    revokedBy: string
  ): Promise<ServiceResult<StudentDiplomaDto>> {
    return this.withTenant(tenantId, async (client) => {
      if (!motif || !motif.trim()) {
        return fail("VALIDATION_ERROR", "Le motif de révocation est requis.");
      }
      const res = await client.query(
        `UPDATE student_professional_diplomas
         SET statut='revoque', date_revocation=now(), motif_revocation=$1,
             revoque_par=$2, updated_at=now()
         WHERE diploma_id=$3 AND student_id=$4 AND tenant_id=$5 AND statut='obtenu'
         RETURNING ${STUDENT_DIPLOMA_COLS}`,
        [motif.trim(), revokedBy, diplomaId, studentId, tenantId]
      );
      if (res.rowCount === 0) {
        return fail("DIPLOMA_NOT_AWARDED", "Aucun diplôme obtenu à révoquer pour cet étudiant.");
      }
      return ok(res.rows[0] as StudentDiplomaDto);
    });
  }

  /**
   * Candidats à l'octroi manuel : étudiants ayant au moins une inscription
<<<<<<< HEAD
   * (non annulée) sur une cohorte d'une UE de la filière du diplôme.
=======
   * (non annulée) sur une cohorte d'une UE de l'une des filières du cycle du
   * diplôme (ex. Licence 1→3, Master 1→2 d'une même spécialité — pas
   * seulement la filière terminale).
>>>>>>> 030-pedagogie-ue-ecue
   */
  async listCandidates(
    tenantId: string,
    diplomaId: string
  ): Promise<ServiceResult<DiplomaCandidate[]>> {
    return this.withTenant(tenantId, async (client) => {
      const diploma = await this.selectDiploma(client, tenantId, diplomaId);
      if (!diploma) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
<<<<<<< HEAD
      const res = await client.query(
        `SELECT DISTINCT sp.id AS student_id, sp.student_number,
=======
      const group = await resolveCycleGroupFor(client, tenantId, diploma.filiere_id);
      const filiereIds = group ? group.filieres.map((f) => f.id) : [diploma.filiere_id];
      const res = await client.query(
        `SELECT DISTINCT sp.id AS student_id,
                sp.student_matricule AS student_number,
>>>>>>> 030-pedagogie-ue-ecue
                COALESCE(
                  NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),
                  u.computed_name, u.name, sp.student_number, ''
                ) AS nom_complet
         FROM student_profiles sp
         LEFT JOIN users u ON u.id = sp.user_id
         JOIN professional_enrollments e ON e.student_id = sp.id AND e.tenant_id = sp.tenant_id
         JOIN professional_ue_sessions sess ON sess.id = e.ue_session_id
         JOIN professional_ue ue ON ue.id = sess.ue_id
         WHERE sp.tenant_id = $1
           AND e.statut <> 'annulee'
<<<<<<< HEAD
           AND ue.filiere_id = $2
         ORDER BY nom_complet ASC`,
        [tenantId, diploma.filiere_id]
      );
      return ok(res.rows as DiplomaCandidate[]);
=======
           AND ue.filiere_id = ANY($2::uuid[])
         ORDER BY nom_complet ASC`,
        [tenantId, filiereIds]
      );

      const requirements = await this.loadRequirements(client, tenantId, diplomaId);
      const candidates: DiplomaCandidate[] = [];
      for (const row of res.rows as Array<{
        student_id: string;
        student_number: string | null;
        nom_complet: string;
      }>) {
        const validatedIds = await loadAllValidatedUeIdsWithConduite(client, tenantId, row.student_id);
        const view = computeDiplomaProgress(requirements, diploma.uv_required, validatedIds);
        const award = await this.loadStudentAward(client, tenantId, diplomaId, row.student_id);
        candidates.push({
          ...row,
          uv_validees: view.uv_validees,
          pourcentage: view.pourcentage,
          eligible: view.eligible,
          statut_octroi: award ? award.statut : null,
          reference: award ? award.reference : null,
          date_obtention: award ? award.date_obtention ?? null : null,
        });
      }
      return ok(candidates);
>>>>>>> 030-pedagogie-ue-ecue
    });
  }

  async listAwarded(
    tenantId: string,
    diplomaId: string,
    statut?: string
  ): Promise<ServiceResult<StudentDiplomaDto[]>> {
    return this.withTenant(tenantId, async (client) => {
      const diploma = await this.selectDiploma(client, tenantId, diplomaId);
      if (!diploma) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
      const params: any[] = [diplomaId, tenantId];
      let where = "spd.diploma_id=$1 AND spd.tenant_id=$2";
      if (statut) {
        params.push(statut);
        where += ` AND spd.statut=$${params.length}`;
      }
      const res = await client.query(
        `SELECT spd.id, spd.diploma_id, spd.student_id, spd.reference, spd.statut,
                spd.uv_total_validees, spd.requirements_snapshot, spd.date_obtention,
                spd.date_revocation, spd.motif_revocation, spd.octroye_par,
                spd.revoque_par, spd.created_at, spd.updated_at,
                COALESCE(
                  NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),
                  u.computed_name, u.name, sp.student_number, ''
                ) AS student_nom
         FROM student_professional_diplomas spd
         JOIN student_profiles sp ON sp.id = spd.student_id
         LEFT JOIN users u ON u.id = sp.user_id
         WHERE ${where}
         ORDER BY spd.created_at DESC`,
        params
      );
      return ok(res.rows as StudentDiplomaDto[]);
    });
  }

  /* ------------------------- Recomputation (hook) -------------------- */

  /** Réévalue les diplômes actifs exigeant `ueId` et octroie ceux désormais acquis. */
  async recomputeForStudent(
    tenantId: string,
    studentId: string,
    ueId: string
  ): Promise<ServiceResult<StudentDiplomaDto[]>> {
    return this.withTenantTx(tenantId, async (client) => {
      const diplomasRes = await client.query(
        `SELECT DISTINCT d.id, d.uv_required
         FROM professional_diplomas d
         JOIN professional_diploma_requirements r ON r.diploma_id = d.id
         WHERE d.tenant_id=$1 AND d.statut='actif' AND r.ue_id=$2`,
        [tenantId, ueId]
      );
      if (diplomasRes.rowCount === 0) return ok([]);
<<<<<<< HEAD
      const validatedSet = new Set(await this.loadValidatedUeIds(client, tenantId, studentId));
=======
      const validatedSet = new Set(await loadAllValidatedUeIdsWithConduite(client, tenantId, studentId));
>>>>>>> 030-pedagogie-ue-ecue
      const created: StudentDiplomaDto[] = [];
      for (const diploma of diplomasRes.rows) {
        const award = await this.tryAwardEligible(
          client,
          tenantId,
          { id: diploma.id, uv_required: diploma.uv_required },
          studentId,
          validatedSet,
          null
        );
        if (award) created.push(award);
      }
      return ok(created);
    });
  }

  /** Recalcule l'éligibilité de tous les étudiants ayant validé des UE du diplôme. */
  async recomputeAllForDiploma(
    tenantId: string,
    diplomaId: string
  ): Promise<ServiceResult<{ awarded: number }>> {
    return this.withTenantTx(tenantId, async (client) => {
      const diploma = await this.selectDiploma(client, tenantId, diplomaId);
      if (!diploma) return fail("DIPLOMA_NOT_FOUND", "Diplôme introuvable.");
      if (diploma.statut !== "actif") return ok({ awarded: 0 });

      const requirements = await this.loadRequirements(client, tenantId, diplomaId);
      if (requirements.length === 0) return ok({ awarded: 0 });
      const ueIds = requirements.map((r) => r.ue_id);

      const studentsRes = await client.query(
        `SELECT DISTINCT student_id FROM student_professional_ue_results
         WHERE tenant_id=$1 AND statut='validee' AND ue_id = ANY($2::uuid[])`,
        [tenantId, ueIds]
      );

      let awarded = 0;
      for (const row of studentsRes.rows) {
        const validatedSet = new Set(
<<<<<<< HEAD
          await this.loadValidatedUeIds(client, tenantId, row.student_id)
=======
          await loadAllValidatedUeIdsWithConduite(client, tenantId, row.student_id)
>>>>>>> 030-pedagogie-ue-ecue
        );
        const award = await this.tryAwardEligible(
          client,
          tenantId,
          { id: diploma.id, uv_required: diploma.uv_required },
          row.student_id,
          validatedSet,
          null
        );
        if (award) awarded++;
      }
      return ok({ awarded });
    });
  }

  /* ------------------------------ Helpers ---------------------------- */

  private async selectDiploma(
    client: PoolClient,
    tenantId: string,
    id: string
  ): Promise<DiplomaDto | null> {
    const res = await client.query(
      `SELECT ${DIPLOMA_COLS} FROM professional_diplomas WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId]
    );
    return res.rowCount === 0 ? null : (res.rows[0] as DiplomaDto);
  }

<<<<<<< HEAD
=======
  private async selectDiplomaByCode(
    client: PoolClient,
    tenantId: string,
    code: string
  ): Promise<DiplomaDto | null> {
    const res = await client.query(
      `SELECT ${DIPLOMA_COLS} FROM professional_diplomas WHERE code=$1 AND tenant_id=$2`,
      [code, tenantId]
    );
    return res.rowCount === 0 ? null : (res.rows[0] as DiplomaDto);
  }

>>>>>>> 030-pedagogie-ue-ecue
  /** Charge les exigences d'un diplôme, enrichies des données d'UE. */
  private async loadRequirements(
    client: PoolClient,
    tenantId: string,
    diplomaId: string
  ): Promise<DiplomaRequirementDto[]> {
    const res = await client.query(
      `SELECT r.id, r.diploma_id, r.ue_id,
              u.code AS ue_code, u.libelle AS ue_libelle, u.nb_uv AS ue_nb_uv,
              r.est_obligatoire, r.ordre
       FROM professional_diploma_requirements r
       JOIN professional_ue u ON u.id = r.ue_id
       WHERE r.diploma_id=$1 AND r.tenant_id=$2
       ORDER BY r.ordre ASC, u.libelle ASC`,
      [diplomaId, tenantId]
    );
    return res.rows as DiplomaRequirementDto[];
  }

<<<<<<< HEAD
  /** Ids des UE validées par l'étudiant (`student_professional_ue_results`). */
  private async loadValidatedUeIds(
    client: PoolClient,
    tenantId: string,
    studentId: string
  ): Promise<string[]> {
    const res = await client.query(
      `SELECT ue_id FROM student_professional_ue_results
       WHERE student_id=$1 AND tenant_id=$2 AND statut='validee'`,
      [studentId, tenantId]
    );
    return res.rows.map((r: any) => r.ue_id as string);
  }
=======
>>>>>>> 030-pedagogie-ue-ecue

  private buildSnapshot(
    uvRequired: number,
    requirements: DiplomaRequirementDto[],
    validatedSet: Set<string>
  ): DiplomaRequirementsSnapshot {
    return {
      uv_required: uvRequired,
      captured_at: new Date().toISOString(),
      requirements: requirements.map((r) => ({
        ue_id: r.ue_id,
        code: r.ue_code,
        libelle: r.ue_libelle,
        nb_uv: r.ue_nb_uv,
        est_obligatoire: r.est_obligatoire,
        ordre: r.ordre,
        validee: validatedSet.has(r.ue_id),
      })),
    };
  }

  private async generateReference(client: PoolClient, tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const res = await client.query(
      `SELECT count(*)::int AS n FROM student_professional_diplomas
       WHERE tenant_id=$1 AND reference LIKE $2`,
      [tenantId, `DIP-${year}-%`]
    );
    const seq = (res.rows[0].n as number) + 1;
    return `DIP-${year}-${String(seq).padStart(6, "0")}`;
  }

<<<<<<< HEAD
=======
  /**
   * Numéro de référence de l'attestation d'authenticité : AUTH/{année}/{NNN}.
   * Attribué une seule fois par octroi (idempotent — régénérer le PDF
   * renvoie toujours le même numéro), séquentiel par tenant, sur l'année de
   * GÉNÉRATION (pas l'année d'obtention du diplôme, qui peut différer).
   *
   * Le décompte reprend automatiquement là où en sont les diplômes déjà
   * obtenus : le nombre de diplômes `obtenu` existants (tous cycles, toutes
   * années confondus) sert de base, à laquelle s'ajoutent les numéros déjà
   * attribués cette année — pas besoin de configurer un point de départ à la
   * main, le compteur suit simplement les octrois déjà enregistrés.
   */
  private async getOrAssignAuthenticiteReference(
    client: PoolClient,
    tenantId: string,
    award: Pick<StudentDiplomaDto, "id" | "authenticite_reference">
  ): Promise<string> {
    if (award.authenticite_reference) return award.authenticite_reference;

    const annee = new Date().getFullYear();

    for (let attempt = 0; attempt < 5; attempt++) {
      const baseRes = await client.query(
        `SELECT
           (SELECT count(*)::int FROM student_professional_diplomas
             WHERE tenant_id=$1 AND statut='obtenu') AS deja_obtenus,
           (SELECT count(*)::int FROM student_professional_diplomas
             WHERE tenant_id=$1 AND authenticite_annee=$2) AS deja_numerotes`,
        [tenantId, annee]
      );
      const { deja_obtenus, deja_numerotes } = baseRes.rows[0] as {
        deja_obtenus: number;
        deja_numerotes: number;
      };
      const numero = deja_obtenus + deja_numerotes + 1;
      const reference = `AUTH/${annee}/${String(numero).padStart(3, "0")}`;
      try {
        await client.query(
          `UPDATE student_professional_diplomas
           SET authenticite_reference=$1, authenticite_numero=$2, authenticite_annee=$3
           WHERE id=$4`,
          [reference, numero, annee, award.id]
        );
        return reference;
      } catch (err: any) {
        if (err?.code === "23505" && attempt < 4) continue; // collision : réessaie avec le compte à jour
        throw err;
      }
    }
    throw new Error("Impossible d'attribuer un numéro d'attestation d'authenticité.");
  }

>>>>>>> 030-pedagogie-ue-ecue
  private async createAward(
    client: PoolClient,
    tenantId: string,
    diplomaId: string,
    studentId: string,
    octroyePar: string | null,
    uvTotal: number,
    snapshot: DiplomaRequirementsSnapshot
  ): Promise<StudentDiplomaDto | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reference = await this.generateReference(client, tenantId);
      try {
        const res = await client.query(
          `INSERT INTO student_professional_diplomas
             (tenant_id, diploma_id, student_id, reference, statut, uv_total_validees,
              requirements_snapshot, date_obtention, octroye_par)
           VALUES ($1,$2,$3,$4,'obtenu',$5,$6::jsonb,now(),$7)
           RETURNING ${STUDENT_DIPLOMA_COLS}`,
          [tenantId, diplomaId, studentId, reference, uvTotal, JSON.stringify(snapshot), octroyePar]
        );
        return res.rows[0] as StudentDiplomaDto;
      } catch (e: any) {
        if (e?.code === "23505") {
          if (e?.constraint === "uniq_student_prof_diploma_active") return null;
          continue;
        }
        throw e;
      }
    }
    throw new Error("Impossible de générer une référence de diplôme unique.");
  }

  private async tryAwardEligible(
    client: PoolClient,
    tenantId: string,
    diploma: { id: string; uv_required: number },
    studentId: string,
    validatedSet: Set<string>,
    octroyePar: string | null
  ): Promise<StudentDiplomaDto | null> {
    const existing = await client.query(
      `SELECT 1 FROM student_professional_diplomas
       WHERE diploma_id=$1 AND student_id=$2 AND tenant_id=$3 AND statut <> 'revoque' LIMIT 1`,
      [diploma.id, studentId, tenantId]
    );
    if ((existing.rowCount ?? 0) > 0) return null;

    const requirements = await this.loadRequirements(client, tenantId, diploma.id);
    const evalResult = evaluateDiplomaEligibility(
      requirements.map((r) => ({
        ue_id: r.ue_id,
        nb_uv: r.ue_nb_uv,
        est_obligatoire: r.est_obligatoire,
      })),
      diploma.uv_required,
      validatedSet
    );
    if (!evalResult.eligible) return null;

    const snapshot = this.buildSnapshot(diploma.uv_required, requirements, validatedSet);
    return this.createAward(
      client,
      tenantId,
      diploma.id,
      studentId,
      octroyePar,
      evalResult.uv_validees,
      snapshot
    );
  }

  private async resolveStudentId(
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

  private async loadStudentAward(
    client: PoolClient,
    tenantId: string,
    diplomaId: string,
    studentId: string
  ): Promise<StudentDiplomaDto | null> {
    const res = await client.query(
      `SELECT ${STUDENT_DIPLOMA_COLS} FROM student_professional_diplomas
       WHERE diploma_id=$1 AND student_id=$2 AND tenant_id=$3 AND statut <> 'revoque'
       ORDER BY created_at DESC LIMIT 1`,
      [diplomaId, studentId, tenantId]
    );
    return res.rowCount === 0 ? null : (res.rows[0] as StudentDiplomaDto);
  }

  private async isParentOfChild(
    client: PoolClient,
    tenantId: string,
    parentUserId: string,
    childId: string
  ): Promise<boolean> {
    const res = await client.query(
      `SELECT 1 FROM student_parents
       WHERE parent_id=$1 AND student_id=$2 AND tenant_id=$3 LIMIT 1`,
      [parentUserId, childId, tenantId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Résumés de diplômes d'un étudiant : diplômes actifs de ses filières (via ses
   * inscriptions) + diplômes déjà octroyés, avec progression et statut d'octroi.
   */
  private async loadStudentDiplomaSummaries(
    client: PoolClient,
    tenantId: string,
    studentId: string
  ): Promise<StudentDiplomaSummaryDto[]> {
    const filRes = await client.query(
      `SELECT DISTINCT ue.filiere_id
       FROM professional_enrollments e
       JOIN professional_ue_sessions sess ON sess.id = e.ue_session_id
       JOIN professional_ue ue ON ue.id = sess.ue_id
       WHERE e.student_id=$1 AND e.tenant_id=$2 AND e.statut <> 'annulee'`,
      [studentId, tenantId]
    );
    const filiereIds = filRes.rows.map((r: any) => r.filiere_id as string);

    const awardsRes = await client.query(
      `SELECT ${STUDENT_DIPLOMA_COLS} FROM student_professional_diplomas
       WHERE student_id=$1 AND tenant_id=$2`,
      [studentId, tenantId]
    );
    const awardByDiploma = new Map<string, StudentDiplomaDto>();
    for (const a of awardsRes.rows as StudentDiplomaDto[]) {
      const existing = awardByDiploma.get(a.diploma_id);
      if (!existing || (existing.statut === "revoque" && a.statut !== "revoque")) {
        awardByDiploma.set(a.diploma_id, a);
      }
    }

    const diplomasRes = await client.query(
      `SELECT ${DIPLOMA_COLS} FROM professional_diplomas
       WHERE tenant_id=$1 AND (
         (statut='actif' AND filiere_id = ANY($2::uuid[]))
         OR id = ANY($3::uuid[])
       )
       ORDER BY libelle ASC`,
      [tenantId, filiereIds, [...awardByDiploma.keys()]]
    );

<<<<<<< HEAD
    const validatedIds = await this.loadValidatedUeIds(client, tenantId, studentId);
=======
    const validatedIds = await loadAllValidatedUeIdsWithConduite(client, tenantId, studentId);
>>>>>>> 030-pedagogie-ue-ecue
    const summaries: StudentDiplomaSummaryDto[] = [];
    for (const diploma of diplomasRes.rows as DiplomaDto[]) {
      const requirements = await this.loadRequirements(client, tenantId, diploma.id);
      const view = computeDiplomaProgress(requirements, diploma.uv_required, validatedIds);
      const award = awardByDiploma.get(diploma.id);
      const obtenu = award && award.statut === "obtenu" ? award : null;
      summaries.push({
        diploma,
        pourcentage: view.pourcentage,
        eligible: view.eligible,
        statut_octroi: obtenu ? "obtenu" : null,
        reference: obtenu ? obtenu.reference : null,
        date_obtention: obtenu ? obtenu.date_obtention : null,
      });
    }
    return summaries;
  }
}
