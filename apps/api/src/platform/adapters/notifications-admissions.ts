/**
 * admissions -> notifications : `ApplicantDirectory` — coordonnées du responsable d'un dossier de candidature.
 *
 * Les événements d'admissions ne portent aucune donnée personnelle (identifiants et codes) : pour écrire au candidat, le module
 * `notifications` demande ici le responsable PRINCIPAL du dossier (à défaut le premier tuteur), par le cas d'usage public
 * `getApplication` d'admissions (aucun SQL dans l'adaptateur, aucune extension du module voisin). Dossier inconnu -> aucun
 * destinataire (événement bénin) ; toute autre erreur LÈVE (le worker rejoue : jamais de message perdu en silence).
 * Lecture seule ; la clé de personne est `person:<identifiant du tuteur du dossier>` (consentement et désinscription stables).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { createAdmissionsDeps, getApplication, AdmissionsCode } from "../../modules/admissions";
import type { ApplicantDirectory } from "../../modules/notifications";
import type { AdapterKit } from "./kit";

export function createNotificationsApplicants(kit: Pick<AdapterKit, "tenantDb" | "clock" | "logger">): ApplicantDirectory {
  const deps = createAdmissionsDeps({ db: kit.tenantDb, clock: kit.clock, logger: kit.logger });
  return {
    async applicantContacts(ctx: RequestContext, applicationId: string) {
      const r = await getApplication(deps, ctx, applicationId);
      if (!r.ok) {
        if (r.error.code === AdmissionsCode.APPLICATION_NOT_FOUND) return [];
        throw r.error;
      }
      const guardians = r.value.guardians;
      const g = guardians.find((x) => x.isPrimary) ?? guardians[0];
      if (!g || (!g.email && !g.phone)) return [];
      return [
        {
          subjectKey: `person:${g.id}`,
          aliasKeys: [],
          userId: null,
          displayName: `${g.firstName} ${g.lastName}`.trim(),
          email: g.email,
          phone: g.phone,
          kind: "GUARDIAN" as const,
          flags: { primary: g.isPrimary, financial: g.isFinancialResponsible },
        },
      ];
    },
  };
}
