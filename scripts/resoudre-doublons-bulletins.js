#!/usr/bin/env node

/**
 * Feature 031 — resout les bulletins en doublon avant la migration 0106.
 *
 * LE PROBLEME
 * `unique_teacher_payment_per_period` porte sur
 * (tenant, enseignant, periode, TYPE). Le type en faisant partie, un enseignant
 * dont la configuration passe d'horaire a salarie en cours de periode se voyait
 * creer un SECOND bulletin au lieu de voir le premier mis a jour. Payer les deux
 * revient a le payer deux fois.
 *
 * CE QUE CE SCRIPT FAIT
 * Pour chaque groupe (tenant, enseignant, periode) comptant plusieurs
 * bulletins, il en garde UN et supprime les autres :
 *
 *   1. Si un bulletin est VERROUILLE (approved / paid), c'est lui qu'on garde :
 *      il a engage l'etablissement, on ne le supprime pas.
 *   2. Si PLUSIEURS sont verrouilles, on ne tranche PAS — c'est une double
 *      remuneration deja engagee, qui releve d'une decision de gestion. Le
 *      groupe est signale et laisse intact.
 *   3. Sinon on garde le plus recemment calcule, le seul a refleter l'etat
 *      courant des heures et de la configuration.
 *
 * Les bulletins supprimes emportent leur detail horaire et leurs entrees
 * d'audit (CASCADE). Le trigger d'audit est neutralise localement : sur DELETE,
 * il tente d'ecrire une trace referencant le paiement supprime, ce qui ferait
 * echouer l'operation sur sa propre trace.
 *
 * Usage :
 *   node scripts/resoudre-doublons-bulletins.js            # apercu seul
 *   node scripts/resoudre-doublons-bulletins.js --appliquer
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

const APPLIQUER = process.argv.includes("--appliquer");
const VERROUILLES = ["approved", "paid"];

function pgConfigFromDatabaseUrl(url) {
  if (!url || !url.startsWith("postgresql://")) return null;
  const withoutScheme = url.replace(/^postgresql:\/\//, "");
  const lastAt = withoutScheme.lastIndexOf("@");
  if (lastAt <= 0) return null;
  const userPass = withoutScheme.slice(0, lastAt);
  const hostPortDb = withoutScheme.slice(lastAt + 1);
  const colon = userPass.indexOf(":");
  const slash = hostPortDb.indexOf("/");
  const hostPort = slash >= 0 ? hostPortDb.slice(0, slash) : hostPortDb;
  const sep = hostPort.lastIndexOf(":");
  return {
    user: decodeURIComponent(userPass.slice(0, colon)),
    password: decodeURIComponent(userPass.slice(colon + 1)),
    host: sep > 0 ? hostPort.slice(0, sep) : hostPort,
    port: sep > 0 ? parseInt(hostPort.slice(sep + 1), 10) || 5432 : 5432,
    database: slash >= 0 ? hostPortDb.slice(slash + 1).split("?")[0] : "postgres",
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  const client = new Client(pgConfigFromDatabaseUrl(url) || { connectionString: url });
  await client.connect();

  console.log("Resolution des bulletins en doublon (feature 031)");
  console.log("=".repeat(78));
  console.log(APPLIQUER ? "MODE : application" : "MODE : apercu seul (--appliquer pour ecrire)");
  console.log("");

  try {
    const groupes = await client.query(
      `SELECT tp.tenant_id, tp.teacher_id, tp.payment_period_id,
              count(*)::int AS n,
              count(*) FILTER (WHERE tp.status::text = ANY($1::text[]))::int AS verrouilles
       FROM teacher_payments tp
       GROUP BY tp.tenant_id, tp.teacher_id, tp.payment_period_id
       HAVING count(*) > 1
       ORDER BY count(*) DESC`,
      [VERROUILLES]
    );

    if (groupes.rowCount === 0) {
      console.log("Aucun doublon. La migration 0106 peut etre appliquee.");
      return;
    }

    let aSupprimer = [];
    let bloquants = 0;

    for (const g of groupes.rows) {
      const lignes = await client.query(
        `SELECT tp.id, tp.payment_type::text AS type, tp.status::text AS statut,
                tp.total_amount::float8 AS total, tp.calculated_at,
                (SELECT count(*)::int FROM payment_hour_details d WHERE d.payment_id = tp.id) AS lignes,
                COALESCE(TRIM(u.first_name || ' ' || u.last_name), 'Enseignant') AS nom,
                pp.name AS periode
         FROM teacher_payments tp
         JOIN teachers te ON te.id = tp.teacher_id
         LEFT JOIN users u ON u.id = te.user_id
         LEFT JOIN payment_periods pp ON pp.id = tp.payment_period_id
         WHERE tp.tenant_id = $1 AND tp.teacher_id = $2 AND tp.payment_period_id = $3
         ORDER BY tp.calculated_at DESC`,
        [g.tenant_id, g.teacher_id, g.payment_period_id]
      );

      const nom = lignes.rows[0].nom;
      const periode = lignes.rows[0].periode;
      console.log(`${nom} — ${periode}`);
      lignes.rows.forEach((l) =>
        console.log(
          `   ${l.type.padEnd(8)} ${l.statut.padEnd(11)} ${String(Math.round(l.total)).padStart(9)} XOF  ${String(l.lignes).padStart(3)} ligne(s)`
        )
      );

      const verrous = lignes.rows.filter((l) => VERROUILLES.includes(l.statut));

      if (verrous.length > 1) {
        // Deux montants deja engages : supprimer l'un d'eux serait effacer une
        // dette reelle. C'est a la gestion de trancher, pas a un script.
        console.log("   >> NON TRAITE : plusieurs bulletins deja engages. Decision de gestion requise.");
        bloquants++;
        console.log("");
        continue;
      }

      const garde = verrous.length === 1 ? verrous[0] : lignes.rows[0];
      const retires = lignes.rows.filter((l) => l.id !== garde.id);
      console.log(
        `   >> garde : ${garde.type}/${garde.statut} — supprime : ${retires.map((r) => `${r.type}/${r.statut}`).join(", ")}`
      );
      aSupprimer.push(...retires.map((r) => r.id));
      console.log("");
    }

    console.log("-".repeat(78));
    console.log(`${groupes.rowCount} groupe(s) | ${aSupprimer.length} bulletin(s) a supprimer | ${bloquants} non traite(s)`);

    if (!APPLIQUER) {
      console.log("\nApercu seul. Relancer avec --appliquer pour ecrire.");
      return;
    }
    if (aSupprimer.length === 0) {
      console.log("\nRien a supprimer.");
      return;
    }

    await client.query("BEGIN");
    try {
      await client.query("ALTER TABLE teacher_payments DISABLE TRIGGER audit_teacher_payments_trigger");
      const d = await client.query(`DELETE FROM payment_hour_details WHERE payment_id = ANY($1::uuid[])`, [aSupprimer]);
      const a = await client.query(`DELETE FROM payment_audit_log WHERE payment_id = ANY($1::uuid[])`, [aSupprimer]);
      const t = await client.query(`DELETE FROM teacher_payments WHERE id = ANY($1::uuid[])`, [aSupprimer]);
      await client.query("ALTER TABLE teacher_payments ENABLE TRIGGER audit_teacher_payments_trigger");
      await client.query("COMMIT");
      console.log(`\nSupprime : ${t.rowCount} bulletin(s), ${d.rowCount} ligne(s) de detail, ${a.rowCount} entree(s) d'audit`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("\nROLLBACK —", e.message);
      process.exitCode = 1;
      return;
    }

    const reste = await client.query(
      `SELECT count(*)::int AS n FROM (
         SELECT 1 FROM teacher_payments
         GROUP BY tenant_id, teacher_id, payment_period_id HAVING count(*) > 1
       ) d`
    );
    console.log(`Groupes en doublon restants : ${reste.rows[0].n}`);
    if (reste.rows[0].n === 0) {
      console.log("La migration 0106 peut etre appliquee.");
    }
  } catch (error) {
    console.error("Echec :", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
