/**
 * Orchestration du seed (sans E/S de terminal : le CLI et le test d'intégration l'appellent) :
 * garde-fous -> jeu de données -> plateforme en processus -> scénario HTTP -> arrêt propre.
 */
import { buildDataset, defaultYearStart } from "./dataset";
import { assertSeedAllowed, assertSeedEnvironment, parseSeedArgs, type SeedArgs } from "./guards";
import { startSeedPlatform } from "./runtime";
import { runScenario, type SeedReport } from "./scenario";

export interface RunSeedOptions {
  env?: NodeJS.ProcessEnv;
  /** Horloge pour l'année par défaut (tests). */
  now?: Date;
  log?: (line: string) => void;
}

export async function runSeed(args: SeedArgs | readonly string[], options: RunSeedOptions = {}): Promise<SeedReport> {
  const env = options.env ?? process.env;
  const parsed: SeedArgs = Array.isArray(args) || typeof (args as SeedArgs).pack !== "string" ? parseSeedArgs(args as readonly string[]) : (args as SeedArgs);
  // Les garde-fous passent AVANT toute connexion.
  assertSeedAllowed(env, env.V2_DATABASE_URL);
  assertSeedEnvironment(env);

  const data = buildDataset({ pack: parsed.pack, seed: parsed.seed, slug: parsed.slug, yearStart: parsed.yearStart ?? defaultYearStart(options.now ?? new Date()) });
  const log = options.log ?? (() => undefined);
  const platform = await startSeedPlatform(env);
  try {
    return await runScenario(platform, data, log);
  } catch (error) {
    const worker = platform.workerLog.filter((l) => /"level":(40|50)/.test(l)).slice(-5);
    if (worker.length > 0 && error instanceof Error) error.message += `\nJournal du worker (avertissements) :\n${worker.join("\n")}`;
    throw error;
  } finally {
    await platform.stop();
  }
}
