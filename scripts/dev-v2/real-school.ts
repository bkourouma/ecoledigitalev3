/**
 * École « réelle » du mode développement v2 (`pnpm dev:v2:real-school`) : une école primaire privée complète, alimentée en suivant
 * le workflow de `docs/guide-test-primary/WORKFLOW_PRIMARY.md` (phases 1 à 9), uniquement par l'API HTTP publique, avec de vrais
 * comptes IAM (MFA pour les rôles sensibles). Les mots de passe sont générés à l'exécution et écrits dans `.dev-v2/credentials.json`
 * (local, ignoré par git) : le panneau « Comptes par tenant » de `/v2/login` les affiche. Jamais affichés dans la console.
 *
 * Variables facultatives : DEVV2_SCHOOL_NAME, DEVV2_SCHOOL_SLUG. Garde-fous identiques à `new-school.ts`. Idempotent : si le slug existe, rien n'est fait.
 *
 * L'année 2025-2026 est jouée EN ENTIER, trimestre par trimestre, avec de vraies dates passées (appels quotidiens, compétences, notes, clôtures,
 * conseil des maîtres, bulletins, bilans scellés, clôture de l'année, archive gelée) ; l'année 2026-2027 est ensuite ouverte et courante.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Accounts, SeedStepError, expectStatus, type Actor } from "../seed-v2/actors";
import { SeedRefusedError, assertSeedEnvironment, databaseNameOf } from "../seed-v2/guards";
import { startSeedPlatform, waitFor } from "../seed-v2/runtime";

const NAME = process.env.DEVV2_SCHOOL_NAME?.trim() || "École Primaire Privée La Réussite";
const SLUG = process.env.DEVV2_SCHOOL_SLUG?.trim() || "ecole-la-reussite";
const PACK = "PRIMARY";
const YEAR = { code: "2025-2026", start: "2025-09-07", end: "2026-09-06" };
const NEXT_YEAR = { code: "2026-2027", start: "2026-09-07" };
/** Dernier jour de classe du troisième trimestre (les grandes vacances commencent ensuite). */
const SCHOOL_END = "2026-07-03";

/** Vacances et jours fériés de l'année 2025-2026 (Côte d'Ivoire), sans classe. */
const NO_SCHOOL: Array<[string, string]> = [["2025-10-27", "2025-11-02"], ["2025-12-20", "2026-01-04"], ["2026-04-04", "2026-04-13"], ["2026-05-01", "2026-05-01"], ["2026-05-14", "2026-05-14"], ["2026-05-25", "2026-05-25"], ["2026-05-27", "2026-05-27"]];

// ---------------------------------------------------------------------------------------------------------------- données
type Sex = "M" | "F";
interface PupilDef { last: string; first: string; sex: Sex; birth: string; guardian?: string }
interface ClassDef {
  key: string;
  code: string;
  name: string;
  level: string;
  program: "MATERNELLE" | "PRIMAIRE";
  capacity: number;
  teacher: { last: string; first: string; sex: Sex; birth: string; account: string };
  pupils: PupilDef[];
}

const CLASSES: ClassDef[] = [
  {
    key: "gs", code: "GS-A", name: "Grande Section A", level: "GS", program: "MATERNELLE", capacity: 25,
    teacher: { last: "ZOKORA", first: "Sylvie", sex: "F", birth: "1987-06-09", account: "instituteur_grande_section" },
    pupils: [
      { last: "ADOU", first: "Aïcha", sex: "F", birth: "2021-03-14" }, { last: "ASSI", first: "Brice", sex: "M", birth: "2021-05-02" },
      { last: "DAGO", first: "Chantal", sex: "F", birth: "2020-11-23" }, { last: "KOUADIO", first: "Emmanuel", sex: "M", birth: "2021-01-30" },
      { last: "TOURE", first: "Mariam", sex: "F", birth: "2021-07-19", guardian: "TOURE Issouf" }, { last: "N'DRI", first: "Yann", sex: "M", birth: "2020-12-08" },
      { last: "SORO", first: "Fanta", sex: "F", birth: "2021-04-26" }, { last: "KONAN", first: "Gaël", sex: "M", birth: "2021-02-11" },
      { last: "BAKAYOKO", first: "Salimata", sex: "F", birth: "2021-06-05" }, { last: "ZADI", first: "Lionel", sex: "M", birth: "2020-10-17" },
    ],
  },
  {
    key: "cp1", code: "CP1-A", name: "CP1 A", level: "CP1", program: "PRIMAIRE", capacity: 35,
    teacher: { last: "KOFFI", first: "Adjoua", sex: "F", birth: "1988-04-12", account: "instituteur_cp1" },
    pupils: [
      { last: "KOUASSI", first: "Aya", sex: "F", birth: "2019-08-21" }, { last: "YAO", first: "Konan Éric", sex: "M", birth: "2019-02-15" },
      { last: "TRAORE", first: "Fatoumata", sex: "F", birth: "2019-10-03" }, { last: "COULIBALY", first: "Aminata", sex: "F", birth: "2019-06-27", guardian: "COULIBALY Awa" },
      { last: "BROU", first: "Kévin", sex: "M", birth: "2019-04-09" }, { last: "FOFANA", first: "Ousmane", sex: "M", birth: "2019-12-01" },
      { last: "AKA", first: "Nadège", sex: "F", birth: "2019-05-18" }, { last: "GNAGNE", first: "Jean-Marc", sex: "M", birth: "2019-09-12" },
      { last: "DOSSO", first: "Kadidja", sex: "F", birth: "2019-03-30" }, { last: "OUATTARA", first: "Souleymane", sex: "M", birth: "2019-07-24" },
      { last: "KACOU", first: "Grâce", sex: "F", birth: "2019-11-07" }, { last: "LOROUGNON", first: "Ange", sex: "M", birth: "2019-01-20" },
    ],
  },
  {
    key: "ce1", code: "CE1-A", name: "CE1 A", level: "CE1", program: "PRIMAIRE", capacity: 35,
    teacher: { last: "KONATE", first: "Mariam", sex: "F", birth: "1985-09-30", account: "instituteur_ce1" },
    pupils: [
      { last: "TOURE", first: "Ibrahim", sex: "M", birth: "2018-05-14", guardian: "TOURE Issouf" }, { last: "DIALLO", first: "Rokia", sex: "F", birth: "2018-09-02" },
      { last: "KOFFI", first: "Prisca", sex: "F", birth: "2018-03-25" }, { last: "YAPI", first: "Christ", sex: "M", birth: "2018-11-16" },
      { last: "BAMBA", first: "Awa", sex: "F", birth: "2018-07-08" }, { last: "ANGAMAN", first: "Stéphane", sex: "M", birth: "2018-01-29" },
      { last: "SANGARE", first: "Mamadou", sex: "M", birth: "2018-06-13" }, { last: "TANOH", first: "Marie-Ange", sex: "F", birth: "2018-10-21" },
      { last: "DJE", first: "Rodrigue", sex: "M", birth: "2018-04-04" }, { last: "ESSOH", first: "Laetitia", sex: "F", birth: "2018-12-19" },
      { last: "COULIBALY", first: "Seydou", sex: "M", birth: "2018-08-10" }, { last: "GBANE", first: "Hawa", sex: "F", birth: "2018-02-06" },
    ],
  },
  {
    key: "cm2", code: "CM2-A", name: "CM2 A", level: "CM2", program: "PRIMAIRE", capacity: 40,
    teacher: { last: "BAMBA", first: "Séraphin", sex: "M", birth: "1979-11-03", account: "instituteur_cm2" },
    pupils: [
      { last: "COULIBALY", first: "Ibrahim", sex: "M", birth: "2015-09-09", guardian: "COULIBALY Awa" }, { last: "N'GUESSAN", first: "Kouamé", sex: "M", birth: "2015-03-22" },
      { last: "TANOH", first: "Maëlle", sex: "F", birth: "2015-12-14" }, { last: "KOUAME", first: "Christelle", sex: "F", birth: "2015-06-01" },
      { last: "SYLLA", first: "Abdoulaye", sex: "M", birth: "2015-08-17" }, { last: "BEUGRE", first: "Estelle", sex: "F", birth: "2015-05-28" },
      { last: "KONE", first: "Mohamed", sex: "M", birth: "2015-10-05" }, { last: "ATTA", first: "Josiane", sex: "F", birth: "2015-02-13" },
      { last: "DIABATE", first: "Nadia", sex: "F", birth: "2015-07-31" }, { last: "ZEBIE", first: "Armand", sex: "M", birth: "2015-04-19" },
      { last: "OUEDRAOGO", first: "Salif", sex: "M", birth: "2015-11-26" }, { last: "ACHI", first: "Marie-Josée", sex: "F", birth: "2015-01-08" },
    ],
  },
];

