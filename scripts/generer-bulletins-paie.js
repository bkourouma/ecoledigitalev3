#!/usr/bin/env node

/**
 * Generation des bulletins de paie PDF + notification des enseignants —
 * feature 031.
 *
 * Derniere etape du parcours, apres :
 *   scripts/traiter-seances-manquantes.js --apply   (source des heures)
 *   scripts/preparer-paie-complete.js --apply       (configs, periodes, calcul)
 *
 * APPROBATION
 * Un bulletin se remet sur un montant arrete, pas sur un brouillon. Le script
 * approuve donc les paiements « calculated » avant d'emettre le PDF, ce qui
 * verrouille au passage les seances rattachees (FR-006) : plus personne ne peut
 * devalider une seance deja payee.
 *
 * NOTIFICATION
 * Desactivee par defaut (--notifier pour l'activer). Emettre 144 courriels est
 * une action sortante irreversible : elle merite un geste explicite, meme quand
 * le reste du parcours est automatise.
 *
 * Usage :
 *   node scripts/generer-bulletins-paie.js                      (simulation)
 *   node scripts/generer-bulletins-paie.js --apply              (approuve + PDF)
 *   node scripts/generer-bulletins-paie.js --apply --notifier   (+ courriels)
 *   node scripts/generer-bulletins-paie.js --apply --limite 3   (echantillon)
 */

const fs = require("fs");
const path = require("path");
const { connect, API_URL } = require("./lib/api-client");

const SORTIE = path.join(__dirname, "..", "bulletins-paie");

/**
 * Registre des envois reussis.
 *
 * Sans lui, une interruption au 102e courriel sur 144 ne laisse AUCUNE trace de
 * ce qui est parti : reprendre veut alors dire tout renvoyer, ou deviner. Le
 * fichier est la memoire du script entre deux executions.
 *
 * Il vit A COTE du script, pas dans le dossier de sortie : les PDF sont des
 * artefacts jetables et regenerables, le registre non. Les ranger ensemble
 * faisait disparaitre la memoire des envois au premier menage.
 */
const REGISTRE = path.join(__dirname, ".envois-bulletins.json");

function lireRegistre() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRE, "utf8"));
  } catch {
    return {};
  }
}

