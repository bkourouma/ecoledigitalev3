/**
 * Nouvelle école VIDE du mode développement v2 (`pnpm dev:v2:new-school`) : un établissement du pack PRIMARY créé comme le fait la
 * console plateforme (organisation + abonnement), avec UN SEUL compte, celui du propriétaire (administrateur de l'école, MFA).
 * Aucune donnée de démonstration : ni année, ni classe, ni élève, ni enseignant. Le testeur configure tout depuis l'interface.
 *
 * Le compte est ajouté à `.dev-v2/credentials.json` (local, ignoré par git, mode 0600) : le panneau « Comptes par tenant » de la page de
 * connexion l'affiche. Le mot de passe est généré à l'exécution et n'est JAMAIS affiché ni versionné.
 *
 * Variables facultatives : DEVV2_SCHOOL_NAME, DEVV2_SCHOOL_SLUG. Garde-fous identiques à `seed.ts` (ALLOW_SEED=1, hors production,
 * Postgres local, base exactement `ecoledigitale_v2`). Idempotent : si le slug existe déjà, rien n'est créé.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Accounts, expectStatus } from "../seed-v2/actors";
import { SeedRefusedError, assertSeedEnvironment, databaseNameOf } from "../seed-v2/guards";
import { startSeedPlatform, waitFor } from "../seed-v2/runtime";

const NAME = process.env.DEVV2_SCHOOL_NAME?.trim() || "École Primaire Les Flamboyants";
const SLUG = process.env.DEVV2_SCHOOL_SLUG?.trim() || "ecole-flamboyants";
const PACK = "PRIMARY";

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
  if (!/^[a-z][a-z0-9-]{2,38}[a-z0-9]$/.test(SLUG)) throw new Error(`Slug invalide : ${SLUG} (minuscules, chiffres, tirets ; 4 à 40 caractères).`);
  const ownerEmail = `direction.generale@${SLUG}.test`;

  const platform = await startSeedPlatform(env);
  let account: { role: string; email: string; password: string; totpSecret?: string } | null = null;
  try {
    const { http, operatorToken } = platform;
    const found = expectStatus(await http("GET", `/api/v1/platform/tenants?search=${encodeURIComponent(SLUG)}&limit=50`, { token: operatorToken }), 200, "recherche du tenant");
    if ((found.body.items as Array<{ slug: string }>).some((t) => t.slug === SLUG)) {
      console.log(`L'école « ${SLUG} » existe déjà : rien n'a été créé ni modifié.`);
      return;
    }
    console.log(`• console : organisation « ${NAME} » (${SLUG}), pack ${PACK}, abonnement PROFESSIONAL`);
    const provisioned = expectStatus(
      await http("POST", "/api/v1/platform/tenants", {
        token: operatorToken,
        body: { name: NAME, slug: SLUG, countryCode: "CI", packs: [PACK], adminContact: { name: "Direction générale", email: ownerEmail, phone: "+225 07 00 00 00 00" } },
      }),
      201,
      "provisionnement",
    ).body;
    const tenantId = provisioned.tenantId as string;
    expectStatus(await http("PUT", `/api/v1/platform/tenants/${tenantId}/subscription`, { token: operatorToken, body: { planKey: "PROFESSIONAL", packs: [PACK], status: "ACTIVE" } }), 200, "abonnement");

    console.log("• compte : propriétaire (administrateur de l'école, avec MFA)");
    const accounts = new Accounts(http, platform.invitations, SLUG);
    const owner = await accounts.owner("proprietaire", ownerEmail);

    console.log("• référentiels du pack PRIMARY (instanciés par le worker)");
    await waitFor(
      async () => {
        const r = await owner.get("/api/v1/academic/reference/grade-levels");
        return (r.body.items as unknown[]).length > 0 ? true : false;
      },
      { label: "niveaux du pack PRIMARY", timeoutMs: 60_000 },
    );
    const row = accounts.list().find((a) => a.role === "proprietaire");
    if (row) account = row;
  } finally {
    await platform.stop();
  }
  if (!account) return;

  const file = env.DEV_CREDENTIALS_FILE as string;
  let previous: Array<{ tenant: string }> = [];
  try {
    previous = (JSON.parse(readFileSync(file, "utf8")) as { accounts?: Array<{ tenant: string }> }).accounts ?? [];
  } catch {
    /* premier fichier */
  }
  const kept = previous.filter((p) => p.tenant !== SLUG);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), accounts: [...kept, { tenant: SLUG, pack: PACK, ...account }] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`\nÉcole « ${NAME} » créée (aucune donnée à l'intérieur), 1 compte : ${account.email}. Le mot de passe et le secret MFA sont dans .dev-v2/credentials.json (non affichés).`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[dev-v2 new-school] ÉCHEC :", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