const GUARDIAN_FIRST: Record<Sex, string[]> = {
  F: ["Awa", "Carine", "Mariam", "Berthe", "Sandrine", "Fatou", "Aline", "Viviane", "Rose", "Hortense", "Kadiatou", "Odette", "Pélagie", "Solange"],
  M: ["Roland", "Hervé", "Prosper", "Léon", "Issouf", "Jean-Baptiste", "Désiré", "Ismaël", "Alain", "Boniface", "Moussa", "Cyrille", "Lazare", "Théophile"],
};

const SUBJECTS = [
  { code: "FRAN", label: "Français", coefficient: "3" },
  { code: "MATH", label: "Mathématiques", coefficient: "3" },
  { code: "EVEI", label: "Éveil (sciences et vie sociale)", coefficient: "2" },
  { code: "EPS", label: "Éducation physique et sportive", coefficient: "1" },
  { code: "ARTS", label: "Éducation artistique", coefficient: "1" },
];

interface Domain { code: string; label: string; competencies: Array<{ code: string; label: string }> }
const FRAMEWORKS: Record<string, { code: string; label: string; domains: Domain[] }> = {
  GS: {
    code: "REUSSITE_GS", label: "Compétences de la Grande Section",
    domains: [
      { code: "LO", label: "Langage oral", competencies: [{ code: "LO.1", label: "Comprend une consigne simple" }, { code: "LO.2", label: "S'exprime en phrases courtes" }] },
      { code: "EM", label: "Éveil mathématique", competencies: [{ code: "EM.1", label: "Dénombre jusqu'à 10" }, { code: "EM.2", label: "Reconnaît les formes simples" }] },
      { code: "MG", label: "Motricité et graphisme", competencies: [{ code: "MG.1", label: "Tient correctement son crayon" }, { code: "MG.2", label: "Trace des lignes et des boucles" }] },
      { code: "VE", label: "Vivre ensemble", competencies: [{ code: "VE.1", label: "Respecte les règles de la classe" }, { code: "VE.2", label: "Participe aux activités de groupe" }] },
    ],
  },
  CP1: {
    code: "REUSSITE_CP1", label: "Français et mathématiques CP1",
    domains: [
      { code: "LO", label: "Langage oral", competencies: [{ code: "LO.1", label: "S'exprime en phrases complètes" }, { code: "LO.2", label: "Récite une comptine ou un court poème" }] },
      { code: "LECT", label: "Lecture", competencies: [{ code: "LECT.1", label: "Déchiffre des syllabes et des mots simples" }, { code: "LECT.2", label: "Lit une phrase courte sans hésiter" }] },
      { code: "ECR", label: "Écriture", competencies: [{ code: "ECR.1", label: "Copie un mot sans erreur" }, { code: "ECR.2", label: "Écrit son prénom et des mots simples" }] },
      { code: "MATH", label: "Mathématiques", competencies: [{ code: "MATH.1", label: "Dénombre et compare les nombres jusqu'à 100" }, { code: "MATH.2", label: "Résout un petit problème d'addition" }] },
    ],
  },
  CE1: {
    code: "REUSSITE_CE1", label: "Français et mathématiques CE1",
    domains: [
      { code: "LO", label: "Langage oral", competencies: [{ code: "LO.1", label: "S'exprime en phrases complètes" }, { code: "LO.2", label: "Raconte un événement vécu en respectant l'ordre des faits" }] },
      { code: "LECT", label: "Lecture", competencies: [{ code: "LECT.1", label: "Lit à voix haute un texte court en respectant la ponctuation" }, { code: "LECT.2", label: "Répond à des questions sur un texte lu" }] },
      { code: "ECR", label: "Écriture", competencies: [{ code: "ECR.1", label: "Copie un texte court sans erreur" }, { code: "ECR.2", label: "Écrit une phrase simple sous dictée" }] },
      { code: "MATH", label: "Mathématiques", competencies: [{ code: "MATH.1", label: "Dénombre, compare et range les nombres jusqu'à 1 000" }, { code: "MATH.2", label: "Résout un problème simple d'addition ou de soustraction" }] },
    ],
  },
  CM2: {
    code: "REUSSITE_CM2", label: "Français et mathématiques CM2",
    domains: [
      { code: "LECT", label: "Lecture", competencies: [{ code: "LECT.1", label: "Lit un texte long et en dégage l'essentiel" }, { code: "LECT.2", label: "Lit avec expression un texte littéraire" }] },
      { code: "ECR", label: "Expression écrite", competencies: [{ code: "ECR.1", label: "Rédige un texte de dix lignes en respectant la consigne" }, { code: "ECR.2", label: "Relit et corrige son texte" }] },
      { code: "GRAM", label: "Grammaire et conjugaison", competencies: [{ code: "GRAM.1", label: "Identifie la nature et la fonction des mots" }, { code: "GRAM.2", label: "Conjugue au présent, à l'imparfait et au futur" }] },
      { code: "MATH", label: "Mathématiques", competencies: [{ code: "MATH.1", label: "Effectue les quatre opérations sur les nombres décimaux" }, { code: "MATH.2", label: "Résout un problème en plusieurs étapes" }] },
    ],
  },
};