function ecrireRegistre(registre) {
  fs.writeFileSync(REGISTRE, JSON.stringify(registre, null, 2));
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** 451 = refus TEMPORAIRE (quota). Le message repartira, il faut ralentir. */
const estTransitoire = (motif) =>
  typeof motif === "string" && /\b451\b|ratelimit|too many|try again/i.test(motif);

function argNombre(nom, defaut) {
  const i = process.argv.indexOf(nom);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : defaut;
}

const slug = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function main() {
  const apply = process.argv.includes("--apply");
  const notifier = process.argv.includes("--notifier");
  const limite = argNombre("--limite", Infinity);

  const ctx = await connect();
  const bilan = { approuves: 0, pdf: 0, notifies: 0, echecs: [] };

  try {
    const { rows: paiements } = await ctx.sql(
      `SELECT tp.id, tp.status::text AS statut, tp.total_amount::float8 AS montant,
              COALESCE(TRIM(u.first_name || ' ' || u.last_name),
                       TRIM(t.first_name || ' ' || t.last_name)) AS enseignant,
              COALESCE(u.email, t.email) AS email,
              pp.name AS periode, pp.period_start::text AS debut
         FROM teacher_payments tp
         JOIN teachers t ON t.id = tp.teacher_id
         LEFT JOIN users u ON u.id = t.user_id
         JOIN payment_periods pp ON pp.id = tp.payment_period_id
        WHERE tp.tenant_id = $1
        ORDER BY pp.period_start, enseignant`,
      [ctx.tenant.id]
    );

    const cibles = paiements.slice(0, limite === Infinity ? undefined : limite);

    console.log(`Tenant     : ${ctx.tenant.slug}`);
    console.log(`Paiements  : ${paiements.length} (${cibles.length} traites)`);
    console.log(`Sortie PDF : ${SORTIE}`);
    console.log(`Courriels  : ${notifier ? "ACTIVES" : "desactives (--notifier pour envoyer)"}`);

    const aApprouver = cibles.filter((p) => p.statut === "calculated");
    console.log(`A approuver: ${aApprouver.length}\n`);

    if (!apply) {
      console.log("Simulation. Relancer avec --apply.");
      for (const p of cibles.slice(0, 5)) {
        console.log(`  ${p.periode.padEnd(20)} ${p.enseignant.padEnd(18)} ${p.montant} XOF [${p.statut}]`);
      }
      return;
    }

    fs.mkdirSync(SORTIE, { recursive: true });

    /* ------------------------- 1. Approbation -------------------------- */
    if (aApprouver.length > 0) {
      // Par lots : l'endpoint accepte une liste, un appel par bulletin
      // multiplierait les allers-retours sans rien apporter.
      for (let i = 0; i < aApprouver.length; i += 100) {
        const lot = aApprouver.slice(i, i + 100).map((p) => p.id);
        const r = await ctx.api("POST", "/api/v1/teacher-payments/approve", {
          paymentIds: lot,
          notes: "Approbation groupee — regularisation des seances effectuees.",
        });
        if (r.ok) bilan.approuves += r.body?.approved ?? lot.length;
        else bilan.echecs.push(`approbation lot ${i / 100 + 1}: HTTP ${r.status} ${r.brut?.message ?? ""}`);
      }
      console.log(`Approuves : ${bilan.approuves}`);
    }

    /* ---------------------------- 2. PDF -------------------------------- */
    console.log(`\nGeneration des PDF...`);
    for (const [idx, p] of cibles.entries()) {
      // Le mois est prefixe par sa date de debut et suffixe par la reference du
      // paiement : deux periodes peuvent porter le MEME nom (un « Avril 2026 »
      // saisi a la main a cote d'un « Avril 2026 » genere), et les fichiers
      // s'ecrasaient silencieusement.
      const nom = `${p.debut}--${slug(p.enseignant)}--${slug(p.periode)}--${p.id.slice(0, 8)}.pdf`;
      const res = await fetch(`${API_URL}/api/v1/teacher-payments/${p.id}/payslip.pdf`, {
        headers: {
          Authorization: `Bearer ${ctx.token}`,
          "X-Tenant": ctx.tenant.slug,
        },
      });
      if (!res.ok) {
        bilan.echecs.push(`pdf ${p.enseignant} ${p.periode}: HTTP ${res.status}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(SORTIE, nom), buffer);
      bilan.pdf++;

      if ((idx + 1) % 25 === 0) console.log(`  ... ${idx + 1}/${cibles.length}`);
    }
    console.log(`PDF ecrits : ${bilan.pdf}`);

    /* ------------------------ 3. Notification --------------------------- */
    if (notifier) {
      const registre = lireRegistre();
      const attente = argNombre("--pause", 4000);

      // Deja notifies : on ne renvoie pas. Un enseignant qui recoit deux fois
      // le meme bulletin doute du premier.
      const aEnvoyer = cibles.filter((p) => !registre[p.id]);
      const dejaFaits = cibles.length - aEnvoyer.length;

      console.log(`\nEnvoi des courriels...`);
      if (dejaFaits > 0) console.log(`  ${dejaFaits} deja envoye(s), ignore(s)`);
      console.log(`  ${aEnvoyer.length} a envoyer, pause de ${attente} ms entre chacun`);

      for (const [idx, p] of aEnvoyer.entries()) {
        let motif = null;

        // Le fournisseur SMTP plafonne le debit sortant et repond 451 quand il
        // est atteint. On reessaie en s'ecartant de plus en plus : abandonner
        // au premier refus laisserait la moitie des bulletins non distribues.
        for (let essai = 1; essai <= 4; essai++) {
          const r = await ctx.api("POST", `/api/v1/teacher-payments/${p.id}/notify`, {});
          if (r.ok && r.body?.envoye) {
            motif = null;
            break;
          }
          motif = r.body?.motif ?? `HTTP ${r.status}`;
          if (!estTransitoire(motif) || essai === 4) break;

          const recul = attente * Math.pow(3, essai);
          console.log(`  quota atteint — nouvelle tentative dans ${Math.round(recul / 1000)} s`);
          await pause(recul);
        }

        if (motif === null) {
          bilan.notifies++;
          // Ecriture immediate : une interruption ne doit pas perdre la trace
          // des envois deja partis.
          registre[p.id] = {
            envoyeLe: new Date().toISOString(),
            destinataire: p.email,
            periode: p.periode,
            enseignant: p.enseignant,
          };
          ecrireRegistre(registre);
        } else {
          bilan.echecs.push(`courriel ${p.enseignant} ${p.periode}: ${motif}`);
        }

        if ((idx + 1) % 10 === 0) {
          console.log(`  ... ${idx + 1}/${aEnvoyer.length} (${bilan.notifies} envoyes)`);
        }
        if (idx < aEnvoyer.length - 1) await pause(attente);
      }
      console.log(`Courriels envoyes : ${bilan.notifies} / ${aEnvoyer.length}`);
    }

    /* ---------------------------- Bilan --------------------------------- */
    const { rows: etat } = await ctx.sql(
      `SELECT status::text AS statut, count(*)::int AS n,
              COALESCE(SUM(total_amount), 0)::float8 AS montant
         FROM teacher_payments WHERE tenant_id = $1 GROUP BY status ORDER BY status`,
      [ctx.tenant.id]
    );
    console.log(`\nEtat des paiements :`);
    for (const e of etat) console.log(`  ${e.statut.padEnd(12)} ${String(e.n).padStart(4)}  ${e.montant} XOF`);

    if (bilan.echecs.length > 0) {
      console.log(`\n${bilan.echecs.length} echec(s) :`);
      for (const e of bilan.echecs.slice(0, 12)) console.log(`  - ${e}`);
    }
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error("ECHEC:", e.message);
  process.exit(1);
});
