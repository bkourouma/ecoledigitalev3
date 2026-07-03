#!/usr/bin/env node

/**
 * Seeds sample data for the Professional Module (feature 030 — Filière→UE→ECUE):
 *   - professional_ecue                  (ECUE — pédagogique)
 *   - professional_ue                    (UE — administratif : prix, UV)
 *   - professional_ue_ecue               (composition UE↔ECUE, mutualisable)
 *   - professional_ue_sessions           (cohortes ouvertes à l'inscription)
 *   - professional_ecue_seances          (une séance d'exemple par cohorte)
 *   - professional_diplomas              (diplômes — filiere_id)
 *   - professional_diploma_requirements  (UE comptabilisées par diplôme)
 *
 * Targets the reference tenant (ecoledigitale). Idempotent: upserts on natural
 * unique keys (tenant_id+code for ecue/ue/diplomas, tenant_id+ue_id+ecue_id for
 * links, diploma_id+ue_id for requirements). Demonstrates mutualisation via a
 * shared "ECUE-ANGLAIS" attached to one UE per filière.
 *
 * Connection order: DATABASE_URL → DB_* env vars → local development defaults.
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadEnv(relativePath) {
  const envPath = path.join(__dirname, "..", relativePath);
  if (!fs.existsSync(envPath)) return;
  try {
    require("dotenv").config({ path: envPath });
  } catch {
    try {
      require(path.join(__dirname, "..", "apps", "api", "node_modules", "dotenv")).config({
        path: envPath,
      });
    } catch {
      // Environment variables already present are enough.
    }
  }
}

loadEnv(".env");
loadEnv(path.join("apps", "api", ".env"));

const DATABASE_URL = process.env.DATABASE_URL;
const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "dbecoledigitale",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || "mysecretpassword",
};

function clientFromEnv() {
  if (DATABASE_URL) return new Client({ connectionString: DATABASE_URL });
  return new Client(DB_CONFIG);
}

// A shared ECUE mutualized across filières (one UE per group links it).
const SHARED_ECUE = { code: "ECUE-ANGLAIS", libelle: "Anglais professionnel" };

// Each item becomes an ECUE (pédagogique) + a UE (prix/UV) composing it (1↔1).
const SEED = [
  {
    programmeCode: "BTS IDA 1",
    items: [
      { code: "ALGO", libelle: "Algorithmique et structures de données", nb_uv: 4, prix: 150000 },
      { code: "POO", libelle: "Programmation orientée objet (Java)", nb_uv: 5, prix: 180000 },
      { code: "WEB", libelle: "Développement Web (HTML / CSS / JS)", nb_uv: 4, prix: 160000 },
      { code: "BDD", libelle: "Bases de données relationnelles (SQL)", nb_uv: 4, prix: 150000 },
      { code: "RES", libelle: "Réseaux et systèmes", nb_uv: 3, prix: 120000 },
    ],
    sharedInto: "IDA1-WEB", // attach the shared ECUE-ANGLAIS to this UE
    diploma: {
      code: "DIP-IDA1",
      libelle: "Diplôme BTS Informatique Développeur d'Application — 1ère année",
      description: "Diplôme professionnel sanctionnant la validation des UV de 1ère année.",
      requiredUeCodes: ["UE-IDA1-ALGO", "UE-IDA1-POO", "UE-IDA1-WEB", "UE-IDA1-BDD"],
      optionalUeCodes: ["UE-IDA1-RES"],
      uv_required: 17,
    },
    prefix: "IDA1",
  },
  {
    programmeCode: "LPRIGL",
    items: [
      { code: "ADMINSYS", libelle: "Administration systèmes Linux", nb_uv: 5, prix: 200000 },
      { code: "SECU", libelle: "Sécurité des réseaux", nb_uv: 5, prix: 220000 },
      { code: "CLOUD", libelle: "Cloud et virtualisation", nb_uv: 4, prix: 190000 },
      { code: "DEVOPS", libelle: "DevOps et intégration continue", nb_uv: 4, prix: 200000 },
    ],
    sharedInto: "LPR-CLOUD",
    diploma: {
      code: "DIP-LPRIGL",
      libelle: "Licence Professionnelle Réseaux Informatiques et Génie Logiciel",
      description: "Diplôme professionnel validant le socle réseaux et génie logiciel.",
      requiredUeCodes: ["UE-LPR-ADMINSYS", "UE-LPR-SECU", "UE-LPR-CLOUD"],
      optionalUeCodes: ["UE-LPR-DEVOPS"],
      uv_required: 14,
    },
    prefix: "LPR",
  },
];

async function upsertEcue(client, tenantId, code, libelle) {
  const res = await client.query(
    `INSERT INTO professional_ecue (tenant_id, code, libelle, statut)
     VALUES ($1, $2, $3, 'actif')
     ON CONFLICT (tenant_id, code) DO UPDATE SET libelle = EXCLUDED.libelle, statut = 'actif', updated_at = now()
     RETURNING id`,
    [tenantId, code, libelle]
  );
  return res.rows[0].id;
}

async function upsertUe(client, tenantId, filiereId, code, libelle, nbUv, prix, createdBy) {
  const res = await client.query(
    `INSERT INTO professional_ue (tenant_id, filiere_id, code, libelle, prix, devise, nb_uv, statut, created_by)
     VALUES ($1, $2, $3, $4, $5, 'XOF', $6, 'actif', $7)
     ON CONFLICT (tenant_id, code) DO UPDATE
       SET libelle = EXCLUDED.libelle, prix = EXCLUDED.prix, nb_uv = EXCLUDED.nb_uv,
           statut = 'actif', updated_at = now()
     RETURNING id`,
    [tenantId, filiereId, code, libelle, prix, nbUv, createdBy]
  );
  return res.rows[0].id;
}

async function linkUeEcue(client, tenantId, ueId, ecueId, obligatoire, ordre) {
  const res = await client.query(
    `INSERT INTO professional_ue_ecue (tenant_id, ue_id, ecue_id, est_obligatoire, coefficient, ordre)
     VALUES ($1, $2, $3, $4, 1, $5)
     ON CONFLICT (tenant_id, ue_id, ecue_id) DO NOTHING`,
    [tenantId, ueId, ecueId, obligatoire, ordre]
  );
  return res.rowCount;
}

async function ensureCohorte(client, tenantId, ueId, enseignantId) {
  const libelle = "Cohorte Juillet 2026";
  const exists = await client.query(
    "SELECT id FROM professional_ue_sessions WHERE ue_id = $1 AND libelle = $2 LIMIT 1",
    [ueId, libelle]
  );
  if (exists.rows.length > 0) return { id: exists.rows[0].id, created: false };
  const res = await client.query(
    `INSERT INTO professional_ue_sessions
       (tenant_id, ue_id, libelle, date_debut, date_fin,
        inscription_ouverte_le, inscription_fermee_le, capacite_max, enseignant_id, statut)
     VALUES ($1, $2, $3, DATE '2026-07-01', DATE '2026-09-30',
             TIMESTAMPTZ '2026-06-01 00:00:00+00', TIMESTAMPTZ '2026-12-31 23:59:59+00',
             30, $4, 'ouvert')
     RETURNING id`,
    [tenantId, ueId, libelle, enseignantId]
  );
  return { id: res.rows[0].id, created: true };
}

async function ensureSessionEcueTeacher(client, tenantId, ueSessionId, ecueId, enseignantId) {
  if (!enseignantId) return 0;
  const res = await client.query(
    `INSERT INTO professional_session_ecue_teachers (tenant_id, ue_session_id, ecue_id, enseignant_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, ue_session_id, ecue_id) DO NOTHING`,
    [tenantId, ueSessionId, ecueId, enseignantId]
  );
  return res.rowCount;
}

async function ensureSeance(client, tenantId, ueSessionId, ecueId, enseignantId) {
  const exists = await client.query(
    "SELECT id FROM professional_ecue_seances WHERE ue_session_id = $1 AND ecue_id = $2 LIMIT 1",
    [ueSessionId, ecueId]
  );
  if (exists.rows.length > 0) return 0;
  await client.query(
    `INSERT INTO professional_ecue_seances
       (tenant_id, ecue_id, ue_session_id, libelle, date, heure_debut, heure_fin, enseignant_id)
     VALUES ($1, $2, $3, 'Séance d''introduction', DATE '2026-07-06', TIME '09:00', TIME '12:00', $4)`,
    [tenantId, ecueId, ueSessionId, enseignantId]
  );
  return 1;
}

async function main() {
  const client = clientFromEnv();
  await client.connect();

  try {
    const tenantRes = await client.query(
      "SELECT id FROM tenants WHERE slug = 'ecoledigitale' OR is_reference = true ORDER BY is_reference DESC LIMIT 1"
    );
    if (tenantRes.rows.length === 0) throw new Error("No reference tenant found.");
    const tenantId = tenantRes.rows[0].id;
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);

    const adminRes = await client.query(
      "SELECT id FROM users WHERE tenant_id = $1 AND active_role_key IN ('admin','owner') ORDER BY active_role_key LIMIT 1",
      [tenantId]
    );
    const createdBy = adminRes.rows[0]?.id ?? null;

    const teachersRes = await client.query(
      "SELECT id FROM teachers WHERE tenant_id = $1 ORDER BY created_at LIMIT 8",
      [tenantId]
    );
    const teacherIds = teachersRes.rows.map((r) => r.id);

    const counts = { ecue: 0, ue: 0, links: 0, cohortes: 0, seances: 0, diplomas: 0, requirements: 0 };
    let teacherIdx = 0;
    const nextTeacher = () =>
      teacherIds.length ? teacherIds[teacherIdx++ % teacherIds.length] : null;

    // Shared ECUE (mutualized across filières).
    const sharedEcueId = await upsertEcue(client, tenantId, SHARED_ECUE.code, SHARED_ECUE.libelle);
    counts.ecue++;

    for (const group of SEED) {
      const progRes = await client.query(
        "SELECT id FROM programmes WHERE tenant_id = $1 AND code = $2 LIMIT 1",
        [tenantId, group.programmeCode]
      );
      if (progRes.rows.length === 0) {
        console.warn(`! Programme "${group.programmeCode}" introuvable — groupe ignoré.`);
        continue;
      }
      const filiereId = progRes.rows[0].id;
      const ueIdByCode = {};

      for (const it of group.items) {
        const ecueCode = `ECUE-${group.prefix}-${it.code}`;
        const ueCode = `UE-${group.prefix}-${it.code}`;
        const ecueId = await upsertEcue(client, tenantId, ecueCode, it.libelle);
        counts.ecue++;
        const ueId = await upsertUe(
          client, tenantId, filiereId, ueCode, it.libelle, it.nb_uv, it.prix, createdBy
        );
        counts.ue++;
        ueIdByCode[ueCode] = ueId;
        counts.links += await linkUeEcue(client, tenantId, ueId, ecueId, true, 0);

        // Mutualisation : attach the shared ECUE to the designated UE (optional).
        if (`${group.prefix}-${it.code}` === group.sharedInto) {
          counts.links += await linkUeEcue(client, tenantId, ueId, sharedEcueId, false, 1);
        }

        const teacherId = nextTeacher();
        const cohorte = await ensureCohorte(client, tenantId, ueId, teacherId);
        if (cohorte.created) counts.cohortes++;
        // Affecte l'enseignant à l'ECUE de cette cohorte (modèle ECUE, feature 030).
        await ensureSessionEcueTeacher(client, tenantId, cohorte.id, ecueId, teacherId);
        counts.seances += await ensureSeance(client, tenantId, cohorte.id, ecueId, teacherId);
      }

      // Diploma (filiere_id) + requirements (ue_id).
      const d = group.diploma;
      const dipRes = await client.query(
        `INSERT INTO professional_diplomas
           (tenant_id, filiere_id, code, libelle, description, uv_required, statut, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'actif', $7)
         ON CONFLICT (tenant_id, code) DO UPDATE
           SET libelle = EXCLUDED.libelle, description = EXCLUDED.description,
               uv_required = EXCLUDED.uv_required, statut = 'actif', updated_at = now()
         RETURNING id`,
        [tenantId, filiereId, d.code, d.libelle, d.description, d.uv_required, createdBy]
      );
      const diplomaId = dipRes.rows[0].id;
      counts.diplomas++;

      let ordre = 0;
      const reqs = [
        ...d.requiredUeCodes.map((c) => ({ code: c, obligatoire: true })),
        ...(d.optionalUeCodes || []).map((c) => ({ code: c, obligatoire: false })),
      ];
      for (const r of reqs) {
        const ueId = ueIdByCode[r.code];
        if (!ueId) continue;
        const ins = await client.query(
          `INSERT INTO professional_diploma_requirements (tenant_id, diploma_id, ue_id, est_obligatoire, ordre)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (diploma_id, ue_id) DO NOTHING`,
          [tenantId, diplomaId, ueId, r.obligatoire, ordre++]
        );
        counts.requirements += ins.rowCount;
      }
    }

    console.log("Seed terminé pour le tenant", tenantId);
    console.log(`  professional_ecue                  : ${counts.ecue} upsert(s)`);
    console.log(`  professional_ue                    : ${counts.ue} upsert(s)`);
    console.log(`  professional_ue_ecue (liaisons)    : ${counts.links} inséré(s)`);
    console.log(`  professional_ue_sessions (cohortes): ${counts.cohortes} inséré(s)`);
    console.log(`  professional_ecue_seances          : ${counts.seances} inséré(s)`);
    console.log(`  professional_diplomas              : ${counts.diplomas} upsert(s)`);
    console.log(`  professional_diploma_requirements  : ${counts.requirements} inséré(s)`);
  } catch (error) {
    console.error("Seed échoué :", error.message);
    if (error.code) console.error("Code:", error.code);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