const PHRASES: Array<{ code: string; scope: "PERIOD" | "YEAR" | "COMPETENCY"; body: string; ratingLevelCode?: string; gradeLevelCode?: string }> = [
  { code: "PERIOD_NA_SOUTIEN", scope: "PERIOD", body: "Des difficultés persistent ; un soutien régulier est conseillé.", ratingLevelCode: "NA" },
  { code: "PERIOD_EA_PROGRES", scope: "PERIOD", body: "Des progrès sont visibles : poursuivez vos efforts avec régularité.", ratingLevelCode: "EA" },
  { code: "PERIOD_AC_FELICITATIONS", scope: "PERIOD", body: "Le travail est satisfaisant : continuez ainsi.", ratingLevelCode: "AC" },
  { code: "PERIOD_COMPORTEMENT", scope: "PERIOD", body: "Comportement exemplaire et bonne participation en classe." },
  { code: "YEAR_GENERIC_SERIEUX", scope: "YEAR", body: "Année de travail sérieuse : l'élève a fourni des efforts constants." },
  { code: "YEAR_CM2_COLLEGE", scope: "YEAR", body: "Bon niveau d'ensemble : l'élève est prêt à aborder la sixième.", gradeLevelCode: "CM2" },
  { code: "COMP_LECTURE_AISANCE", scope: "COMPETENCY", body: "Lit à voix haute avec aisance et en respectant la ponctuation.", ratingLevelCode: "AC", gradeLevelCode: "CP1" },
  { code: "COMP_CALCUL_ENTRAINEMENT", scope: "COMPETENCY", body: "Doit s'entraîner davantage au calcul mental.", ratingLevelCode: "EA" },
];

// ---------------------------------------------------------------------------------------------------------------- plomberie
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

