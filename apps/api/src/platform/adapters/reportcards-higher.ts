/**
 * reportcards -> higher : `SignatoryDirectory` (signataires : nom, qualité, fonction, actif) et `InstitutionPort` (identité de
 * l'établissement imprimée sur les diplômes et attestations : l'identité visuelle versionnée de `reportcards`).
 *
 * Aucune valeur par défaut : un établissement sans identité renseignée ne peut pas émettre un document officiel — l'erreur
 * est explicite (`adapters.institution_identity_missing`), jamais un nom générique imprimé à sa place.
 */
import { ConflictError, type RequestContext } from "@ecoledigitale/kernel";
import { getBranding, listSignatories, type ReportcardsDeps } from "../../modules/reportcards";
import type { InstitutionPort, SignatoryDirectory } from "../../modules/higher";

export function createHigherSignatoryDirectory(reportcards: ReportcardsDeps): SignatoryDirectory {
  return {
    async getSignatory(ctx: RequestContext, signatoryId) {
      const r = await listSignatories(reportcards, ctx, {});
      if (!r.ok) return null;
      const s = r.value.find((x) => x.id === signatoryId);
      return s ? { signatoryId: s.id, fullName: s.fullName, title: s.title, function: s.jobFunction, active: s.active } : null;
    },
  };
}

export function createHigherInstitutionPort(reportcards: ReportcardsDeps): InstitutionPort {
  return {
    async getInstitution(ctx: RequestContext, institutionId) {
      // Identité propre à l'établissement, sinon identité du tenant (établissement `null`).
      const own = institutionId ? await getBranding(reportcards, ctx, { institutionId }) : null;
      const shared = own && own.ok && own.value[0] ? own : await getBranding(reportcards, ctx, { institutionId: null });
      const b = shared.ok ? shared.value[0] : undefined;
      if (!b) throw new ConflictError("L'identité de l'établissement n'est pas renseignée : renseignez-la avant d'émettre un document officiel.", { code: "adapters.institution_identity_missing" });
      return { name: b.legalName, shortName: b.shortName, address: b.address, country: null, logoRef: b.logoObjectKey };
    },
  };
}
