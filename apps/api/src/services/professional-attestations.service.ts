import type { PoolClient } from "pg";
import type { DiplomaAttestationDto } from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";
import { loadValidatedUeIdsWithConduite, loadMentionForFilieres } from "./professional-cycle-groups";

/**
 * Attestations de réussite — directement à partir des inscriptions et de la
 * validation des UE d'une filière (pas de configuration manuelle préalable,
 * contrairement au module Diplômes). Une filière compte 3 semestres ; ses UE
 * exigées sont celles rattachées à ses semestres (`professional_semestre_ue`).
 * Un étudiant a « validé tous ses crédits » quand chacune de ces UE a un
 * résultat `validee` (`student_professional_ue_results`).
 */

export interface AttestationRequiredUe {
  ue_id: string;
  code: string;
  libelle: string;
  nb_uv: number;
}

export interface AttestationRosterStudent {
  student_id: string;
  matricule: string | null;
  nom_complet: string;
  uv_required: number;
  uv_validees: number;
  pourcentage: number;
  eligible: boolean;
  ue_manquantes: AttestationRequiredUe[];
  /** Année scolaire d'obtention (« 2025-2026 ») dérivée de la dernière UE validée ; null si non éligible / dates absentes. */
  annee_scolaire: string | null;
}

/**
 * Année scolaire (« 2025-2026 ») d'une date, pivot au 1er août — identique à
 * `academicYearFromDate` du front (`diplome-format.ts`) qui alimente l'année
 * imprimée sur l'attestation, afin que le filtre corresponde au PDF.
 */
