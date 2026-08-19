#!/usr/bin/env node

/**
 * Feature 031 — Phase 0, tâche T001 : constat préalable à la migration 0103.
 *
 * POURQUOI CE SCRIPT
 * La forme de `0103_remuneration_professionnelle.sql` dépend de l'état REEL de
 * la base, qui diverge du schema versionne sur deux points (research.md, E4/E5) :
 *
 *   E4 — `payment_hour_details.teaching_hours_id` est declare
 *        `NOT NULL REFERENCES teaching_hours(id)` par 0011, alors que
 *        `payment-calculator.ts` y insere des `teacher_attendance_sessions.id`.
 *        Toute insertion de detail horaire viole donc la FK ; l'erreur est
 *        absorbee par le try/catch par paiement (ROLLBACK, errors++). Selon les
 *        environnements, la FK a pu etre retiree a la main — il faut le savoir
 *        avant d'ecrire un DROP CONSTRAINT.
 *
 *   E5 — `payment_periods.academic_year_id` est lue et ecrite par
 *        `routes/payment-periods.ts` mais n'est creee par AUCUNE migration.
 *        Une base reconstruite depuis les migrations n'a pas la colonne.
 *
 * Ce script ne MODIFIE RIEN. Il lit le catalogue systeme et imprime un rapport.
 * A executer sur dev ET sur prod : ne jamais deduire l'etat de la prod du dev.
 *
 * Usage :
 *   node scripts/check-payment-hour-details-fk.js
 *   DATABASE_URL=postgresql://user:pass@host:5432/base node scripts/check-payment-hour-details-fk.js
 *   node scripts/check-payment-hour-details-fk.js --json
 *
 * Connection order: DATABASE_URL -> DB_* env vars -> local development defaults.
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

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "dbecoledigitale",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || "mysecretpassword",
};

const DATABASE_URL = process.env.DATABASE_URL;
const AS_JSON = process.argv.includes("--json");

function pgConfigFromDatabaseUrl(url) {
  if (!url || !url.startsWith("postgresql://")) return null;
  const withoutScheme = url.replace(/^postgresql:\/\//, "");
  const lastAt = withoutScheme.lastIndexOf("@");
  if (lastAt <= 0) return null;
  const userPass = withoutScheme.slice(0, lastAt);
  const hostPortDb = withoutScheme.slice(lastAt + 1);
  const colon = userPass.indexOf(":");
  if (colon < 0) return null;
  const user = decodeURIComponent(userPass.slice(0, colon));
  const password = decodeURIComponent(userPass.slice(colon + 1));
  const slash = hostPortDb.indexOf("/");
  const hostPort = slash >= 0 ? hostPortDb.slice(0, slash) : hostPortDb;
  const database = slash >= 0 ? hostPortDb.slice(slash + 1).split("?")[0] : "postgres";
  const portSeparator = hostPort.lastIndexOf(":");
  return {
    user,
    password,
    host: portSeparator > 0 ? hostPort.slice(0, portSeparator) : hostPort,
    port: portSeparator > 0 ? parseInt(hostPort.slice(portSeparator + 1), 10) || 5432 : 5432,
    database,
  };
}

// --------------------------------------------------------------------------
// Requetes de constat (lecture seule)
// --------------------------------------------------------------------------

const Q_TABLE_EXISTS = `
  SELECT to_regclass($1) IS NOT NULL AS present
`;

const Q_COLUMN = `
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
`;

const Q_CONSTRAINTS = `
  SELECT con.conname            AS name,
         con.contype            AS type,
         pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public' AND rel.relname = $1
  ORDER BY con.contype, con.conname
`;

const Q_INDEXES = `
  SELECT indexname AS name, indexdef AS definition
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = $1
  ORDER BY indexname
`;

const Q_EXTENSION = `
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = $1) AS present
`;

// Combien de lignes de detail horaire pointent vers un id qui n'existe pas dans
// teaching_hours ? Si la FK a ete retiree, ces lignes ont pu s'ecrire : elles
// mesurent l'ampleur reelle du defaut E4.
const Q_ORPHAN_DETAILS = `
  SELECT count(*)::int AS n
  FROM payment_hour_details phd
  WHERE phd.teaching_hours_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM teaching_hours th WHERE th.id = phd.teaching_hours_id)
`;

// Les memes ids existent-ils en revanche dans teacher_attendance_sessions ?
// Une valeur > 0 confirme que le calculateur ecrit bien la mauvaise origine.
const Q_DETAILS_MATCHING_ATTENDANCE = `
  SELECT count(*)::int AS n
  FROM payment_hour_details phd
  WHERE phd.teaching_hours_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM teacher_attendance_sessions s WHERE s.id = phd.teaching_hours_id)
`;

const Q_COUNT = `SELECT count(*)::int AS n FROM %I`;

async function scalar(client, sql, params = []) {
  const res = await client.query(sql, params);
  return res.rows[0];
}

async function tableExists(client, name) {
  const row = await scalar(client, Q_TABLE_EXISTS, [name]);
  return row.present === true;
}

async function safeCount(client, table) {
  if (!(await tableExists(client, table))) return null;
  const res = await client.query(Q_COUNT.replace("%I", `"${table}"`));
  return res.rows[0].n;
}

async function run() {
  const parsedUrl = DATABASE_URL ? pgConfigFromDatabaseUrl(DATABASE_URL) : null;
  const client =
    parsedUrl != null
      ? new Client(parsedUrl)
      : DATABASE_URL
        ? new Client({ connectionString: DATABASE_URL })
        : new Client(DB_CONFIG);

  const target = parsedUrl
    ? `${parsedUrl.host}:${parsedUrl.port}/${parsedUrl.database}`
    : DATABASE_URL
      ? "(DATABASE_URL)"
      : `${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`;

  await client.connect();

  const report = { target, checkedAt: new Date().toISOString() };

  try {
    const serverVersion = await scalar(client, "SHOW server_version");
    report.serverVersion = serverVersion.server_version;

    // ---- E4 : payment_hour_details -------------------------------------
    const phdPresent = await tableExists(client, "payment_hour_details");
    report.paymentHourDetails = { tablePresent: phdPresent };

    if (phdPresent) {
      const col = await client.query(Q_COLUMN, ["payment_hour_details", "teaching_hours_id"]);
      report.paymentHourDetails.teachingHoursIdColumn = col.rows[0] || null;

      const cons = await client.query(Q_CONSTRAINTS, ["payment_hour_details"]);
      report.paymentHourDetails.constraints = cons.rows;
      report.paymentHourDetails.fkOnTeachingHours = cons.rows.filter(
        (c) => c.type === "f" && /teaching_hours/.test(c.definition)
      );
      report.paymentHourDetails.uniqueTeachingHourPerPayment = cons.rows.filter((c) =>
        /unique_teaching_hour_per_payment/.test(c.name)
      );

      const idx = await client.query(Q_INDEXES, ["payment_hour_details"]);
      report.paymentHourDetails.indexes = idx.rows;

      // Colonnes cibles de 0103 : deja presentes ?
      for (const c of ["source", "attendance_session_id", "seance_id"]) {
        const r = await client.query(Q_COLUMN, ["payment_hour_details", c]);
        report.paymentHourDetails[`column_${c}`] = r.rows[0] || null;
      }

      report.paymentHourDetails.rowCount = await safeCount(client, "payment_hour_details");

      if (report.paymentHourDetails.rowCount > 0) {
        report.paymentHourDetails.orphanTeachingHoursRefs = (
          await scalar(client, Q_ORPHAN_DETAILS)
        ).n;
        if (await tableExists(client, "teacher_attendance_sessions")) {
          report.paymentHourDetails.refsMatchingAttendanceSessions = (
            await scalar(client, Q_DETAILS_MATCHING_ATTENDANCE)
          ).n;
        }
      } else {
        report.paymentHourDetails.orphanTeachingHoursRefs = 0;
        report.paymentHourDetails.refsMatchingAttendanceSessions = 0;
      }
    }

    // ---- E5 : payment_periods.academic_year_id --------------------------
    const ppPresent = await tableExists(client, "payment_periods");
    report.paymentPeriods = { tablePresent: ppPresent };
    if (ppPresent) {
      const col = await client.query(Q_COLUMN, ["payment_periods", "academic_year_id"]);
      report.paymentPeriods.academicYearIdColumn = col.rows[0] || null;
      report.paymentPeriods.rowCount = await safeCount(client, "payment_periods");
      if (col.rows[0]) {
        const nulls = await client.query(
          "SELECT count(*)::int AS n FROM payment_periods WHERE academic_year_id IS NULL"
        );
        report.paymentPeriods.rowsWithNullAcademicYear = nulls.rows[0].n;
      }
    }

    // ---- E6 : devise par defaut ----------------------------------------
    if (await tableExists(client, "teacher_payments")) {
      const col = await client.query(Q_COLUMN, ["teacher_payments", "currency"]);
      report.teacherPayments = {
        currencyColumn: col.rows[0] || null,
        rowCount: await safeCount(client, "teacher_payments"),
      };
    }

    // ---- Patron anti-chevauchement (EXCLUDE) sur les tables de paie ------
    // 0103 calque sa contrainte EXCLUDE sur celle de course_hourly_rates.
    // Encore faut-il qu'elle existe reellement : les deux variantes de la
    // migration 0011 divergent sur ce point (voir la section MIGRATION 0011).
    report.excludeConstraints = {};
    for (const t of [
      "payment_periods",
      "teacher_payment_configs",
      "course_hourly_rates",
      "teacher_payments",
    ]) {
      if (!(await tableExists(client, t))) {
        report.excludeConstraints[t] = null;
        continue;
      }
      const r = await client.query(
        `SELECT con.conname AS name, con.contype::text AS type,
                pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname = 'public' AND rel.relname = $1
           AND con.contype IN ('x', 'u')
         ORDER BY con.contype, con.conname`,
        [t]
      );
      report.excludeConstraints[t] = r.rows;
    }

    // ---- Prerequis de 0103 ---------------------------------------------
    report.prerequisites = {
      btree_gist: (await scalar(client, Q_EXTENSION, ["btree_gist"])).present,
      professional_ecue_seances: await tableExists(client, "professional_ecue_seances"),
      professional_ecue: await tableExists(client, "professional_ecue"),
      professional_ue_sessions: await tableExists(client, "professional_ue_sessions"),
      academic_years: await tableExists(client, "academic_years"),
      professional_ecue_hourly_rates: await tableExists(client, "professional_ecue_hourly_rates"),
    };

    if (report.prerequisites.professional_ecue_seances) {
      const seanceCols = {};
      for (const c of ["statut", "validated_by", "validated_at", "heure_debut", "heure_fin"]) {
        const r = await client.query(Q_COLUMN, ["professional_ecue_seances", c]);
        seanceCols[c] = r.rows[0] || null;
      }
      report.professionalEcueSeances = {
        columns: seanceCols,
        rowCount: await safeCount(client, "professional_ecue_seances"),
      };
      const withHours = await client.query(
        `SELECT count(*)::int AS n FROM professional_ecue_seances
         WHERE heure_debut IS NOT NULL AND heure_fin IS NOT NULL AND enseignant_id IS NOT NULL`
      );
      report.professionalEcueSeances.payableCandidates = withHours.rows[0].n;
    }
  } finally {
    await client.end();
  }

  return report;
}

// --------------------------------------------------------------------------
// Rendu
// --------------------------------------------------------------------------

function yn(v) {
  return v === true ? "OUI" : v === false ? "NON" : "—";
}

function print(report) {
  const line = "=".repeat(78);
  console.log(line);
  console.log("Constat prealable — migration 0103 (feature 031)");
  console.log(`Base    : ${report.target}`);
  console.log(`Postgres: ${report.serverVersion || "?"}`);
  console.log(`Date    : ${report.checkedAt}`);
  console.log(line);

  // E4
  console.log("");
  console.log("E4 — payment_hour_details.teaching_hours_id");
  console.log("-".repeat(78));
  const phd = report.paymentHourDetails || {};
  if (!phd.tablePresent) {
    console.log("  Table ABSENTE — migration 0011 non appliquee sur cette base.");
  } else {
    const col = phd.teachingHoursIdColumn;
    console.log(`  Colonne presente        : ${yn(!!col)}`);
    if (col) {
      console.log(`  Nullable                : ${col.is_nullable === "YES" ? "OUI" : "NON"}`);
    }
    const fks = phd.fkOnTeachingHours || [];
    console.log(`  FK vers teaching_hours  : ${fks.length > 0 ? "PRESENTE" : "ABSENTE"}`);
    for (const fk of fks) console.log(`      ${fk.name} :: ${fk.definition}`);
    const uq = phd.uniqueTeachingHourPerPayment || [];
    console.log(`  unique_teaching_hour_…  : ${uq.length > 0 ? "PRESENTE" : "ABSENTE"}`);
    for (const c of uq) console.log(`      ${c.name} :: ${c.definition}`);
    console.log(`  Lignes de detail        : ${phd.rowCount}`);
    console.log(`  Refs orphelines (E4)    : ${phd.orphanTeachingHoursRefs}`);
    console.log(`  …dont ids d'attendance  : ${phd.refsMatchingAttendanceSessions ?? "—"}`);
    console.log("");
    console.log("  Colonnes cibles de 0103 :");
    for (const c of ["source", "attendance_session_id", "seance_id"]) {
      console.log(`      ${c.padEnd(24)} ${yn(!!phd[`column_${c}`])}`);
    }
  }

  // E5
  console.log("");
  console.log("E5 — payment_periods.academic_year_id");
  console.log("-".repeat(78));
  const pp = report.paymentPeriods || {};
  if (!pp.tablePresent) {
    console.log("  Table ABSENTE.");
  } else {
    console.log(`  Colonne presente        : ${yn(!!pp.academicYearIdColumn)}`);
    if (pp.academicYearIdColumn) {
      console.log(
        `  Nullable                : ${pp.academicYearIdColumn.is_nullable === "YES" ? "OUI" : "NON"}`
      );
      console.log(`  Lignes a NULL           : ${pp.rowsWithNullAcademicYear}`);
    }
    console.log(`  Lignes (periodes)       : ${pp.rowCount}`);
  }

  // E6
  console.log("");
  console.log("E6 — teacher_payments.currency");
  console.log("-".repeat(78));
  const tp = report.teacherPayments;
  if (!tp) {
    console.log("  Table ABSENTE.");
  } else {
    console.log(`  Defaut                  : ${tp.currencyColumn?.column_default ?? "—"}`);
    console.log(`  Lignes (paiements)      : ${tp.rowCount}`);
  }

  // Anti-chevauchement
  console.log("");
  console.log("Contraintes EXCLUDE / UNIQUE des tables de paie");
  console.log("-".repeat(78));
  for (const [t, rows] of Object.entries(report.excludeConstraints || {})) {
    if (rows === null) {
      console.log(`  ${t} : table absente`);
      continue;
    }
    if (rows.length === 0) {
      console.log(`  ${t} : AUCUNE (ni EXCLUDE ni UNIQUE)`);
      continue;
    }
    console.log(`  ${t} :`);
    rows.forEach((r) => console.log(`      [${r.type}] ${r.name} :: ${r.definition}`));
  }

  // Prerequis
  console.log("");
  console.log("Prerequis de 0103");
  console.log("-".repeat(78));
  for (const [k, v] of Object.entries(report.prerequisites || {})) {
    console.log(`  ${k.padEnd(34)} ${yn(v)}`);
  }

  const se = report.professionalEcueSeances;
  if (se) {
    console.log("");
    console.log("professional_ecue_seances");
    console.log("-".repeat(78));
    console.log(`  Lignes                  : ${se.rowCount}`);
    console.log(`  Candidates payables*    : ${se.payableCandidates}`);
    console.log("  * horaires complets + enseignant renseigne (avant statut/validation)");
    console.log("  Colonnes ajoutees par 0103 :");
    for (const c of ["statut", "validated_by", "validated_at"]) {
      console.log(`      ${c.padEnd(24)} ${yn(!!se.columns[c])}`);
    }
  }

  // Verdict
  console.log("");
  console.log(line);
  console.log("VERDICT — ce que 0103 doit prevoir sur CETTE base");
  console.log(line);
  const todo = [];
  if (phd.tablePresent) {
    if ((phd.fkOnTeachingHours || []).length > 0) {
      todo.push("DROP la FK teaching_hours (presente) avant de relacher le NOT NULL");
    } else {
      todo.push("FK teaching_hours deja absente — le DROP … IF EXISTS sera un no-op");
    }
    if (phd.teachingHoursIdColumn?.is_nullable === "NO") {
      todo.push("ALTER COLUMN teaching_hours_id DROP NOT NULL requis");
    } else {
      todo.push("teaching_hours_id deja nullable — no-op");
    }
    if ((phd.uniqueTeachingHourPerPayment || []).length > 0) {
      todo.push("DROP unique_teaching_hour_per_payment, remplacer par index partiels");
    }
    if (phd.orphanTeachingHoursRefs > 0) {
      todo.push(
        `${phd.orphanTeachingHoursRefs} ligne(s) de detail referencent un teaching_hours inexistant — ` +
          "a requalifier en source='academique' + attendance_session_id avant de recreer la FK"
      );
    }
  }
  if (pp.tablePresent && !pp.academicYearIdColumn) {
    todo.push("ADD COLUMN payment_periods.academic_year_id (absente : le code la lit deja)");
  } else if (pp.academicYearIdColumn) {
    todo.push("payment_periods.academic_year_id deja presente — ADD COLUMN IF NOT EXISTS = no-op");
  }
  if (report.prerequisites && !report.prerequisites.btree_gist) {
    todo.push("CREATE EXTENSION btree_gist requis (contrainte EXCLUDE des tarifs)");
  }
  if (report.prerequisites && !report.prerequisites.professional_ecue_seances) {
    todo.push("BLOQUANT : professional_ecue_seances absente — appliquer 0069 d'abord");
  }
  const chr = (report.excludeConstraints || {}).course_hourly_rates;
  if (Array.isArray(chr) && !chr.some((c) => c.type === "x")) {
    todo.push(
      "course_hourly_rates n'a AUCUNE contrainte EXCLUDE sur cette base : le patron " +
        "anti-chevauchement que 0103 devait calquer n'existe pas ici (variante _fixed de 0011). " +
        "Decider si 0103 le reintroduit pour les tarifs ECUE ou s'aligne sur l'existant."
    );
  }
  if (todo.length === 0) {
    console.log("  Rien a signaler.");
  } else {
    todo.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t}`));
  }
  console.log("");
  console.log("Rappel : executer ce script sur dev ET sur prod avant d'ecrire 0103.");
  console.log(line);
}

run()
  .then((report) => {
    if (AS_JSON) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      print(report);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("Constat impossible :", error.message);
    if (error.code) console.error("Code:", error.code);
    process.exit(1);
  });
