/**
 * Ajoute un compte de personnel à une école existante du mode développement v2 (`pnpm dev:v2:add-account`) : le compte est invité
 * par le propriétaire de l'école (comme le fait le seed), activé, MFA enrôlée, rôle système attribué, puis écrit dans
 * `.dev-v2/credentials.json` (local, ignoré par git) pour que le panneau « Comptes par tenant » de la page de connexion l'affiche.
 *
 * Variables : DEVV2_SCHOOL_SLUG (défaut `ecole-flamboyants`), DEVV2_ACCOUNT_ROLE (`directeur` par défaut ; voir `ROLES` : direction, secrétariat, économe, éducateur, examens, admissions, instituteur, parent, élève).
 * Il faut que le propriétaire de l'école figure déjà dans le fichier des comptes (créé par `pnpm dev:v2:new-school`).
 * Garde-fous identiques à `new-school.ts`. Les mots de passe sont générés à l'exécution et jamais affichés.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SYSTEM_ROLE_TEMPLATES } from "../../apps/api/src/modules/rbac/templates/system-roles";
import { Accounts, actorFrom, type Actor, expectStatus, totpAt } from "../seed-v2/actors";
import { SeedRefusedError, assertSeedEnvironment, databaseNameOf } from "../seed-v2/guards";
import { startSeedPlatform } from "../seed-v2/runtime";

const SLUG = process.env.DEVV2_SCHOOL_SLUG?.trim() || "ecole-flamboyants";
const ROLE = process.env.DEVV2_ACCOUNT_ROLE?.trim() || "directeur";
/**
 * Rôles pris en charge. `staff` : membre du personnel invité par le propriétaire (rôle système rbac, MFA là où le modèle de rôle la
 * recommande). `teacher` : instituteur, avec une fiche du personnel créée puis liée au compte par l'invitation au portail.
 * `parent` / `student` : compte de portail relié à un tuteur / un élève de test créé pour l'occasion.
 */
type Kind = "staff" | "teacher" | "parent" | "student";
const ROLES: Record<string, { prefix: string; kind: Kind }> = {
  directeur: { prefix: "directeur", kind: "staff" },
  responsable_pedagogique: { prefix: "pedagogie", kind: "staff" },
  directeur_etudes: { prefix: "etudes", kind: "staff" },
  secretariat: { prefix: "secretariat", kind: "staff" },
  econome: { prefix: "econome", kind: "staff" },
  educateur: { prefix: "educateur", kind: "staff" },
  responsable_examens: { prefix: "examens", kind: "staff" },
  admissions_officer: { prefix: "admissions", kind: "staff" },
  instituteur: { prefix: "instituteur", kind: "teacher" },
  parent: { prefix: "parent", kind: "parent" },
  eleve: { prefix: "eleve", kind: "student" },
};
const mfaRecommended = (role: string): boolean => SYSTEM_ROLE_TEMPLATES.find((t) => t.key === role)?.mfaRecommended === true;

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

const ref = (b: any, ...keys: string[]): string => {
  for (const k of keys) { const v = k.split(".").reduce((o, p) => o?.[p], b); if (typeof v === "string") return v; }
  throw new Error("Identifiant absent de la réponse de l'API.");
};

/** Instituteur (fiche du personnel liée), parent (tuteur) ou élève : crée la fiche, invite au portail, active le compte. */
async function portalAccount(owner: Actor, accounts: Accounts, kind: Exclude<Kind, "staff">, email: string): Promise<void> {
  if (kind === "teacher") {
    const cats = (await owner.get("/api/v1/people/reference/staff-categories")).body.items as Array<{ code: string; canTeach: boolean }>;
    const cat = cats.find((c) => c.canTeach);
    if (!cat) throw new Error("Aucune catégorie de personnel enseignant.");
    const staff = await owner.post("/api/v1/people/staff", { person: { lastName: "KOFFI", firstName: "Instituteur", sex: "M", birthDate: "1988-03-14", email }, categoryCode: cat.code, hiredOn: "2024-09-01" }, 201);
    await owner.post(`/api/v1/people/staff/${ref(staff.body, "staff.id", "id")}/portal-invitation`, { role: "instituteur" }, [200, 201]);
    await accounts.portal("instituteur", email);
  } else if (kind === "parent") {
    const g = await owner.post("/api/v1/people/guardians", { person: { lastName: "KOUASSI", firstName: "Parent", sex: "F", phone: "0700000001", email } }, 201);
    await owner.post(`/api/v1/people/persons/${ref(g.body, "guardian.personId")}/portal-invitation`, { quality: "GUARDIAN" }, [200, 201]);
    await accounts.portal("parent", email);
  } else {
    const s = await owner.post("/api/v1/people/students", { person: { lastName: "KOUASSI", firstName: "Eleve", sex: "M", birthDate: "2014-05-20", birthPlace: "Abidjan", email } }, 201);
    await owner.post(`/api/v1/people/persons/${ref(s.body, "student.personId")}/portal-invitation`, { quality: "STUDENT" }, [200, 201]);
    await accounts.portal("eleve", email);
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
    if (spec.kind === "staff") await accounts.staff(owner, ROLE, email, ROLE, { mfa: mfaRecommended(ROLE) });
    else await portalAccount(owner, accounts, spec.kind, email);
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
