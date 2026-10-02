/**
 * Test de fumée de la démonstration (`pnpm demo:smoke`), sur la pile DÉMARRÉE :
 *
 *   - sondes : API `/health` et `/ready`, web `/api/health` et `/v2/login` ;
 *   - console plateforme : connexion de l'opérateur, liste des organisations ;
 *   - par établissement : connexion de plusieurs rôles (MFA comprise, TOTP calculé depuis le fichier d'identifiants), appels de
 *     routes clés (listes, résultats, bulletins, tableaux de bord, portails) : 2xx exigé, aucun 5xx toléré ;
 *   - ISOLATION : les ressources d'un établissement sont introuvables (403/404) pour le propriétaire d'un autre, et ne figurent
 *     dans aucune de ses listes ;
 *   - vérification publique d'un bulletin : AUTHENTIQUE et marqué « démonstration ».
 *
 * Variables : DEMO_API_URL, DEMO_WEB_URL, DEMO_CREDENTIALS_JSON, DEMO_OPERATOR_EMAIL, DEMO_OPERATOR_PASSWORD.
 * Les mots de passe ne sont jamais affichés.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { totpAt } from "../seed-v2/actors";

interface Account {
  tenant: string;
  pack: string;
  role: string;
  email: string;
  password: string;
  totpSecret?: string;
}

const api = process.env.DEMO_API_URL ?? "http://127.0.0.1:4100";
const web = process.env.DEMO_WEB_URL ?? "http://127.0.0.1:3100";

let checks = 0;
const failures: string[] = [];
const serverErrors: string[] = [];

interface Res {
  status: number;
  body: any;
  text: string;
}

async function call(method: string, path: string, token?: string, body?: unknown, base = api): Promise<Res> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* corps non JSON */
  }
  if (res.status >= 500) serverErrors.push(`${method} ${path} -> ${res.status}`);
  return { status: res.status, body: parsed, text };
}

