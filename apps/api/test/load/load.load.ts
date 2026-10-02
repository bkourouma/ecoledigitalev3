/**
 * TEST DE CHARGE de la plateforme v2 ASSEMBLÉE (API réelle sur un vrai port, vrai worker en processus, Postgres 17 + Redis 7 éphémères).
 *
 *   pnpm test:load                      # échelle réduite (CI) : 60 élèves par tenant, 3 tenants
 *   ED_LOAD_SCALE=33 pnpm test:load     # ~2 000 élèves par tenant
 *
 * Les scénarios s'exécutent SÉQUENTIELLEMENT (jamais en parallèle entre eux), en boucle fermée à concurrence fixe. Chacun mesure
 * p50/p95/p99, débit et erreurs. Le rapport (JSON + Markdown) est écrit dans `test/load/results/` (ignoré par git).
 * Voir `docs/architecture/perf-report.md` pour la méthode, les seuils (PROPOSÉS) et les résultats.
 *
 * Propriétés de CORRECTION (toujours bloquantes) : aucune erreur 5xx, aucune fuite inter-tenants (HTTP et RLS) sous concurrence.
 * Seuils de latence : bloquants seulement avec ED_LOAD_ENFORCE=1.
 *
 * Non rejoué ici : l'import de 5 000 lignes est mesuré par `test/imports/performance.integration.test.ts` (durées `[perf]` et pic mémoire).
 */
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { waitFor, REDIS_URL } from "../phase1/support/harness";
import { PASSWORD } from "../phase1/support/scenario";
import { describeIntegration } from "../helpers/fixtures";
import { expectStatus } from "../phase2/support/actors";
import { DEFAULT_SANDBOX_SECRET } from "../../src/modules/finance/infrastructure/providers/sandbox-provider";
import { addDays } from "../phase3/support/admissions";
import { CONCURRENCY, ENFORCE, NOISY_NEIGHBOUR_MAX_RATIO, READS, REAL_PDF, SCALE, SCRYPT_LOG_N, STUDENTS_PER_TENANT, TENANTS, THRESHOLDS, THRESHOLD_FACTOR, CLASS_SIZE, log } from "./config";
import { resetIpLimiters, resetSqlStats, setSqlCapture, sqlTop, startLoadPlatform, type LoadEnv, type SqlStat } from "./support/platform";
import { drive, toMarkdown, type DriveOptions, type OpResult, type ScenarioStats } from "./support/stats";
import { seedTenant, SUBJECTS, type TenantWorld } from "./support/seed";

const here = dirname(fileURLToPath(import.meta.url));
const only = (process.env.ED_LOAD_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const wanted = (name: string): boolean => only.length === 0 || only.some((o) => name.startsWith(o));

const res = (r: { status: number; body: unknown }): OpResult => ({ status: r.status, note: r.status >= 400 ? JSON.stringify(r.body)?.slice(0, 240) : undefined });
const pick = <T>(a: T[], i: number): T => a[i % a.length] as T;
const rnd = (() => {
  let s = 123456789;
  return (n: number): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s % n;
  };
})();

function findField(o: unknown, key: string): string | undefined {
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === key && typeof v === "string") return v;
      const sub = findField(v, key);
      if (sub) return sub;
    }
  }
  return undefined;
}

interface Extra {
  loopP99Ms: number;
  loopMaxMs: number;
  cpuMs: number;
  heapMb: number;
}

