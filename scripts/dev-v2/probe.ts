/**
 * Sonde de développement (jetable) : se connecte comme propriétaire d'une école du fichier des comptes et exécute le fichier
 * `DEVV2_PROBE` (module exportant `run(owner, ctx)`). Ne crée rien par elle-même.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { actorFrom, expectStatus, totpAt } from "../seed-v2/actors";
import { startSeedPlatform } from "../seed-v2/runtime";

async function main(): Promise<void> {
  const env = process.env;
  const slug = env.DEVV2_SCHOOL_SLUG as string;
  const rows = (JSON.parse(readFileSync(env.DEV_CREDENTIALS_FILE as string, "utf8")) as { accounts: Array<{ tenant: string; role: string; email: string; password: string; totpSecret?: string }> }).accounts;
  const row = rows.find((r) => r.tenant === slug && r.role === "proprietaire");
  if (!row?.totpSecret) throw new Error("propriétaire introuvable");
  const platform = await startSeedPlatform(env);
  try {
    const { http } = platform;
    const login = expectStatus(await http("POST", "/api/v1/iam/login", { body: { email: row.email, password: row.password, tenantSlug: slug, client: "mobile" } }), 200, "connexion");
    let session: any = null;
    for (const shift of [0, 30_000, -30_000]) {
      const r = await http("POST", "/api/v1/iam/mfa/challenge", { body: { challengeToken: login.body.challengeToken, code: totpAt(row.totpSecret, Date.now() + shift), client: "mobile" } });
      if (r.status === 200) { session = r.body; break; }
    }
    if (!session) throw new Error("MFA refusée");
    const owner = actorFrom(http, "proprietaire", row.email, { accessToken: session.accessToken, identityId: session.user.id ?? session.user.userId, totpSecret: row.totpSecret });
    const mod = await import(pathToFileURL(env.DEVV2_PROBE as string).href);
    await mod.run(owner, { slug, http, operatorToken: platform.operatorToken });
  } finally {
    await platform.stop();
  }
}

main().then(() => process.exit(0), (e) => { console.error("[probe] ÉCHEC :", e instanceof Error ? e.message : e); process.exit(1); });
