#!/usr/bin/env node

/**
 * Resout les conflits d'emploi du temps signales par l'ecran de validation des
 * seances — feature 031.
 *
 * LE PROBLEME
 * Le jeu de demonstration place TOUTES les seances sur 08:00-10:00. Les series
 * ont ete semees en plusieurs passes (L2GL, puis L1TL) sans se concerter : un
 * meme enseignant se retrouve affecte a deux ECUE de deux cohortes differentes
 * au meme creneau. Physiquement impossible, et le calcul paie deux fois le
 * meme temps — d'ou le bandeau « creneau(x) paye(s) deux fois ».
 *
 * Ce ne sont PAS des doublons : les deux seances portent des ECUE distinctes,
 * des cohortes distinctes et des libelles distincts. Les supprimer ou en
 * devalider une retirerait des heures reellement dues.
 *
 * LA CORRECTION
 * On decale la seance de la serie la plus recente (celle qui est venue
 * percuter un creneau deja pris) sur le creneau suivant, libre partout.
 * La DUREE est inchangee : 2 h restent 2 h, donc aucun montant ne bouge et
 * aucune heure ne sort de la paie. `payment_hour_details` ne stocke pas les
 * horaires — seulement `hours_count` — le detail des paiements deja calcules
 * reste donc exact.
 *
 * Usage :
 *   node scripts/fix-seances-chevauchements.js --dry-run   (defaut : simulation)
 *   node scripts/fix-seances-chevauchements.js --apply
 *   node scripts/fix-seances-chevauchements.js --rollback <fichier-sauvegarde>
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

/**
 * Heures de debut candidates pour le repli, dans l'ordre de preference.
 *
 * Un creneau fixe ne suffit pas : au fur et a mesure que des seances sont
 * rattrapees, les plages se remplissent. On cherche donc, pour CHAQUE seance a
 * decaler, la premiere heure candidate ou l'enseignant est libre ce jour-la.
 *
 * La DUREE est toujours conservee : c'est elle qui est payee.
 */
const HEURES_CANDIDATES = [
  "10:00", "12:30", "14:00", "16:15", "18:30", "06:00", "20:00",
];

const enMinutes = (h) => {
  const [a, b] = h.split(":").map(Number);
  return a * 60 + b;
};
const enHeure = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;

/**
 * Paires en chevauchement. Reprend MOT POUR MOT les conditions de
 * `findOverlaps` (professional-seance-validation.service.ts) : une requete
 * approchante corrigerait autre chose que ce que l'ecran signale.
 */
const SQL_CHEVAUCHEMENTS = `
  SELECT a.id AS a_id, a.enseignant_id, a.date::text AS date,
         a.heure_debut::text AS a_debut, a.heure_fin::text AS a_fin,
         ea.code AS a_ecue, a.created_at AS a_cree,
         b.id AS b_id,
         b.heure_debut::text AS b_debut, b.heure_fin::text AS b_fin,
         eb.code AS b_ecue, b.created_at AS b_cree,
         COALESCE(TRIM(u.first_name || ' ' || u.last_name),
                  TRIM(t.first_name || ' ' || t.last_name)) AS enseignant
    FROM professional_ecue_seances a
    JOIN professional_ecue_seances b ON b.tenant_id = a.tenant_id
    JOIN professional_ecue ea ON ea.id = a.ecue_id
    JOIN professional_ecue eb ON eb.id = b.ecue_id
    LEFT JOIN teachers t ON t.id = a.enseignant_id
    LEFT JOIN users    u ON u.id = t.user_id
   WHERE a.enseignant_id IS NOT NULL
     AND b.enseignant_id = a.enseignant_id
     AND a.date = b.date
     AND a.id < b.id
     AND a.statut = 'realisee' AND b.statut = 'realisee'
     AND a.validated_at IS NOT NULL AND b.validated_at IS NOT NULL
     AND a.heure_debut IS NOT NULL AND a.heure_fin IS NOT NULL
     AND b.heure_debut IS NOT NULL AND b.heure_fin IS NOT NULL
     AND a.heure_debut < b.heure_fin
     AND b.heure_debut < a.heure_fin
   ORDER BY a.date, enseignant`;

function connect() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL absent : impossible de se connecter.");
    process.exit(1);
  }
  return new Client({ connectionString: process.env.DATABASE_URL });
}

