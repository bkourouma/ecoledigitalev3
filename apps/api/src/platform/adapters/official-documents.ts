/**
 * Dépendances de `reportcards` pour les documents officiels d'AUTRES modules (reçu de paiement, bulletin de paie) : clé de
 * signature (environnement, jamais le dépôt), stockage d'objets, domaine public de vérification, audit.
 *
 * Dans l'API, ces dépendances SCELLENT et LISENT (elles n'ont pas de moteur de rendu : le PDF est produit par le worker, qui
 * porte son propre moteur et le même stockage). Sans clé de signature, sceller échoue FERMÉ (`reportcards.signing_key_missing`).
 */
import { createReportcardsDeps, ensureBuiltinTemplates, ensureSigningKeyRegistered, keyProviderFromEnv, type ReportcardsDeps } from "../../modules/reportcards";
import type { ObjectStorage } from "./storage";
import type { AdapterKit } from "./kit";

export interface OfficialDocumentDepsOptions {
  /** Audit de `reportcards` (adaptateur du port d'audit de l'API) ; absent : pas d'audit (lecture / worker). */
  readonly audit?: Parameters<typeof createReportcardsDeps>[0]["audit"];
}

const warmups = new WeakMap<ReportcardsDeps, Promise<void>>();

/**
 * Prépare le scellement des documents officiels pour ce processus : enregistre la clé publique de signature et publie les gabarits
 * de plateforme (tables GLOBALES, écrites par l'acteur `system`). Ces écritures changent d'identité : elles sont IMPOSSIBLES à
 * l'intérieur de la transaction d'un module (`TX_IDENTITY_SWITCH`). Or les modules des packs (primary_school, examinations)
 * demandent leurs documents DANS leur transaction : la plateforme lance donc cette préparation au démarrage (API et worker), hors
 * de toute transaction, et les adaptateurs l'ATTENDENT (même promesse) avant de sceller. Idempotent ; un échec (clé non
 * configurée) est rejouable et le scellement échoue alors FERMÉ comme avant.
 */
export function warmOfficialDocuments(deps: ReportcardsDeps): Promise<void> {
  let promise = warmups.get(deps);
  if (!promise) {
    promise = (async () => {
      const key = await ensureSigningKeyRegistered(deps);
      if (!key.ok) throw key.error;
      const templates = await ensureBuiltinTemplates(deps);
      if (!templates.ok) throw templates.error;
    })().catch((e) => {
      warmups.delete(deps);
      throw e;
    });
    warmups.set(deps, promise);
  }
  return promise;
}

export function createOfficialDocumentDeps(kit: AdapterKit, storage: ObjectStorage | null, options: OfficialDocumentDepsOptions = {}): ReportcardsDeps {
  let keys: ReturnType<typeof keyProviderFromEnv> = null;
  try {
    keys = keyProviderFromEnv(kit.env);
  } catch (e) {
    kit.logger.error({ err: e instanceof Error ? e.message : String(e) }, "documents officiels : clé de signature invalide (aucun scellement possible)");
  }
  const base = (kit.env.REPORTCARDS_VERIFICATION_BASE_URL ?? kit.env.V2_APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return createReportcardsDeps({
    db: kit.tenantDb,
    systemDb: kit.systemDb,
    clock: kit.clock,
    logger: kit.logger,
    ...(options.audit ? { audit: options.audit } : {}),
    keys,
    ports: storage ? { storage } : {},
    config: { verificationBaseUrl: base || null },
  });
}