function check(label: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ` : ${detail}` : ""}`);
  console.log(`  ${ok ? "OK  " : "ECHEC"} ${label}${ok || !detail ? "" : ` : ${detail}`}`);
}

async function expect2xx(label: string, method: string, path: string, token: string, body?: unknown): Promise<Res> {
  const r = await call(method, path, token, body);
  check(label, r.status >= 200 && r.status < 300, `HTTP ${r.status} ${typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 160) : String(r.text).slice(0, 160)}`);
  return r;
}

async function login(a: Account): Promise<string | null> {
  const first = await call("POST", "/api/v1/iam/login", undefined, { email: a.email, password: a.password, tenantSlug: a.tenant, client: "mobile" });
  if (first.body?.status === "authenticated") return first.body.accessToken as string;
  if (first.body?.status === "mfa_required" && a.totpSecret) {
    // Anti-rejeu : un code déjà consommé est refusé ; on essaie le pas courant puis le suivant.
    for (const delta of [0, 30_000, 60_000]) {
      const r = await call("POST", "/api/v1/iam/mfa/challenge", undefined, { challengeToken: first.body.challengeToken, code: totpAt(a.totpSecret, Date.now() + delta), client: "mobile" });
      if (r.status === 200 && r.body?.accessToken) return r.body.accessToken as string;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const started = Date.now();
  const creds = JSON.parse(readFileSync(process.env.DEMO_CREDENTIALS_JSON as string, "utf8")) as { accounts: Account[] };
  const tenants = [...new Set(creds.accounts.map((a) => a.tenant))];

  console.log("Sondes");
  for (const [label, base, path] of [["API /health", api, "/health"], ["API /ready", api, "/ready"], ["Web /api/health", web, "/api/health"], ["Web /v2/login", web, "/v2/login"]] as const) {
    const r = await call("GET", path, undefined, undefined, base);
    check(label, r.status === 200, `HTTP ${r.status}`);
  }

  console.log("Console de la plateforme");
  const op = await call("POST", "/api/v1/super-admin/auth/login", undefined, { email: process.env.DEMO_OPERATOR_EMAIL, password: process.env.DEMO_OPERATOR_PASSWORD });
  check("connexion de l'opérateur", op.status === 200 && Boolean(op.body?.token), `HTTP ${op.status}`);
  const bad = await call("POST", "/api/v1/super-admin/auth/login", undefined, { email: process.env.DEMO_OPERATOR_EMAIL, password: randomBytes(12).toString("base64url") });
  check("mot de passe d'opérateur erroné refusé", bad.status === 401, `HTTP ${bad.status}`);
  if (op.body?.token) {
    const list = await expect2xx("liste des organisations", "GET", "/api/v1/platform/tenants?limit=50", op.body.token);
    const slugs = ((list.body?.items ?? []) as Array<{ slug: string }>).map((t) => t.slug);
    check("les établissements de démonstration sont listés", tenants.every((t) => slugs.includes(t)), slugs.join(","));
  }

  // --- par établissement -----------------------------------------------------------------------------------------------------
  const tokens = new Map<string, string>();
  const idsByTenant = new Map<string, { classroomId?: string; periodId?: string; studentId?: string; invoiceId?: string; reportCardId?: string; verificationCode?: string }>();
  for (const tenant of tenants) {
    console.log(`\nÉtablissement ${tenant}`);
    const accounts = creds.accounts.filter((a) => a.tenant === tenant);
    const pack = accounts[0]?.pack ?? "";
    for (const a of accounts) {
      const token = await login(a);
      check(`connexion ${a.role}${a.totpSecret ? " (MFA)" : ""}`, token !== null);
      if (token) tokens.set(`${tenant}/${a.role}`, token);
    }
    const t = (role: string): string | undefined => tokens.get(`${tenant}/${role}`);
    const owner = t("proprietaire");
    const ids: NonNullable<ReturnType<typeof idsByTenant.get>> = {};
    idsByTenant.set(tenant, ids);
    if (owner) {
      const entitlements = await expect2xx("propriétaire : droits et abonnement", "GET", "/api/v1/entitlements/me", owner);
      check("abonnement PROFESSIONAL actif", JSON.stringify(entitlements.body).includes("PROFESSIONAL"));
      await expect2xx("propriétaire : navigation par rôle", "GET", "/api/v1/rbac/me/navigation", owner);
      const classes = await expect2xx("propriétaire : classes", "GET", "/api/v1/academic/classrooms?limit=50", owner);
      ids.classroomId = (classes.body?.items as Array<{ id: string }> | undefined)?.[0]?.id;
      check("au moins une classe", Boolean(ids.classroomId));
      const students = await expect2xx("propriétaire : élèves", "GET", "/api/v1/people/students?limit=50", owner);
      ids.studentId = (students.body?.items as Array<{ id: string }> | undefined)?.[0]?.id;
      check("au moins 12 élèves", ((students.body?.items as unknown[] | undefined)?.length ?? 0) >= 12);
      const invoices = await expect2xx("propriétaire : factures", "GET", "/api/v1/finance/invoices?limit=50", owner);
      ids.invoiceId = (invoices.body?.items as Array<{ id: string }> | undefined)?.[0]?.id;
      await expect2xx("propriétaire : règlements", "GET", "/api/v1/finance/payments?limit=20", owner);
      await expect2xx("propriétaire : années académiques", "GET", "/api/v1/academic/years", owner);
      await expect2xx("propriétaire : candidatures", "GET", "/api/v1/admissions/applications?limit=20", owner);
      await expect2xx("propriétaire : notifications (journal)", "GET", "/api/v1/notifications/deliveries?limit=20", owner);
      await expect2xx("propriétaire : tableau de bord de direction (vue d'ensemble)", "GET", "/api/v1/analytics/overview", owner);
      await expect2xx("propriétaire : tableau de bord (effectifs)", "GET", "/api/v1/analytics/enrollment", owner);
      await expect2xx("propriétaire : règles d'alerte", "GET", "/api/v1/analytics/alerts/rules", owner);
      await expect2xx("propriétaire : journaux d'imports", "GET", "/api/v1/imports/jobs?limit=10", owner);
      await expect2xx("propriétaire : jeux de règles liés", "GET", "/api/v1/rules/bindings", owner);
      const cards = await call("GET", `/api/v1/reportcards/report-cards?limit=5`, owner);
      check("propriétaire : bulletins", cards.status === 200 && ((cards.body?.items as unknown[] | undefined)?.length ?? 0) > 0, `HTTP ${cards.status}`);
      const first = (cards.body?.items as Array<{ id: string; verificationCode: string }> | undefined)?.[0];
      ids.reportCardId = first?.id;
      ids.verificationCode = first?.verificationCode;
      if (first) {
        // Téléchargement du PDF : URL signée de courte durée (servie par l'API, relayée par le web), octets « %PDF- ».
        const pdf = await call("GET", `/api/v1/reportcards/report-cards/${first.id}/pdf`, owner);
        const url = (pdf.body?.url ?? pdf.body?.downloadUrl) as string | undefined;
        let isPdf = false;
        if (url) {
          const file = await fetch(url, { signal: AbortSignal.timeout(60_000) });
          const bytes = Buffer.from(await file.arrayBuffer());
          isPdf = file.status === 200 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
        }
        check("bulletin : PDF téléchargeable par URL signée", isPdf, `HTTP ${pdf.status} ${JSON.stringify(pdf.body).slice(0, 120)}`);
      }
      // Contenu propre à chaque pack (volumes minimaux de la démonstration).
      const countOf = (r: Res): number => ((r.body?.items ?? r.body) as unknown[] | undefined)?.length ?? 0;
      const apps = await expect2xx("propriétaire : candidatures (au moins 9)", "GET", "/api/v1/admissions/applications?limit=50", owner);
      check("au moins 9 candidatures à tous les statuts", countOf(apps) >= 9, String(countOf(apps)));
      const imports = await call("GET", "/api/v1/imports/jobs?limit=10", owner);
      check("un import d'élèves VALIDÉ, prêt à exécuter", imports.status === 200 && JSON.stringify(imports.body).includes('"VALIDATED"'), `HTTP ${imports.status}`);
      if (pack === "SECONDARY") {
        const councils = await expect2xx("propriétaire : conseils de classe", "GET", "/api/v1/councils/councils", owner);
        check("un conseil de classe OUVERT", JSON.stringify(councils.body).includes('"OPEN"'));
        const measures = await expect2xx("propriétaire : mesures de vie scolaire", "GET", "/api/v1/schoollife/measures", owner);
        check("au moins 3 mesures de vie scolaire", countOf(measures) >= 3, String(countOf(measures)));
        const assigns = await expect2xx("propriétaire : élèves affectés par l'État", "GET", "/api/v1/stateassign/assignments", owner);
        check("un dossier d'affectation", countOf(assigns) >= 1, String(countOf(assigns)));
        const sessions = await expect2xx("propriétaire : sessions d'examen", "GET", "/api/v1/examinations/sessions", owner);
        check("session officielle et examen blanc", countOf(sessions) >= 2, String(countOf(sessions)));
      }
      if (pack === "PRIMARY") {
        const reviews = await expect2xx("propriétaire : bilans annuels", "GET", "/api/v1/primary_school/annual-reviews?limit=20", owner);
        check("5 bilans annuels dont 3 scellés", countOf(reviews) >= 5 && (JSON.stringify(reviews.body).match(/"SEALED"/g)?.length ?? 0) >= 3, String(countOf(reviews)));
        await expect2xx("propriétaire : conseils des maîtres", "GET", "/api/v1/primary_school/councils", owner);
      }
      const years = await call("GET", "/api/v1/academic/years", owner);
      const yearId =(years.body?.items as Array<{ id: string }> | undefined)?.[0]?.id;
      if (yearId) {
        const periods = await call("GET", `/api/v1/academic/years/${yearId}/periods`, owner);
        ids.periodId = (periods.body?.items as Array<{ id: string }> | undefined)?.[0]?.id;
      }
    }
    const dir = t("directeur");
    if (dir) {
      await expect2xx("directeur : tableau de bord", "GET", "/api/v1/analytics/overview", dir);
      if (ids.classroomId && ids.periodId) await expect2xx("directeur : résultats de la classe (période 1)", "GET", `/api/v1/results/classrooms/${ids.classroomId}/periods/${ids.periodId}/state`, dir);
    }
    const parent = t("parent");
    if (parent) {
      await expect2xx("parent : ses enfants", "GET", "/api/v1/people/children", parent);
      await expect2xx("parent : bulletins de ses enfants", "GET", "/api/v1/reportcards/me/report-cards", parent);
      await expect2xx("parent : finances de ses enfants", "GET", "/api/v1/finance/me/learners", parent);
    }
    const eleve = t("eleve");
    if (eleve) {
      await expect2xx("élève : sa fiche", "GET", "/api/v1/people/me/student", eleve);
      await expect2xx("élève : ses bulletins", "GET", "/api/v1/reportcards/me/report-cards", eleve);
    }
    const teacher = t("enseignant") ?? t("instituteur");
    if (teacher) {
      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
      await expect2xx("enseignant : emploi du temps personnel (deux semaines)", "GET", `/api/v1/scheduling/me/timetable?from=${from}&to=${to}`, teacher);
      await expect2xx("enseignant : séances du jour", "GET", "/api/v1/scheduling/me/today", teacher);
      await expect2xx("enseignant : ses évaluations", "GET", "/api/v1/assess/assessments?limit=10", teacher);
    }
    const econome = t("econome");
    if (econome) await expect2xx("économe : factures", "GET", "/api/v1/finance/invoices?limit=10", econome);
    const adm = t("admissions_officer");
    if (adm) await expect2xx("chargé d'admissions : candidatures", "GET", "/api/v1/admissions/applications?limit=10", adm);
    // Vérification publique d'un bulletin.
    if (ids.verificationCode) {
      const v = await call("GET", `/api/v1/public/verify/${ids.verificationCode}`);
      check(`vérification publique d'un bulletin : AUTHENTIQUE${pack === "HIGHER" ? "" : " et « démonstration »"}`, v.status === 200 && v.body?.status === "AUTHENTIC" && (pack === "HIGHER" || v.body?.demonstration === true), `HTTP ${v.status} ${JSON.stringify(v.body).slice(0, 120)}`);
    }
  }

  // --- isolation entre établissements --------------------------------------------------------------------------------------
  console.log("\nIsolation entre établissements");
  for (const a of tenants) {
    for (const b of tenants) {
      if (a === b) continue;
      const ownerA = tokens.get(`${a}/proprietaire`);
      const idsB = idsByTenant.get(b);
      if (!ownerA || !idsB) continue;
      const probes: Array<[string, string | undefined]> = [
        ["classe", idsB.classroomId ? `/api/v1/academic/classrooms/${idsB.classroomId}` : undefined],
        ["élève", idsB.studentId ? `/api/v1/people/students/${idsB.studentId}` : undefined],
        ["facture", idsB.invoiceId ? `/api/v1/finance/invoices/${idsB.invoiceId}` : undefined],
        ["bulletin", idsB.reportCardId ? `/api/v1/reportcards/report-cards/${idsB.reportCardId}` : undefined],
      ];
      for (const [what, path] of probes) {
        if (!path) continue;
        const r = await call("GET", path, ownerA);
        check(`${a} ne lit pas ${what} de ${b}`, r.status === 403 || r.status === 404, `HTTP ${r.status}`);
      }
      const list = await call("GET", "/api/v1/people/students?limit=200", ownerA);
      check(`liste des élèves de ${a} sans élève de ${b}`, !idsB.studentId || !JSON.stringify(list.body).includes(idsB.studentId));
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${checks} contrôles en ${seconds} s : ${checks - failures.length} réussis, ${failures.length} en échec, ${serverErrors.length} réponse(s) 5xx.`);
  if (serverErrors.length > 0) console.log(`Réponses 5xx :\n  ${serverErrors.join("\n  ")}`);
  if (failures.length > 0) console.log(`Échecs :\n  ${failures.join("\n  ")}`);
  process.exit(failures.length === 0 && serverErrors.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[smoke] ERREUR :", e instanceof Error ? e.message : e);
  process.exit(2);
});