const warnings: string[] = [];
const counts: Record<string, number> = {};
const bump = (k: string, n = 1): void => { counts[k] = (counts[k] ?? 0) + n; };
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  console.log(`• ${name}`);
  try {
    await fn();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${name} : ${message.slice(0, 600)}`);
    console.log(`  ⚠ étape en échec : ${message.slice(0, 600)}`);
    return false;
  }
}

const hash = (v: string): number => {
  let h = 2166136261;
  for (let i = 0; i < v.length; i += 1) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Jours de classe (lundi au vendredi) entre deux dates, vacances et fériés exclus. */
function schoolDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (NO_SCHOOL.some(([x, y]) => d >= x && d <= y)) continue;
    out.push(d);
  }
  return out;
}

const phone = (n: number): string => `+22507${String(10_000_00 + n * 7919).slice(-8).padStart(8, "0")}`;

// ---------------------------------------------------------------------------------------------------------------- principal
async function main(): Promise<void> {
  const env = process.env;
  assertDevAllowed(env);
  assertSeedEnvironment({ ...env, AUDIT_HMAC_KEY: env.AUDIT_HMAC_KEY ?? "sha256-mode" });
  if (!/^[a-z][a-z0-9-]{2,38}[a-z0-9]$/.test(SLUG)) throw new Error(`Slug invalide : ${SLUG}`);
  const file = env.DEV_CREDENTIALS_FILE as string;
  const existingRows: Row[] = existsSync(file) ? ((JSON.parse(readFileSync(file, "utf8")) as { accounts?: Row[] }).accounts ?? []) : [];

  const platform = await startSeedPlatform(env);
  let accountsOut: Array<{ role: string; email: string; password: string; totpSecret?: string }> = [];
  try {
    const { http, operatorToken } = platform;
    const found = expectStatus(await http("GET", `/api/v1/platform/tenants?search=${encodeURIComponent(SLUG)}&limit=50`, { token: operatorToken }), 200, "recherche du tenant");
    if ((found.body.items as Array<{ slug: string }>).some((t) => t.slug === SLUG)) {
      console.log(`L'école « ${SLUG} » existe déjà : rien n'a été créé ni modifié.`);
      return;
    }

    // ---------------------------------------------------------------------------------------------------- phase 0 : école
    console.log(`• création de l'école « ${NAME} » (${SLUG}), pack ${PACK}, offre PROFESSIONAL`);
    const mail = (prefix: string): string => `${prefix}@${SLUG}.test`;
    const provisioned = expectStatus(
      await http("POST", "/api/v1/platform/tenants", {
        token: operatorToken,
        body: { name: NAME, slug: SLUG, countryCode: "CI", packs: [PACK], adminContact: { name: "Direction générale", email: mail("direction.generale"), phone: "+225 07 07 00 00 01" } },
      }),
      201,
      "provisionnement",
    ).body;
    const tenantId = provisioned.tenantId as string;
    const institutionId = provisioned.institutions[0].id as string;
    expectStatus(await http("PUT", `/api/v1/platform/tenants/${tenantId}/subscription`, { token: operatorToken, body: { planKey: "PROFESSIONAL", packs: [PACK], status: "ACTIVE" } }), 200, "abonnement");

    const accounts = new Accounts(http, platform.invitations, SLUG);
    const owner = await accounts.owner("proprietaire", mail("direction.generale"));
    // Écriture immédiate des comptes déjà créés : une panne plus loin ne les perd pas.
    const flush = (): void => {
      mkdirSync(dirname(file), { recursive: true });
      const mine = accounts.list().map((a) => ({ tenant: SLUG, pack: PACK, ...a }));
      const others = existingRows.filter((r) => r.tenant !== SLUG);
      writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), accounts: [...others, ...mine] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    };
    flush();

    // ---------------------------------------------------------------------------------------------------- phase 1 : préparer l'école
    let directeur!: Actor;
    let etudes!: Actor;
    await step("comptes de direction : directeur, directeur des études, secrétariat", async () => {
      directeur = await accounts.staff(owner, "directeur", mail("directeur"), "directeur");
      etudes = await accounts.staff(owner, "directeur_etudes", mail("directeur.etudes"), "directeur_etudes");
      await accounts.staff(owner, "secretariat", mail("secretariat"), "secretariat");
      flush();
    });

    const gradeLevels = await waitFor(
      async () => {
        const r = await owner.get("/api/v1/academic/reference/grade-levels");
        const items = r.body.items as Array<{ id: string; code: string }>;
        return items.some((g) => g.code === "CP1") ? items : false;
      },
      { label: "niveaux du pack", timeoutMs: 90_000 },
    );
    const levelId = (code: string): string => {
      const l = gradeLevels.find((g) => g.code === code);
      if (!l) throw new SeedStepError(`Niveau introuvable : ${code}`);
      return l.id;
    };

    await step("réglages académiques : politique d'inscription automatique, numérotation", async () => {
      await owner.put(`/api/v1/academic/institutions/${institutionId}/settings`, {
        enrollmentConfirmationPolicy: "AUTO",
        registrationNumberPrefix: "REUS",
        registrationNumberPattern: "{PREFIX}-{YEAR}-{LEVEL}-{STUDENT_SEQ:4}",
      });
    });
    await step("identité de l'école (bulletins)", async () => {
      await owner.put("/api/v1/reportcards/branding", {
        legalName: NAME,
        headerLeft: ["République de Côte d'Ivoire", "Ministère de l'Éducation nationale"],
        address: "Cocody Angré, Abidjan (Côte d'Ivoire)",
        primaryColor: "#14532D",
      });
    });

    const year = (await owner.post("/api/v1/academic/years", { institutionId, code: YEAR.code, label: `Année scolaire ${YEAR.code}`, startsOn: YEAR.start }, 201)).body;
    const yearId = year.id as string;
    console.log(`• année ${YEAR.code} : ouverte, courante, 3 trimestres, trimestre 1 ouvert`);
    await owner.post(`/api/v1/academic/years/${yearId}/open`);
    await owner.post(`/api/v1/academic/years/${yearId}/set-current`);
    const plan = await owner.post(`/api/v1/academic/years/${yearId}/period-plan`, { planCode: "THREE_TERMS" }, 201);
    const periodIds = (plan.body.items as Array<{ id: string }>).map((p) => p.id);
    await owner.post(`/api/v1/academic/periods/${periodIds[0]}/open`);

    const programs = (await owner.get(`/api/v1/academic/programs?institutionId=${institutionId}`)).body.items as Array<{ id: string; code: string }>;
    const programId = (code: string): string => {
      const p = programs.find((x) => x.code === code);
      if (!p) throw new SeedStepError(`Programme introuvable : ${code}`);
      return p.id;
    };

    const subjectIds: string[] = [];
    await step("matières (5) et curriculums publiés", async () => {
      for (const s of SUBJECTS) {
        subjectIds.push((await owner.post("/api/v1/academic/subjects", { institutionId, code: s.code, label: s.label }, 201)).body.id as string);
      }
    });
    const versions: Record<string, { id: string; teachable: Record<string, string[]> }> = {};
    const mkVersion = async (program: "MATERNELLE" | "PRIMAIRE"): Promise<void> => {
      const version = (await owner.post("/api/v1/academic/curriculum-versions", { programId: programId(program), academicYearId: yearId }, 201)).body;
      const node = async (body: Record<string, unknown>): Promise<{ id: string }> =>
        (await owner.post(`/api/v1/academic/curriculum-versions/${version.id}/nodes`, body, 201)).body;
      const teachable: Record<string, string[]> = {};
      for (const c of CLASSES.filter((x) => x.program === program)) {
        const level = await node({ nodeTypeCode: "LEVEL", code: c.level, label: c.name, gradeLevelId: levelId(c.level) });
        if (program === "MATERNELLE") {
          await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S1", label: "Semestre 1", periodTypeCode: "SEMESTER", periodOrdinal: 1 });
          await node({ parentId: level.id, nodeTypeCode: "PERIOD", code: "S2", label: "Semestre 2", periodTypeCode: "SEMESTER", periodOrdinal: 2 });
        } else {
          teachable[c.key] = [];
          for (const [i, s] of SUBJECTS.entries()) {
            const n = await node({ parentId: level.id, nodeTypeCode: "SUBJECT", code: s.code, label: s.label, subjectId: subjectIds[i], coefficient: s.coefficient });
            teachable[c.key]!.push(n.id);
          }
        }
      }
      await owner.post(`/api/v1/academic/curriculum-versions/${version.id}/publish`);
      versions[program] = { id: version.id as string, teachable };
    };
    await step("curriculum du programme MATERNELLE", () => mkVersion("MATERNELLE"));
    await step("curriculum du programme PRIMAIRE (CP1, CE1, CM2)", () => mkVersion("PRIMAIRE"));

    const classroomIds: Record<string, string> = {};
    await step("classes (brouillon) : Grande Section A, CP1 A, CE1 A, CM2 A", async () => {
      for (const c of CLASSES) {
        const v = versions[c.program];
        if (!v) throw new SeedStepError(`Curriculum absent pour ${c.program}`);
        const r = await owner.post(
          "/api/v1/academic/classrooms",
          { institutionId, academicYearId: yearId, programId: programId(c.program), gradeLevelId: levelId(c.level), curriculumVersionId: v.id, code: c.code, name: c.name, capacity: c.capacity },
          201,
        );
        classroomIds[c.key] = r.body.id as string;
      }
    });

    // ---------------------------------------------------------------------------------------------------- phase 2 : pack Primaire
    let scaleId = "";
    const levelIdOf: Record<string, string> = {};
    await step("échelle d'appréciation NA / EA / AC", async () => {
      const scale = (
        await owner.post(
          "/api/v1/primary_school/rating-scales",
          {
            code: "NIVEAUX_REUSSITE", label: "Niveaux de maîtrise (Non acquis, En cours, Acquis)",
            levels: [
              { code: "NA", label: "Non acquis", ordinal: 1, meetsExpectation: false },
              { code: "EA", label: "En cours d'acquisition", ordinal: 2, meetsExpectation: false },
              { code: "AC", label: "Acquis", ordinal: 3, meetsExpectation: true },
            ],
          },
          201,
        )
      ).body;
      scaleId = scale.id as string;
      for (const l of scale.levels as Array<{ id: string; code: string }>) levelIdOf[l.code] = l.id;
    });
    await step("réglages du pack : échelle par défaut, conservation des archives 10 ans", async () => {
      await owner.put("/api/v1/primary_school/settings", { defaultRatingScaleId: scaleId, archiveRetentionYears: 10 });
    });
    const frameworkOf: Record<string, { id: string; competencyIds: string[] }> = {};
    await step("référentiels de compétences publiés (GS, CP1, CE1, CM2)", async () => {
      for (const [level, def] of Object.entries(FRAMEWORKS)) {
        const fw = (await owner.post("/api/v1/primary_school/frameworks", { code: def.code, label: def.label, scaleId, gradeLevelCodes: [level] }, 201)).body;
        const detail = (await owner.put(`/api/v1/primary_school/frameworks/${fw.id}/structure`, { domains: def.domains })).body;
        await owner.post(`/api/v1/primary_school/frameworks/${fw.id}/publish`, {});
        const ids = (detail.domains as Array<{ competencies: Array<{ id: string }> }>).flatMap((d) => d.competencies.map((c) => c.id));
        frameworkOf[level] = { id: fw.id as string, competencyIds: ids };
        bump("competences", ids.length);
      }
    });
    await step("banque d'appréciations : 8 phrases", async () => {
      for (const p of PHRASES) {
        await owner.post("/api/v1/primary_school/phrases", p, 201);
        bump("phrases");
      }
    });

    // ---------------------------------------------------------------------------------------------------- phase 3 : les personnes
    const categories = (await owner.get("/api/v1/people/reference/staff-categories")).body.items as Array<{ code: string; canTeach: boolean }>;
    const teachCategory = categories.find((c) => c.canTeach);
    if (!teachCategory) throw new SeedStepError("Aucune catégorie de personnel enseignant.");
    const staffOf: Record<string, string> = {};
    const teacherActors: Record<string, Actor> = {};
    const staffMail = (c: ClassDef): string => mail(c.teacher.account.replace(/_/g, "."));
    await step("personnel : un instituteur titulaire par classe", async () => {
      for (const c of CLASSES) {
        const t = c.teacher;
        const r = await owner.post("/api/v1/people/staff", { person: { lastName: t.last, firstName: t.first, sex: t.sex, birthDate: t.birth, email: staffMail(c), phone: phone(CLASSES.indexOf(c) + 1) }, categoryCode: teachCategory.code, hiredOn: "2020-09-01" }, 201);
        staffOf[c.key] = (r.body.staff?.id ?? r.body.id) as string;
        bump("personnel");
      }
    });
    const councilStaff: Record<string, string> = {};
    await step("personnel : directrice et secrétaire du conseil des maîtres", async () => {
      for (const [key, last, first, email, tel] of [["chair", "DIABATE", "Mariame", "directrice", 21], ["secretary", "N'DA", "Léonie", "secretaire", 22]] as const) {
        const r = await owner.post("/api/v1/people/staff", { person: { lastName: last, firstName: first, sex: "F", birthDate: "1975-02-02", email: mail(email), phone: phone(tel) }, categoryCode: categories[0]!.code, hiredOn: "2015-09-01" }, 201);
        councilStaff[key] = (r.body.staff?.id ?? r.body.id) as string;
        bump("personnel");
      }
    });

    const relationships = (await owner.get("/api/v1/people/reference/relationship-types")).body.items as Array<{ code: string }>;
    const relationshipCode = relationships[0]?.code as string;
    const guardianCache = new Map<string, { id: string; personId: string }>();
    const students: Array<{ cls: ClassDef; def: PupilDef; id: string; personId: string; enrollmentId?: string }> = [];
    let guardianSeq = 0;
    await step("tuteurs (fratries comprises) et élèves", async () => {
      for (const c of CLASSES) {
        for (const [i, p] of c.pupils.entries()) {
          const gKey = p.guardian ?? `${p.last} ${GUARDIAN_FIRST[i % 2 === 0 ? "F" : "M"][(guardianSeq) % 14]}`;
          if (!guardianCache.has(gKey)) {
            const [gLast, ...rest] = gKey.split(" ");
            const gFirst = rest.join(" ");
            const sex: Sex = GUARDIAN_FIRST.F.includes(gFirst) ? "F" : "M";
            const portalEmail = gKey === "COULIBALY Awa" ? mail("parent") : undefined;
            const g = await owner.post("/api/v1/people/guardians", { person: { lastName: gLast, firstName: gFirst, sex, phone: phone(100 + guardianSeq), ...(portalEmail ? { email: portalEmail } : {}) } }, 201);
            guardianCache.set(gKey, { id: g.body.guardian.id as string, personId: g.body.guardian.personId as string });
            guardianSeq += 1;
            bump("tuteurs");
          }
          const s = await owner.post("/api/v1/people/students", { person: { lastName: p.last, firstName: p.first, sex: p.sex, birthDate: p.birth, birthPlace: "Abidjan" } }, 201);
          const st = { cls: c, def: p, id: s.body.student.id as string, personId: s.body.student.personId as string };
          students.push(st);
          await owner.post(`/api/v1/people/students/${st.id}/guardians`, { guardianId: guardianCache.get(gKey)!.id, relationshipCode, isPrimaryContact: true, isFinancialResponsible: true, hasLegalCustody: true, portalAccess: true }, 201);
          bump("eleves");
        }
      }
    });

    await step("affectation des titulaires, comptes instituteurs, activation des classes", async () => {
      for (const c of CLASSES) {
        await owner.post("/api/v1/people/teaching-assignments", { staffId: staffOf[c.key], academicYearId: yearId, classroomId: classroomIds[c.key], roleCode: "HOMEROOM", coversAllSubjects: true, startsOn: YEAR.start }, [200, 201]);
        await owner.post(`/api/v1/academic/classrooms/${classroomIds[c.key]}/activate`, {});
        await owner.post(`/api/v1/people/staff/${staffOf[c.key]}/portal-invitation`, { role: "instituteur" }, [200, 201]);
        teacherActors[c.key] = await accounts.portal(c.teacher.account, staffMail(c));
        flush();
      }
    });
    await step("inscriptions des élèves dans leur classe", async () => {
      for (const s of students) {
        const e = (await owner.post("/api/v1/academic/enrollments", { studentId: s.id, classroomId: classroomIds[s.cls.key], enrolledOn: YEAR.start }, 201)).body;
        s.enrollmentId = e.id as string;
        bump("inscriptions");
      }
    });
    await step("comptes famille : parent (2 enfants) et élève de CM2", async () => {
      const g = guardianCache.get("COULIBALY Awa")!;
      await owner.post(`/api/v1/people/persons/${g.personId}/portal-invitation`, { quality: "GUARDIAN" }, [200, 201]);
      await accounts.portal("parent", mail("parent"));
      const pupil = students.find((s) => s.def.last === "COULIBALY" && s.def.first === "Ibrahim")!;
      await owner.patch(`/api/v1/people/students/${pupil.id}`, { person: { email: mail("eleve") } });
      await owner.post(`/api/v1/people/persons/${pupil.personId}/portal-invitation`, { quality: "STUDENT" }, [200, 201]);
      await accounts.portal("eleve", mail("eleve"));
      flush();
    });

    // ---------------------------------------------------------------------------------------------------- phase 5 : organisation
    await step("emploi du temps de l'école publié (CP1, CE1, CM2) et séances générées", async () => {
      const today = iso(new Date());
      const tt = (await owner.post("/api/v1/scheduling/timetables", { institutionId, academicYearId: yearId, name: "Emploi du temps de l'école 2026-2027", validFrom: YEAR.start, validTo: YEAR.end }, 201)).body;
      for (const c of CLASSES.filter((x) => x.program === "PRIMAIRE")) {
        for (const [i, nodeId] of versions.PRIMAIRE!.teachable[c.key]!.entries()) {
          await owner.post(`/api/v1/scheduling/timetables/${tt.id}/entries`, { classroomId: classroomIds[c.key], curriculumNodeId: nodeId, weekday: i + 1, startTime: "08:00", endTime: "10:00", staff: [{ staffId: staffOf[c.key], role: "LEAD" }], title: SUBJECTS[i]!.label }, 201);
          bump("creneaux");
        }
      }
      await owner.post(`/api/v1/scheduling/timetables/${tt.id}/publish`);
      await owner.post(`/api/v1/scheduling/timetables/${tt.id}/generate`, { from: YEAR.start, to: SCHOOL_END });
    });

    // ---------------------------------------------------------------------------------------------------- phases 6 à 9 : l'année scolaire
    const periodsList = (await owner.get(`/api/v1/academic/years/${yearId}/periods`)).body.items as Array<{ id: string; startsOn: string; endsOn: string }>;
    const periodInfo = periodIds.map((id) => periodsList.find((p) => p.id === id) as { id: string; startsOn: string; endsOn: string });
    console.log(`  périodes : ${periodInfo.map((p) => `${p.startsOn} → ${p.endsOn}`).join(" | ")}`);
    const FAST = process.env.REAL_FAST === "1";
    const last = periodInfo.length - 1;
    const classKeys = CLASSES.map((c) => c.key);
    const graded = CLASSES.filter((x) => x.program === "PRIMAIRE");
    const pupilsOf = (key: string): typeof students => students.filter((s) => s.cls.key === key);
    const ability = (s: { def: PupilDef }): number => (hash(`${s.def.last}${s.def.first}`) % 100) / 100;
    const clampDay = (date: string, p: { startsOn: string; endsOn: string }): string => {
      const hi = p.endsOn < SCHOOL_END ? p.endsOn : SCHOOL_END;
      return date < p.startsOn ? p.startsOn : date > hi ? hi : date;
    };
    const cpath = (key: string, pi: number): string => `${classroomIds[key]}/periods/${periodIds[pi]}`;

    // Identité de l'école, signataire et modèle de bulletin : posés une fois, avant la première émission.
    let templateKey = "primary-bulletin";
    await step("bulletins : signataire (directrice) et modèle du pack Primaire", async () => {
      const sig = await owner.post("/api/v1/reportcards/signatories", { fullName: "Mariame DIABATE", title: "Directrice de l'école", jobFunction: "Direction" }, 201);
      const tpls = (await owner.get("/api/v1/reportcards/templates")).body;
      const list = (tpls.items ?? tpls) as Array<{ key: string; signatureSlots?: Array<{ key?: string; slot?: string }> }>;
      const tpl = list.find((t) => t.key === templateKey) ?? list.find((t) => /primary/.test(t.key));
      if (!tpl) throw new SeedStepError(`Gabarit du primaire introuvable (${list.map((t) => t.key).join(", ")})`);
      templateKey = tpl.key;
      await owner.put("/api/v1/reportcards/template-configs", {
        documentKind: "REPORT_CARD", pack: PACK, templateKey: tpl.key, options: {},
        signatureAssignments: (tpl.signatureSlots ?? []).slice(0, 1).map((s) => ({ slot: s.key ?? s.slot, signatoryId: sig.body.id })),
      });
    });
    const types = await waitFor(async () => {
      const items = (await owner.get("/api/v1/assess/assessment-types")).body.items as Array<{ id: string; code: string }>;
      return items.length > 0 ? items : false;
    }, { label: "types d'évaluation", timeoutMs: 60_000 });
    const typeOf = (code: string): string => (types.find((t) => t.code === code) ?? types[0]!).id;
    await owner.put("/api/v1/results/settings", { requireDeliberation: false });

    // Règles de calcul de l'établissement. Les jeux fournis par le pack sont des jeux de DÉMONSTRATION (fictifs, effectifs à partir du
    // 2026-09-01) : l'école adopte ici SES règles (règlement intérieur : seuil de passage, mentions, quorum…), publiées au catalogue de la
    // plateforme avec la source « établissement », puis liées à ses niveaux dès le début de l'année 2025-2026. Les résultats calculés ne
    // portent donc plus la mention « démonstration ». La plateforme exige que l'auteur d'une version nationale ne l'approuve pas
    // (réglage `nationalFourEyes`) : en développement, ce réglage est suspendu le temps de la publication puis rétabli tel quel.
    await step("règles de calcul de l'établissement : rédaction, approbation, publication et liaison aux niveaux", async () => {
      const RULES_CODE = "LA-REUSSITE-PRIMAIRE";
      const SCHOOL_PARAMS: Record<string, number> = {
        seuil_passage: 10, marge_conseil: 1, pourcentage_absences: 20, redoublements_alerte: 1, quorum_pourcent: 50, decimales: 2,
        actif: 1, passable: 10, assez_bien: 12, bien: 14, tres_bien: 16, excellent: 18,
      };
      const clean = (text: string): string =>
        text
          .replace(/^\(fictif\)\s*/i, "")
          .replace("(milieu du barème, choisi pour exercer le mécanisme)", "fixé par le règlement intérieur de l'établissement")
          .replace(/\s*\(seuil de départ non officiel\)/i, "")
          .replace(/\s*Seuils de départ non officiels\./i, "")
          .replace(/\s*Le quorum officiel est inconnu\./i, "")
          .replace(/\s*Hypothèse de mécanisme, pas la définition officielle\./i, "");
      const sets = (await owner.get("/api/v1/rules/rule-sets")).body.items as Array<{ code: string; origin: string; versions: Array<{ id: string; status: string; contractId: string }> }>;
      const base = sets.find((s) => s.code === "CI-PRIMARY-PLACEHOLDER" && s.origin === "national");
      if (!base) throw new SeedStepError("Jeu de départ CI-PRIMARY-PLACEHOLDER introuvable.");
      const op = (method: string, url: string, body?: unknown): ReturnType<typeof http> => http(method, url, { token: operatorToken, ...(body !== undefined ? { body } : {}) });
      const settings = expectStatus(await op("GET", "/api/v1/rules/platform/settings"), 200, "réglages plateforme").body as { nationalFourEyes: boolean };
      const wasOn = settings.nationalFourEyes;
      const existing = ((await op("GET", "/api/v1/rules/platform/rule-sets")).body.items ?? []) as Array<{ code: string }>;
      const alreadyPublished = existing.some((x) => x.code === RULES_CODE);
      try {
        if (alreadyPublished) console.log("    jeu de règles de l'établissement déjà publié au catalogue : réutilisé");
        else {
        if (wasOn) expectStatus(await op("PUT", "/api/v1/rules/platform/settings", { nationalFourEyes: false }), 200, "suspension de la séparation des tâches");
        expectStatus(await op("POST", "/api/v1/rules/platform/rule-sets", { code: RULES_CODE, name: "Règles de calcul de l'École Primaire Privée La Réussite", countryCode: "CI", educationSystem: "PRIMARY" }), 201, "jeu de règles");
        for (const v of base.versions.filter((x) => x.status === "published")) {
          const detail = (await owner.get(`/api/v1/rules/rule-versions/${v.id}`)).body as { rules: Array<{ key: string; type: string; expression: string; parameters: Record<string, { default?: unknown; description?: string; [k: string]: unknown }>; description?: string }> };
          const rules = detail.rules.map((r) => ({
            key: r.key,
            type: r.type,
            expression: r.expression,
            parameters: Object.fromEntries(
              Object.entries(r.parameters ?? {}).map(([name, spec]) => [name, { ...spec, ...(name in SCHOOL_PARAMS ? { default: SCHOOL_PARAMS[name] } : {}), ...(spec.description ? { description: clean(String(spec.description)) } : {}) }]),
            ),
            description: clean(String(r.description ?? "")),
          }));
          const created = expectStatus(
            await op("POST", `/api/v1/rules/platform/rule-sets/${RULES_CODE}/versions`, {
              contractId: v.contractId,
              effectiveFrom: "2025-09-01",
              source: { kind: "institution", reference: "Règlement intérieur de l'École Primaire Privée La Réussite", description: "Règles de calcul adoptées par l'établissement : seuil de passage de 10/20, mentions par seuils de moyenne, quorum du conseil de 50 %." },
              rules,
              notes: "Règles de l'établissement (règlement intérieur), effectives dès l'année scolaire 2025-2026.",
            }),
            201,
            `version ${v.contractId}`,
          ).body as { id: string };
          for (const to of ["simulated", "proposed", "approved", "published"]) {
            expectStatus(await op("POST", `/api/v1/rules/platform/rule-versions/${created.id}/transitions`, { to, comment: "Règles de l'établissement (règlement intérieur)." }), 200, `${v.contractId} → ${to}`);
          }
          bump("reglesPubliees");
        }
        }
      } finally {
        if (wasOn) await op("PUT", "/api/v1/rules/platform/settings", { nationalFourEyes: true });
      }
      // Liaisons de l'établissement : mêmes niveaux que celles du pack, vers les règles de l'école, dès le début de l'année.
      const bindings = (await owner.get("/api/v1/rules/bindings")).body.items as Array<{ contractId: string; ruleSetCode: string; institutionId: string | null; curriculumNodeId: string | null; levelCode: string | null; effectiveFrom: string }>;
      for (const b of bindings.filter((x) => x.ruleSetCode === "CI-PRIMARY-PLACEHOLDER")) {
        // La liaison du pack court depuis 2000 sans fin : on la termine la veille de l'année, puis on lie les règles de l'école.
        await owner.put("/api/v1/rules/bindings", { contractId: b.contractId, ruleSetCode: b.ruleSetCode, institutionId: b.institutionId, curriculumNodeId: b.curriculumNodeId, levelCode: b.levelCode, effectiveFrom: b.effectiveFrom, effectiveTo: "2025-08-31" });
        await owner.put("/api/v1/rules/bindings", { contractId: b.contractId, ruleSetCode: RULES_CODE, institutionId: b.institutionId, curriculumNodeId: b.curriculumNodeId, levelCode: b.levelCode, effectiveFrom: "2025-09-01" });
        bump("liaisonsDeRegles");
      }
    });

    for (const [pi, period] of periodInfo.entries()) {
      const term = `Trimestre ${pi + 1}`;
      const teachEnd = period.endsOn < SCHOOL_END ? period.endsOn : SCHOOL_END;
      if (pi > 0) await step(`${term} : ouverture de la période`, async () => { await owner.post(`/api/v1/academic/periods/${period.id}/open`, {}, [200, 201, 409]); });

      // --- 6.1 appels quotidiens, validés par la direction ------------------------------------------------------------------
      await step(`${term} : appels quotidiens (${period.startsOn} → ${teachEnd})`, async () => {
        const days = schoolDays(period.startsOn, teachEnd).filter((d) => !FAST || new Date(`${d}T00:00:00Z`).getUTCDay() === 3);
        for (const [n, day] of days.entries()) {
          for (const c of CLASSES) {
            const t = teacherActors[c.key]!;
            const pupils = pupilsOf(c.key);
            const parts: Array<"FULL" | "MORNING" | "AFTERNOON"> = c.program === "MATERNELLE" ? ["FULL"] : ["MORNING", "AFTERNOON"];
            for (const dayPart of parts) {
              const opened = await t.post("/api/v1/attendance/sessions", { scope: "DAILY", classroomId: classroomIds[c.key], date: day, ...(c.program === "MATERNELLE" ? {} : { dayPart }) }, [200, 201]);
              const sid = opened.body.session.id as string;
              await t.put(`/api/v1/attendance/sessions/${sid}/records`, {
                entries: pupils.map((s) => {
                  const h = hash(`${day}${dayPart}${s.id}`) % 100;
                  return h < 4 ? { studentId: s.id, statusCode: "ABSENT" } : h < 7 && dayPart !== "AFTERNOON" ? { studentId: s.id, statusCode: "LATE", minutesLate: 5 + (h % 4) * 5 } : { studentId: s.id, statusCode: "PRESENT" };
                }),
              });
              await t.post(`/api/v1/attendance/sessions/${sid}/submit`, {});
              await directeur.post(`/api/v1/attendance/sessions/${sid}/validate`, {});
              bump("appels");
            }
          }
          if (n % 20 === 19) console.log(`    … ${n + 1}/${days.length} jours`);
        }
      });

      // --- 6.3 compétences : saisie, validation de la grille, période prête ------------------------------------------------
      await step(`${term} : compétences saisies, grilles validées, période marquée prête`, async () => {
        const observedOn = clampDay(addDays(period.startsOn, 40), period);
        for (const c of CLASSES) {
          const t = teacherActors[c.key]!;
          const fw = frameworkOf[c.level]!;
          const lines = pupilsOf(c.key).flatMap((s) =>
            fw.competencyIds
              .map((competencyId, k) => ({ s, competencyId, k }))
              .filter(({ s: st, k }) => hash(`${st.id}${k}${pi}`) % 53 !== 0) // quelques compétences restent « non évaluées »
              .map(({ s: st, competencyId, k }) => {
                const v = ability(st) + 0.12 * pi + ((hash(`${st.def.first}${k}${pi}`) % 30) - 15) / 100;
                const code = v < 0.33 ? "NA" : v < 0.62 ? "EA" : "AC";
                return { enrollmentId: st.enrollmentId as string, competencyId, ratingLevelId: levelIdOf[code] as string, observedOn };
              }),
          );
          await t.put("/api/v1/primary_school/competency-assessments/bulk", { classroomId: classroomIds[c.key], periodId: period.id, frameworkId: fw.id, lines });
          await t.post(`/api/v1/primary_school/classrooms/${cpath(c.key, pi)}/competencies/validate`, { frameworkId: fw.id });
          await t.post(`/api/v1/primary_school/classrooms/${cpath(c.key, pi)}/ready`, {}, [200, 201]);
          bump("lignesDeCompetences", lines.length);
        }
      });

      // --- 6.4 évaluations notées : trois contrôles par matière et par trimestre ------------------------------------------
      await step(`${term} : évaluations notées (devoirs 1 et 2, composition), relues, approuvées, publiées`, async () => {
        const plans = [
          { title: "Devoir n°1", type: "DEVOIR", offset: 21 },
          { title: "Devoir n°2", type: "DEVOIR", offset: 55 },
          { title: "Composition du trimestre", type: "COMPOSITION", offset: 70 },
        ];
        for (const c of graded) {
          const t = teacherActors[c.key]!;
          const nodes = versions.PRIMAIRE!.teachable[c.key]!;
          for (const [pn, plan] of plans.entries()) {
            const assessedOn = clampDay(addDays(period.startsOn, plan.offset), period);
            const created = await t.post("/api/v1/assess/assessments/bulk", { typeId: typeOf(plan.type), academicPeriodId: period.id, title: plan.title, assessedOn, targets: nodes.map((curriculumNodeId) => ({ classroomId: classroomIds[c.key], curriculumNodeId })) }, 201);
            for (const [a, assessment] of (created.body.items as Array<{ id: string }>).entries()) {
              const entries = pupilsOf(c.key).map((s) => {
                const raw = 4 + ability(s) * 12.5 + ((hash(`${s.id}${a}${pn}${pi}`) % 9) - 4) * 0.8 + pi * 0.3;
                return { enrollmentId: s.enrollmentId, score: String(Math.max(2, Math.min(19.5, Math.round(raw * 2) / 2))) };
              });
              await t.put(`/api/v1/assess/assessments/${assessment.id}/grades`, { entries }, 200, { "idempotency-key": `real-${SLUG}-${c.key}-${pi}-${pn}-${a}` });
              await t.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "SUBMITTED" });
              await etudes.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "REVIEWED" });
              await etudes.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "APPROVED" });
              await directeur.post(`/api/v1/assess/assessments/${assessment.id}/transitions`, { to: "PUBLISHED" });
              bump("evaluations");
              bump("notes", entries.length);
            }
          }
        }
      });

      // --- 8 fin de période : verrouillage, (conseil de fin d'année), clôture des résultats ---------------------------------
      await step(`${term} : verrouillage des notes`, async () => {
        for (const key of classKeys) await directeur.post(`/api/v1/results/classrooms/${cpath(key, pi)}/lock`, {});
      });

      if (pi === last) {
        await step(`${term} : conseil des maîtres de fin d'année (propositions, présence signée, décisions, procès-verbal)`, async () => {
          for (const c of CLASSES) {
            const t = teacherActors[c.key]!;
            const prep = await t.post("/api/v1/primary_school/councils/prepare", { classroomId: classroomIds[c.key], periodId: period.id, heldOn: teachEnd }, [200, 201]);
            const deliberationId = prep.body.deliberationId as string;
            const cases = prep.body.cases as Array<{ id: string; enrollmentId: string }>;
            await directeur.put(`/api/v1/primary_school/councils/${deliberationId}/attendance`, {
              participants: [
                { staffId: staffOf[c.key], roleCode: "HOMEROOM", convened: true, present: true },
                { staffId: councilStaff.chair, roleCode: "CHAIR", convened: true, present: true },
                { staffId: councilStaff.secretary, roleCode: "SECRETARY", convened: true, present: true },
              ],
              signedStaffIds: [staffOf[c.key], councilStaff.chair, councilStaff.secretary],
            });
            const ranked = pupilsOf(c.key).map((s) => ({ s, a: ability(s) })).sort((x, y) => x.a - y.a);
            const repeat = new Set(c.key === "gs" || c.key === "cm2" ? [] : [ranked[0]!.s.enrollmentId]);
            for (const cs of cases) {
              const redouble = repeat.has(cs.enrollmentId);
              await t.patch(`/api/v1/primary_school/councils/${deliberationId}/cases/${cs.id}`, { proposalCode: redouble ? "REPEAT" : "PROMOTED", proposalNote: redouble ? "Acquis encore fragiles en fin d'année ; un maintien est proposé." : "Acquis suffisants pour la classe supérieure." });
              await directeur.post(`/api/v1/primary_school/councils/${deliberationId}/cases/${cs.id}/decide`, {
                finalCode: redouble ? "REPEAT" : "PROMOTED",
                justification: redouble ? "Le conseil des maîtres confirme le maintien : les compétences de base ne sont pas stabilisées." : "Le conseil des maîtres confirme le passage en classe supérieure : les compétences attendues sont acquises.",
              });
              bump("decisionsDuConseil");
            }
            await directeur.post(`/api/v1/primary_school/councils/${deliberationId}/minutes`, { heldOn: teachEnd }, 201);
            await waitFor(async () => (await directeur.get(`/api/v1/primary_school/councils/${deliberationId}`)).body.minutesDocumentId, { label: "procès-verbal du conseil", timeoutMs: 180_000 });
            await directeur.patch(`/api/v1/results/deliberations/${deliberationId}`, { status: "HELD", heldOn: teachEnd });
            bump("conseilsTenus");
          }
        });
      }

      await step(`${term} : clôture des résultats puis des notes et de la période, par classe`, async () => {
        for (const key of classKeys) {
          await directeur.post(`/api/v1/results/classrooms/${cpath(key, pi)}/close`, {});
          await directeur.post(`/api/v1/academic/classrooms/${cpath(key, pi)}/close-grading`, {}, [200, 201, 409]);
          await directeur.post(`/api/v1/academic/classrooms/${cpath(key, pi)}/close`, {}, [200, 201, 409]);
          bump("periodesCloses");
        }
      });

      // --- 8.9 bulletins de la période : émission, rendu PDF signé, publication aux familles -----------------------------------
      await step(`${term} : bulletins (émission, PDF signés, publication aux familles)`, async () => {
        for (const c of CLASSES) {
          const batch = await owner.post("/api/v1/reportcards/batches", { classroomId: classroomIds[c.key], academicPeriodId: period.id, idempotencyKey: `real-${SLUG}-${c.key}-${pi}` }, [200, 202]);
          const total = Number((batch.body.batch ?? batch.body).total ?? 0);
          if (total === 0) throw new SeedStepError(`Aucun bulletin dans le lot (${c.code}) : ${JSON.stringify(batch.body).slice(0, 300)}`);
          const cards = await waitFor(async () => {
            const page = await owner.get(`/api/v1/reportcards/report-cards?classroomId=${classroomIds[c.key]}&academicPeriodId=${period.id}&live=true`);
            const items = page.body.items as Array<{ id: string; renderStatus: string }>;
            if (items.length < total) return false;
            if (items.some((x) => x.renderStatus === "FAILED")) throw new SeedStepError("Rendu d'un bulletin en échec (Chromium disponible ?).");
            return items.every((x) => x.renderStatus === "RENDERED") ? items : false;
          }, { label: `rendu PDF des bulletins ${c.code}`, timeoutMs: 600_000, intervalMs: 1500 });
          await owner.post("/api/v1/reportcards/publish", { reportCardIds: cards.map((x) => x.id) });
          bump("bulletins", cards.length);
        }
      });
    }

    // --- 9 fin d'année : bilans annuels scellés, clôture de l'année, archive gelée ------------------------------------------
    await step("bilans annuels : préparation, scellement et PDF de chaque bilan", async () => {
      for (const c of CLASSES) {
        const prepared = await directeur.post("/api/v1/primary_school/annual-reviews/prepare", { classroomId: classroomIds[c.key], academicYearId: yearId }, [200, 201]);
        for (const r of prepared.body.reviews as Array<{ id: string }>) {
          await directeur.post(`/api/v1/primary_school/annual-reviews/${r.id}/seal`, {});
          bump("bilansScelles");
        }
        for (const r of prepared.body.reviews as Array<{ id: string }>) {
          await waitFor(async () => (await directeur.get(`/api/v1/primary_school/annual-reviews/${r.id}`)).body.reportcardId, { label: "PDF du bilan annuel", timeoutMs: 300_000, intervalMs: 1500 });
        }
      }
    });
    await step("année 2025-2026 : clôture des trimestres de l'établissement puis de l'année", async () => {
      for (const [pi, period] of periodInfo.entries()) {
        await owner.post(`/api/v1/academic/periods/${period.id}/close-grading`, {}, [200, 201, 409]);
        await owner.post(`/api/v1/academic/periods/${period.id}/close`, {}, [200, 201]);
        console.log(`    Trimestre ${pi + 1} clôturé`);
      }
      await owner.post(`/api/v1/academic/years/${yearId}/close`, {}, [200, 201]);
    });
    await step("archive de l'année : préparée, contrôlée puis gelée", async () => {
      const prepared = await directeur.post("/api/v1/primary_school/year-archives/prepare", { academicYearId: yearId }, [200, 201]);
      const archiveId = prepared.body.id as string;
      const state = (await directeur.get(`/api/v1/primary_school/year-archives/${archiveId}`)).body;
      console.log(`    archive : ${state.status}`);
      await directeur.post(`/api/v1/primary_school/year-archives/${archiveId}/freeze`, {}, [200, 201]);
    });

    // --- année suivante : 2026-2027, courante, trimestre 1 ouvert -----------------------------------------------------------
    await step("année 2026-2027 : créée, ouverte, courante, trimestre 1 ouvert", async () => {
      const next = (await owner.post("/api/v1/academic/years", { institutionId, code: NEXT_YEAR.code, label: `Année scolaire ${NEXT_YEAR.code}`, startsOn: NEXT_YEAR.start }, 201)).body;
      await owner.post(`/api/v1/academic/years/${next.id}/open`);
      await owner.post(`/api/v1/academic/years/${next.id}/set-current`);
      const plan2 = await owner.post(`/api/v1/academic/years/${next.id}/period-plan`, { planCode: "THREE_TERMS" }, 201);
      await owner.post(`/api/v1/academic/periods/${(plan2.body.items as Array<{ id: string }>)[0]!.id}/open`);
    });

    accountsOut = accounts.list();
    flush();
  } finally {
    await platform.stop();
  }

  console.log("\n===== RÉSUMÉ =====");
  console.log(JSON.stringify(counts));
  console.log(`Comptes créés : ${accountsOut.map((a) => a.role).join(", ")}`);
  if (warnings.length) {
    console.log(`\n${warnings.length} avertissement(s) :`);
    for (const w of warnings) console.log(` - ${w}`);
  }
  console.log(`\nÉcole « ${NAME} » (${SLUG}) créée. Les comptes (mot de passe et MFA) sont dans .dev-v2/credentials.json, affichés sur /v2/login.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[dev-v2 real-school] ÉCHEC :", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