async function rollback(fichier) {
  const sauvegarde = JSON.parse(fs.readFileSync(fichier, "utf8"));
  const client = connect();
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const l of sauvegarde.lignes) {
      await client.query(
        `UPDATE professional_ecue_seances
            SET heure_debut = $1::time, heure_fin = $2::time, updated_at = now()
          WHERE id = $3`,
        [l.avant_debut, l.avant_fin, l.id]
      );
    }
    await client.query("COMMIT");
    console.log(`${sauvegarde.lignes.length} seance(s) remise(s) a leur horaire d'origine.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const idxRollback = args.indexOf("--rollback");
  if (idxRollback >= 0) return rollback(args[idxRollback + 1]);

  const apply = args.includes("--apply");
  const client = connect();
  await client.connect();

  try {
    const { rows: paires } = await client.query(SQL_CHEVAUCHEMENTS);
    if (paires.length === 0) {
      console.log("Aucun chevauchement : rien a corriger.");
      return;
    }

    console.log(`${paires.length} chevauchement(s) detecte(s).\n`);

    // Dans chaque paire, on decale la seance la PLUS RECEMMENT creee : c'est
    // elle qui est venue occuper un creneau deja pris. Decaler la plus
    // ancienne deplacerait un cours qui etait la en premier.
    const aDecaler = new Map();
    for (const p of paires) {
      const recent =
        new Date(p.b_cree) >= new Date(p.a_cree)
          ? { id: p.b_id, ecue: p.b_ecue, debut: p.b_debut, fin: p.b_fin }
          : { id: p.a_id, ecue: p.a_ecue, debut: p.a_debut, fin: p.a_fin };
      aDecaler.set(recent.id, {
        ...recent,
        enseignant: p.enseignant,
        enseignant_id: p.enseignant_id,
        date: p.date,
      });
    }

    const cibles = [...aDecaler.values()];
    console.log(`\n${cibles.length} seance(s) a decaler.`);

    // Occupation reelle de chaque enseignant, jour par jour : c'est elle qui
    // dit ou il reste de la place. On l'entretient au fil des affectations,
    // sinon deux seances deplacees le meme jour se percuteraient a leur tour.
    const { rows: occupation } = await client.query(
      `SELECT s.id, s.enseignant_id, s.date::text AS date,
              s.heure_debut::text AS debut, s.heure_fin::text AS fin
         FROM professional_ecue_seances s
        WHERE s.statut = 'realisee'
          AND s.heure_debut IS NOT NULL AND s.heure_fin IS NOT NULL
          AND (s.enseignant_id, s.date) IN (
                SELECT c.enseignant_id, c.date::date
                  FROM professional_ecue_seances c
                 WHERE c.id = ANY($1::uuid[]))`,
      [cibles.map((c) => c.id)]
    );

    const parJour = new Map();
    for (const o of occupation) {
      const cle = `${o.enseignant_id}|${o.date}`;
      if (!parJour.has(cle)) parJour.set(cle, []);
      parJour.get(cle).push({ id: o.id, debut: enMinutes(o.debut), fin: enMinutes(o.fin) });
    }

    const affectations = [];
    for (const c of cibles) {
      const cle = `${c.enseignant_id}|${c.date}`;
      const creneaux = parJour.get(cle) ?? [];
      const duree = enMinutes(c.fin) - enMinutes(c.debut);
      const autres = creneaux.filter((x) => x.id !== c.id);

      const heure = HEURES_CANDIDATES.map(enMinutes).find(
        (debut) => !autres.some((o) => debut < o.fin && o.debut < debut + duree)
      );
      if (heure === undefined) {
        console.error(
          `\nARRET : aucun creneau libre pour ${c.enseignant} le ${c.date} ` +
            `(duree ${duree} min). Rien n'a ete ecrit.`
        );
        process.exitCode = 1;
        return;
      }

      // La seance deplacee occupe desormais sa nouvelle place : les suivantes
      // du meme jour doivent en tenir compte.
      const place = creneaux.find((x) => x.id === c.id);
      if (place) {
        place.debut = heure;
        place.fin = heure + duree;
      }
      affectations.push({ ...c, nouveauDebut: enHeure(heure), nouveauFin: enHeure(heure + duree) });
    }

    for (const a of affectations) {
      console.log(
        `  ${a.date} ${a.enseignant} : ${a.ecue} ${a.debut.slice(0, 5)}-${a.fin.slice(0, 5)}` +
          ` -> ${a.nouveauDebut.slice(0, 5)}-${a.nouveauFin.slice(0, 5)}`
      );
    }

    if (!apply) {
      console.log("\nSimulation (--dry-run par defaut). Relancer avec --apply pour ecrire.");
      return;
    }

    // Sauvegarde AVANT ecriture : sans elle, l'operation ne serait pas annulable.
    const sauvegarde = {
      genere_le: new Date().toISOString(),
      lignes: affectations.map((c) => ({
        id: c.id,
        enseignant: c.enseignant,
        date: c.date,
        ecue: c.ecue,
        avant_debut: c.debut,
        avant_fin: c.fin,
        apres_debut: c.nouveauDebut,
        apres_fin: c.nouveauFin,
      })),
    };
    const fichier = path.join(
      __dirname,
      `fix-seances-chevauchements.backup.${Date.now()}.json`
    );
    fs.writeFileSync(fichier, JSON.stringify(sauvegarde, null, 2));
    console.log(`\nSauvegarde ecrite : ${fichier}`);

    await client.query("BEGIN");
    // Chaque seance a SON creneau : un UPDATE global remettrait tout le monde
    // a la meme heure et recreerait les conflits qu'on vient de resoudre.
    for (const a of affectations) {
      await client.query(
        `UPDATE professional_ecue_seances
            SET heure_debut = $1::time, heure_fin = $2::time, updated_at = now()
          WHERE id = $3`,
        [a.nouveauDebut, a.nouveauFin, a.id]
      );
    }
    const res = { rowCount: affectations.length };

    // On revalide DANS la transaction : si le chevauchement persiste, on
    // annule plutot que de laisser la base a moitie corrigee.
    const { rows: restants } = await client.query(SQL_CHEVAUCHEMENTS);
    if (restants.length > 0) {
      await client.query("ROLLBACK");
      console.error(
        `\nARRET : ${restants.length} chevauchement(s) subsistent apres correction. ` +
          `Transaction annulee, la base est inchangee.`
      );
      process.exitCode = 1;
      return;
    }
    await client.query("COMMIT");

    console.log(`\n${res.rowCount} seance(s) decalee(s). Plus aucun chevauchement.`);
    console.log(`Annulation : node scripts/fix-seances-chevauchements.js --rollback "${fichier}"`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("ECHEC:", e.message);
  process.exit(1);
});
