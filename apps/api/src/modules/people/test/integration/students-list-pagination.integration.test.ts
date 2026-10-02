/**
 * Liste d'élèves : « paginer d'abord, joindre ensuite ». Prouve, sur données synthétiques (Postgres réel), que la requête
 * réécrite renvoie EXACTEMENT les mêmes lignes, dans le même ordre, avec le même total que la requête historique
 * (LATERAL évalué avant LIMIT), pour les filtres usuels, et que la RLS isole toujours les tenants.
 *
 * Mesure facultative (EXPLAIN ANALYZE avant / après) : `PEOPLE_PERF_EXPLAIN=1 PEOPLE_PERF_N=20000`.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { listStudentRows, buildStudentListQuery, buildStudentWhere, type StudentListFilter } from "../../infrastructure/students-repo";
import { STUDENT_COLUMNS, STUDENT_FROM } from "../../infrastructure/students-repo";
import { createPeopleTestDb, ctxFor, describeIntegration, type PeopleTestDb } from "../support/db";
import type { Tx } from "@ecoledigitale/database";

const N = Number(process.env.PEOPLE_PERF_N ?? 1500);
const EXPLAIN = process.env.PEOPLE_PERF_EXPLAIN === "1";

/** Requête HISTORIQUE (avant réécriture), conservée ici comme référence de comportement. */
function legacyListQuery(tenantId: string, f: StudentListFilter): { sql: string; params: unknown[] } {
  const w = buildStudentWhere(tenantId, f);
  const limit = w.bind(f.limit);
  const offset = w.bind(f.offset);
  return {
    sql: `SELECT ${STUDENT_COLUMNS}, count(*) OVER() AS total ${STUDENT_FROM}
      WHERE s.tenant_id = $1${w.sql}
      ORDER BY lower(p.last_name), lower(p.first_name), s.id
      LIMIT ${limit} OFFSET ${offset}`,
    params: w.params,
  };
}

