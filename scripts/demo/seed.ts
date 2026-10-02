/**
 * Seed de démonstration : trois établissements (Secondaire, Primaire, Supérieur) créés par l'API HTTP publique, en processus
 * (voir `scripts/seed-v2` : scénario de base + prolongement `scripts/seed-v2/demo`), puis écriture des comptes de test dans
 * `.demo/credentials.json` (fichier local ignoré par git). Les mots de passe sont générés à l'exécution et ne sont JAMAIS affichés.
 *
 * Variables : celles de `scripts/demo/lib/env.mjs` + DEMO_CREDENTIALS_JSON.
 * Développement : DEMO_SEED_PACKS=SECONDARY,PRIMARY,HIGHER (sous-ensemble) et DEMO_SEED_SLUG_SUFFIX=-d1 (autre jeu de slugs).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildDataset, defaultYearStart } from "../seed-v2/dataset";
import { assertSeedAllowed, assertSeedEnvironment, DEFAULT_SEED, type SeedPack } from "../seed-v2/guards";
import { startSeedPlatform } from "../seed-v2/runtime";
import { runScenario, type SeedReport } from "../seed-v2/scenario";
import { demoExtension } from "../seed-v2/demo";

const DEMO_TENANTS: Array<{ slug: string; pack: SeedPack; label: string }> = [
  { slug: "demo-secondaire", pack: "SECONDARY", label: "Secondaire (collège / lycée)" },
  { slug: "demo-primaire", pack: "PRIMARY", label: "Primaire (maternelle / primaire)" },
  { slug: "demo-superieur", pack: "HIGHER", label: "Supérieur (LMD)" },
];

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
  assertSeedAllowed(env, env.V2_DATABASE_URL);
  assertSeedEnvironment(env);
  const log = (line: string): void => console.log(line);
  const yearStart = defaultYearStart(new Date());
  const suffix = env.DEMO_SEED_SLUG_SUFFIX ?? "";
  const only = (env.DEMO_SEED_PACKS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const rows: CredentialRow[] = [];
  const reports: SeedReport[] = [];
  const warnings: string[] = [];

  const platform = await startSeedPlatform(env);
  try {
    for (const t of DEMO_TENANTS) {
      if (only.length > 0 && !only.includes(t.pack)) continue;
      const slug = `${t.slug}${suffix}`;
      log(`\n=== ${t.label} : ${slug} ===`);
      const data = buildDataset({ pack: t.pack, seed: DEFAULT_SEED, slug, yearStart });
      // Primaire : deux semestres (le parcours de la maternelle, éprouvé par le test de sortie de la phase 3, les utilise).
      if (t.pack === "PRIMARY") data.periodPlan = "TWO_SEMESTERS";
      const report = await runScenario(platform, data, log, {
        extend: async (ctx) => {
          const out = await demoExtension(ctx, { importDir: env.DEMO_IMPORT_DIR });
          for (const w of out.warnings) warnings.push(`${slug} : ${w.step} : ${w.message}`);
        },
      });
      reports.push(report);
      if (report.alreadySeeded) throw new Error(`Le tenant « ${slug} » existe déjà (base non vide) : lancez « pnpm demo:reset » pour repartir d'une base neuve.`);
      for (const a of report.accounts) rows.push({ tenant: slug, pack: t.pack, role: a.role, email: a.email, password: a.password, ...(a.totpSecret ? { totpSecret: a.totpSecret } : {}) });
      log(`  volumes : ${Object.entries(report.counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
  } finally {
    await platform.stop();
  }

  const file = env.DEMO_CREDENTIALS_JSON as string;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), accounts: rows }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  for (const w of warnings) console.log(`⚠ ${w}`);
  console.log(`\nSeed terminé : ${reports.length} établissement(s), ${rows.length} comptes, ${warnings.length} avertissement(s).`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[seed] ÉCHEC :", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
