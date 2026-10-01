import { randomBytes } from "node:crypto";
import pg from "pg";
import { applyLegacySchema, type MigrationOutcome } from "./migrations";

/**
 * Accès aux bases éphémères.
 *
 * Le serveur est désigné par TEST_DATABASE_URL (Postgres JETABLE : voir run.mjs, qui en lance un dans
 * Docker, ou le service Postgres de la CI). Le harnais n'ouvre JAMAIS que des bases qu'il a créées
 * lui-même (préfixe `char_`) et ne touche pas à `postgres` ni à une autre base du serveur.
 */

const { Client, Pool } = pg;

export function adminUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL est absent. Lancez les tests via `pnpm test:characterization` (Postgres éphémère dans Docker) " +
        "ou pointez TEST_DATABASE_URL vers un Postgres JETABLE.",
    );
  }
  return url;
}

export function urlForDatabase(database: string): string {
  const u = new URL(adminUrl());
  u.pathname = `/${database}`;
  return u.toString();
}

function quoteIdent(name: string): string {
  if (!/^char_[a-z0-9_]+$/.test(name)) throw new Error(`Nom de base refusé : ${name}`);
  return `"${name}"`;
}

/** Crée la base MODELE : schéma legacy complet, aucune donnée. */
export async function createTemplateDatabase(): Promise<{ name: string; outcomes: MigrationOutcome[] }> {
  const name = `char_tpl_${randomBytes(4).toString("hex")}`;
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }
  const client = new Client({ connectionString: urlForDatabase(name) });
  await client.connect();
  try {
    const outcomes = await applyLegacySchema(client);
    return { name, outcomes };
  } finally {
    await client.end();
  }
}

export async function dropDatabase(name: string): Promise<void> {
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

export interface ScenarioDatabase {
  name: string;
  url: string;
  pool: pg.Pool;
  drop(): Promise<void>;
}

/** Copie du modèle pour un fichier de test. */
export async function createScenarioDatabase(templateName: string, label: string): Promise<ScenarioDatabase> {
  const name = `char_${label.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 30)}_${randomBytes(3).toString("hex")}`;
  const admin = new Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(templateName)}`);
  } finally {
    await admin.end();
  }
  const url = urlForDatabase(name);
  const pool = new Pool({ connectionString: url, max: 4 });
  return {
    name,
    url,
    pool,
    async drop() {
      await pool.end().catch(() => undefined);
      await dropDatabase(name);
    },
  };
}