describeIntegration.skipIf(!REDIS_URL)(`CHARGE — ${TENANTS} tenants x ${STUDENTS_PER_TENANT} élèves (échelle ${SCALE}), concurrence ${CONCURRENCY}`, () => {
  let p: LoadEnv;
  const worlds: TenantWorld[] = [];
  const results: ScenarioStats[] = [];
  const extras: Record<string, Extra> = {};
  const breaches: string[] = [];
  const sqlByScenario: Record<string, Array<Pick<SqlStat, "text" | "calls" | "totalMs" | "maxMs">>> = {};
  const allSql = new Map<string, SqlStat>();
  const notes: Record<string, unknown> = {};
  const startedAt = new Date().toISOString();

  /** Exécute un scénario avec mesure de la boucle d'événements, du CPU et des requêtes SQL ; applique erreurs 5xx et seuils. */
  async function scenario(name: string, opts: Omit<DriveOptions, "name">, { allowErrors = false }: { allowErrors?: boolean } = {}): Promise<ScenarioStats | null> {
    if (!wanted(name)) return null;
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    const cpu0 = process.cpuUsage();
    resetSqlStats();
    setSqlCapture(true);
    const stats = await drive({ ...opts, name });
    setSqlCapture(false);
    h.disable();
    const cpu = process.cpuUsage(cpu0);
    extras[name] = { loopP99Ms: Math.round(h.percentile(99) / 1e4) / 100, loopMaxMs: Math.round(h.max / 1e4) / 100, cpuMs: Math.round((cpu.user + cpu.system) / 1000), heapMb: Math.round(process.memoryUsage().heapUsed / 1048576) };
    const top = sqlTop("total", 6);
    sqlByScenario[name] = top.map((s) => ({ text: s.text.slice(0, 700), calls: s.calls, totalMs: Math.round(s.totalMs), maxMs: Math.round(s.maxMs) }));
    for (const s of sqlTop("total", 200)) {
      const g = allSql.get(s.key);
      if (!g) allSql.set(s.key, { ...s });
      else {
        g.calls += s.calls;
        g.totalMs += s.totalMs;
        if (s.maxMs >= g.maxMs) {
          g.maxMs = s.maxMs;
          g.slowestValues = s.slowestValues;
        }
      }
    }
    results.push(stats);
    const th = THRESHOLDS[name];
    if (th && stats.p95 > th.p95 * THRESHOLD_FACTOR) breaches.push(`${name} : p95 ${stats.p95} ms > seuil ${Math.round(th.p95 * THRESHOLD_FACTOR)} ms`);
    log(`${name.padEnd(30)} n=${String(stats.count).padStart(5)} err=${stats.errors} p50=${stats.p50} p95=${stats.p95} p99=${stats.p99} max=${stats.max} ${stats.rps} req/s  (boucle p99 ${extras[name]!.loopP99Ms} ms, cpu ${extras[name]!.cpuMs} ms)`);
    if (!allowErrors) expect(stats.errors, `${name} : ${stats.samples.join(" | ")}`).toBe(0);
    return stats;
  }

  beforeAll(async () => {
    log(`démarrage : scrypt logN=${SCRYPT_LOG_N}, rendu PDF ${REAL_PDF ? "réel (Chrome)" : "déterministe"}, seuils ${ENFORCE ? "BLOQUANTS" : "indicatifs"}`);
    p = await startLoadPlatform();
  }, 600_000);

  afterAll(async () => {
    await p?.stop();
  });

  // ===========================================================================================================
  describe("(0) génération du jeu de données (écritures mesurées)", () => {
    it(`${TENANTS} tenants, ${STUDENTS_PER_TENANT} élèves chacun (classes de ${CLASS_SIZE}), inscriptions, factures, notes publiées, parents`, async () => {
      const t0 = performance.now();
      for (let i = 0; i < TENANTS; i += 1) {
        const ts = performance.now();
        const w = await seedTenant(p, i, PASSWORD);
        worlds.push(w);
        for (const s of w.seedStats) {
          results.push({ ...s, name: `${s.name}[t${i + 1}]` });
          log(`${s.name}[t${i + 1}] n=${s.count} p50=${s.p50} p95=${s.p95} p99=${s.p99} ${s.rps} req/s`);
        }
        log(`tenant ${i + 1} généré en ${Math.round((performance.now() - ts) / 1000)} s`);
      }
      notes.seedSeconds = Math.round((performance.now() - t0) / 1000);
      const counts = await p.db.admin.query(
        `SELECT (SELECT count(*) FROM people.students)::int AS students, (SELECT count(*) FROM academic.enrollments)::int AS enrollments, (SELECT count(*) FROM finance.invoices)::int AS invoices, (SELECT count(*) FROM assess.grades)::int AS grades`,
      );
      notes.dataset = counts.rows[0];
      log("jeu de données :", JSON.stringify(counts.rows[0]), `en ${notes.seedSeconds} s`);
      const sv = await p.db.admin.query("SHOW server_version");
      notes.postgres = sv.rows[0].server_version;
      expect(counts.rows[0].students).toBe(TENANTS * STUDENTS_PER_TENANT);
    });
  });

  // ===========================================================================================================
  describe("(1) IAM : connexion et refresh (limiteur d'IP de production CONSERVÉ)", () => {
    it("connexions (scrypt de production) : comptes enseignant et parents ; les 429 du limiteur sont comptés à part", async () => {
      const accounts = worlds.flatMap((w) => [{ email: `prof@charge${w.index + 1}.test`, slug: w.T.slug }, ...w.parents.map((pa) => ({ email: pa.email, slug: w.T.slug }))]);
      await resetIpLimiters(["login:ip"]);
      const total = Math.min(160, READS);
      await scenario("iam.login", {
        what: "POST /iam/login (mot de passe, sans MFA)",
        concurrency: CONCURRENCY,
        total,
        limitedStatuses: [429],
        op: async (i) => {
          const a = pick(accounts, i);
          const r = await p.http("POST", "/api/v1/iam/login", { body: { email: a.email, password: PASSWORD, tenantSlug: a.slug, client: "mobile" } });
          return res(r);
        },
      });
    });

    it("refresh en chaîne (jeton tournant) : 4 sessions, au plus 100 appels (limite de production : 120/min/IP)", async () => {
      const w = worlds[0]!;
      const login = async (email: string): Promise<{ refreshToken: string }> => {
        const r = await p.http("POST", "/api/v1/iam/login", { body: { email, password: PASSWORD, tenantSlug: w.T.slug, client: "mobile" } });
        expectStatus(r, 200);
        return { refreshToken: (r.body.refreshToken ?? r.body.session?.refreshToken) as string };
      };
      const sessions = [await login(w.parents[0]!.email), await login(w.parents[1]!.email), await login(`prof@charge1.test`), await login(w.parents[2]!.email)];
      expect(sessions.every((s) => typeof s.refreshToken === "string" && s.refreshToken.length > 10)).toBe(true);
      await scenario("iam.refresh", {
        what: "POST /iam/refresh (rotation du jeton)",
        concurrency: 4,
        total: 100,
        limitedStatuses: [429],
        op: async (_i, w2) => {
          const s = sessions[w2]!;
          const r = await p.http("POST", "/api/v1/iam/refresh", { body: { refreshToken: s.refreshToken, client: "mobile" } });
          if (r.status === 200 && r.body.refreshToken) s.refreshToken = r.body.refreshToken as string;
          return res(r);
        },
      });
    });
  });

  // ===========================================================================================================
  describe("(2) listes paginées (élèves, factures) et rapport financier", () => {
    it("élèves : page courante, page profonde, recherche textuelle", async () => {
      await scenario("people.students.list", {
        what: "GET /people/students?limit=50&offset=<aléatoire>",
        concurrency: CONCURRENCY,
        total: READS,
        op: async (i) => {
          const w = pick(worlds, i);
          return res(await w.owner.raw("GET", `/api/v1/people/students?limit=50&offset=${rnd(Math.max(1, STUDENTS_PER_TENANT - 50))}`));
        },
      });
      await scenario("people.students.list.deep", {
        what: "GET /people/students — dernière page",
        concurrency: CONCURRENCY,
        total: READS,
        op: async (i) => res(await pick(worlds, i).owner.raw("GET", `/api/v1/people/students?limit=50&offset=${Math.max(0, STUDENTS_PER_TENANT - 50)}`)),
      });
      const first = await worlds[0]!.owner.get("/api/v1/people/students?limit=50&offset=0");
      const names = (first.body.items as unknown[]).map((it) => findField(it, "lastName")).filter((s): s is string => Boolean(s));
      expect(names.length).toBeGreaterThan(0);
      await scenario("people.students.search", {
        what: "GET /people/students?q=<préfixe de nom>",
        concurrency: CONCURRENCY,
        total: READS,
        op: async (i) => res(await worlds[0]!.owner.raw("GET", `/api/v1/people/students?limit=50&q=${encodeURIComponent(pick(names, i).slice(0, 4))}`)),
      });
    });

    it("factures : liste (statut ISSUED), détail, relevé d'un apprenant ; rapport de synthèse", async () => {
      await scenario("finance.invoices.list", {
        what: "GET /finance/invoices?status=ISSUED&limit=50&offset=<aléatoire>",
        concurrency: CONCURRENCY,
        total: READS,
        op: async (i) => res(await pick(worlds, i).owner.raw("GET", `/api/v1/finance/invoices?status=ISSUED&limit=50&offset=${rnd(Math.max(1, STUDENTS_PER_TENANT - 50))}`)),
      });
      await scenario("finance.invoice.detail", {
        what: "GET /finance/invoices/:id",
        concurrency: CONCURRENCY,
        total: READS,
        op: async (i) => {
          const w = pick(worlds, i);
          const sid = pick(w.studentIds, rnd(w.studentIds.length));
          return res(await w.owner.raw("GET", `/api/v1/finance/invoices/${w.invoiceByStudent.get(sid)}`));
        },
      });
      await scenario("finance.statement", {
        what: "GET /finance/learners/:id/statement",
        concurrency: CONCURRENCY,
        total: Math.min(READS, 200),
        op: async (i) => {
          const w = pick(worlds, i);
          return res(await w.owner.raw("GET", `/api/v1/finance/learners/${pick(w.studentIds, rnd(w.studentIds.length))}/statement`));
        },
      });
      await scenario("finance.reports.summary", {
        what: "GET /finance/reports/summary (agrégation du tenant)",
        concurrency: 4,
        total: Math.min(READS, 80),
        op: async (i) => res(await pick(worlds, i).owner.raw("GET", "/api/v1/finance/reports/summary")),
      });
    });
  });

  // ===========================================================================================================
  describe("(3) saisie de notes en lot et appel", () => {
    it("saisie en lot : PUT /assess/assessments/:id/grades (une classe entière par appel)", async () => {
      const versions = new Map<string, number>();
      const jobs = worlds.flatMap((w) => w.classes.flatMap((c) => c.draftAssessments.map((d) => ({ w, c, d }))));
      await scenario("assess.grades.batch", {
        what: `PUT /assess/assessments/:id/grades (${CLASS_SIZE} notes par appel, enseignant affecté)`,
        concurrency: CONCURRENCY,
        total: jobs.length,
        op: async (i) => {
          const { w, c, d } = jobs[i]!;
          const entries = c.enrollmentIds.map((enrollmentId, k) => ({ enrollmentId, score: String(5 + ((k * 3 + i) % 14)) }));
          const r = await w.teacher.raw("PUT", `/api/v1/assess/assessments/${d.id}/grades`, { entries });
          if (r.status === 200) for (const g of r.body.grades as Array<{ enrollmentId: string; rowVersion: number }>) versions.set(`${d.id}:${g.enrollmentId}`, g.rowVersion);
          return res(r);
        },
      });
      // second passage : correction de notes sur les mêmes évaluations (chemin « mise à jour » + révisions)
      await scenario("assess.grades.rewrite", {
        what: "PUT /assess/assessments/:id/grades — correction des mêmes notes (brouillon)",
        concurrency: CONCURRENCY,
        total: jobs.length,
        op: async (i) => {
          const { w, c, d } = jobs[i]!;
          const entries = c.enrollmentIds.map((enrollmentId, k) => ({ enrollmentId, score: String(6 + ((k * 5 + i) % 13)), rowVersion: versions.get(`${d.id}:${enrollmentId}`) ?? 1 }));
          return res(await w.teacher.raw("PUT", `/api/v1/assess/assessments/${d.id}/grades`, { entries }));
        },
      });
    });

    it("appel : ouverture de séance + pointage de la classe + soumission", async () => {
      const days = 3;
      const jobs = worlds.flatMap((w) => w.classes.flatMap((c) => Array.from({ length: days }, (_, k) => ({ w, c, date: addDays(w.yearStart, 14 + k) }))));
      await scenario("attendance.call", {
        what: `POST /attendance/sessions + PUT .../records (${CLASS_SIZE} élèves) + POST .../submit`,
        concurrency: CONCURRENCY,
        total: jobs.length,
        op: async (i) => {
          const { w, c, date } = jobs[i]!;
          let opened = await w.owner.raw("POST", "/api/v1/attendance/sessions", { scope: "DAILY", classroomId: c.id, date });
          if (opened.status === 409 || opened.status === 422) {
            opened = await w.owner.raw("POST", "/api/v1/attendance/sessions", { scope: "SESSION", classroomId: c.id, date, curriculumNodeId: w.nodeBySubject.MATHS!.nodeId, source: "LIVE_CLASS", durationMinutes: 60 });
          }
          if (opened.status >= 300) return res(opened);
          const sid = opened.body.session.id as string;
          const entries = c.studentIds.map((studentId, k) => ({ studentId, statusCode: k % 11 === 0 ? "ABSENT" : k % 7 === 0 ? "LATE" : "PRESENT", ...(k % 7 === 0 && k % 11 !== 0 ? { minutesLate: 5 } : {}) }));
          const marked = await w.owner.raw("PUT", `/api/v1/attendance/sessions/${sid}/records`, { entries });
          if (marked.status >= 300) return res(marked);
          return res(await w.owner.raw("POST", `/api/v1/attendance/sessions/${sid}/submit`, {}));
        },
      });
    });
  });

  // ===========================================================================================================
  describe("(5) paiements : initiation en ligne (sandbox), webhook signé, rejeu concurrent, virements", () => {
    const pending: Array<{ w: TenantWorld; studentId: string; paymentId: string; providerRef: string }> = [];
    const sign = (raw: string): string => createHmac("sha256", DEFAULT_SANDBOX_SECRET).update(raw, "utf8").digest("hex");

    it("initiation de paiements en ligne (état « en attente »)", async () => {
      const per = Math.max(5, Math.floor(STUDENTS_PER_TENANT * 0.4));
      const jobs = worlds.flatMap((w) => w.studentIds.slice(-per).map((studentId) => ({ w, studentId })));
      await scenario("finance.payment.online", {
        what: "POST /finance/payments/online (sandbox, en attente)",
        concurrency: CONCURRENCY,
        total: jobs.length,
        op: async (i) => {
          const { w, studentId } = jobs[i]!;
          const r = await w.owner.raw(
            "POST",
            "/api/v1/finance/payments/online",
            { learnerId: studentId, enrollmentId: w.enrollmentByStudent.get(studentId), amount: 500000, provider: "sandbox", invoiceId: w.invoiceByStudent.get(studentId), metadata: { sandbox: "pending" } },
            { "idempotency-key": `ld-online-${w.index}-${studentId}` },
          );
          if (r.status === 201) pending.push({ w, studentId, paymentId: r.body.payment.id as string, providerRef: r.body.payment.providerRef as string });
          return res(r);
        },
      });
    });

    it("webhooks signés (1 par paiement), puis rejeu concurrent des mêmes événements : un paiement, un reçu", async () => {
      if (!wanted("finance.webhook")) return;
      const evt = (x: (typeof pending)[number]): string => JSON.stringify({ id: `evt-ld-${x.paymentId}`, type: "payment.succeeded", reference: x.paymentId, transaction: x.providerRef, amount: 500000, currency: "XOF", occurred_at: new Date().toISOString() });
      await scenario("finance.webhook", {
        what: "POST /finance/webhooks/sandbox/:tenant (public, signature HMAC) -> paiement confirmé, reçu, facture soldée",
        concurrency: CONCURRENCY,
        total: pending.length,
        op: async (i) => {
          const x = pending[i]!;
          const raw = evt(x);
          const r = await p.http("POST", `/api/v1/finance/webhooks/sandbox/${x.w.T.tenantId}`, { rawBody: raw, headers: { "x-sandbox-signature": sign(raw) } });
          if (r.status === 200 && r.body.replayed !== false) return { status: 500, note: "premier webhook marqué rejoué" };
          return res(r);
        },
      });
      const replays = Math.min(pending.length, 60);
      await scenario("finance.webhook.replay", {
        what: "mêmes webhooks rejoués en rafale (idempotence sous concurrence)",
        concurrency: CONCURRENCY * 2,
        total: replays * 3,
        op: async (i) => {
          const x = pending[i % replays]!;
          const raw = evt(x);
          const r = await p.http("POST", `/api/v1/finance/webhooks/sandbox/${x.w.T.tenantId}`, { rawBody: raw, headers: { "x-sandbox-signature": sign(raw) } });
          if (r.status === 200 && r.body.replayed !== true) return { status: 500, note: "rejeu non reconnu" };
          return res(r);
        },
      });
      const r = await p.db.admin.query("SELECT count(*)::int AS n, count(DISTINCT payment_id)::int AS d FROM finance.receipts");
      expect(r.rows[0].n, "un seul reçu par paiement").toBe(r.rows[0].d);
      const paid = await p.db.admin.query("SELECT count(*)::int AS n FROM finance.invoices WHERE status = 'PAID'");
      expect(paid.rows[0].n).toBeGreaterThanOrEqual(pending.length);
    });

    it("virements enregistrés par le secrétariat (affectation automatique)", async () => {
      const per = Math.max(5, Math.floor(STUDENTS_PER_TENANT * 0.3));
      const jobs = worlds.flatMap((w) => w.studentIds.slice(0, per).map((studentId) => ({ w, studentId })));
      await scenario("finance.payment.manual", {
        what: "POST /finance/payments (TRANSFER, allocation AUTO)",
        concurrency: CONCURRENCY,
        total: jobs.length,
        op: async (i) => {
          const { w, studentId } = jobs[i]!;
          return res(
            await w.owner.raw(
              "POST",
              "/api/v1/finance/payments",
              { learnerId: studentId, enrollmentId: w.enrollmentByStudent.get(studentId), amount: 250000, method: "TRANSFER", reference: `VIR-LD-${w.index}-${i}`, allocation: { mode: "AUTO", invoiceIds: [w.invoiceByStudent.get(studentId)] } },
              { "idempotency-key": `ld-vir-${w.index}-${i}` },
            ),
          );
        },
      });
    });
  });

  // ===========================================================================================================
  describe("(7) multi-tenant : absence de fuite sous concurrence, dégradation entre tenants (voisin bruyant)", () => {
    it("charge mixte simultanée des tenants : chaque réponse ne contient que des identifiants du tenant, les sondes croisées échouent TOUTES", async () => {
      const sets = worlds.map((w) => ({ students: new Set(w.studentIds), invoices: new Set([...w.invoiceByStudent.values()]), enrollments: new Set([...w.enrollmentByStudent.values()]) }));
      let leaks = 0;
      let crossOk = 0;
      let crossProbes = 0;
      const leakKinds: Record<string, number> = {};
      await scenario("isolation.mixed", {
        what: "lectures simultanées des 3 tenants + sondes croisées (jeton du tenant A, ressource du tenant B)",
        concurrency: CONCURRENCY * 2,
        total: READS * 2,
        op: async (i) => {
          const a = i % worlds.length;
          const w = worlds[a]!;
          const kind = rnd(5);
          if (kind === 0) {
            const r = await w.owner.raw("GET", `/api/v1/people/students?limit=50&offset=${rnd(Math.max(1, STUDENTS_PER_TENANT - 50))}`);
            if (r.status === 200) for (const it of r.body.items as Array<{ id: string }>) if (!sets[a]!.students.has(it.id)) { leaks += 1; leakKinds["list:students"] = (leakKinds["list:students"] ?? 0) + 1; }
            return res(r);
          }
          if (kind === 1) {
            const r = await w.owner.raw("GET", `/api/v1/finance/invoices?limit=50&offset=${rnd(Math.max(1, STUDENTS_PER_TENANT - 50))}`);
            if (r.status === 200) for (const it of r.body.items as Array<{ id: string }>) if (!sets[a]!.invoices.has(it.id)) { leaks += 1; leakKinds["list:invoices"] = (leakKinds["list:invoices"] ?? 0) + 1; }
            return res(r);
          }
          if (kind === 2) {
            const r = await w.owner.raw("GET", `/api/v1/academic/enrollments?limit=50&offset=${rnd(Math.max(1, STUDENTS_PER_TENANT - 50))}`);
            if (r.status === 200) for (const it of ((r.body.items ?? []) as Array<{ id: string }>)) if (!sets[a]!.enrollments.has(it.id)) { leaks += 1; leakKinds["list:enrollments"] = (leakKinds["list:enrollments"] ?? 0) + 1; }
            return res(r);
          }
          // sondes croisées : ressource d'un AUTRE tenant avec le jeton de ce tenant -> 403/404 attendu, jamais 200
          const b = (a + 1 + rnd(worlds.length - 1)) % worlds.length;
          const other = worlds[b]!;
          const sid = pick(other.studentIds, rnd(other.studentIds.length));
          const urls = [`/api/v1/people/students/${sid}`, `/api/v1/finance/invoices/${other.invoiceByStudent.get(sid)}`, `/api/v1/academic/enrollments/${other.enrollmentByStudent.get(sid)}`, `/api/v1/finance/learners/${sid}/statement`];
          const url = pick(urls, rnd(urls.length));
          const r = await w.owner.raw("GET", url);
          crossProbes += 1;
          // 403/404 : refus. 200 n'est admis QUE pour le relevé d'un apprenant inconnu du tenant (vide) : jamais une donnée de l'autre tenant.
          const foreignData = r.status === 200 && (url.endsWith("/statement") ? JSON.stringify(r.body).includes(other.invoiceByStudent.get(sid) as string) : true);
          if (r.status === 403 || r.status === 404 || (r.status === 200 && !foreignData)) {
            crossOk += 1;
            return { status: 200 };
          }
          leaks += 1;
          leakKinds[url.replace(/[0-9a-f-]{36}/g, ":id")] = (leakKinds[url.replace(/[0-9a-f-]{36}/g, ":id")] ?? 0) + 1;
          return { status: 500, note: `sonde croisée : ${r.status}` };
        },
      }, { allowErrors: true });
      notes.isolation = { leaks, crossProbes, crossOk, leakKinds };
      expect(leaks, `aucune fuite inter-tenants (HTTP) : ${JSON.stringify(leakKinds)}`).toBe(0);
      expect(crossOk).toBe(crossProbes);
    });

    it("RLS sous concurrence (rôle applicatif, requêtes directes) : comptes exacts, aucune ligne d'un autre tenant, écriture croisée refusée", async () => {
      const tenantDb = p.app.v2.tenantDb;
      const ctxOf = (w: TenantWorld, n: number) => ({ tenantId: w.T.tenantId, userId: null, roles: [], requestId: `rls-${n}`, actor: "system", mfa: false }) as never;
      const tables = ["people.students", "academic.enrollments", "finance.invoices", "assess.grades"];
      const expected: Record<string, number[]> = {};
      for (const t of tables) {
        expected[t] = [];
        for (const w of worlds) expected[t]!.push((await p.db.admin.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [w.T.tenantId])).rows[0].n);
      }
      let bad = 0;
      const stats = await scenario("isolation.rls.direct", {
        what: "SELECT count(*) par tenant (rôle app_user + RLS) en rafale, et fuite = lignes hors tenant",
        concurrency: CONCURRENCY * 2,
        total: 240,
        op: async (i) => {
          const wi = i % worlds.length;
          const w = worlds[wi]!;
          const table = pick(tables, Math.floor(i / worlds.length));
          const row = await tenantDb.run(ctxOf(w, i), async (tx) => (await tx.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE tenant_id <> $1)::int AS foreign_rows FROM ${table}`, [w.T.tenantId])).rows[0] as { n: number; foreign_rows: number });
          if (row.foreign_rows !== 0 || row.n !== expected[table]![wi]) bad += 1;
          return { status: row.foreign_rows === 0 && row.n === expected[table]![wi] ? 200 : 500, note: `${table} n=${row.n} étranger=${row.foreign_rows}` };
        },
      }, { allowErrors: true });
      expect(bad, "aucune fuite RLS").toBe(0);
      // écriture croisée : modifier une ligne d'un autre tenant touche 0 ligne (USING), insérer pour un autre tenant échoue (WITH CHECK)
      const a = worlds[0]!;
      const b = worlds[1]!;
      const upd = await tenantDb.run(ctxOf(a, 9001), async (tx) => (await tx.query("UPDATE people.students SET status = status WHERE tenant_id = $1", [b.T.tenantId])).rowCount);
      expect(upd).toBe(0);
      await expect(
        tenantDb.run(ctxOf(a, 9002), (tx) => tx.query("INSERT INTO people.persons (id, tenant_id, last_name, first_name, sex) VALUES (gen_random_uuid(), $1, 'X', 'Y', 'M')", [b.T.tenantId])),
      ).rejects.toThrow();
      notes.rls = { checks: stats?.count ?? 0, violations: bad };
    });

    it("voisin bruyant : p95 d'un tenant CALME seul, puis pendant qu'un voisin sature l'API (concurrence x6, écritures et recherches)", async () => {
      if (!wanted("noisy")) return;
      const victim = worlds[1]!;
      const aggressor = worlds[0]!;
      const victimOp = async (i: number): Promise<OpResult> => {
        const k = i % 3;
        if (k === 0) return res(await victim.owner.raw("GET", `/api/v1/people/students?limit=50&offset=${rnd(Math.max(1, STUDENTS_PER_TENANT - 50))}`));
        if (k === 1) return res(await victim.owner.raw("GET", `/api/v1/finance/invoices?status=ISSUED&limit=50&offset=${rnd(Math.max(1, STUDENTS_PER_TENANT - 50))}`));
        const pa = pick(victim.parents, i);
        return res(await pa.actor.raw("GET", `/api/v1/finance/me/learners/${pa.studentIds[0]}/invoices`));
      };
      const victimTotal = Math.max(150, READS);
      const alone = await scenario("noisy.victim.alone", { what: "tenant calme seul", concurrency: 2, total: victimTotal, op: victimOp });

      const stopAt = { done: false };
      const noise = drive({
        name: "noisy.aggressor",
        what: "voisin bruyant",
        concurrency: CONCURRENCY * 3,
        durationMs: 10 * 60_000,
        stop: () => stopAt.done,
        op: async (i) => {
          const k = i % 4;
          if (k === 0) {
            const n = 900_000 + i;
            return res(await aggressor.owner.raw("POST", "/api/v1/people/students", { person: { lastName: `BRUIT${n.toString(36).toUpperCase()}`, firstName: `Voisin${(n * 7).toString(36)}`, sex: "M", birthDate: "2010-05-05" }, acknowledgeDuplicate: true, duplicateReason: "Voisin bruyant (charge)." }));
          }
          if (k === 1) return res(await aggressor.owner.raw("GET", `/api/v1/people/students?limit=200&offset=${rnd(Math.max(1, STUDENTS_PER_TENANT - 200))}`));
          if (k === 2) return res(await aggressor.owner.raw("GET", "/api/v1/finance/reports/summary"));
          return res(await aggressor.owner.raw("GET", `/api/v1/finance/invoices?limit=200&offset=${rnd(Math.max(1, STUDENTS_PER_TENANT - 200))}`));
        },
      });
      await new Promise((r) => setTimeout(r, 1500)); // le voisin atteint son régime
      const loud = await scenario("noisy.victim.loud", { what: "tenant calme PENDANT la saturation du voisin", concurrency: 2, total: victimTotal, op: victimOp });
      stopAt.done = true;
      // arrêt du voisin : on épuise son drive par un drapeau (op lent), puis on n'attend pas la fin de la durée maximale
      const noiseStats = await noise;
      results.push(noiseStats);
      log(`voisin : ${noiseStats.count} requêtes, ${noiseStats.errors} erreurs, ${noiseStats.rps} req/s`);
      if (alone && loud) {
        const ratio = Math.round((loud.p95 / Math.max(1, alone.p95)) * 100) / 100;
        notes.noisyNeighbour = { aloneP95: alone.p95, loudP95: loud.p95, ratioP95: ratio, aloneP50: alone.p50, loudP50: loud.p50, victimErrorsLoud: loud.errors, maxRatioProposed: NOISY_NEIGHBOUR_MAX_RATIO };
        log(`voisin bruyant : p95 ${alone.p95} -> ${loud.p95} ms (x${ratio}), p50 ${alone.p50} -> ${loud.p50} ms`);
        if (ratio > NOISY_NEIGHBOUR_MAX_RATIO) breaches.push(`voisin bruyant : p95 x${ratio} > x${NOISY_NEIGHBOUR_MAX_RATIO}`);
      }
    });
  });

  // ===========================================================================================================
  describe("(4) résultats d'une période et bulletins (worker)", () => {
    it("clôture du semestre : verrouillage puis calcul par le jeu de règles (une classe par appel, tenants en parallèle)", async () => {
      for (const w of worlds) await w.owner.put("/api/v1/results/settings", { requireDeliberation: false });
      const jobs = worlds.flatMap((w) => w.classes.map((c) => ({ w, c })));
      await scenario("results.close", {
        what: `POST /results/classrooms/:id/periods/:pid/lock + close (${CLASS_SIZE} élèves x ${SUBJECTS.length} matières, règles de démonstration)`,
        concurrency: Math.min(TENANTS, 3),
        total: jobs.length,
        op: async (i) => {
          const { w, c } = jobs[i]!;
          const base = `/api/v1/results/classrooms/${c.id}/periods/${w.periodIds[0]}`;
          const locked = await w.directeur.raw("POST", `${base}/lock`, { force: true, reason: "Charge : évaluations en brouillon conservées pour les autres scénarios." });
          if (locked.status >= 300) return res(locked);
          const closed = await w.directeur.raw("POST", `${base}/close`, {});
          if (closed.status < 300 && closed.body?.resultsCount !== c.studentIds.length) return { status: 500, note: `resultsCount ${closed.body?.resultsCount} ≠ ${c.studentIds.length}` };
          return res(closed);
        },
      });
      const n = await p.db.admin.query("SELECT count(*)::int AS n FROM results.period_results WHERE scope = 'PERIOD' AND status = 'FINAL'");
      notes.finalPeriodResults = n.rows[0].n;
    });

    it("bulletins : lot par classe (file BullMQ + worker), durée de bout en bout jusqu'à COMPLETED", async () => {
      if (!wanted("reportcards")) return;
      for (const w of worlds) {
        await w.owner.put("/api/v1/reportcards/branding", { legalName: `Collège Charge ${w.index + 1}`, headerLeft: ["République de Côte d'Ivoire (démonstration)"], address: "Abidjan", primaryColor: "#14532D" });
        const sig = await w.owner.post("/api/v1/reportcards/signatories", { fullName: "Directeur Fictif", title: "Chef d'établissement", jobFunction: "Direction" }, 201);
        const templates = await w.owner.get("/api/v1/reportcards/templates");
        const slots = ((templates.body.items ?? templates.body) as Array<{ key: string; signatureSlots?: Array<{ key?: string; slot?: string }> }>).find((t) => t.key === "secondary-bulletin")?.signatureSlots ?? [];
        await w.owner.put("/api/v1/reportcards/template-configs", {
          documentKind: "REPORT_CARD",
          pack: "SECONDARY",
          templateKey: "secondary-bulletin",
          options: {},
          signatureAssignments: slots.slice(0, 1).map((s) => ({ slot: s.key ?? s.slot, signatoryId: sig.body.id })),
        });
      }
      const jobs = worlds.flatMap((w) => w.classes.map((c) => ({ w, c })));
      await scenario("reportcards.batch.e2e", {
        what: `POST /reportcards/batches puis attente de COMPLETED (${CLASS_SIZE} bulletins par lot, rendu ${REAL_PDF ? "Chrome" : "déterministe"})`,
        concurrency: Math.min(TENANTS, 3),
        total: jobs.length,
        op: async (i) => {
          const { w, c } = jobs[i]!;
          const created = await w.owner.raw("POST", "/api/v1/reportcards/batches", { classroomId: c.id, academicPeriodId: w.periodIds[0], idempotencyKey: `ld-bulletins-${w.index}-${c.code}` });
          if (created.status >= 300) return res(created);
          const id = (created.body.batch ?? created.body).id as string;
          const done = await waitFor(
            async () => {
              const r = await w.owner.get(`/api/v1/reportcards/batches/${id}`);
              const st = (r.body.batch ?? r.body).status as string;
              return ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"].includes(st) ? { st, b: r.body.batch ?? r.body } : false;
            },
            { label: `lot ${c.code}`, timeoutMs: 600_000, intervalMs: 150 },
          );
          if (done.st !== "COMPLETED") return { status: 500, note: `lot ${done.st} : ${JSON.stringify(done.b).slice(0, 200)}` };
          return { status: 200 };
        },
      });
    });
  });

  // ===========================================================================================================
  describe("(6) portail parent (lecture)", () => {
    it("un parent consulte ses enfants : liste, factures, présences, résultats, bulletins", async () => {
      const parents = worlds.flatMap((w) => w.parents.map((pa) => ({ w, pa })));
      const endpoints = (sid: string): string[] => [
        "/api/v1/people/children",
        "/api/v1/finance/me/learners",
        `/api/v1/finance/me/learners/${sid}/invoices`,
        `/api/v1/attendance/children/${sid}/attendance`,
        `/api/v1/results/children/${sid}/results`,
        `/api/v1/reportcards/children/${sid}/report-cards`,
      ];
      // sonde unique : chaque route doit répondre 2xx pour le parent, sinon le scénario mesurerait des erreurs
      for (const { pa } of parents.slice(0, 1)) for (const url of endpoints(pa.studentIds[0]!)) expectStatus(await pa.actor.raw("GET", url), 200);
      await scenario("portal.parent.mix", {
        what: "6 routes de lecture du portail parent (aléatoires)",
        concurrency: CONCURRENCY,
        total: READS * 2,
        op: async (i) => {
          const { pa } = pick(parents, i);
          const url = pick(endpoints(pick(pa.studentIds, rnd(2))), rnd(6));
          return res(await pa.actor.raw("GET", url));
        },
      });
    });
  });

  // ===========================================================================================================
  describe("(8) analyse : requêtes SQL les plus coûteuses (EXPLAIN ANALYZE) et rapport", () => {
    it("EXPLAIN (ANALYZE, BUFFERS) des 3 requêtes de lecture les plus coûteuses (temps cumulé), écriture du rapport", async () => {
      setSqlCapture(false);
      const candidates = [...allSql.values()]
        .filter((s) => /^\s*(SELECT|WITH)\b/i.test(s.text) && !/set_config|pg_advisory|current_setting\(\s*'app\./i.test(s.text) && s.calls >= 5)
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, 8);
      const explains: Array<{ text: string; calls: number; totalMs: number; meanMs: number; maxMs: number; plan: string }> = [];
      for (const s of candidates) {
        if (explains.length >= 3) break;
        const w = worlds.find((x) => JSON.stringify(s.slowestValues).includes(x.T.tenantId)) ?? worlds[0]!;
        try {
          const plan = await p.app.v2.tenantDb.run({ tenantId: w.T.tenantId, userId: null, roles: [], requestId: "explain", actor: "system", mfa: false } as never, async (tx) => {
            const r = await tx.query(`EXPLAIN (ANALYZE, BUFFERS) ${s.text}`, s.slowestValues as unknown[]);
            return (r.rows as Array<Record<string, string>>).map((row) => row["QUERY PLAN"]).join("\n");
          });
          explains.push({ text: s.text, calls: s.calls, totalMs: Math.round(s.totalMs), meanMs: Math.round((s.totalMs / s.calls) * 100) / 100, maxMs: Math.round(s.maxMs), plan });
        } catch (e) {
          log(`EXPLAIN impossible (${(e as Error).message}) pour ${s.text.slice(0, 80)}`);
        }
      }
      notes.explains = explains;
      const slowest = [...allSql.values()].filter((s) => s.calls >= 5).sort((a, b) => b.totalMs / b.calls - a.totalMs / a.calls).slice(0, 8).map((s) => ({ text: s.text.slice(0, 600), calls: s.calls, meanMs: Math.round((s.totalMs / s.calls) * 100) / 100, maxMs: Math.round(s.maxMs) }));
      notes.slowestByMean = slowest;
      // index existants : tables les plus lues séquentiellement (statistiques Postgres)
      const seq = await p.db.admin.query(
        `SELECT schemaname || '.' || relname AS tbl, seq_scan::bigint AS seq_scan, seq_tup_read::bigint AS seq_tup_read, coalesce(idx_scan, 0)::bigint AS idx_scan, n_live_tup::bigint AS rows
         FROM pg_stat_user_tables WHERE seq_scan > 50 AND n_live_tup > 200 ORDER BY seq_tup_read DESC LIMIT 12`,
      );
      notes.seqScans = seq.rows;
      const dir = join(here, "results");
      mkdirSync(dir, { recursive: true });
      const meta = {
        startedAt,
        finishedAt: new Date().toISOString(),
        scale: SCALE,
        tenants: TENANTS,
        studentsPerTenant: STUDENTS_PER_TENANT,
        classSize: CLASS_SIZE,
        concurrency: CONCURRENCY,
        scryptLogN: SCRYPT_LOG_N,
        pdf: p.realPdf ? "chrome" : "deterministe",
        node: process.version,
        platform: process.platform,
        cpus: `${cpus().length} x ${cpus()[0]?.model ?? "?"}`,
        memGb: Math.round(totalmem() / 1073741824),
        enforce: ENFORCE,
      };
      writeFileSync(join(dir, "latest.json"), JSON.stringify({ meta, notes, results, extras, sqlByScenario, breaches }, null, 2));
      writeFileSync(join(dir, "latest.md"), `${toMarkdown(results)}\n\nDépassements de seuils (proposés) : ${breaches.length ? `\n- ${breaches.join("\n- ")}` : "aucun"}\n`);
      log(`rapport : ${join(dir, "latest.json")}`);
      if (ENFORCE) expect(breaches, "seuils de latence dépassés (ED_LOAD_ENFORCE=1)").toEqual([]);
      else if (breaches.length) log("[BREACH]", breaches.join(" ; "));
    });
  });
});