function anneeScolaireOf(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return d.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export interface AttestationRoster {
  filiere: { id: string; name: string; code: string };
  ue_requises: AttestationRequiredUe[];
  students: AttestationRosterStudent[];
}

export class ProfessionalAttestationsService extends ProfessionalBaseService {
  /** Roster des étudiants inscrits dans la filière, avec leur progression. */
  async getRoster(tenantId: string, filiereId: string): Promise<ServiceResult<AttestationRoster>> {
    return this.withTenant(tenantId, async (client) => {
      const filiere = await this.selectFiliere(client, tenantId, filiereId);
      if (!filiere) return fail("FILIERE_NOT_FOUND", "Filière introuvable.");

      const ueRequises = await this.loadRequiredUe(client, tenantId, filiereId);
      const ueIds = ueRequises.map((u) => u.ue_id);

      const studentsRes = await client.query(
        `SELECT DISTINCT en.student_id,
                COALESCE(
                  NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),
                  u.computed_name, u.name, sp.student_number, ''
                ) AS nom_complet,
                COALESCE(psm.matricule, sp.student_number) AS matricule
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
         JOIN student_profiles sp ON sp.id = en.student_id
         LEFT JOIN users u ON u.id = sp.user_id
         LEFT JOIN professional_student_matricules psm
                ON psm.student_id = en.student_id AND psm.filiere_id = $2
               AND psm.tenant_id = en.tenant_id
         WHERE en.tenant_id = $1 AND en.statut IN ('confirmee','terminee') AND ue.filiere_id = $2
         ORDER BY nom_complet ASC`,
        [tenantId, filiereId]
      );

      // Année scolaire de chaque étudiant, dérivée de la session d'UE la plus
      // récente à laquelle il est inscrit dans cette filière (la date de début
      // de session définit l'année académique de la cohorte — cf. page
      // Bulletins). Source fiable, contrairement à `date_validation` souvent
      // absente. Renseignée pour tous les inscrits, pas seulement les éligibles.
      const anneeParEtudiant = await this.loadAnneeScolaireParEtudiant(client, tenantId, filiereId);

      const students: AttestationRosterStudent[] = [];
      for (const row of studentsRes.rows as Array<{
        student_id: string;
        nom_complet: string;
        matricule: string | null;
      }>) {
        const validatedIds = await loadValidatedUeIdsWithConduite(client, tenantId, row.student_id, ueIds);
        const ueManquantes = ueRequises.filter((u) => !validatedIds.has(u.ue_id));
        const uvValidees = ueRequises
          .filter((u) => validatedIds.has(u.ue_id))
          .reduce((s, u) => s + u.nb_uv, 0);
        const uvRequired = ueRequises.reduce((s, u) => s + u.nb_uv, 0);
        const eligible = ueRequises.length > 0 && ueManquantes.length === 0;
        students.push({
          student_id: row.student_id,
          matricule: row.matricule,
          nom_complet: row.nom_complet,
          uv_required: uvRequired,
          uv_validees: uvValidees,
          pourcentage: uvRequired > 0 ? Math.min(100, Math.round((uvValidees / uvRequired) * 100)) : 0,
          eligible,
          ue_manquantes: ueManquantes,
          annee_scolaire: anneeScolaireOf(anneeParEtudiant.get(row.student_id)),
        });
      }

      return ok({ filiere, ue_requises: ueRequises, students });
    });
  }

  /** Données imprimables de l'attestation — seulement si tout est validé. */
  async getStudentAttestation(
    tenantId: string,
    filiereId: string,
    studentId: string
  ): Promise<ServiceResult<DiplomaAttestationDto>> {
    return this.withTenant(tenantId, async (client) => {
      const filiere = await this.selectFiliere(client, tenantId, filiereId);
      if (!filiere) return fail("FILIERE_NOT_FOUND", "Filière introuvable.");

      const studentRes = await client.query(
        `SELECT sp.id,
                COALESCE(
                  NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),
                  u.computed_name, u.name, sp.student_number, ''
                ) AS nom_complet,
                COALESCE(psm.matricule, sp.student_number) AS matricule
         FROM student_profiles sp
         LEFT JOIN users u ON u.id = sp.user_id
         LEFT JOIN professional_student_matricules psm
                ON psm.student_id = sp.id AND psm.filiere_id = $3
               AND psm.tenant_id = sp.tenant_id
         WHERE sp.id = $2 AND sp.tenant_id = $1`,
        [tenantId, studentId, filiereId]
      );
      if (studentRes.rowCount === 0) return fail("STUDENT_NOT_FOUND", "Étudiant introuvable.");
      const student = studentRes.rows[0] as {
        id: string;
        nom_complet: string;
        matricule: string | null;
      };

      const ueRequises = await this.loadRequiredUe(client, tenantId, filiereId);
      if (ueRequises.length === 0) {
        return fail(
          "NO_UE_CONFIGURED",
          "Aucune UE n'est rattachée aux semestres de cette filière."
        );
      }
      const ueIds = ueRequises.map((u) => u.ue_id);
      const validatedIds = await loadValidatedUeIdsWithConduite(client, tenantId, studentId, ueIds);
      const allValidated = ueRequises.every((u) => validatedIds.has(u.ue_id));
      if (!allValidated) {
        return fail(
          "NOT_ELIGIBLE",
          "Cet étudiant n'a pas encore validé toutes les UE de sa filière."
        );
      }

      const datesRes = await client.query(
        `SELECT date_validation FROM student_professional_ue_results
         WHERE tenant_id=$1 AND student_id=$2 AND statut='validee' AND ue_id = ANY($3::uuid[])
           AND date_validation IS NOT NULL`,
        [tenantId, studentId, ueIds]
      );
      const timestamps = datesRes.rows
        .map((r: any) => r.date_validation as string)
        .map((d) => new Date(d).getTime());

      // Année scolaire de la cohorte (dernière session de l'étudiant dans la
      // filière = année d'obtention) — même source que le roster, pour un filtre
      // cohérent avec le PDF. Sert aussi de repli à la date d'obtention si
      // aucune date de validation n'est renseignée.
      const anneeMap = await this.loadAnneeScolaireParEtudiant(client, tenantId, filiereId, studentId);
      const sessionDebut = anneeMap.get(studentId) ?? null;
      const anneeAcademique = anneeScolaireOf(sessionDebut);

      const dateObtention =
        timestamps.length > 0
          ? new Date(Math.max(...timestamps)).toISOString()
          : sessionDebut
            ? new Date(sessionDebut).toISOString()
            : new Date().toISOString();
      const reference = student.matricule
        ? `ATT-${student.matricule}`
        : `ATT-${studentId.slice(0, 8).toUpperCase()}`;
      const mention = await loadMentionForFilieres(client, tenantId, [filiereId], studentId);

      return ok({
        reference,
        diplome: {
          code: filiere.code,
          libelle: filiere.name,
          filiere_libelle: filiere.name,
        },
        etudiant: { id: student.id, nom_complet: student.nom_complet },
        date_obtention: dateObtention,
        annee_academique: anneeAcademique,
        uv_total_validees: ueRequises.reduce((s, u) => s + u.nb_uv, 0),
        ue_validees: ueRequises.map((u) => ({ code: u.code, libelle: u.libelle, nb_uv: u.nb_uv })),
        mention,
      });
    });
  }

  /**
   * Date de début de la DERNIÈRE session d'UE de l'étudiant dans la filière
   * (inscriptions confirmées/terminées) — l'année d'obtention / de fin de cycle.
   * Choix adapté à une attestation de réussite (constat de succès au passé :
   * « a obtenu … au cours de l'année … »). Sert de base à l'année scolaire de la
   * cohorte. Clé = student_id, valeur = date ISO.
   */
  private async loadAnneeScolaireParEtudiant(
    client: PoolClient,
    tenantId: string,
    filiereId: string,
    studentId?: string
  ): Promise<Map<string, string>> {
    const params: any[] = [tenantId, filiereId];
    let filtreEtudiant = "";
    if (studentId) {
      params.push(studentId);
      filtreEtudiant = ` AND en.student_id = $3`;
    }
    const res = await client.query(
      `SELECT en.student_id, MAX(s.date_debut)::text AS derniere
         FROM professional_enrollments en
         JOIN professional_ue_sessions s ON s.id = en.ue_session_id AND s.tenant_id = en.tenant_id
         JOIN professional_ue ue ON ue.id = s.ue_id AND ue.tenant_id = s.tenant_id
        WHERE en.tenant_id = $1 AND en.statut IN ('confirmee','terminee')
          AND ue.filiere_id = $2${filtreEtudiant}
        GROUP BY en.student_id`,
      params
    );
    const map = new Map<string, string>();
    for (const r of res.rows as Array<{ student_id: string; derniere: string | null }>) {
      if (r.derniere) map.set(r.student_id, r.derniere);
    }
    return map;
  }

  private async selectFiliere(
    client: PoolClient,
    tenantId: string,
    filiereId: string
  ): Promise<{ id: string; name: string; code: string } | null> {
    const res = await client.query(
      `SELECT id, name, code FROM programmes WHERE id=$1 AND tenant_id=$2`,
      [filiereId, tenantId]
    );
    return res.rowCount === 0 ? null : (res.rows[0] as { id: string; name: string; code: string });
  }

  /** UE exigées d'une filière : celles rattachées à l'un de ses semestres. */
  private async loadRequiredUe(
    client: PoolClient,
    tenantId: string,
    filiereId: string
  ): Promise<AttestationRequiredUe[]> {
    const res = await client.query(
      `SELECT DISTINCT u.id AS ue_id, u.code, u.libelle, u.nb_uv
       FROM professional_semestre_ue su
       JOIN professional_semestres sm ON sm.id = su.semestre_id AND sm.tenant_id = su.tenant_id
       JOIN professional_ue u ON u.id = su.ue_id AND u.tenant_id = su.tenant_id
       WHERE sm.tenant_id = $1 AND sm.filiere_id = $2
       ORDER BY u.code ASC`,
      [tenantId, filiereId]
    );
    return res.rows as AttestationRequiredUe[];
  }

}
