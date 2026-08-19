#!/usr/bin/env node

/**
 * Feature 031 — verification de bout en bout de la remuneration professionnelle.
 *
 * Compare ce que la BASE dit devoir etre paye avec ce que l'API calcule
 * reellement. Une verification qui se contenterait de relire les montants
 * produits par le calcul ne prouverait rien : elle confirmerait le calcul par
 * lui-meme. Le montant attendu est donc recalcule en SQL, independamment.
 *
 * Prerequis :
 *   1. migration 0103 appliquee   (node scripts/apply-migration-0103-remuneration-pro.js)
 *   2. jeu de demonstration pose  (node scripts/seed-remuneration-professionnelle.js)
 *   3. API demarree               (pnpm --filter @ecoledigitale/api dev)
 *
 * Usage :
 *   node scripts/verify-remuneration-031.js
 *   API_URL=http://localhost:8011 ADMIN_PASSWORD=... node scripts/verify-remuneration-031.js
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

const API_URL = process.env.API_URL || `http://localhost:${process.env.API_PORT || 4000}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Passw0rd!admin";
const DATABASE_URL = process.env.DATABASE_URL;

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
  const portSeparator = hostPort.lastIndexOf(":");
  return {
    user: decodeURIComponent(userPass.slice(0, colon)),
    password: decodeURIComponent(userPass.slice(colon + 1)),
    host: portSeparator > 0 ? hostPort.slice(0, portSeparator) : hostPort,
    port: portSeparator > 0 ? parseInt(hostPort.slice(portSeparator + 1), 10) || 5432 : 5432,
    database: slash >= 0 ? hostPortDb.slice(slash + 1).split("?")[0] : "postgres",
  };
}

const checks = [];
function check(label, passed, detail) {
  checks.push({ label, passed, detail });
  console.log(`  ${passed ? "OK  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const client = new Client(pgConfigFromDatabaseUrl(DATABASE_URL) || { connectionString: DATABASE_URL });
  await client.connect();

  console.log("Verification feature 031 — remuneration professionnelle");
  console.log("=".repeat(78));

  try {
    // --- Contexte : la periode posee par le seed -----------------------
    const period = await client.query(`
      SELECT pp.id, pp.tenant_id, pp.name,
             pp.period_start::text AS period_start,
             pp.period_end::text   AS period_end,
             pp.academic_year_id,
             t.slug AS tenant_slug
      FROM payment_periods pp
      JOIN tenants t ON t.id = pp.tenant_id
      WHERE (pp.name LIKE '%seed 031%' OR pp.description LIKE '%remuneration professionnelle%')
        -- Exclure les periodes archivees : le calcul les refuse, et une
        -- execution precedente du seed a pu en laisser une en doublon.
        AND pp.status <> 'archived'
      ORDER BY pp.created_at DESC LIMIT 1
    `);
    if (period.rowCount === 0) {
      console.log("Periode de demonstration absente : lancer d'abord scripts/seed-remuneration-professionnelle.js");
      process.exitCode = 1;
      return;
    }
    const p = period.rows[0];
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [p.tenant_id]);
    console.log(`Periode : ${p.name} (${p.period_start} -> ${p.period_end})`);
    console.log(`Tenant  : ${p.tenant_slug}`);
    console.log("");

    /**
     * ENSEIGNANTS AU BULLETIN VERROUILLE.
     *
     * Un paiement `approved`, `paid` ou `cancelled` n'est jamais reecrit par un
     * recalcul (FR-025). Les heures de ces enseignants n'apparaitront donc pas
     * dans le resultat du calcul, et les compter dans l'attendu ferait echouer
     * la verification alors que le systeme se comporte correctement.
     *
     * On les exclut donc de l'attendu, et on evite de les choisir pour les
     * scenarios qui ont besoin d'un recalcul effectif.
     */
    const verrouilles = (
      await client.query(
        `SELECT tp.teacher_id
         FROM teacher_payments tp
         WHERE tp.payment_period_id = $1
           AND tp.status::text IN ('approved', 'paid', 'cancelled')`,
        [p.id]
      )
    ).rows.map((r) => r.teacher_id);

    if (verrouilles.length > 0) {
      console.log(
        `${verrouilles.length} enseignant(s) au bulletin verrouille — exclus des verifications qui exigent un recalcul.`
      );
      console.log("");
    }

    // --- Attendu, calcule independamment en SQL -------------------------
    // Reproduit la regle de tarification (nominatif > generique > defaut) sans
    // passer par le code applicatif.
    const expected = await client.query(
      `WITH payable AS (
         SELECT se.id, se.enseignant_id, se.ecue_id, se.date,
                EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut)) / 3600.0 AS heures
         FROM professional_ecue_seances se
         WHERE se.tenant_id = $1
           AND se.date BETWEEN $2::date AND $3::date
           AND se.statut = 'realisee'
           AND se.validated_at IS NOT NULL
           AND se.enseignant_id IS NOT NULL
           AND se.heure_debut IS NOT NULL
           AND se.heure_fin IS NOT NULL
           -- Bulletins verrouilles exclus : leurs heures ne seront pas
           -- recalculees, les attendre serait attendre le contraire de FR-025.
           AND NOT (se.enseignant_id = ANY($4::uuid[]))
       )
       SELECT pa.enseignant_id,
              cfg.config_type::text AS config_type,
              SUM(pa.heures)::float8 AS heures,
              SUM(pa.heures * COALESCE(
                    (SELECT r.montant_horaire FROM professional_ecue_hourly_rates r
                      WHERE r.tenant_id = $1 AND r.ecue_id = pa.ecue_id
                        AND (r.enseignant_id = pa.enseignant_id OR r.enseignant_id IS NULL)
                        AND r.valide_du <= pa.date
                        AND (r.valide_au IS NULL OR r.valide_au >= pa.date)
                      ORDER BY (r.enseignant_id IS NULL), r.valide_du DESC LIMIT 1),
                    cfg.default_hourly_rate, 0))::float8 AS montant_sans_hsup
       FROM payable pa
       JOIN teacher_payment_configs cfg
         ON cfg.tenant_id = $1 AND cfg.teacher_id = pa.enseignant_id
        AND cfg.effective_from <= $3::date
        AND (cfg.effective_to IS NULL OR cfg.effective_to >= $2::date)
       GROUP BY pa.enseignant_id, cfg.config_type
       ORDER BY pa.enseignant_id`,
      [p.tenant_id, p.period_start, p.period_end, verrouilles]
    );

    console.log("Attendu (calcule en SQL, independamment du code applicatif)");
    console.log("-".repeat(78));
    let expectedTotalHours = 0;
    for (const row of expected.rows) {
      expectedTotalHours += Number(row.heures);
      console.log(
        `  ${row.enseignant_id.slice(0, 8)}  ${row.config_type.padEnd(7)} ` +
          `${Number(row.heures).toFixed(2).padStart(6)} h  ` +
          `${Math.round(Number(row.montant_sans_hsup)).toLocaleString("fr-FR").padStart(12)} XOF (hors h. sup)`
      );
    }
    console.log("");

    // --- Authentification ----------------------------------------------
    // Les roles vivent dans user_roles/roles, pas dans une colonne users.role.
    const admin = await client.query(
      `SELECT DISTINCT u.email, u.created_at
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = $1 AND LOWER(r.name) IN ('admin', 'super_admin', 'administrateur')
       ORDER BY u.created_at LIMIT 1`,
      [p.tenant_id]
    );
    if (admin.rowCount === 0) {
      console.log("Aucun administrateur sur ce tenant : impossible d'appeler l'API.");
      process.exitCode = 1;
      return;
    }
    const email = admin.rows[0].email;

    const loginRes = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tenant": p.tenant_slug },
      body: JSON.stringify({ email, password: ADMIN_PASSWORD }),
    }).catch((e) => ({ ok: false, statusText: e.message }));

    if (!loginRes.ok) {
      console.log(`Connexion impossible (${email}) : ${loginRes.status ?? ""} ${loginRes.statusText ?? ""}`);
      console.log("Verifier que l'API tourne et que ADMIN_PASSWORD est correct.");
      process.exitCode = 1;
      return;
    }
    const login = await loginRes.json();
    const token = login.accessToken || login.data?.accessToken || login.token;
    if (!token) {
      console.log("Reponse de login sans jeton :", JSON.stringify(login).slice(0, 200));
      process.exitCode = 1;
      return;
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Tenant": p.tenant_slug,
      "x-academic-year-id": p.academic_year_id || "",
    };

    // --- 1er calcul ------------------------------------------------------
    console.log("Calcul via l'API");
    console.log("-".repeat(78));
    const calcRes = await fetch(`${API_URL}/api/v1/teacher-payments/calculate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ periodId: p.id, recalculate: true }),
    });
    const calc = await calcRes.json();
    if (!calcRes.ok) {
      console.log("Calcul refuse :", JSON.stringify(calc).slice(0, 400));
      process.exitCode = 1;
      return;
    }

    const results = calc.data?.results ?? [];
    for (const r of results) {
      if (r.status === "calculated") {
        console.log(
          `  ${String(r.teacherName).padEnd(24)} ${String(r.paymentType).padEnd(7)} ` +
            `${Math.round(r.totalAmount).toLocaleString("fr-FR").padStart(12)} ${r.currency ?? ""}  ` +
            `(acad ${r.hoursBySource?.academique ?? 0} h / pro ${r.hoursBySource?.professionnel ?? 0} h)`
        );
      } else {
        console.log(
          `  ${String(r.teacherName).padEnd(24)} ${String(r.status).padEnd(10)} ${r.skipReason ?? ""} ${r.message ?? r.error ?? ""}`
        );
      }
    }
    console.log("");

    // --- Assertions ------------------------------------------------------
    console.log("Verifications");
    console.log("-".repeat(78));

    check("teacherName renseigne (plus de « Unknown »)",
      results.every((r) => r.teacherName && r.teacherName !== "Unknown"));

    const calculated = results.filter((r) => r.status === "calculated");
    check("au moins un paiement calcule", calculated.length > 0, `${calculated.length} paiement(s)`);

    const paidPro = calculated.filter((r) => (r.hoursBySource?.professionnel ?? 0) > 0);
    check(
      "des heures PROFESSIONNELLES ont ete payees (SC-001)",
      paidPro.length > 0,
      `${paidPro.length} enseignant(s)`
    );

    const proHoursPaid = calculated.reduce((s, r) => s + (r.hoursBySource?.professionnel ?? 0), 0);
    check(
      "heures professionnelles payees = heures payables attendues (SC-004)",
      Math.abs(proHoursPaid - expectedTotalHours) < 0.01,
      `${proHoursPaid.toFixed(2)} h payees / ${expectedTotalHours.toFixed(2)} h attendues`
    );

    // Le detail doit tracer chaque heure vers sa seance (SC-003).
    const detail = await client.query(
      `SELECT phd.source, count(*)::int AS lignes,
              SUM(phd.hours_count)::float8 AS heures,
              count(*) FILTER (WHERE phd.seance_id IS NOT NULL)::int AS avec_seance
       FROM payment_hour_details phd
       JOIN teacher_payments tp ON tp.id = phd.payment_id
       WHERE tp.payment_period_id = $1
       GROUP BY phd.source`,
      [p.id]
    );
    const proDetail = detail.rows.find((r) => r.source === "professionnel");
    check(
      "chaque ligne professionnelle reference sa seance (SC-003)",
      Boolean(proDetail) && proDetail.lignes === proDetail.avec_seance,
      proDetail ? `${proDetail.avec_seance}/${proDetail.lignes} lignes` : "aucune ligne"
    );

    // Aucune seance non payable ne doit avoir produit de ligne — sur les
    // bulletins RECALCULABLES. Un bulletin verrouille garde ses lignes meme si
    // la seance change ensuite : c'est FR-025, pas une fuite. Les compter ici
    // reviendrait a exiger qu'un montant deja paye se reecrive tout seul.
    const leak = await client.query(
      `SELECT count(*)::int AS n
       FROM payment_hour_details phd
       JOIN teacher_payments tp ON tp.id = phd.payment_id
       JOIN professional_ecue_seances se ON se.id = phd.seance_id
       WHERE tp.payment_period_id = $1
         AND tp.status::text NOT IN ('approved', 'paid', 'cancelled')
         AND (se.statut <> 'realisee' OR se.validated_at IS NULL)`,
      [p.id]
    );
    check(
      "aucune seance annulee ou non validee n'a produit de montant (SC-004)",
      leak.rows[0].n === 0,
      `${leak.rows[0].n} fuite(s)`
    );

    // --- Idempotence : 2e calcul identique (SC-005) ----------------------
    const before = await client.query(
      `SELECT tp.id, tp.total_amount::float8 AS total,
              (SELECT count(*)::int FROM payment_hour_details d WHERE d.payment_id = tp.id) AS lignes
       FROM teacher_payments tp WHERE tp.payment_period_id = $1 ORDER BY tp.id`,
      [p.id]
    );

    await fetch(`${API_URL}/api/v1/teacher-payments/calculate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ periodId: p.id, recalculate: true }),
    });

    const after = await client.query(
      `SELECT tp.id, tp.total_amount::float8 AS total,
              (SELECT count(*)::int FROM payment_hour_details d WHERE d.payment_id = tp.id) AS lignes
       FROM teacher_payments tp WHERE tp.payment_period_id = $1 ORDER BY tp.id`,
      [p.id]
    );

    const identical =
      before.rows.length === after.rows.length &&
      before.rows.every((b, i) => {
        const a = after.rows[i];
        return a.id === b.id && Math.abs(a.total - b.total) < 0.01 && a.lignes === b.lignes;
      });
    check(
      "recalcul idempotent : memes montants, meme nombre de lignes (SC-005)",
      identical,
      `${before.rows.length} paiement(s)`
    );

    // --- Verrou sur paiement approuve (FR-025) --------------------------
    if (after.rows.length > 0) {
      const locked = after.rows[0].id;
      await client.query(
        `UPDATE teacher_payments SET status = 'approved', approved_at = now() WHERE id = $1`,
        [locked]
      );
      const lockedTotalBefore = after.rows[0].total;

      const relock = await fetch(`${API_URL}/api/v1/teacher-payments/calculate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ periodId: p.id, recalculate: true }),
      });
      const relockJson = await relock.json();
      const lockedResult = (relockJson.data?.results ?? []).find(
        (r) => r.skipReason === "PAYMENT_LOCKED"
      );

      const stillSame = await client.query(
        `SELECT total_amount::float8 AS total, status::text AS status FROM teacher_payments WHERE id = $1`,
        [locked]
      );
      check(
        "un paiement approuve n'est pas ecrase par un recalcul (FR-025)",
        Boolean(lockedResult) &&
          stillSame.rows[0].status === "approved" &&
          Math.abs(stillSame.rows[0].total - lockedTotalBefore) < 0.01
      );

      await client.query(
        `UPDATE teacher_payments SET status = 'calculated', approved_at = NULL WHERE id = $1`,
        [locked]
      );
    }

    // --- US4 : ventilation par origine et invariant (SC-007) --------------
    const summaryRes = await fetch(
      `${API_URL}/api/v1/payment-reports/summary?periodId=${p.id}&source=all`,
      { headers }
    );
    if (summaryRes.ok) {
      const summary = (await summaryRes.json()).data?.summary ?? {};
      const bs = summary.bySource ?? {};
      const somme = (bs.academique ?? 0) + (bs.professionnel ?? 0) + (bs.nonVentile ?? 0);
      check(
        "ventilation par origine : acad + pro + hors-heures = total (SC-007)",
        Math.abs(somme - (summary.totalAmount ?? 0)) < 0.01,
        `${Math.round(bs.academique ?? 0)} + ${Math.round(bs.professionnel ?? 0)} + ${Math.round(bs.nonVentile ?? 0)} = ${Math.round(somme)} / total ${Math.round(summary.totalAmount ?? 0)}`
      );

      const proRes = await fetch(
        `${API_URL}/api/v1/payment-reports/summary?periodId=${p.id}&source=professionnel`,
        { headers }
      );
      const proSummary = proRes.ok ? (await proRes.json()).data?.summary ?? {} : {};
      check(
        "le filtre « professionnel » ne retient que les paiements concernes (FR-030)",
        (proSummary.totalPayments ?? 0) > 0 &&
          (proSummary.totalPayments ?? 0) <= (summary.totalPayments ?? 0),
        `${proSummary.totalPayments ?? 0} / ${summary.totalPayments ?? 0} paiement(s)`
      );
    } else {
      check("rapports accessibles", false, `HTTP ${summaryRes.status}`);
    }

    // --- US4 : detail enrichi d'un paiement (SC-003) -----------------------
    const anyPayment = after.rows[0];
    if (anyPayment) {
      const detRes = await fetch(`${API_URL}/api/v1/teacher-payments/${anyPayment.id}`, { headers });
      const det = detRes.ok ? (await detRes.json()).data ?? {} : {};
      const lignes = det.hourDetails ?? [];
      const pro = lignes.filter((l) => l.source === "professionnel");
      check(
        "le detail expose origine, intitule et cohorte (FR-031)",
        pro.length === 0 ||
          pro.every((l) => l.source && l.intitule && l.sessionDate && l.seanceId),
        `${pro.length} ligne(s) professionnelle(s)`
      );
    }

    // --- US3 : resolution du tarif ECUE -----------------------------------
    const rateSample = await client.query(
      `SELECT r.ecue_id, COALESCE(r.enseignant_id, se.enseignant_id) AS enseignant_id, r.montant_horaire::float8 AS montant
       FROM professional_ecue_hourly_rates r
       LEFT JOIN LATERAL (
         SELECT s.enseignant_id FROM professional_ecue_seances s
         WHERE s.ecue_id = r.ecue_id AND s.enseignant_id IS NOT NULL LIMIT 1
       ) se ON TRUE
       WHERE r.tenant_id = $1 LIMIT 1`,
      [p.tenant_id]
    );
    if (rateSample.rowCount > 0) {
      const r = rateSample.rows[0];
      const params = new URLSearchParams({
        ecueId: r.ecue_id,
        enseignantId: r.enseignant_id,
        date: p.period_start,
      });
      const resolveRes = await fetch(
        `${API_URL}/api/v1/professional/remuneration/ecue-rates/resolve?${params}`,
        { headers }
      );
      const resolved = resolveRes.ok ? (await resolveRes.json()).data ?? {} : {};
      check(
        "la resolution de tarif ECUE renvoie un montant et son origine (FR-012)",
        Boolean(resolved.montant_horaire) && Boolean(resolved.origine),
        `${resolved.montant_horaire} XOF — ${resolved.origine}`
      );
    }

    // --- Derogation comptable sur le volume horaire (0104) ----------------
    // Une seance payable est choisie, sa duree est doublee, et on verifie que
    // le montant recalcule suit — sans que les horaires aient bouge.
    // La seance doit FIGURER DANS LE DETAIL horaire : celles d'un enseignant
    // salarie n'en produisent aucune, doubler leur duree ne changerait rien et
    // le test mesurerait la mauvaise chose.
    const cible = await client.query(
      `SELECT se.id, se.heure_debut::text hd, se.heure_fin::text hf,
              EXTRACT(EPOCH FROM (se.heure_fin - se.heure_debut))/3600.0 AS duree
       FROM professional_ecue_seances se
       WHERE se.tenant_id = $1 AND se.date BETWEEN $2::date AND $3::date
         AND se.statut = 'realisee' AND se.validated_at IS NOT NULL
         AND se.heure_debut IS NOT NULL AND se.heure_fin IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM payment_hour_details d
           JOIN teacher_payments tp2 ON tp2.id = d.payment_id
           WHERE d.seance_id = se.id AND tp2.payment_period_id = $4
         )
         AND NOT EXISTS (
           SELECT 1 FROM payment_hour_details d
           JOIN teacher_payments tp2 ON tp2.id = d.payment_id
           WHERE d.seance_id = se.id AND tp2.status::text IN ('approved','paid')
         )
       ORDER BY se.date LIMIT 1`,
      [p.tenant_id, p.period_start, p.period_end, p.id]
    );

    if (cible.rowCount > 0) {
      const s = cible.rows[0];
      const dureeOrigine = Number(s.duree);
      const dureeCible = dureeOrigine * 2;

      const avant = await client.query(
        `SELECT COALESCE(SUM(phd.hours_count), 0)::float8 h
         FROM payment_hour_details phd JOIN teacher_payments tp ON tp.id = phd.payment_id
         WHERE tp.payment_period_id = $1 AND phd.source = 'professionnel'`,
        [p.id]
      );

      const setRes = await fetch(
        `${API_URL}/api/v1/professional/remuneration/seances/${s.id}/duree`,
        { method: "PATCH", headers, body: JSON.stringify({ duree: dureeCible }) }
      );
      check("la derogation de volume horaire est acceptee", setRes.ok, `HTTP ${setRes.status}`);

      // Les horaires ne doivent PAS avoir change : c'est tout l'interet de
      // separer le registre pedagogique du volume paye.
      const apresSet = await client.query(
        `SELECT heure_debut::text hd, heure_fin::text hf, duree_payee::float8 dp
         FROM professional_ecue_seances WHERE id = $1`,
        [s.id]
      );
      check(
        "les horaires restent intacts apres derogation",
        apresSet.rows[0].hd === s.hd && apresSet.rows[0].hf === s.hf,
        `${apresSet.rows[0].hd}–${apresSet.rows[0].hf}`
      );

      await fetch(`${API_URL}/api/v1/teacher-payments/calculate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ periodId: p.id, recalculate: true }),
      });

      const apres = await client.query(
        `SELECT COALESCE(SUM(phd.hours_count), 0)::float8 h
         FROM payment_hour_details phd JOIN teacher_payments tp ON tp.id = phd.payment_id
         WHERE tp.payment_period_id = $1 AND phd.source = 'professionnel'`,
        [p.id]
      );
      check(
        "le calcul paie le volume derogé, pas celui des horaires",
        Math.abs(apres.rows[0].h - (avant.rows[0].h + dureeOrigine)) < 0.01,
        `${avant.rows[0].h} h -> ${apres.rows[0].h} h (attendu +${dureeOrigine})`
      );

      // Retrait de la derogation : retour au volume des horaires.
      await fetch(`${API_URL}/api/v1/professional/remuneration/seances/${s.id}/duree`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ duree: null }),
      });
      await fetch(`${API_URL}/api/v1/teacher-payments/calculate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ periodId: p.id, recalculate: true }),
      });
      const retabli = await client.query(
        `SELECT COALESCE(SUM(phd.hours_count), 0)::float8 h
         FROM payment_hour_details phd JOIN teacher_payments tp ON tp.id = phd.payment_id
         WHERE tp.payment_period_id = $1 AND phd.source = 'professionnel'`,
        [p.id]
      );
      check(
        "retirer la derogation rend la main aux horaires",
        Math.abs(retabli.rows[0].h - avant.rows[0].h) < 0.01,
        `${retabli.rows[0].h} h / ${avant.rows[0].h} h`
      );
    }

    // --- Rapprochement emploi du temps ------------------------------------
    const manqRes = await fetch(
      `${API_URL}/api/v1/professional/remuneration/seances/manquantes?fromDate=${p.period_start}&toDate=${p.period_end}`,
      { headers }
    );
    const manquantes = manqRes.ok ? (await manqRes.json()).data ?? [] : null;
    check(
      "le rapprochement emploi du temps repond",
      Array.isArray(manquantes),
      Array.isArray(manquantes) ? `${manquantes.length} creneau(x) sans seance` : `HTTP ${manqRes.status}`
    );

    // Aucun creneau signale ne doit avoir de seance : sinon on proposerait
    // d'ajouter des doublons.
    if (Array.isArray(manquantes) && manquantes.length > 0) {
      const faux = await client.query(
        `SELECT count(*)::int n FROM professional_ecue_seances se
         WHERE se.tenant_id = $1 AND se.ue_session_id = $2 AND se.ecue_id = $3 AND se.date = $4::date`,
        [p.tenant_id, manquantes[0].ue_session_id, manquantes[0].ecue_id, manquantes[0].date]
      );
      check(
        "un creneau signale manquant n'a effectivement aucune seance",
        faux.rows[0].n === 0,
        `${faux.rows[0].n} seance(s) trouvee(s)`
      );
    }

    // --- Saisie libre : une seance SANS horaires, payee sur son volume -----
    // C'est le cas que la derogation debloque : jusqu'ici, une seance sans
    // creneau n'etait pas payable, meme quand l'administration connaissait sa
    // duree.
    // L'enseignant doit avoir un bulletin RECALCULABLE : sur un paiement
    // verrouille, valider une seance de plus ne change rien et le test
    // mesurerait le verrou au lieu de la collecte.
    const contexte = await client.query(
      `SELECT se.ue_session_id, se.ecue_id, se.enseignant_id
       FROM professional_ecue_seances se
       JOIN teacher_payment_configs cfg
         ON cfg.teacher_id = se.enseignant_id AND cfg.tenant_id = se.tenant_id
        AND cfg.config_type::text IN ('hourly', 'mixed')
       WHERE se.tenant_id = $1 AND se.date BETWEEN $2::date AND $3::date
         AND se.enseignant_id IS NOT NULL
         AND NOT (se.enseignant_id = ANY($4::uuid[]))
       LIMIT 1`,
      [p.tenant_id, p.period_start, p.period_end, verrouilles]
    );

    if (contexte.rowCount === 0) {
      console.log(
        "  (saisie libre non testee : aucun enseignant horaire/mixte au bulletin recalculable sur cette periode)"
      );
    }

    let seanceLibreId = null;
    if (contexte.rowCount > 0) {
      const ctx = contexte.rows[0];
      const avantLibre = await client.query(
        `SELECT COALESCE(SUM(phd.hours_count), 0)::float8 h
         FROM payment_hour_details phd JOIN teacher_payments tp ON tp.id = phd.payment_id
         WHERE tp.payment_period_id = $1 AND phd.source = 'professionnel'`,
        [p.id]
      );

      const creation = await fetch(`${API_URL}/api/v1/professional/remuneration/seances`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ue_session_id: ctx.ue_session_id,
          ecue_id: ctx.ecue_id,
          enseignant_id: ctx.enseignant_id,
          date: p.period_end,
          duree_payee: 4,
          libelle: "Seance de verification (sans horaires)",
        }),
      });
      const creee = creation.ok ? (await creation.json()).data : null;
      seanceLibreId = creee?.id ?? null;
      check(
        "une seance sans horaires est creable avec un volume horaire",
        creation.ok && Boolean(seanceLibreId),
        `HTTP ${creation.status}`
      );

      if (seanceLibreId) {
        const etat = await client.query(
          `SELECT statut, validated_at, saisie_comptable, cree_par IS NOT NULL AS tracee
           FROM professional_ecue_seances WHERE id = $1`,
          [seanceLibreId]
        );
        const e = etat.rows[0];
        check(
          "elle est creee 'realisee' mais NON validee (valider reste un acte distinct)",
          e.statut === "realisee" && e.validated_at === null
        );
        check(
          "elle est tracee comme saisie comptable",
          e.saisie_comptable === true && e.tracee === true
        );

        // Tant qu'elle n'est pas validee, elle ne doit rien produire.
        await fetch(`${API_URL}/api/v1/teacher-payments/calculate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ periodId: p.id, recalculate: true }),
        });
        const nonValidee = await client.query(
          `SELECT COALESCE(SUM(phd.hours_count), 0)::float8 h
           FROM payment_hour_details phd JOIN teacher_payments tp ON tp.id = phd.payment_id
           WHERE tp.payment_period_id = $1 AND phd.source = 'professionnel'`,
          [p.id]
        );
        check(
          "non validee, elle ne produit aucun montant",
          Math.abs(nonValidee.rows[0].h - avantLibre.rows[0].h) < 0.01,
          `${nonValidee.rows[0].h} h / ${avantLibre.rows[0].h} h`
        );

        // Validee, elle doit apporter exactement son volume.
        await fetch(`${API_URL}/api/v1/professional/remuneration/seances/validate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ seanceIds: [seanceLibreId], validated: true }),
        });
        await fetch(`${API_URL}/api/v1/teacher-payments/calculate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ periodId: p.id, recalculate: true }),
        });
        const validee = await client.query(
          `SELECT COALESCE(SUM(phd.hours_count), 0)::float8 h
           FROM payment_hour_details phd JOIN teacher_payments tp ON tp.id = phd.payment_id
           WHERE tp.payment_period_id = $1 AND phd.source = 'professionnel'`,
          [p.id]
        );
        check(
          "validee, elle est payee sur son volume saisi (4 h)",
          Math.abs(validee.rows[0].h - (avantLibre.rows[0].h + 4)) < 0.01,
          `${avantLibre.rows[0].h} h -> ${validee.rows[0].h} h`
        );

        // Une seance qui justifie un montant ne peut pas etre supprimee
        // (ON DELETE RESTRICT, migration 0105) : on la devalide et on recalcule
        // pour purger son detail, ce qui la libere.
        const suppressionBloquee = await client
          .query(`DELETE FROM professional_ecue_seances WHERE id = $1`, [seanceLibreId])
          .then(() => false)
          .catch(() => true);
        check(
          "une seance qui justifie un paiement ne peut pas etre supprimee (0105)",
          suppressionBloquee
        );

        const devalRes = await fetch(
          `${API_URL}/api/v1/professional/remuneration/seances/validate`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ seanceIds: [seanceLibreId], validated: false }),
          }
        );
        const deval = await devalRes.json().catch(() => ({}));
        check(
          "la seance se devalide (elle liberera son detail au recalcul)",
          devalRes.ok && (deval.data?.updated ?? 0) === 1,
          `HTTP ${devalRes.status} — ${JSON.stringify(deval.data ?? deval).slice(0, 160)}`
        );
        await fetch(`${API_URL}/api/v1/teacher-payments/calculate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ periodId: p.id, recalculate: true }),
        });
        await client.query(`DELETE FROM professional_ecue_seances WHERE id = $1`, [seanceLibreId]);
        await fetch(`${API_URL}/api/v1/teacher-payments/calculate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ periodId: p.id, recalculate: true }),
        });
      }
    }

    // --- Bilan ------------------------------------------------------------
    const failed = checks.filter((c) => !c.passed);
    console.log("");
    console.log("=".repeat(78));
    if (failed.length === 0) {
      console.log(`Toutes les verifications passent (${checks.length}/${checks.length}).`);
    } else {
      console.log(`${failed.length} verification(s) en echec sur ${checks.length} :`);
      failed.forEach((c) => console.log(`  - ${c.label}`));
      process.exitCode = 1;
    }
    console.log("=".repeat(78));
  } catch (error) {
    console.error("Verification interrompue :", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
