import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

function getScriptDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function parseEnvFile(filePath) {
  const values = {};

  if (!fs.existsSync(filePath)) {
    return values;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    values[key] = value;
  }

  return values;
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function ensure(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function buildHeaders({ token, tenantId, academicYearId }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Tenant": tenantId,
  };

  if (academicYearId) {
    headers["X-Academic-Year-Id"] = academicYearId;
  }

  return headers;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertStudentShape(student) {
  if (!student || typeof student !== "object") {
    throw new Error("API student payload is empty or invalid");
  }

  if (!student.id || !student.studentNumber) {
    throw new Error("API student payload misses id or studentNumber");
  }

  if (!student.user || !student.user.email) {
    throw new Error("API student payload misses nested user/email used by the students page");
  }
}

async function loginSuperAdmin(apiBaseUrl, email, password) {
  const response = await fetch(`${apiBaseUrl}/api/v1/super-admin/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Super-admin login failed: ${JSON.stringify(payload)}`);
  }

  if (!payload?.token) {
    throw new Error("Super-admin login did not return a token");
  }

  return payload.token;
}

async function fetchStudentsList({ apiBaseUrl, token, tenantId, academicYearId, searchEmail, limit }) {
  const url = new URL(`${apiBaseUrl}/api/v1/students`);

  if (limit) {
    url.searchParams.set("limit", String(limit));
  }

  if (searchEmail) {
    url.searchParams.set("search", searchEmail);
  }

  const response = await fetch(url, {
    headers: buildHeaders({ token, tenantId, academicYearId }),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Students API failed: ${JSON.stringify(payload)}`);
  }

  if (!Array.isArray(payload?.students)) {
    throw new Error("Students API did not return a students array");
  }

  for (const student of payload.students) {
    assertStudentShape(student);
  }

  return payload;
}

async function createSmokeStudent({ apiBaseUrl, token, tenantId }) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const email = `smoke.student.${stamp}@ecoledigitale.ci`;

  const response = await fetch(`${apiBaseUrl}/api/v1/students/with-user`, {
    method: "POST",
    headers: {
      ...buildHeaders({ token, tenantId }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      firstName: "Smoke",
      lastName: `Student${stamp.slice(-4)}`,
      email,
      password: "SmokeTest@123",
      currentYear: 1,
      status: "active",
      dateOfBirth: "2010-01-15",
      nationality: "Ivoirienne",
      gender: "feminin",
      subPrefecture: "Abidjan",
    }),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Smoke student creation failed: ${JSON.stringify(payload)}`);
  }

  return {
    email,
    studentId: payload?.id,
    userId: payload?.userId,
  };
}

async function cleanupSmokeStudent(client, tenantId, email) {
  await client.query("BEGIN");
  try {
    const userRes = await client.query(
      `
      SELECT id
      FROM users
      WHERE tenant_id = $1
        AND LOWER(email) = LOWER($2)
      LIMIT 1
      `,
      [tenantId, email]
    );

    const userId = userRes.rows[0]?.id;
    if (!userId) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query("DELETE FROM student_profiles WHERE tenant_id = $1 AND user_id = $2", [tenantId, userId]);
    await client.query("DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2", [tenantId, userId]);
    await client.query("DELETE FROM users WHERE tenant_id = $1 AND id = $2", [tenantId, userId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const rootDir = path.resolve(getScriptDir(), "..");
  const apiEnv = parseEnvFile(path.join(rootDir, "apps", "api", ".env"));

  const connectionString = ensure(
    process.env.DATABASE_URL || apiEnv.DATABASE_URL,
    "DATABASE_URL is missing. Expected it in apps/api/.env or env vars."
  );

  const superAdminEmail = ensure(
    process.env.SUPER_ADMIN_EMAIL || apiEnv.SUPER_ADMIN_EMAIL,
    "SUPER_ADMIN_EMAIL is missing. Expected it in apps/api/.env or env vars."
  );

  const superAdminPassword = ensure(
    process.env.SUPER_ADMIN_PASSWORD || apiEnv.SUPER_ADMIN_PASSWORD,
    "SUPER_ADMIN_PASSWORD is missing. Expected it in apps/api/.env or env vars."
  );

  const apiBaseUrl = getArgValue("--api-base") || process.env.API_BASE_URL || "http://localhost:4000";
  const tenantInput =
    getArgValue("--tenant") ||
    process.env.TENANT_ID ||
    process.env.TENANT_SLUG;
  const searchEmail = getArgValue("--search-email");
  const keepCreated = hasFlag("--keep-created");

  ensure(
    tenantInput,
    "Usage: node scripts/verify-student-registration-visibility.mjs --tenant <tenant-id-or-slug> [--search-email user@example.com] [--keep-created]"
  );

  const client = new Client({ connectionString });
  await client.connect();

  let createdSmokeStudent = null;
  let resolvedTenantId = null;

  try {
    const tenantRes = await client.query(
      `
      SELECT id, name, slug
      FROM tenants
      WHERE id::text = $1 OR slug = $1
      LIMIT 1
      `,
      [tenantInput]
    );

    const tenant = tenantRes.rows[0];
    ensure(tenant, `Tenant not found for "${tenantInput}"`);
    resolvedTenantId = tenant.id;

    const dbCountRes = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM student_profiles
      WHERE tenant_id = $1
      `,
      [tenant.id]
    );

    const dbStudentCount = dbCountRes.rows[0]?.total ?? 0;

    const activeYearRes = await client.query(
      `
      SELECT id, name
      FROM academic_years
      WHERE tenant_id = $1
        AND COALESCE(is_active, false) = true
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [tenant.id]
    );

    const activeAcademicYear = activeYearRes.rows[0] || null;
    const token = await loginSuperAdmin(apiBaseUrl, superAdminEmail, superAdminPassword);

    const initialApiList = await fetchStudentsList({
      apiBaseUrl,
      token,
      tenantId: tenant.id,
      academicYearId: activeAcademicYear?.id,
      limit: 1000,
    });

    if (initialApiList.total !== dbStudentCount) {
      throw new Error(
        `DB/API mismatch for tenant ${tenant.slug}: DB has ${dbStudentCount} students, API returns ${initialApiList.total}`
      );
    }

    console.log(`[OK] Tenant ${tenant.slug} (${tenant.id})`);
    console.log(`[OK] DB count = API count = ${dbStudentCount}`);
    if (activeAcademicYear) {
      console.log(`[OK] Active academic year header used during verification: ${activeAcademicYear.name} (${activeAcademicYear.id})`);
    } else {
      console.log("[WARN] No active academic year found for this tenant; API checked without X-Academic-Year-Id");
    }

    let targetEmail = searchEmail;

    if (!targetEmail) {
      createdSmokeStudent = await createSmokeStudent({
        apiBaseUrl,
        token,
        tenantId: tenant.id,
      });
      targetEmail = createdSmokeStudent.email;
      console.log(`[OK] Smoke student created: ${targetEmail}`);
    }

    const dbStudentRes = await client.query(
      `
      SELECT sp.id, sp.student_number, u.email
      FROM student_profiles sp
      JOIN users u ON u.id = sp.user_id
      WHERE sp.tenant_id = $1
        AND LOWER(u.email) = LOWER($2)
      LIMIT 1
      `,
      [tenant.id, targetEmail]
    );

    const dbStudent = dbStudentRes.rows[0];
    ensure(dbStudent, `Student ${targetEmail} not found in DB for tenant ${tenant.slug}`);
    console.log(`[OK] Student found in DB: ${dbStudent.student_number} / ${dbStudent.email}`);

    if (createdSmokeStudent) {
      const firstPageApiList = await fetchStudentsList({
        apiBaseUrl,
        token,
        tenantId: tenant.id,
        academicYearId: activeAcademicYear?.id,
      });

      const isVisibleOnDefaultPage = firstPageApiList.students.some(
        (student) => student?.user?.email?.toLowerCase() === targetEmail.toLowerCase()
      );

      ensure(
        isVisibleOnDefaultPage,
        `Student ${targetEmail} was created but is not visible in the first /api/v1/students page used by /academic/students`
      );
      console.log("[OK] Newly created student is visible in the first students page payload");
    }

    const apiSearch = await fetchStudentsList({
      apiBaseUrl,
      token,
      tenantId: tenant.id,
      academicYearId: activeAcademicYear?.id,
      searchEmail: targetEmail,
      limit: 1000,
    });

    const foundStudent = apiSearch.students.find(
      (student) => student?.user?.email?.toLowerCase() === targetEmail.toLowerCase()
    );
    ensure(foundStudent, `Student ${targetEmail} is present in DB but not returned by /api/v1/students`);
    assertStudentShape(foundStudent);

    console.log(`[OK] Student visible in /api/v1/students with tenant ${tenant.slug}`);
    console.log(`[OK] Payload matches the students page contract (nested user + identifiers present)`);

    if (createdSmokeStudent && !keepCreated) {
      const deleted = await cleanupSmokeStudent(client, tenant.id, createdSmokeStudent.email);
      console.log(deleted ? `[OK] Smoke student cleaned up: ${createdSmokeStudent.email}` : `[WARN] Smoke student not found for cleanup: ${createdSmokeStudent.email}`);
      createdSmokeStudent = null;
    }
  } finally {
    if (createdSmokeStudent && !keepCreated) {
      try {
        const deleted = await cleanupSmokeStudent(client, resolvedTenantId, createdSmokeStudent.email);
        console.log(
          deleted
            ? `[OK] Smoke student cleaned up after failure: ${createdSmokeStudent.email}`
            : `[WARN] Smoke student cleanup skipped after failure: ${createdSmokeStudent.email}`
        );
      } catch (cleanupError) {
        console.error(`[WARN] Smoke student cleanup failed: ${cleanupError.message}`);
      }
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
