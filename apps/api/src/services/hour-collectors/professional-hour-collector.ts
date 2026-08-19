import type { PoolClient } from "pg";
import type { HourCollectionScope, HourCollector, HourRecord } from "./types";
import { heureDejaPayeeSQL } from "./heures-consommees";
import {
  SEANCE_PAYABLE_PREDICATE,
  DUREE_PAYEE_SQL,
} from "../professional-seance-validation.service";

/**
 * Heures du Module Professionnel — séances d'ECUE validées.
 *
 * Ne remonte QUE les séances payables. Le prédicat n'est pas réécrit ici : il
 * est importé du service de validation, qui est aussi celui qui l'affiche à
 * l'écran. Deux définitions divergentes produiraient une liste qui annonce des
 * heures et un calcul qui en paie d'autres — l'écart le plus difficile à
 * diagnostiquer pour un gestionnaire de paie.
 *
 * S'y ajoute l'exclusion des heures DÉJÀ CONSOMMÉES par un autre bulletin
 * (`heures-consommees.ts`) : une séance validée n'est payable qu'une fois,
 * même si deux périodes couvrent la même date.
 *
 * La durée retenue vient de `DUREE_PAYEE_SQL` — la dérogation comptable si elle
 * existe, sinon les horaires. Là encore l'expression est importée, pas
 * recopiée : le calcul doit payer exactement ce que l'écran de validation
 * annonce.
 *
 * L'enseignant retenu est `professional_ecue_seances.enseignant_id`, soit
 * l'intervenant RÉEL de la séance — remplacement compris — et non le titulaire
 * de l'affectation `professional_session_ecue_teachers`.
 */
export class ProfessionalHourCollector implements HourCollector {
  readonly source = "professionnel" as const;

  async collect(client: PoolClient, scope: HourCollectionScope): Promise<HourRecord[]> {
    const { tenantId, periodStart, periodEnd, teacherIds, periodId } = scope;
    const restrict = Boolean(teacherIds && teacherIds.length > 0);
    const res = await client.query(
      `SELECT
         se.id                AS seance_id,
         se.enseignant_id     AS teacher_id,
         se.date::text        AS session_date,
         ${DUREE_PAYEE_SQL} AS hours,
         se.ecue_id,
         se.ue_session_id,
         ec.libelle           AS intitule,
         ec.code              AS code,
         us.libelle           AS cohorte_libelle
       FROM professional_ecue_seances se
       JOIN professional_ecue        ec ON ec.id = se.ecue_id       AND ec.tenant_id = se.tenant_id
       JOIN professional_ue_sessions us ON us.id = se.ue_session_id AND us.tenant_id = se.tenant_id
       WHERE se.tenant_id = $1
         AND se.date BETWEEN $2::date AND $3::date
         AND ${SEANCE_PAYABLE_PREDICATE}
         AND ($4::boolean IS FALSE OR se.enseignant_id = ANY($5::uuid[]))
         AND NOT ${heureDejaPayeeSQL("seance_id", "se.id", "se.tenant_id", "$6")}
       ORDER BY se.enseignant_id, se.date, se.heure_debut`,
      [
        tenantId,
        periodStart,
        periodEnd,
        restrict,
        restrict ? teacherIds : [],
        periodId,
      ]
    );

    return res.rows.map((r) => ({
      source: "professionnel" as const,
      teacherId: r.teacher_id,
      sessionDate: r.session_date,
      hours: Number(r.hours) || 0,
      attendanceSessionId: null,
      courseId: null,
      seanceId: r.seance_id,
      ecueId: r.ecue_id,
      ueSessionId: r.ue_session_id,
      intitule: r.intitule,
      code: r.code,
      cohorteLibelle: r.cohorte_libelle,
    }));
  }
}
