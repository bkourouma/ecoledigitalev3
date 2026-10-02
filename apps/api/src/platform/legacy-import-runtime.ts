/**
 * Assemblage minimal pour `pnpm iam:import-legacy` : connexions legacy (lecture seule) et v2 (rôle applicatif
 * `app_user`, jamais superuser), service `iam` sans secret de production, et ligne de commande.
 *
 * `iam` est construit avec des secrets JETABLES propres au processus : l'import ne signe, ne chiffre et ne vérifie
 * aucun jeton (`provisionMember` écrit un hash déjà calculé), il n'a donc pas besoin de `IAM_JWT_SECRET` /
 * `IAM_MFA_ENCRYPTION_KEY` de production — qu'il ne faut pas copier sur le poste qui lance l'import.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Pool } from "pg";
import { SystemDb, TenantDb } from "@ecoledigitale/database";
import { consoleLogger, systemClock, type Logger } from "@ecoledigitale/kernel";
import { buildIamConfig, createIamService } from "../modules/iam";
import { importLegacyUsers, openLegacyPool, type ImportDeps, type ImportReport } from "./legacy-import";
import { assertSafeDbRole } from "./v2-context";

export interface ImportRuntime {
  deps: ImportDeps;
  close(): Promise<void>;
}

export async function createImportRuntime(options: { legacyUrl: string; v2Url: string; logger: Logger }): Promise<ImportRuntime> {
  const legacy = await openLegacyPool(options.legacyUrl);
  const v2Pool = new Pool({ connectionString: options.v2Url, max: 4, application_name: "iam-import-legacy-v2" });
  try {
    await assertSafeDbRole(v2Pool); // même garde que l'API : refuse superuser / BYPASSRLS / propriétaire
  } catch (e) {
    await Promise.allSettled([legacy.end(), v2Pool.end()]);
    throw e;
  }
  const tenantDb = new TenantDb(v2Pool, { statementTimeoutMs: 30_000 });
  const systemDb = new SystemDb(tenantDb, { logger: options.logger });
  const iam = createIamService({
    config: buildIamConfig({ jwtSecret: randomBytes(48).toString("base64"), mfaEncryptionKey: randomBytes(32).toString("base64") }),
    tenantDb,
    systemDb,
    logger: options.logger,
  });
  return {
    deps: { legacy, tenantDb, systemDb, iam, clock: systemClock, logger: options.logger },
    async close() {
      await iam.drainBackground();
      await Promise.allSettled([legacy.end(), v2Pool.end()]);
    },
  };
}

// -----------------------------------------------------------------------------
// Ligne de commande (scripts/iam/import-legacy.ts n'est qu'une enveloppe)
// -----------------------------------------------------------------------------

export const IMPORT_USAGE = `Usage : pnpm iam:import-legacy [-- --dry-run] [--tenant <slug>] [--report <fichier.json>]

Importe les utilisateurs du legacy dans iam (identités + accès) et rbac (assignations). Idempotent ; lecture seule côté legacy.

Environnement
  LEGACY_DATABASE_URL            base legacy (défaut : DATABASE_URL). Ouverte en LECTURE SEULE.
  V2_DATABASE_URL                base v2, rôle applicatif (membre de app_user ; superuser refusé).
  IAM_IMPORT_TECHNICAL_PASSWORD  mot de passe des comptes techniques (users.is_technical_account). Sans lui, ils sont
                                 ignorés ; il n'existe AUCUN défaut. Soumis à la politique de mot de passe d'iam.

Préalable : l'API a démarré au moins une fois contre la base v2 (synchronisation des tenants + rôles système).
Le rapport (stdout, ou --report) liste les cas ambigus ; il ne contient ni mot de passe ni hash.`;

export function summarizeImport(report: ImportReport): string {
  const t = report.totals;
  const lines = [
    `${report.dryRun ? "SIMULATION — " : ""}Import terminé : ${t.tenants} établissement(s) traité(s), ${t.tenantsSkipped} ignoré(s).`,
    `  comptes lus ........... ${t.usersSeen}`,
    `  identités créées ...... ${t.identitiesCreated}`,
    `  accès créés ........... ${t.membershipsCreated} (déjà présents : ${t.membershipsExisting})`,
    `  assignations RBAC ..... ${t.assignmentsGranted} (déjà présentes : ${t.assignmentsExisting})`,
    `  comptes ignorés ....... ${t.skipped}`,
  ];
  const kinds = Object.entries(report.ambiguityCounts);
  if (kinds.length > 0) {
    lines.push("  cas ambigus :");
    for (const [kind, n] of kinds) lines.push(`    - ${kind}: ${n}`);
  }
  return lines.join("\n");
}

/** Renvoie le code de sortie. Aucune donnée sensible n'est écrite. */
export async function runImportCli(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
  const valueOf = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i !== -1) return argv[i + 1];
    return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  };
  if (flags.has("--help") || argv.includes("-h")) {
    console.log(IMPORT_USAGE);
    return 0;
  }
  const legacyUrl = (env.LEGACY_DATABASE_URL ?? env.DATABASE_URL)?.trim();
  const v2Url = env.V2_DATABASE_URL?.trim();
  if (!legacyUrl || !v2Url) {
    console.error(`LEGACY_DATABASE_URL (ou DATABASE_URL) et V2_DATABASE_URL sont obligatoires.\n${IMPORT_USAGE}`);
    return 2;
  }
  const dryRun = flags.has("--dry-run");
  const tenantSlug = valueOf("--tenant");
  const reportFile = valueOf("--report");
  const technicalPassword = env.IAM_IMPORT_TECHNICAL_PASSWORD?.trim() || undefined;

  const runtime = await createImportRuntime({ legacyUrl, v2Url, logger: consoleLogger });
  try {
    const report = await importLegacyUsers(runtime.deps, { dryRun, ...(tenantSlug ? { tenantSlug } : {}), ...(technicalPassword ? { technicalPassword } : {}) });
    console.log(summarizeImport(report));
    if (reportFile) {
      writeFileSync(reportFile, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });
      console.log(`Rapport détaillé : ${reportFile}`);
    } else if (report.ambiguities.length > 0) {
      console.log(JSON.stringify(report.ambiguities, null, 2));
    }
    return 0;
  } catch (e) {
    console.error(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await runtime.close();
  }
}
