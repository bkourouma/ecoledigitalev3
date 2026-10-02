#!/usr/bin/env tsx
/**
 * pnpm seed:v2 --pack HIGHER|PRIMARY|SECONDARY [--seed <n>] [--slug <slug>] [--year-start AAAA-MM-JJ]
 *
 * Crée un établissement de démonstration COMPLET et reproductible (mêmes graine et début d'année = mêmes données) sur la plateforme
 * v2, uniquement par les cas d'usage exposés par l'API HTTP (aucun SQL direct) :
 *   organisation et abonnement, année et périodes, programme et curriculum publié, classe, élèves, tuteurs, enseignants,
 *   inscriptions, barème, factures et règlements, emploi du temps, appels, évaluations et notes publiées, comptes de test par rôle.
 *
 * REFUSE de s'exécuter sans `ALLOW_SEED=1` ET sans que la base ciblée (`V2_DATABASE_URL`, rôle applicatif) ait un nom finissant
 * par `_dev`, `_test` ou `_local`. Prérequis : migrations appliquées (`pnpm db:v2:migrate`), Redis (`REDIS_URL`) pour le worker en
 * processus, et les secrets de l'API (`IAM_JWT_SECRET`, `IAM_MFA_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY`).
 *
 * Les mots de passe des comptes de test sont générés à l'exécution et affichés UNE SEULE FOIS ici : rien n'est écrit sur disque.
 * Relancer la commande sur le même `--slug` ne crée rien (idempotent) ; utilisez un autre `--slug` pour un second établissement.
 */
import "./db/load-env";
import { SeedRefusedError } from "./seed-v2/guards";
import { runSeed } from "./seed-v2/run";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  try {
    const report = await runSeed(argv, { log: (line) => console.log(line) });
    if (report.alreadySeeded) {
      console.log(`\nL'établissement « ${report.slug} » existe déjà : rien n'a été créé.`);
      return 0;
    }
    console.log(`\nÉtablissement « ${report.slug} » (pack ${report.pack}) créé.`);
    for (const note of report.notes) console.log(`  - ${note}`);
    console.log(`  - Volumes : ${Object.entries(report.counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`  - Empreinte des données : ${report.fingerprint}`);
    console.log("\nComptes de test (mots de passe affichés UNE SEULE FOIS, non récupérables) :");
    for (const a of report.accounts) {
      console.log(`  ${a.role.padEnd(26)} ${a.email}  mot de passe : ${a.password}${a.totpSecret ? `  secret TOTP (MFA) : ${a.totpSecret}` : ""}`);
    }
    console.log(`\nConnexion : tenant « ${report.slug} ». Les comptes à MFA exigent le code TOTP du secret ci-dessus.`);
    return 0;
  } catch (error) {
    if (error instanceof SeedRefusedError) {
      console.error(`[seed:v2] ${error.message}`);
      return error.code === "SEED_BAD_ARGS" ? 2 : 1;
    }
    console.error("[seed:v2] ÉCHEC :", error instanceof Error ? error.message : error);
    return 1;
  }
}

void main().then((code) => process.exit(code));
