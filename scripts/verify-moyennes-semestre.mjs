#!/usr/bin/env node
/**
 * Vérifie l’API « moyennes semestre » (GET/PUT matrix) comme utilisée par
 * /annee-academique/moyennes-semestre.
 *
 * Prérequis : API sur le port 4000 (ou MOYENNES_API_URL), JWT valide avec tenant.
 *
 * Variables d’environnement :
 *   JWT ou BEARER_TOKEN   — token Bearer (obligatoire)
 *   X_TENANT              — UUID ou slug tenant (recommandé si le backend l’exige)
 *   X_USER_ID             — optionnel
 *   MOYENNES_API_URL      — défaut http://localhost:4000
 *   CLASS_ID, PERIOD_ID   — optionnel ; sinon découverte via année active + classes
 *   MOYENNES_SKIP_PUT     — si "1", ne fait pas d’essai PUT
 *
 * Usage :
 *   pnpm exec node scripts/verify-moyennes-semestre.mjs
 */

const API = process.env.MOYENNES_API_URL || "http://localhost:4000";
const token = process.env.JWT || process.env.BEARER_TOKEN || "";
const tenant = process.env.X_TENANT || "";
const userId = process.env.X_USER_ID || "";
const skipPut = process.env.MOYENNES_SKIP_PUT === "1";

function headers() {
  const h = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (tenant) h["X-Tenant"] = tenant;
  if (userId) h["X-User-Id"] = userId;
  return h;
}

async function fetchJson(path, opts = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body.message || body.error || res.statusText || "HTTP error";
    throw new Error(`${path} → ${res.status}: ${msg}`);
  }
  return body;
}

function assertMatrixShape(data) {
  if (!data || typeof data !== "object") throw new Error("Réponse matrix: data manquant");
  const { courses, students, averages } = data;
  if (!Array.isArray(courses)) throw new Error("data.courses doit être un tableau");
  if (!Array.isArray(students)) throw new Error("data.students doit être un tableau");
  if (!averages || typeof averages !== "object") throw new Error("data.averages doit être un objet");
  for (const c of courses) {
    if (!c.id || !c.code) throw new Error("Chaque cours doit avoir id et code");
  }
  for (const s of students) {
    if (!s.studentId) throw new Error("Chaque élève doit avoir studentId");
  }
}

async function discoverClassAndPeriod() {
  const active = await fetchJson("/api/v1/academic-years/active");
  const yearId = active.data?.id;
  if (!yearId) throw new Error("Pas d’année académique active (active.data.id)");

  const periodsRes = await fetchJson(`/api/v1/academic-years/${yearId}/periods`);
  const periods = periodsRes.data || [];
  if (!periods.length) throw new Error("Aucune période pour l’année active");

  const classesRes = await fetchJson(
    `/api/v1/classes?academicYearId=${encodeURIComponent(yearId)}&includeDetails=true&limit=100&page=1`
  );
  const classes = classesRes.data || [];
  if (!classes.length) throw new Error("Aucune classe pour l’année active");

  for (const period of periods) {
    for (const cls of classes) {
      const matrix = await fetchJson(
        `/api/v1/semester-averages/matrix?classId=${encodeURIComponent(cls.id)}&periodId=${encodeURIComponent(period.id)}`
      );
      const d = matrix.data;
      if (d?.students?.length > 0 && d?.courses?.length > 0) {
        return { classId: cls.id, periodId: period.id, matrix: d, classLabel: cls.name, periodLabel: period.name };
      }
    }
  }

  throw new Error(
    "Aucune combinaison classe+période avec au moins un élève et une matière. " +
      "Vérifiez les inscriptions et les matières affectées (class_courses)."
  );
}

async function main() {
  if (!token) {
    console.error(
      "❌ Définissez JWT (ou BEARER_TOKEN) avec un token valide, et idéalement X_TENANT.\n" +
        "   Exemple PowerShell :\n" +
        '   $env:JWT="eyJ..."; $env:X_TENANT="votre-tenant"; pnpm exec node scripts/verify-moyennes-semestre.mjs'
    );
    process.exit(1);
  }

  console.log(`API: ${API}`);

  let classId = process.env.CLASS_ID || "";
  let periodId = process.env.PERIOD_ID || "";
  let matrix;

  if (classId && periodId) {
    const res = await fetchJson(
      `/api/v1/semester-averages/matrix?classId=${encodeURIComponent(classId)}&periodId=${encodeURIComponent(periodId)}`
    );
    matrix = res.data;
    assertMatrixShape(matrix);
    console.log(`✓ GET matrix (ids fournis) — ${matrix.students.length} élève(s), ${matrix.courses.length} matière(s)`);
  } else {
    const found = await discoverClassAndPeriod();
    classId = found.classId;
    periodId = found.periodId;
    matrix = found.matrix;
    assertMatrixShape(matrix);
    console.log(
      `✓ GET matrix (auto) — classe « ${found.classLabel} », période « ${found.periodLabel} » : ` +
        `${matrix.students.length} élève(s), ${matrix.courses.length} matière(s)`
    );
  }

  if (skipPut) {
    console.log("○ PUT ignoré (MOYENNES_SKIP_PUT=1)");
    console.log("✅ Vérifications terminées.");
    return;
  }

  const studentId = matrix.students[0].studentId;
  const courseId = matrix.courses[0].id;
  const testGrade = 12.5;

  await fetchJson("/api/v1/semester-averages/matrix", {
    method: "PUT",
    body: JSON.stringify({
      classId,
      periodId,
      cells: [{ studentId, courseId, average: testGrade }],
    }),
  });
  console.log(`✓ PUT matrix — note test ${testGrade} pour 1 cellule`);

  const again = await fetchJson(
    `/api/v1/semester-averages/matrix?classId=${encodeURIComponent(classId)}&periodId=${encodeURIComponent(periodId)}`
  );
  const saved = again.data?.averages?.[studentId]?.[courseId];
  if (saved == null || Math.abs(Number(saved) - testGrade) > 0.01) {
    throw new Error(`La note relue ne correspond pas (attendu ${testGrade}, lu ${saved})`);
  }
  console.log("✓ Relecture GET matrix — note persistée correctement");
  console.log("✅ Vérifications terminées.");
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
