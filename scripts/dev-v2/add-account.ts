/**
 * Ajoute un compte de personnel à une école existante du mode développement v2 (`pnpm dev:v2:add-account`) : le compte est invité
 * par le propriétaire de l'école (comme le fait le seed), activé, MFA enrôlée, rôle système attribué, puis écrit dans
 * `.dev-v2/credentials.json` (local, ignoré par git) pour que le panneau « Comptes par tenant » de la page de connexion l'affiche.
 *
 * Variables : DEVV2_SCHOOL_SLUG (défaut `ecole-flamboyants`), DEVV2_ACCOUNT_ROLE (`directeur` par défaut, ou `responsable_pedagogique`).
 * Il faut que le propriétaire de l'école figure déjà dans le fichier des comptes (créé par `pnpm dev:v2:new-school`).
 * Garde-fous identiques à `new-school.ts`. Les mots de passe sont générés à l'exécution et jamais affichés.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Accounts, actorFrom, expectStatus, totpAt } from "../seed-v2/actors";
import { SeedRefusedError, assertSeedEnvironment, databaseNameOf } from "../seed-v2/guards";
import { startSeedPlatform } from "../seed-v2/runtime";

const SLUG = process.env.DEVV2_SCHOOL_SLUG?.trim() || "ecole-flamboyants";
const ROLE = process.env.DEVV2_ACCOUNT_ROLE?.trim() || "directeur";
const ROLES: Record<string, { prefix: string }> = {
  directeur: { prefix: "directeur" },
  responsable_pedagogique: { prefix: "pedagogie" },
};

interface Row { tenant: string; pack?: string; role: string; email: string; password: string; totpSecret?: string }

function assertDevAllowed(env: NodeJS.ProcessEnv): void {
  if (env.ALLOW_SEED !== "1") throw new SeedRefusedError("SEED_NOT_ALLOWED", "Refusé : ALLOW_SEED=1 requis.");
  if (env.NODE_ENV === "production") throw new SeedRefusedError("SEED_NOT_ALLOWED", "Refusé : NODE_ENV=production.");
  const url = env.V2_DATABASE_URL?.trim();
  if (!url) throw new SeedRefusedError("SEED_ENV_MISSING", "Refusé : V2_DATABASE_URL absent.");
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!local || databaseNameOf(url) !== "ecoledigitale_v2") {
    throw new SeedRefusedError("SEED_DATABASE_REFUSED", `Refusé : base « ${databaseNameOf(url) ?? "?"} » sur « ${host} » (attendu : ecoledigitale_v2 sur le serveur local).`);
  }
}

async function main(): Promise<void> {
  const env = process.env;
  assertDevAllowed(env);
  assertSeedEnvironment({ ...env, AUDIT_HMAC_KEY: env.AUDIT_HMAC_KEY ?? "sha256-mode" });
  const spec = ROLES[ROLE];
  if (!spec) throw new Error(`Rôle non pris en charge : ${ROLE} (${Object.keys(ROLES).join(", ")}).`);
  const email = `${spec.prefix}@${SLUG}.test`;

  const file = env.DEV_CREDENTIALS_FILE as string;
  const rows: Row[] = (JSON.parse(readFileSync(file, "utf8")) as { accounts?: Row[] }).accounts ?? [];
  if (rows.some((r) => r.tenant === SLUG && r.email === email)) {
    console.log(`Le compte ${email} existe déjà dans le fichier des comptes : rien n'a été créé.`);
    return;
  }
  const ownerRow = rows.find((r) => r.tenant === SLUG && r.role === "proprietaire");
  if (!ownerRow?.totpSecret) throw new Error(`Propriétaire de « ${SLUG} » introuvable dans le fichier des comptes (lancez d'abord pnpm dev:v2:new-school).`);

  const platform = await startSeedPlatform(env);
  let created: { email: string; password: string; totpSecret?: string } | null = null;
  try {
    const { http } = platform;
    // Connexion du propriétaire (mot de passe + code MFA) : l'essai tombe sur le pas courant, sinon sur le suivant.
    const login = expectStatus(await http("POST", "/api/v1/iam/login", { body: { email: ownerRow.email, password: ownerRow.password, tenantSlug: SLUG, client: "mobile" } }), 200, "connexion du propriétaire");
    if (login.body.status !== "mfa_required") throw new Error(`Statut de connexion inattendu : ${String(login.body.status)}`);
    let session: any = null;
    for (const shift of [0, 30_000, -30_000]) {
      const r = await http("POST", "/api/v1/iam/mfa/challenge", { body: { challengeToken: login.body.challengeToken, code: totpAt(ownerRow.totpSecret, Date.now() + shift), client: "mobile" } });
      if (r.status === 200) { session = r.body; break; }
    }
    if (!session) throw new Error("Code MFA du propriétaire refusé (réessayez dans 30 secondes).");
    const owner = actorFrom(http, "proprietaire", ownerRow.email, { accessToken: session.accessToken, identityId: session.user.id ?? session.user.userId, totpSecret: ownerRow.totpSecret });

    console.log(`• ${ROLE} : invitation, activation, MFA et rôle (${email})`);
    const accounts = new Accounts(http, platform.invitations, SLUG);
    await accounts.staff(owner, ROLE, email, ROLE);
    created = accounts.list().find((a) => a.role === ROLE) ?? null;
  } finally {
    await platform.stop();
  }
  if (!created) return;

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), accounts: [...rows, { tenant: SLUG, pack: "PRIMARY", role: ROLE, ...created }] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`\nCompte ${created.email} créé (rôle ${ROLE}, avec MFA). Le mot de passe et le secret MFA sont dans .dev-v2/credentials.json (non affichés).`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[dev-v2 add-account] ÉCHEC :", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
