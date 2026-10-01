// Calcule l'état final des tables à partir des sources de schéma du dépôt :
//   1. infra/scripts/migrations/*.sql        (source principale, rejouée dans l'ordre)
//   2. apps/api/prisma/migrations/*/migration.sql (chaîne Prisma, réellement exécutée par deploy.sh)
//   3. apps/api/prisma/schema.prisma          (modèles Prisma, @@map)
//   4. CREATE TABLE trouvés dans des scripts JS/TS (tables créées hors migrations)
import fs from 'node:fs';
import path from 'node:path';
import { replayMigrations, splitStatements } from './sql-parse.mjs';

/** Ordre d'application des migrations infra : préfixe numérique puis nom.
 *  Les fichiers *_rollback.sql et validate_*.sql ne sont jamais rejoués. */
export function orderInfraMigrations(dir) {
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const skipped = [];
  const kept = [];
  for (const f of all) {
    if (/_rollback\.sql$/i.test(f) || /^validate_/i.test(f)) skipped.push(f);
    else kept.push(f);
  }
  const key = (f) => {
    const m = /^(\d+)/.exec(f);
    return m ? [parseInt(m[1], 10), f] : [Number.MAX_SAFE_INTEGER, f];
  };
  kept.sort((a, b) => {
    const [na, fa] = key(a);
    const [nb, fb] = key(b);
    return na - nb || (fa < fb ? -1 : fa > fb ? 1 : 0);
  });
  return { kept, skipped };
}

function readFiles(dir, names) {
  return names.map((n) => ({ name: n, text: fs.readFileSync(path.join(dir, n), 'utf8').replace(/^﻿/, '') }));
}

/** Tables supprimées par un script de rollback (information seulement). */
function rollbackDrops(dir, names) {
  const out = {};
  for (const f of names) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const tabs = new Set();
    for (const st of splitStatements(text)) {
      for (const m of st.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?\w+"?(?:\s*,\s*"?\w+"?)*)/gi)) {
        m[1].split(',').forEach((t) => tabs.add(t.replace(/"/g, '').trim().toLowerCase()));
      }
    }
    out[f] = [...tabs];
  }
  return out;
}

export function parsePrismaSchema(file) {
  const text = fs.readFileSync(file, 'utf8');
  const models = [];
  for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const body = m[2];
    const map = /@@map\("([^"]+)"\)/.exec(body);
    const table = (map ? map[1] : m[1]).toLowerCase();
    const hasTenant = /@map\("tenant_id"\)/.test(body) || /^\s*tenant_id\s/m.test(body);
    models.push({ model: m[1], table, hasTenant });
  }
  return models;
}

export function buildState(root) {
  const infraDir = path.join(root, 'infra/scripts/migrations');
  const { kept, skipped } = orderInfraMigrations(infraDir);
  const infra = replayMigrations(readFiles(infraDir, kept), {
    bulkTenantize: {
      file: '0055_unified_multitenancy.sql',
      // Liste d'exclusion de la boucle DO de 0055 (tables sans tenant_id).
      exclude: new Set(['tenants', 'roles', 'token_blacklist', 'super_admin_users', 'super_admin_audit_logs', '_prisma_migrations']),
    },
  });

  const prismaMigDir = path.join(root, 'apps/api/prisma/migrations');
  const prismaDirs = fs.existsSync(prismaMigDir)
    ? fs.readdirSync(prismaMigDir).filter((d) => fs.existsSync(path.join(prismaMigDir, d, 'migration.sql'))).sort()
    : [];
  const prismaFiles = prismaDirs.map((d) => ({
    name: `prisma:${d}`,
    text: fs.readFileSync(path.join(prismaMigDir, d, 'migration.sql'), 'utf8').replace(/^﻿/, ''),
  }));
  const prisma = replayMigrations(prismaFiles, {});

  const prismaModels = fs.existsSync(path.join(root, 'apps/api/prisma/schema.prisma'))
    ? parsePrismaSchema(path.join(root, 'apps/api/prisma/schema.prisma'))
    : [];

  return {
    infra,
    prisma,
    prismaModels,
    infraFiles: kept,
    infraSkipped: skipped,
    rollbackDrops: rollbackDrops(infraDir, skipped),
    prismaMigrations: prismaDirs,
  };
}