describeIntegration("liste d'élèves paginée d'abord (Postgres réel, données synthétiques)", () => {
  let db: PeopleTestDb;
  let a: string;
  let b: string;
  const Y1 = "aaaaaaaa-0000-4000-8000-000000000001";
  const Y0 = "aaaaaaaa-0000-4000-8000-000000000000";
  const INST = "bbbbbbbb-0000-4000-8000-000000000001";

  async function seed(tenant: string, n: number): Promise<void> {
    await db.admin.query(
      `INSERT INTO people.persons (id, tenant_id, last_name, first_name, sex, identity_id)
       SELECT md5($1 || ':p:' || i)::uuid, $1::uuid, 'Nom' || ((i * 7919) % 200), 'Pre' || ((i * 104729) % 300), 'M',
              CASE WHEN i % 10 = 0 THEN md5($1 || ':i:' || i)::uuid END
         FROM generate_series(1, $2::int) i`,
      [tenant, n],
    );
    await db.admin.query(
      `INSERT INTO people.students (id, tenant_id, person_id, student_number, sequence_number, status)
       SELECT md5($1 || ':s:' || i)::uuid, $1::uuid, md5($1 || ':p:' || i)::uuid, 'M' || i, i,
              CASE WHEN i % 50 = 0 THEN 'ARCHIVED' WHEN i % 7 = 0 THEN 'INACTIVE' ELSE 'ACTIVE' END
         FROM generate_series(1, $2::int) i`,
      [tenant, n],
    );
    // Inscription courante pour 5 élèves sur 6 ; une inscription plus ancienne pour 1 sur 5 ; une PENDING plus récente pour 1 sur 11.
    await db.admin.query(
      `INSERT INTO people.student_enrollment_summaries
         (tenant_id, enrollment_id, student_id, academic_year_id, institution_id, classroom_id, classroom_name, status, enrolled_on, source_event_id, registration_number)
       SELECT $1::uuid, md5($1 || ':e:' || i)::uuid, md5($1 || ':s:' || i)::uuid, $3::uuid, $4::uuid, md5($1 || ':c:' || (i % 40))::uuid, 'Classe ' || (i % 40), 'ACTIVE',
              DATE '2025-09-01', md5($1 || ':se:' || i)::uuid, 'R' || i
         FROM generate_series(1, $2::int) i WHERE i % 6 <> 0`,
      [tenant, n, Y1, INST],
    );
    await db.admin.query(
      `INSERT INTO people.student_enrollment_summaries
         (tenant_id, enrollment_id, student_id, academic_year_id, institution_id, classroom_id, classroom_name, status, enrolled_on, source_event_id)
       SELECT $1::uuid, md5($1 || ':e0:' || i)::uuid, md5($1 || ':s:' || i)::uuid, $3::uuid, $4::uuid, md5($1 || ':c0:' || (i % 40))::uuid, 'Ancienne ' || (i % 40), 'ACTIVE',
              DATE '2024-09-01', md5($1 || ':se0:' || i)::uuid
         FROM generate_series(1, $2::int) i WHERE i % 5 = 0`,
      [tenant, n, Y0, INST],
    );
    await db.admin.query(
      `INSERT INTO people.student_enrollment_summaries
         (tenant_id, enrollment_id, student_id, academic_year_id, institution_id, classroom_id, classroom_name, status, enrolled_on, source_event_id)
       SELECT $1::uuid, md5($1 || ':e2:' || i)::uuid, md5($1 || ':s:' || i)::uuid, $3::uuid, $4::uuid, md5($1 || ':c2:' || (i % 40))::uuid, 'Attente ' || (i % 40), 'PENDING',
              DATE '2026-01-10', md5($1 || ':se2:' || i)::uuid
         FROM generate_series(1, $2::int) i WHERE i % 11 = 0`,
      [tenant, n, Y1, INST],
    );
    await db.admin.query(
      `INSERT INTO people.identity_memberships (tenant_id, identity_id, status, source_event_id, source_occurred_at)
       SELECT $1::uuid, md5($1 || ':i:' || i)::uuid, 'active', md5($1 || ':sm:' || i)::uuid, now()
         FROM generate_series(1, $2::int) i WHERE i % 10 = 0`,
      [tenant, n],
    );
    await db.admin.query("ANALYZE people.persons; ANALYZE people.students; ANALYZE people.student_enrollment_summaries; ANALYZE people.identity_memberships");
  }

  beforeAll(async () => {
    db = await createPeopleTestDb();
    a = await db.createTenant("liste-a");
    b = await db.createTenant("liste-b");
    await seed(a, N);
    await seed(b, Math.min(N, 300));
  }, 300_000);
  afterAll(async () => {
    await db?.drop();
  });

  const run = <T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> => db.tenantDb.run(ctxFor(tenant), fn, { readOnly: true });

  it("renvoie les mêmes lignes, le même ordre et le même total que la requête historique", async () => {
    const classroom = (await db.admin.query(`SELECT md5($1 || ':c:' || 3)::uuid AS id`, [a])).rows[0].id as string;
    const base = { limit: 50, offset: 0 };
    const cases: Array<[string, StudentListFilter]> = [
      ["sans filtre, page 1", { ...base }],
      ["page 2", { limit: 50, offset: 50 }],
      ["page profonde", { limit: 50, offset: Math.max(0, N - 70) }],
      ["page de 200", { limit: 200, offset: 100 }],
      ["incluant les archivés", { ...base, includeArchived: true }],
      ["statut INACTIVE", { ...base, status: "INACTIVE" }],
      ["classe", { ...base, classroomId: classroom }],
      ["année + statut d'inscription", { ...base, academicYearId: Y0, enrollmentStatus: "ACTIVE" }],
      ["institution", { ...base, institutionId: INST }],
      ["recherche par nom", { ...base, q: "Nom12" }],
      ["recherche par matricule", { ...base, q: "M1" }],
      ["recherche par numéro d'inscription", { ...base, q: "R1" }],
      ["restreint à des identifiants", { ...base, onlyIds: [] }],
      ["page au-delà de la fin", { limit: 50, offset: N + 500 }],
    ];
    // `onlyIds` : de vrais identifiants d'élèves du tenant.
    const ids = (await db.admin.query(`SELECT md5($1 || ':s:' || i)::uuid AS id FROM unnest(ARRAY[1,2,3,7,11,13,500]) i`, [a])).rows.map((r) => r.id as string);
    cases[12] = ["restreint à des identifiants", { ...base, onlyIds: ids }];

    for (const [label, f] of cases) {
      const oldQ = legacyListQuery(a, f);
      const before = await run(a, (tx) => tx.many(oldQ.sql, oldQ.params));
      const after = await run(a, (tx) => listStudentRows(tx, a, f));
      expect(JSON.stringify(after.rows), label).toBe(JSON.stringify(before));
      const expectedTotal = before.length > 0 ? Number((before[0] as { total: string }).total) : after.total;
      expect(after.total, `${label} : total`).toBe(expectedTotal);
    }
    // Au-delà de la fin : aucune ligne, mais le total vrai (comptage sans jointures).
    const beyond = await run(a, (tx) => listStudentRows(tx, a, { limit: 50, offset: N + 500 }));
    expect(beyond.rows).toHaveLength(0);
    expect(beyond.total).toBe(N - Math.floor(N / 50)); // tous sauf les ARCHIVED (1 sur 50)
  });

  it("la jointure d'inscription courante reste celle de la requête historique (ACTIVE d'abord, puis la plus récente)", async () => {
    const r = await run(a, (tx) => listStudentRows(tx, a, { limit: 200, offset: 0 }));
    const withEnrollment = r.rows.filter((x) => x.ceEnrollmentId !== null);
    expect(withEnrollment.length).toBeGreaterThan(100);
    // Les élèves avec une inscription ACTIVE et une PENDING plus récente : c'est l'ACTIVE qui est « courante ».
    expect(r.rows.every((x) => x.ceStatus === null || ["ACTIVE", "PENDING", "SUSPENDED"].includes(x.ceStatus))).toBe(true);
    const mixed = r.rows.filter((x) => x.ceStatus === "PENDING");
    // PENDING courante seulement quand il n'existe aucune inscription ACTIVE (jamais le cas ici : 1/11 a aussi une ACTIVE sauf 1/6).
    for (const m of mixed) {
      const hasActive = (await db.admin.query(`SELECT 1 FROM people.student_enrollment_summaries WHERE student_id = $1 AND status = 'ACTIVE'`, [m.studentId])).rowCount;
      expect(hasActive).toBe(0);
    }
  });

  it("RLS A/B : la liste d'un tenant ne contient jamais un élève de l'autre, ni dans les lignes ni dans le total", async () => {
    const la = await run(a, (tx) => listStudentRows(tx, a, { limit: 200, offset: 0, includeArchived: true }));
    const lb = await run(b, (tx) => listStudentRows(tx, b, { limit: 200, offset: 0, includeArchived: true }));
    const idsA = new Set((await db.admin.query(`SELECT id FROM people.students WHERE tenant_id = $1`, [a])).rows.map((r) => r.id as string));
    const idsB = new Set((await db.admin.query(`SELECT id FROM people.students WHERE tenant_id = $1`, [b])).rows.map((r) => r.id as string));
    expect(la.rows.every((r) => idsA.has(r.studentId))).toBe(true);
    expect(lb.rows.every((r) => idsB.has(r.studentId))).toBe(true);
    expect(la.total).toBe(N);
    expect(lb.total).toBe(Math.min(N, 300));
    // Même en demandant (par erreur) le tenant A avec le contexte du tenant B : la RLS ne laisse rien passer.
    const crossed = await run(b, (tx) => listStudentRows(tx, a, { limit: 50, offset: 0, includeArchived: true }));
    expect(crossed.rows).toHaveLength(0);
    expect(crossed.total).toBe(0);
    // Un identifiant d'élève de A passé dans `onlyIds` sous le contexte de B ne ressort pas.
    const crossedIds = await run(b, (tx) => listStudentRows(tx, b, { limit: 50, offset: 0, onlyIds: [...idsA].slice(0, 20) }));
    expect(crossedIds.rows).toHaveLength(0);
  });

  it.runIf(EXPLAIN)("EXPLAIN ANALYZE avant / après (sortie console)", async () => {
    const f: StudentListFilter = { limit: 50, offset: 0 };
    const deepFilter: StudentListFilter = { limit: 50, offset: Math.max(0, N - 100) };
    const searchFilter: StudentListFilter = { limit: 50, offset: 0, q: "Nom12" };
    const lines: string[] = [];
    for (const [label, filter] of [["page 1", f], ["dernière page", deepFilter], ["recherche q=Nom12", searchFilter]] as const) {
      for (const [name, q] of [["avant", legacyListQuery(a, filter)], ["apres", buildStudentListQuery(a, filter)]] as const) {
        const times: number[] = [];
        let plan = "";
        for (let i = 0; i < 7; i++) {
          const rows = await run(a, (tx) => tx.many<{ "QUERY PLAN": string }>(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${q.sql}`, q.params));
          plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
          const m = /Execution Time: ([\d.]+) ms/.exec(plan);
          times.push(Number(m?.[1] ?? NaN));
        }
        times.sort((x, y) => x - y);
        const lateralLoops = [...plan.matchAll(/student_enrollment_summaries_by_student[^\n]*loops=(\d+)/g)].map((x) => x[1]).join(",");
        lines.push(`[perf] N=${N} ${label.padEnd(18)} ${name.padEnd(5)} exec mediane ${times[3]!.toFixed(2)} ms (min ${times[0]!.toFixed(2)}, max ${times[6]!.toFixed(2)}) boucles LATERAL: ${lateralLoops || "n/a"}`);
        if (process.env.PEOPLE_PERF_PLAN === "1") lines.push(plan);
      }
    }
    console.log(lines.join("\n"));
  }, 600_000);
});
