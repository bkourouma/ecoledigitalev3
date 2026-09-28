import type {
  SignataireCle,
  SignataireDto,
  SignataireUpdateInput,
} from "@ecoledigitale/contracts";
import { ProfessionalBaseService, ok, fail, ServiceResult } from "./professional-base.service";

/**
 * Signataires configurables des documents officiels (attestation de réussite,
 * diplôme, attestation d'authenticité). Un seul enregistrement par « titre »
 * (`cle`) et par établissement — cf. migration 0087.
 *
 * Les valeurs par défaut ci-dessous reprennent les libellés historiquement codés
 * en dur côté front : elles servent de repli si la ligne n'existe pas encore
 * (établissement créé après la migration), pour que les documents restent
 * corrects en toutes circonstances.
 */

/**
 * Exporté depuis le 23/09/2026 pour que l'espace propriétaire puisse DÉTECTER
 * qu'un établissement imprime encore ces valeurs.
 *
 * Ce sont des noms de personnes réelles. Tant qu'un établissement ne les a pas
 * remplacés, ses diplômes et ses attestations portent la signature de gens qui
 * n'ont jamais vu ses étudiants. L'écran « Documents officiels » le signale, et
 * il ne peut le faire qu'en comparant à cette source — la redéclarer ailleurs
 * garantirait qu'un jour les deux divergent et que l'alerte se taise.
 */
export const SIGNATAIRES_DEFAULTS: Record<SignataireCle, SignataireDto> = {
  attestation_reussite: {
    cle: "attestation_reussite",
    nom: "Celeste BAH",
    qualite: "Enseignant Chercheur",
    fonction: "Directeur des Etudes",
  },
  diplome_gauche: {
    cle: "diplome_gauche",
    nom: "PROFESSEUR PENE BI GUIME CREPIN",
    qualite: null,
    fonction: "Directeur du Comité Scientifique\nDirecteur de Recherche",
  },
  diplome_droite: {
    cle: "diplome_droite",
    nom: "CELESTE BAH, Enseignant - chercheur",
    qualite: null,
    fonction: "Membre du Comité Scientifique\nDirecteur Général Adjoint",
  },
  authenticite: {
    cle: "authenticite",
    nom: "BAH CELESTE",
    qualite: null,
    fonction: "Directeur Général Adjoint",
  },
};

const DEFAULTS = SIGNATAIRES_DEFAULTS;
const CLES = Object.keys(DEFAULTS) as SignataireCle[];

export class ProfessionalSignatairesService extends ProfessionalBaseService {
  /** Les 4 signataires, complétés par les valeurs par défaut si absents en base. */
  async list(tenantId: string): Promise<ServiceResult<SignataireDto[]>> {
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `SELECT cle, nom, qualite, fonction FROM professional_signataires
          WHERE tenant_id = $1`,
        [tenantId]
      );
      const byCle = new Map<string, SignataireDto>(
        (res.rows as SignataireDto[]).map((r) => [r.cle, r])
      );
      return ok(CLES.map((cle) => byCle.get(cle) ?? DEFAULTS[cle]));
    });
  }

  /** Enregistre (crée ou remplace) le signataire d'un titre donné. */
  async upsert(
    tenantId: string,
    cle: SignataireCle,
    input: SignataireUpdateInput
  ): Promise<ServiceResult<SignataireDto>> {
    if (!CLES.includes(cle)) return fail("VALIDATION_ERROR", "Titre de signataire inconnu.");
    return this.withTenant(tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO professional_signataires (tenant_id, cle, nom, qualite, fonction)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, cle) DO UPDATE
           SET nom = EXCLUDED.nom,
               qualite = EXCLUDED.qualite,
               fonction = EXCLUDED.fonction,
               updated_at = now()
         RETURNING cle, nom, qualite, fonction`,
        [tenantId, cle, input.nom, input.qualite ?? null, input.fonction ?? null]
      );
      return ok(res.rows[0] as SignataireDto);
    });
  }
}
