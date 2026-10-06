/**
 * Seed du mode développement v2 (`pnpm dev:v2:seed`) : trois établissements de TEST (Secondaire, Primaire, Supérieur) créés dans
 * la base locale `ecoledigitale_v2` par l'API HTTP publique, en processus (mêmes scénario et prolongement que la démonstration :
 * `scripts/seed-v2`), puis écriture des comptes dans `.dev-v2/credentials.json` (local, ignoré par git, mode 0600).
 * Les mots de passe sont générés à l'exécution et ne sont JAMAIS affichés ni versionnés.
 *
 * GARDE-FOUS (propres à ce script, `scripts/seed-v2/guards.ts` reste inchangé) : ALLOW_SEED=1, NODE_ENV différent de production,
 * serveur Postgres local (localhost / 127.0.0.1 / ::1) ET base exactement `ecoledigitale_v2`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildDataset, defaultYearStart } from "../seed-v2/dataset";
import { assertSeedEnvironment, DEFAULT_SEED, SeedRefusedError, databaseNameOf, type SeedPack } from "../seed-v2/guards";
import { startSeedPlatform } from "../seed-v2/runtime";
import { runScenario, type SeedReport } from "../seed-v2/scenario";
import { demoExtension } from "../seed-v2/demo";

const TENANTS: Array<{ slug: string; pack: SeedPack; label: string }> = [
  { slug: "secondaire-test", pack: "SECONDARY", label: "Secondaire (collège / lycée)" },
  { slug: "primaire-test", pack: "PRIMARY", label: "Primaire (maternelle / primaire)" },
  { slug: "superieur-test", pack: "HIGHER", label: "Supérieur (LMD)" },
];

function assertDevSeedAllowed(env: NodeJS.ProcessEnv): void {
  if (env.ALLOW_SEED !== "1") throw new SeedRefusedError("SEED_NOT_ALLOWED", "Seed refusé : ALLOW_SEED=1 requis.");
  if (env.NODE_ENV === "production") throw new SeedRefusedError("SEED_NOT_ALLOWED", "Seed refusé : NODE_ENV=production.");
  const url = env.V2_DATABASE_URL?.trim();
  if (!url) throw new SeedRefusedError("SEED_ENV_MISSING", "Seed refusé : V2_DATABASE_URL absent.");
  const name = databaseNameOf(url);
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!local || name !== "ecoledigitale_v2") {
    throw new SeedRefusedError("SEED_DATABASE_REFUSED", `Seed refusé : base « ${name ?? "?"} » sur « ${host} » (attendu : ecoledigitale_v2 sur le serveur local).`);
  }
}

interface CredentialRow {
  tenant: string;
  pack: string;
  role: string;
  email: string;
  password: string;
  totpSecret?: string;
}

async function main(): Promise<void> {
  const env = process.env;
  assertDevSeedAllowed(env);
  // Comme l'API de ce mode, le seed chaîne l'audit en SHA-256 simple (pas de AUDIT_HMAC_KEY) : une chaîne cohérente de bout en bout.
  assertSeedEnvironment({ ...env, AUDIT_HMAC_KEY: env.AUDIT_HMAC_KEY ?? "sha256-mode" });
  const log = (line: string): void => console.log(line);
  const yearStart = defaultYearStart(new Date());
  const only = (env.DEVV2_SEED_PACKS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const rows: CredentialRow[] = [];
  const reports: SeedReport[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];

  const platform = await startSeedPlatform(env);
  try {
    for (const t of TENANTS) {
      if (only.length > 0 && !only.includes(t.pack)) continue;
      log(`\n=== ${t.label} : ${t.slug} ===`);
      const data = buildDataset({ pack: t.pack, seed: DEFAULT_SEED, slug: t.slug, yearStart });
      if (t.pack === "PRIMARY") data.periodPlan = "TWO_SEMESTERS";
      const report = await runScenario(platform, data, log, {
        extend: async (ctx) => {
          const out = await demoExtension(ctx, { importDir: undefined });
          for (const w of out.warnings) warnings.push(`${t.slug} : ${w.step} : ${w.message}`);
        },
      });
      reports.push(report);
      if (report.alreadySeeded) {
        skipped.push(t.slug);
        continue; // idempotence : l'établissement existe déjà, ses comptes ont été écrits lors du premier seed
      }
      for (const a of report.accounts) {
        rows.push({ tenant: t.slug, pack: t.pack, role: a.role, email: a.email, password: a.password, ...(a.totpSecret ? { totpSecret: a.totpSecret } : {}) });
      }
    }
  } finally {
    await platform.stop();
  }

  if (skipped.length > 0) console.log(`Déjà présents (non recréés) : ${skipped.join(", ")}. Pour repartir à neuf, supprimez-les avec la console plateforme ou recréez la base.`);
  if (rows.length > 0) {
    const file = env.DEV_CREDENTIALS_FILE as string;
    let previous: CredentialRow[] = [];
    try {
      previous = (JSON.parse((await import("node:fs")).readFileSync(file, "utf8")) as { accounts?: CredentialRow[] }).accounts ?? [];
    } catch {
      /* premier seed */
    }
    const kept = previous.filter((p) => !rows.some((r) => r.tenant === p.tenant));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), accounts: [...kept, ...rows] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  for (const w of warnings) console.log(`⚠ ${w}`);
  console.log(`\nSeed terminé : ${reports.length - skipped.length} établissement(s) créé(s), ${rows.length} comptes, ${warnings.length} avertissement(s).`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[dev-v2 seed] ÉCHEC :", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
