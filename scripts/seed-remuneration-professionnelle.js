#!/usr/bin/env node

/**
 * Feature 031 — jeu de demonstration de la remuneration professionnelle.
 *
 * Pose de quoi exercer les deux user stories du MVP sur des donnees reelles,
 * en s'appuyant sur les seances ECUE deja presentes (feature 030) :
 *
 *   - une periode de paiement couvrant un mois qui contient des seances ;
 *   - une configuration de paie pour 3 enseignants : horaire, salarie, mixte ;
 *   - un tarif ECUE generique et un tarif nominatif ;
 *   - des seances passees a 'realisee' + validees, et volontairement
 *     des cas NON payables (annulee, horaires incomplets, non validee) pour
 *     verifier qu'ils ne produisent aucun montant.
 *
 * Idempotent : reexecutable, il reprend les memes enregistrements.
 * Lecture/ecriture sur la base de DEV uniquement.
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
      /* variables deja presentes */
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

function pgConfigFromDatabaseUrl(url) {
  if (!url || !url.startsWith("postgresql://")) return null;
  const withoutScheme = url.replace(/^postgresql:\/\//, "");
  const lastAt = withoutScheme.lastIndexOf("@");
  if (lastAt <= 0) return null;
  const userPass = withoutScheme.slice(0, lastAt);
  const hostPortDb = withoutScheme.slice(lastAt + 1);
  const colon = userPass.indexOf(":");
  if (colon < 0) return null;
  const slash = hostPortDb.indexOf("/");
  const hostPort = slash >= 0 ? hostPortDb.slice(0, slash) : hostPortDb;
  const portSeparator = hostPort.lastIndexOf(":");
  return {
    user: decodeURIComponent(userPass.slice(0, colon)),
    password: decodeURIComponent(userPass.slice(colon + 1)),
    host: portSeparator > 0 ? hostPort.slice(0, portSeparator) : hostPort,
    port: portSeparator > 0 ? parseInt(hostPort.slice(portSeparator + 1), 10) || 5432 : 5432,
    database: slash >= 0 ? hostPortDb.slice(slash + 1).split("?")[0] : "postgres",
  };
}

async function main() {
  const parsedUrl = DATABASE_URL ? pgConfigFromDatabaseUrl(DATABASE_URL) : null;
  const client =
    parsedUrl != null
      ? new Client(parsedUrl)
      : DATABASE_URL
        ? new Client({ connectionString: DATABASE_URL })
        : new Client(DB_CONFIG);

  await client.connect();
  console.log("Seed remuneration professionnelle (feature 031)");
  console.log("=".repeat(78));

  try {
    await client.query("BEGIN");

    // --- Tenant et mois de travail --------------------------------------
    // On se cale sur le mois qui contient le plus de seances exploitables :
    // inventer des dates produirait un jeu qui ne ressemble a rien de reel.
    const target = await client.query(`
      SELECT se.tenant_id,
             date_trunc('month', se.date)::date AS mois,
             count(*)::int AS nb
      FROM professional_ecue_seances se
      WHERE se.enseignant_id IS NOT NULL
        AND se.heure_debut IS NOT NULL
        AND se.heure_fin IS NOT NULL
      GROUP BY se.tenant_id, date_trunc('month', se.date)
      ORDER BY nb DESC
      LIMIT 1
    `);

    if (target.rowCount === 0) {
      console.log("Aucune seance ECUE exploitable en base : appliquer d'abord 0069/0070 et leur seed.");
      await client.query("ROLLBACK");
      return;
    }

    const tenantId = target.rows[0].tenant_id;
    const monthStart = target.rows[0].mois;
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const bounds = await client.query(
      `SELECT $1::date AS debut, ($1::date + INTERVAL '1 month' - INTERVAL '1 day')::date AS fin`,
      [monthStart]
    );
    const periodStart = bounds.rows[0].debut.toISOString().slice(0, 10);
    const periodEnd = bounds.rows[0].fin.toISOString().slice(0, 10);
    console.log(`Tenant  : ${tenantId}`);
    console.log(`Periode : ${periodStart} -> ${periodEnd} (${target.rows[0].nb} seances)`);

    const adminUser = await client.query(
      `SELECT id FROM users WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [tenantId]
    );
    const userId = adminUser.rows[0]?.id ?? null;

    // --- Periode de paiement --------------------------------------------
    // Recherche par NOM d'abord, statut compris : chercher uniquement les
    // periodes non archivees laissait creer un doublon des que la precedente
    // passait a 'archived' — deux lignes de meme nom, dont une seule active.
    const PERIOD_NAME = `Paie ${periodStart.slice(0, 7)} (seed 031)`;
    let periodId;
    const seeded = await client.query(
      `SELECT id, status::text AS status FROM payment_periods
       WHERE tenant_id = $1 AND name = $2
       ORDER BY created_at`,
      [tenantId, PERIOD_NAME]
    );

    if (seeded.rowCount > 0) {
      // La premiere devient la periode de reference ; les doublons eventuels
      // sont archives (une periode archivee ne bloque pas la contrainte
      // anti-chevauchement).
      periodId = seeded.rows[0].id;
      const doublons = seeded.rows
        .slice(1)
        .filter((r) => r.status !== "archived")
        .map((r) => r.id);
      if (doublons.length > 0) {
        await client.query(
          `UPDATE payment_periods SET status = 'archived' WHERE id = ANY($1::uuid[])`,
          [doublons]
        );
        console.log(`${doublons.length} periode(s) en doublon archivee(s).`);
      }
      await client.query(
        `UPDATE payment_periods SET period_start = $1::date, period_end = $2::date, status = 'active'
         WHERE id = $3`,
        [periodStart, periodEnd, periodId]
      );
      console.log(`Periode existante reutilisee : ${PERIOD_NAME}`);

      /**
       * PURGE DES BULLETINS DE CETTE PERIODE.
       *
       * Un bulletin `approved` ou `paid` n'est jamais reecrit par un recalcul
       * (FR-025). Les laisser en place rendait le jeu de demonstration NON
       * REPRODUCTIBLE : au bout de quelques passes, tous les bulletins etaient
       * verrouilles, plus aucun recalcul n'avait d'effet, et la verification ne
       * mesurait plus rien.
       *
       * La periode appartient au seed — il la (re)cree a chaque execution. En
       * purger les bulletins est donc dans son perimetre, contrairement a
       * toucher une periode reelle.
       *
       * Le trigger d'audit est neutralise le temps de la suppression : sur
       * DELETE, il tente d'ecrire une trace referencant le paiement supprime.
       */
      const aPurger = await client.query(
        `SELECT id FROM teacher_payments WHERE payment_period_id = $1`,
        [periodId]
      );
      if (aPurger.rowCount > 0) {
        const ids = aPurger.rows.map((r) => r.id);
        await client.query(
          "ALTER TABLE teacher_payments DISABLE TRIGGER audit_teacher_payments_trigger"
        );
        await client.query(`DELETE FROM payment_hour_details WHERE payment_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM payment_audit_log WHERE payment_id = ANY($1::uuid[])`, [ids]);
        await client.query(`DELETE FROM teacher_payments WHERE id = ANY($1::uuid[])`, [ids]);
        await client.query(
          "ALTER TABLE teacher_payments ENABLE TRIGGER audit_teacher_payments_trigger"
        );
        console.log(`${aPurger.rowCount} bulletin(s) de la periode purge(s) — repart de zero.`);
      }
    } else {
      const academicYear = await client.query(
        `SELECT id FROM academic_years WHERE tenant_id = $1 ORDER BY is_active DESC, start_date DESC LIMIT 1`,
        [tenantId]
      );
      const created = await client.query(
        `INSERT INTO payment_periods
           (tenant_id, academic_year_id, name, description, period_start, period_end, status, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, 'active', $7)
         RETURNING id`,
        [
          tenantId,
          academicYear.rows[0]?.id ?? null,
          PERIOD_NAME,
          "Jeu de demonstration — remuneration professionnelle",
          periodStart,
          periodEnd,
          userId,
        ]
      );
      periodId = created.rows[0].id;
      console.log("Periode de paiement creee.");
    }

    // --- Trois enseignants du mois --------------------------------------
    const teachers = await client.query(
      `SELECT se.enseignant_id AS id,
              COALESCE(TRIM(u.first_name || ' ' || u.last_name),
                       TRIM(t.first_name || ' ' || t.last_name), 'Enseignant') AS nom,
              count(*)::int AS nb_seances
       FROM professional_ecue_seances se
       JOIN teachers t ON t.id = se.enseignant_id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE se.tenant_id = $1
         AND se.date BETWEEN $2::date AND $3::date
         AND se.heure_debut IS NOT NULL AND se.heure_fin IS NOT NULL
         AND t.status = 'active'
       GROUP BY se.enseignant_id, u.first_name, u.last_name, t.first_name, t.last_name
       -- Tri stable : sans le second critere, les enseignants a egalite de
       -- seances sortaient dans un ordre arbitraire et changeaient de
       -- configuration d'une execution a l'autre — un jeu de demonstration
       -- dont les montants attendus bougent ne sert a rien.
       ORDER BY nb_seances DESC, nom, se.enseignant_id
       LIMIT 3`,
      [tenantId, periodStart, periodEnd]
    );

    if (teachers.rowCount === 0) {
      console.log("Aucun enseignant actif avec des seances sur ce mois.");
      await client.query("ROLLBACK");
      return;
    }

    const configTypes = ["hourly", "salary", "mixed"];
    console.log("");
    console.log("Configurations de paie");
    console.log("-".repeat(78));

    // Purge de TOUTES les configurations posees par ce seed, pas seulement
    // celles des enseignants retenus cette fois : un enseignant sorti de la
    // selection gardait sinon une configuration orpheline et continuait d'etre
    // paye, sans figurer nulle part dans le jeu de demonstration.
    const purged = await client.query(
      `DELETE FROM teacher_payment_configs WHERE tenant_id = $1 AND notes = 'Seed 031' RETURNING id`,
      [tenantId]
    );
    if (purged.rowCount > 0) {
      console.log(`  (${purged.rowCount} configuration(s) du seed precedent retiree(s))`);
    }

    for (let i = 0; i < teachers.rows.length; i++) {
      const t = teachers.rows[i];
      const configType = configTypes[i % configTypes.length];
      // effective_from large : la contrainte EXCLUDE de teacher_payment_configs
      // interdit deux configs chevauchantes pour le meme enseignant.
      await client.query(
        `DELETE FROM teacher_payment_configs WHERE tenant_id = $1 AND teacher_id = $2`,
        [tenantId, t.id]
      );
      // `academic_year_id` renseigne l'annee active : sans elle, la config
      // existait en base mais n'apparaissait pas dans l'ecran de configuration.
      const ay = await client.query(
        `SELECT id FROM academic_years WHERE tenant_id = $1 ORDER BY is_active DESC, start_date DESC LIMIT 1`,
        [tenantId]
      );
      await client.query(
        `INSERT INTO teacher_payment_configs
           (tenant_id, academic_year_id, teacher_id, config_type, monthly_salary, default_hourly_rate,
            overtime_threshold, overtime_multiplier, effective_from, notes, created_by)
         VALUES ($1, $11, $2, $3::payment_config_type, $4, $5, $6, $7, $8::date, $9, $10)`,
        [
          tenantId,
          t.id,
          configType,
          configType === "hourly" ? null : 450000,
          configType === "salary" ? null : 10000,
          20, // seuil hebdo volontairement bas : rend les heures sup observables
          1.5,
          "2000-01-01",
          "Seed 031",
          userId,
          ay.rows[0]?.id ?? null,
        ]
      );
      console.log(`  ${t.nom.padEnd(32)} ${configType.padEnd(8)} ${t.nb_seances} seance(s)`);
    }

    const hourlyTeacher = teachers.rows[0];

    // --- Tarifs ECUE ------------------------------------------------------
    const ecues = await client.query(
      `SELECT DISTINCT se.ecue_id, ec.code, ec.libelle
       FROM professional_ecue_seances se
       JOIN professional_ecue ec ON ec.id = se.ecue_id
       WHERE se.tenant_id = $1 AND se.date BETWEEN $2::date AND $3::date
         AND se.enseignant_id = $4
       ORDER BY ec.code
       LIMIT 2`,
      [tenantId, periodStart, periodEnd, hourlyTeacher.id]
    );

    console.log("");
    console.log("Tarifs horaires ECUE");
    console.log("-".repeat(78));
    await client.query(`DELETE FROM professional_ecue_hourly_rates WHERE tenant_id = $1`, [tenantId]);

    if (ecues.rowCount > 0) {
      await client.query(
        `INSERT INTO professional_ecue_hourly_rates
           (tenant_id, ecue_id, enseignant_id, montant_horaire, devise, valide_du, notes, created_by)
         VALUES ($1, $2, NULL, 12000, 'XOF', '2000-01-01'::date, 'Tarif generique (seed 031)', $3)`,
        [tenantId, ecues.rows[0].ecue_id, userId]
      );
      console.log(`  ${ecues.rows[0].code} — generique          12 000 XOF/h`);
    }
    if (ecues.rowCount > 1) {
      await client.query(
        `INSERT INTO professional_ecue_hourly_rates
           (tenant_id, ecue_id, enseignant_id, montant_horaire, devise, valide_du, notes, created_by)
         VALUES ($1, $2, $3, 18000, 'XOF', '2000-01-01'::date, 'Tarif nominatif (seed 031)', $4)`,
        [tenantId, ecues.rows[1].ecue_id, hourlyTeacher.id, userId]
      );
      console.log(`  ${ecues.rows[1].code} — nominatif          18 000 XOF/h`);
    }
    console.log("  (les ECUE sans tarif retombent sur 10 000 XOF/h — tarif par defaut de la config)");

    // --- Etat des seances -------------------------------------------------
    // Remise a plat pour que le seed soit reexecutable a l'identique.
    await client.query(
      `UPDATE professional_ecue_seances
       SET statut = 'planifiee', validated_at = NULL, validated_by = NULL
       WHERE tenant_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [tenantId, periodStart, periodEnd]
    );

    const teacherIds = teachers.rows.map((t) => t.id);
    const candidates = await client.query(
      `SELECT id FROM professional_ecue_seances
       WHERE tenant_id = $1 AND date BETWEEN $2::date AND $3::date
         AND enseignant_id = ANY($4::uuid[])
         AND heure_debut IS NOT NULL AND heure_fin IS NOT NULL
       ORDER BY date, heure_debut`,
      [tenantId, periodStart, periodEnd, teacherIds]
    );

    const ids = candidates.rows.map((r) => r.id);
    // On garde volontairement des cas NON payables : sans eux, on ne verifie
    // jamais que le calcul les ignore (SC-004).
    const annulee = ids.slice(0, 1);
    const nonValidee = ids.slice(1, 3);
    const validee = ids.slice(3);

    if (annulee.length) {
      await client.query(
        `UPDATE professional_ecue_seances SET statut = 'annulee', statut_modifie_le = now()
         WHERE id = ANY($1::uuid[])`,
        [annulee]
      );
    }
    if (nonValidee.length) {
      await client.query(
        `UPDATE professional_ecue_seances SET statut = 'realisee', statut_modifie_le = now()
         WHERE id = ANY($1::uuid[])`,
        [nonValidee]
      );
    }
    if (validee.length) {
      await client.query(
        `UPDATE professional_ecue_seances
         SET statut = 'realisee', statut_modifie_le = now(),
             validated_by = $2, validated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [validee, userId]
      );
    }

    console.log("");
    console.log("Etat des seances de la periode");
    console.log("-".repeat(78));
    console.log(`  annulees (non payables)          : ${annulee.length}`);
    console.log(`  realisees mais NON validees      : ${nonValidee.length}`);
    console.log(`  realisees ET validees (payables) : ${validee.length}`);

    const totalHeures = await client.query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (heure_fin - heure_debut)) / 3600.0), 0)::float8 AS h
       FROM professional_ecue_seances
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, validee]
    );

    await client.query("COMMIT");

    console.log("");
    console.log("=".repeat(78));
    console.log(`Heures payables    : ${Number(totalHeures.rows[0].h).toFixed(2)} h`);
    console.log(`periodId           : ${periodId}`);
    console.log("");
    console.log("Etape suivante : lancer le calcul depuis l'ecran « Calcul des Paiements »,");
    console.log("ou POST /api/v1/teacher-payments/calculate { periodId }.");
    console.log("=".repeat(78));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", error.message);
    if (error.detail) console.error("Detail:", error.detail);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
