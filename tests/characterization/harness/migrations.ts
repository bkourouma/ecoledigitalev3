import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { legacyPrismaMigrationsDir, legacySqlMigrationsDir } from "./paths";

/**
 * Construction du schéma LEGACY sur une base vierge.
 *
 * POURQUOI CE N'EST PAS « psql -f » SUR LES 164 MIGRATIONS
 * Le schéma de production n'est reconstructible depuis aucune des deux chaînes seule
 * (docs/inventory/README.md, « Lire avec précaution ») :
 *   - la baseline Prisma (`apps/api/prisma/migrations/20260403110000_baseline`) est un INSTANTANÉ du résultat cumulé
 *     des anciennes migrations SQL : users, tenants, student_profiles, courses, classes, payment_*, teacher_*... ainsi
 *     que 9 tables que le SQL n'a jamais créées (bilan_types, course_assignments, teaching_hours,
 *     student_period_attendance_summaries...). `deploy.sh` n'exécute que la chaîne Prisma ;
 *   - les migrations SQL de `infra/scripts/migrations` créent tout le module Professionnel (0061+), la RLS (0055),
 *     la paie (0103+). Les plus anciennes (0001-0028) font double emploi avec la baseline, échouent sur une base
 *     qui la contient (types, tables déjà créés), sont parfois cassées (syntaxe) et l'une (0022) SUPPRIME la table
 *     `courses` de la baseline pour la recréer sans `bilan_type_id`.
 *
 * ORDRE RETENU (vérifié par tests/harness.test.ts) :
 *   1. chaîne Prisma complète, dans l'ordre des horodatages (c'est ce que `prisma migrate deploy` exécute) ;
 *   2. migrations SQL à partir du préfixe `SQL_REPLAY_FROM` (0029), dans l'ordre « préfixe numérique puis nom » comme
 *      l'inventaire 0.6, hors `*_rollback.sql` et `validate_*.sql`, BOM retiré (0055 en porte un). C'est le plus petit
 *      préfixe à partir duquel la chaîne SQL se rejoue sur la baseline sans autre erreur que celle documentée plus bas.
 *      Chaque fichier est joué dans sa propre transaction : un échec est consigné puis annulé, jamais fatal ;
 *   3. correctifs du harnais (`LEGACY_HARNESS_PATCHES`) - aucun n'est nécessaire à ce jour.
 */

/** Première migration SQL rejouée après la baseline Prisma (les précédentes sont subsumées par la baseline). */
export const SQL_REPLAY_FROM = 29;

export interface MigrationOutcome {
  chain: "prisma" | "sql" | "patch";
  name: string;
  ok: boolean;
  error?: string;
}

/**
 * Migrations SQL rejouées qui échouent encore, et pourquoi. Aucune n'est nécessaire au code caractérisé.
 */
export const EXPECTED_SQL_MIGRATION_FAILURES: Record<string, string> = {
  "0056_restore_pro_sessions_formateurs.sql":
    "restaure des tables Imhotep (formations professionnelles) sur un schéma qui n'en a plus la forme ; Imhotep est supprimé en Phase 0",
};

/**
 * Correctifs appliqués APRES les chaînes. Chacun compenserait un écart entre « Prisma + SQL rejoué » et la base réelle
 * de production (qui n'a jamais été reconstruite depuis zéro). Vide : la reconstruction est directement exploitable.
 */
export const LEGACY_HARNESS_PATCHES: { name: string; reason: string; sql: string }[] = [];

export function sqlMigrationFiles(): string[] {
  return readdirSync(legacySqlMigrationsDir)
    .filter((f) => f.endsWith(".sql") && !/_rollback\.sql$/.test(f) && !/^validate_/.test(f))
    .filter((f) => parseInt(f, 10) >= SQL_REPLAY_FROM)
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (na !== nb) return na - nb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
}

export function prismaMigrationDirs(): string[] {
  return readdirSync(legacyPrismaMigrationsDir)
    .filter((d) => /^\d{14}_/.test(d))
    .sort();
}

function stripBom(sql: string): string {
  return sql.replace(/^﻿/, "");
}

/** Applique les deux chaînes + correctifs sur une base VIERGE (schéma `public` vide). */
export async function applyLegacySchema(client: Client): Promise<MigrationOutcome[]> {
  const outcomes: MigrationOutcome[] = [];

  for (const dir of prismaMigrationDirs()) {
    const file = join(legacyPrismaMigrationsDir, dir, "migration.sql");
    try {
      await client.query(stripBom(readFileSync(file, "utf8")));
      outcomes.push({ chain: "prisma", name: dir, ok: true });
    } catch (e) {
      outcomes.push({ chain: "prisma", name: dir, ok: false, error: firstLine(e) });
      await client.query("ROLLBACK").catch(() => undefined);
    }
  }

  for (const f of sqlMigrationFiles()) {
    try {
      await client.query(stripBom(readFileSync(join(legacySqlMigrationsDir, f), "utf8")));
      // Un fichier qui ouvre BEGIN sans COMMIT laisserait la transaction ouverte pour le suivant.
      await client.query("COMMIT").catch(() => undefined);
      outcomes.push({ chain: "sql", name: f, ok: true });
    } catch (e) {
      outcomes.push({ chain: "sql", name: f, ok: false, error: firstLine(e) });
      await client.query("ROLLBACK").catch(() => undefined);
    }
  }

  for (const p of LEGACY_HARNESS_PATCHES) {
    try {
      await client.query(p.sql);
      outcomes.push({ chain: "patch", name: p.name, ok: true });
    } catch (e) {
      outcomes.push({ chain: "patch", name: p.name, ok: false, error: firstLine(e) });
      await client.query("ROLLBACK").catch(() => undefined);
    }
  }
  return outcomes;
}

function firstLine(e: unknown): string {
  return String((e as Error)?.message ?? e).split("\n")[0];
}
