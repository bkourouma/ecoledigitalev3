/**
 * Écrit `.demo/credentials.md` (lisible) à partir de `.demo/credentials.json` (écrit par le seed) et des secrets de l'opérateur.
 * Les deux fichiers sont locaux et ignorés par git : c'est le SEUL endroit où figurent les mots de passe et secrets TOTP.
 */
import { writeFileSync } from "node:fs";
import { CREDENTIALS_JSON, CREDENTIALS_MD } from "./paths.mjs";
import { PLATFORM_GUIDE, ROLE_GUIDE, ROLE_ORDER, TENANTS } from "./guide.mjs";
import { readJson } from "./state.mjs";

export function readCredentials() {
  return readJson(CREDENTIALS_JSON, null);
}

const baseUrl = (slug, port) => `http://${slug}.localhost:${port}`;

export function writeCredentialsMd({ secrets, ports }) {
  const creds = readCredentials();
  const lines = [];
  lines.push("# Comptes de démonstration EcoleDigitale", "");
  lines.push("> FICHIER LOCAL, ignoré par git. Mots de passe et secrets TOTP générés à l'exécution : ne jamais le committer ni le partager.", "");
  lines.push("## Connexion", "");
  lines.push(`- Adresse de l'application : \`http://localhost:${ports.web}\` (établissement par défaut : ${TENANTS[0].slug}).`);
  lines.push("- Pour entrer dans un autre établissement, utilisez son sous-domaine (résolu automatiquement par les navigateurs modernes) :");
  for (const t of TENANTS) lines.push(`  - ${t.label} : \`${baseUrl(t.slug, ports.web)}/v2/login\``);
  lines.push("- Connexion : adresse e-mail + mot de passe ci-dessous. Les comptes marqués MFA demandent aussi un code à 6 chiffres : `pnpm demo:totp <e-mail>` (ou `pnpm demo:totp <etablissement> <role>`). Chaque code ne sert qu'une fois : attendez le suivant (30 s) si une connexion vient d'en consommer un.", "");
  lines.push("## Opérateur de la plateforme (super-admin)", "");
  lines.push(`- Page : \`http://localhost:${ports.web}/v2/platform/login\``);
  lines.push(`- E-mail : \`${secrets.operatorEmail}\``);
  lines.push(`- Mot de passe : \`${secrets.operatorPassword}\``);
  lines.push(`- Ce qu'il peut tester : ${PLATFORM_GUIDE.tests}`, "");

  if (!creds) {
    lines.push("## Comptes des établissements", "", "_Pas encore de seed : lancez `pnpm demo:up`._", "");
  } else {
    for (const t of TENANTS) {
      const rows = creds.accounts.filter((a) => a.tenant === t.slug);
      if (rows.length === 0) continue;
      lines.push(`## ${t.label}`, "", `Slug : \`${t.slug}\` · connexion : \`${baseUrl(t.slug, ports.web)}/v2/login\``, "");
      lines.push("| Rôle | E-mail | Mot de passe | MFA (secret TOTP) | Ce qu'il peut tester |", "|---|---|---|---|---|");
      const sorted = [...rows].sort((a, b) => (ROLE_ORDER.indexOf(a.role) + 1 || 99) - (ROLE_ORDER.indexOf(b.role) + 1 || 99));
      for (const a of sorted) {
        const g = ROLE_GUIDE[a.role];
        lines.push(`| ${g ? g.label : a.role} | \`${a.email}\` | \`${a.password}\` | ${a.totpSecret ? `\`${a.totpSecret}\`` : "non"} | ${g ? g.tests : ""} |`);
      }
      lines.push("");
    }
  }
  lines.push("## Boîte aux lettres locale", "", "Aucun e-mail n'est envoyé. Les invitations et les liens « mot de passe oublié » sont écrits dans `.demo/mailbox.jsonl` (un objet JSON par ligne, champ `link`).", "");
  writeFileSync(CREDENTIALS_MD, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
}
