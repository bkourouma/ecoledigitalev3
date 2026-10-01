/**
 * Chargement des RuleSets de départ du catalogue national (`CI-HIGHER-LMD`, `CI-HIGHER-BTS`, `CI-CLASSIC-SEMESTRE`).
 *
 * Source UNIQUE : les fichiers de données de `seed/` (versionnés), jamais deux copies. Le chargeur est idempotent et
 * s'exécute au démarrage (`setup` du plugin) sous un verrou consultatif (plusieurs instances d'API ne s'y battent pas) :
 *
 *   - version absente  : insérée en BROUILLON puis menée jusqu'à « publiée » par la machine d'états (donc avec son
 *                        historique, son hash signé et son audit) — on ne contourne jamais la gouvernance ;
 *   - version présente : son hash de définition doit égaler celui des données de départ (R-RUL-12 : la v1 de la
 *                        baseline reste intacte et rejouable). Une divergence est une ERREUR (`rules.hash_mismatch`) :
 *                        pour changer une règle de départ, on ajoute une NOUVELLE version aux données.
 *
 * Chaque règle doit compiler et satisfaire son contrat, sinon le chargement échoue (rien n'est inséré).
 */
import { InternalError } from "@ecoledigitale/kernel";
import { getContract } from "../contracts";
import { checkConformity } from "../domain/conformity";
import { computeDefinitionHash } from "../domain/definition";
import { RulesCode } from "../domain/errors";
import type { GovernanceActor } from "../domain/types";
import {
  getRuleSetByCode,
  insertRules,
  insertRuleSet,
  insertVersion,
  listVersions,
  getVersion,
} from "../infrastructure/catalog-repository";
import { SEED_ACTOR_ID, SEED_ACTOR_NAME, SEED_RULE_SETS } from "../seed/rulesets";
import { seedVersionRecords } from "../seed/records";
import type { SeedRuleSet } from "../seed/types";
import type { RulesDeps } from "./deps";
import { recordVersionEvent, type WriteEnv } from "./support";
import { performTransition } from "./transitions";

export interface SeedReport {
  /** `CODE vN` des versions créées par ce chargement. */
  readonly created: string[];
  /** `CODE vN` des versions déjà présentes et vérifiées (hash égal). */
  readonly verified: string[];
}

const SEED_LOCK = "rules:seed";

export async function ensureNationalCatalog(deps: RulesDeps, sets: readonly SeedRuleSet[] = SEED_RULE_SETS): Promise<SeedReport> {
  const actor: GovernanceActor = { kind: "system", id: SEED_ACTOR_ID, name: SEED_ACTOR_NAME };
  const env: WriteEnv = { kind: "NATIONAL", tenantId: null, ctx: null, actor };
  const report: SeedReport = { created: [], verified: [] };

  await deps.systemDb.run("rules-seed-catalog", async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [SEED_LOCK]);
    for (const seedSet of sets) {
      let set = await getRuleSetByCode(tx, "NATIONAL", seedSet.code);
      if (!set) {
        set = await insertRuleSet(tx, "NATIONAL", null, {
          id: deps.newId(),
          code: seedSet.code,
          name: seedSet.name,
          countryCode: seedSet.countryCode,
          regulation: seedSet.regulation,
          educationSystem: seedSet.educationSystem,
          level: seedSet.level,
        });
      }
      for (const seedVersion of seedSet.versions) {
        const label = `${seedSet.code} v${seedVersion.versionNo}`;
        const contract = getContract(seedVersion.contractId);
        if (!contract) throw new InternalError(`Données de départ ${label} : contrat inconnu ${seedVersion.contractId}.`, { code: RulesCode.UNKNOWN_CONTRACT });
        const records = seedVersionRecords(seedVersion);
        const conformity = checkConformity(contract, records);
        if (!conformity.ok) {
          const first = conformity.violations[0]?.message ?? conformity.rules.find((r) => !r.ok)?.diagnostics[0]?.message ?? "erreur inconnue";
          throw new InternalError(`Données de départ ${label} : ne satisfont pas le contrat ${contract.id} (${first}).`, { code: RulesCode.CONTRACT_VIOLATION });
        }
        const hash = computeDefinitionHash(seedVersion.contractId, records);

        const existing = (await listVersions(tx, "NATIONAL", { ruleSetId: set.id })).find((v) => v.versionNo === seedVersion.versionNo);
        if (existing) {
          if (existing.definitionHash !== hash) {
            throw new InternalError(
              `Données de départ ${label} : l'empreinte stockée (${existing.definitionHash ?? "aucune"}) diffère de celle des données (${hash}). ` +
                "Une version de départ est immuable : ajoutez une nouvelle version aux données plutôt que de modifier celle-ci.",
              { code: RulesCode.HASH_MISMATCH },
            );
          }
          report.verified.push(label);
          continue;
        }

        const version = await insertVersion(tx, "NATIONAL", null, {
          id: deps.newId(),
          ruleSetId: set.id,
          versionNo: seedVersion.versionNo,
          contractId: seedVersion.contractId,
          effectiveFrom: seedVersion.effectiveFrom,
          effectiveTo: seedVersion.effectiveTo ?? null,
          source: { ...seedVersion.source },
          notes: seedVersion.notes ?? null,
          createdBy: null,
        });
        await insertRules(tx, "NATIONAL", null, version.id, records, deps.newId);
        await recordVersionEvent(deps, tx, env, version.id, null, "draft", "Données de départ de la plateforme.");
        for (const to of ["simulated", "proposed", "approved", "published"] as const) {
          const step = await performTransition(deps, tx, env, { versionId: version.id, to, comment: "Données de départ de la plateforme." });
          if (!step.ok) throw step.error;
        }
        const published = await getVersion(tx, "NATIONAL", version.id);
        if (published?.definitionHash !== hash) throw new InternalError(`Données de départ ${label} : hash incohérent après publication.`, { code: RulesCode.HASH_MISMATCH });
        report.created.push(label);
      }
    }
  });
  return report;
}
