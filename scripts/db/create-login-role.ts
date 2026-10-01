#!/usr/bin/env tsx
/**
 * pnpm db:v2:create-login-role
 *
 * Crée, sur une base de DÉVELOPPEMENT ou de TEST uniquement (nom finissant par _dev, _test
 * ou _local), un rôle LOGIN membre de `app_user` avec un mot de passe aléatoire.
 *
 *   pnpm db:v2:create-login-role [-- --url <admin-url>] [--role ed_v2_app] [--rotate]
 *
 * Le mot de passe (et l'URL complète) est affiché UNE SEULE FOIS sur la sortie standard :
 * copiez-le dans votre `.env` local (non suivi par git). Rien n'est écrit sur disque.
 */
import "./load-env";
import { parseArgs } from "node:util";
import { DEFAULT_LOGIN_ROLE, LoginRoleError, createLoginRole } from "../../apps/api/src/platform/v2-login-role";
import { redactUrl } from "../../apps/api/src/platform/v2-migrations";

const USAGE = `Usage : pnpm db:v2:create-login-role [-- --url <url-admin>] [--role <nom>] [--rotate]
URL d'administration par défaut : V2_MIGRATOR_URL. Rôle par défaut : ${DEFAULT_LOGIN_ROLE}.`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2)[0] === "--" ? process.argv.slice(3) : process.argv.slice(2);
  let values;
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        url: { type: "string" },
        role: { type: "string" },
        rotate: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (e) {
    console.error(`Erreur d'arguments : ${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const adminUrl = values.url ?? process.env.V2_MIGRATOR_URL?.trim();
  if (!adminUrl) {
    console.error(`Aucune URL d'administration : définissez V2_MIGRATOR_URL ou passez --url.\n${USAGE}`);
    return 2;
  }

  try {
    const created = await createLoginRole({
      adminUrl,
      ...(values.role ? { role: values.role } : {}),
      rotate: values.rotate === true,
    });
    console.log(
      `Rôle "${created.role}" ${created.rotated ? "mis à jour" : "créé"} sur la base ${created.database} (${redactUrl(adminUrl)}).`,
    );
    console.log("");
    console.log("Ajoutez la ligne suivante à votre .env LOCAL (non suivi par git).");
    console.log("Elle n'est affichée qu'UNE SEULE FOIS et n'a été écrite nulle part :");
    console.log("");
    console.log(`V2_DATABASE_URL=${created.applicationUrl}`);
    return 0;
  } catch (e) {
    if (e instanceof LoginRoleError) console.error(`Refusé : ${e.message}`);
    else console.error(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
