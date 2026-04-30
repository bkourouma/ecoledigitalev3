#!/usr/bin/env node

/**
 * Seed 19 teachers for tenant `ecoledigitale` and map the 20 courses currently
 * returned by `/api/v1/courses` (limit 20, created_at DESC) to them on class
 * `J-LP-RIGLA-A-717`.
 *
 * One teacher intentionally carries two courses:
 * - PHP (MySQL)
 * - Langage C Sharp (C#)
 *
 * The script is idempotent:
 * - teachers are matched by email
 * - users are matched by email
 * - assignments are updated if they already exist on the target class-course
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");

const TENANT_SLUG = "ecoledigitale";
const TARGET_CLASS_CODE = "J-LP-RIGLA-A-717";
const DEFAULT_PASSWORD = "Password@2025";
const TARGET_COURSE_LIMIT = 20;

const TEACHER_SEEDS = [
  {
    employeeNumber: "ED-LPRIGL-ENS-001",
    firstName: "Bertrand",
    lastName: "Yao",
    email: "bertrand.yao.lprigl@ecoledigitale.local",
    phone: "+2250101001001",
    specialties: ["PHP", "C#"],
    bio: "Enseignant en developpement applicatif et bases de donnees.",
    qualifications: ["Master Genie Logiciel"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-002",
    firstName: "Mireille",
    lastName: "Kouame",
    email: "mireille.kouame.lprigl@ecoledigitale.local",
    phone: "+2250101001002",
    specialties: ["Finance", "Economie"],
    bio: "Enseignante orientee gestion et finance appliquee.",
    qualifications: ["Master Finance"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-003",
    firstName: "Salim",
    lastName: "Traore",
    email: "salim.traore.lprigl@ecoledigitale.local",
    phone: "+2250101001003",
    specialties: ["Droit", "TIC"],
    bio: "Enseignant en droit du numerique et gouvernance des SI.",
    qualifications: ["Master Droit du Numerique"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-004",
    firstName: "Clarisse",
    lastName: "Ndri",
    email: "clarisse.ndri.lprigl@ecoledigitale.local",
    phone: "+2250101001004",
    specialties: ["Anglais technique"],
    bio: "Enseignante d anglais de specialite et communication professionnelle.",
    qualifications: ["Master Anglais"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-005",
    firstName: "Ibrahim",
    lastName: "Kone",
    email: "ibrahim.kone.lprigl@ecoledigitale.local",
    phone: "+2250101001005",
    specialties: ["Reseaux"],
    bio: "Enseignant en architectures reseaux et interconnexions.",
    qualifications: ["Master Reseaux et Telecoms"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-006",
    firstName: "Nadege",
    lastName: "Gnahore",
    email: "nadege.gnahore.lprigl@ecoledigitale.local",
    phone: "+2250101001006",
    specialties: ["Linux", "Systemes"],
    bio: "Enseignante en administration Linux et exploitation serveur.",
    qualifications: ["Master Systemes et Reseaux"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-007",
    firstName: "Thierry",
    lastName: "Bamba",
    email: "thierry.bamba.lprigl@ecoledigitale.local",
    phone: "+2250101001007",
    specialties: ["Windows Server"],
    bio: "Enseignant en environnement Microsoft et administration serveur.",
    qualifications: ["Ingenieur Informatique"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-008",
    firstName: "Ariane",
    lastName: "Kouassi",
    email: "ariane.kouassi.lprigl@ecoledigitale.local",
    phone: "+2250101001008",
    specialties: ["Merise", "Modelisation"],
    bio: "Enseignante en modelisation de donnees et conception SI.",
    qualifications: ["Master SI"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-009",
    firstName: "Serge",
    lastName: "Diomande",
    email: "serge.diomande.lprigl@ecoledigitale.local",
    phone: "+2250101001009",
    specialties: ["SQL Server"],
    bio: "Enseignant en developpement SQL Server et optimisation.",
    qualifications: ["Master Bases de Donnees"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-010",
    firstName: "Cynthia",
    lastName: "Ahoua",
    email: "cynthia.ahoua.lprigl@ecoledigitale.local",
    phone: "+2250101001010",
    specialties: ["C#"],
    bio: "Enseignante en programmation orientee objet et ecosysteme .NET.",
    qualifications: ["Master Developpement Logiciel"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-011",
    firstName: "Idriss",
    lastName: "Toure",
    email: "idriss.toure.lprigl@ecoledigitale.local",
    phone: "+2250101001011",
    specialties: ["Algorithmique"],
    bio: "Enseignant en algorithmique et raisonnement formel.",
    qualifications: ["Master Informatique"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-012",
    firstName: "Delphine",
    lastName: "Konan",
    email: "delphine.konan.lprigl@ecoledigitale.local",
    phone: "+2250101001012",
    specialties: ["Windows Server"],
    bio: "Enseignante en exploitation, maintenance et securisation Windows.",
    qualifications: ["Master Administration Systeme"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-013",
    firstName: "Herve",
    lastName: "Guessan",
    email: "herve.guessan.lprigl@ecoledigitale.local",
    phone: "+2250101001013",
    specialties: ["Merise"],
    bio: "Enseignant en methodologie Merise et urbanisation du SI.",
    qualifications: ["Master Systemes d Information"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-014",
    firstName: "Sonia",
    lastName: "Coulibaly",
    email: "sonia.coulibaly.lprigl@ecoledigitale.local",
    phone: "+2250101001014",
    specialties: ["SQL Server"],
    bio: "Enseignante en developpement SQL et reporting.",
    qualifications: ["Master Bases de Donnees"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-015",
    firstName: "Romuald",
    lastName: "Zadi",
    email: "romuald.zadi.lprigl@ecoledigitale.local",
    phone: "+2250101001015",
    specialties: ["Anglais"],
    bio: "Enseignant en anglais de specialite informatique.",
    qualifications: ["Master Langues Etrangeres"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-016",
    firstName: "Estelle",
    lastName: "Kacou",
    email: "estelle.kacou.lprigl@ecoledigitale.local",
    phone: "+2250101001016",
    specialties: ["PHP"],
    bio: "Enseignante en developpement PHP et applications web.",
    qualifications: ["Master Genie Logiciel"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-017",
    firstName: "Kevin",
    lastName: "Ouattara",
    email: "kevin.ouattara.lprigl@ecoledigitale.local",
    phone: "+2250101001017",
    specialties: ["Reseaux"],
    bio: "Enseignant en infrastructures reseaux et protocoles.",
    qualifications: ["Master Reseaux Informatiques"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-018",
    firstName: "Prisca",
    lastName: "Bakayoko",
    email: "prisca.bakayoko.lprigl@ecoledigitale.local",
    phone: "+2250101001018",
    specialties: ["Graphes", "Recherche operationnelle"],
    bio: "Enseignante en graphes, optimisation et ordonnancement.",
    qualifications: ["Master Mathematiques Appliquees"],
  },
  {
    employeeNumber: "ED-LPRIGL-ENS-019",
    firstName: "Landry",
    lastName: "Adjoua",
    email: "landry.adjoua.lprigl@ecoledigitale.local",
    phone: "+2250101001019",
    specialties: ["Bourse", "Marches financiers"],
    bio: "Enseignant en finance de marche et pratique boursiere.",
    qualifications: ["Master Finance de Marche"],
  },
];

function loadEnvFile(relativePath) {
  const envPath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function isoDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function ensureTeacherRoleId(client) {
  const existing = await client.query(
    `SELECT id FROM roles WHERE key = 'teacher' LIMIT 1`
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const created = await client.query(
    `INSERT INTO roles (key, name, is_active, is_system, created_at, updated_at)
     VALUES ('teacher', 'Enseignant', true, true, NOW(), NOW())
     RETURNING id`
  );
  return created.rows[0].id;
}

async function ensureUser(client, tenantId, roleId, teacherSeed, passwordHash) {
  const existing = await client.query(
    `SELECT id, tenant_id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [teacherSeed.email]
  );

  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    if (user.tenant_id && user.tenant_id !== tenantId) {
      throw new Error(
        `L'email ${teacherSeed.email} existe deja sur un autre tenant (${user.tenant_id}).`
      );
    }

    await client.query(
      `UPDATE users
       SET tenant_id = $2,
           name = $3,
           first_name = $4,
           last_name = $5,
           is_active = true,
           active_role_key = 'teacher',
           role_updated_at = COALESCE(role_updated_at, NOW()),
           updated_at = NOW()
       WHERE id = $1`,
      [
        user.id,
        tenantId,
        `${teacherSeed.firstName} ${teacherSeed.lastName}`,
        teacherSeed.firstName,
        teacherSeed.lastName,
      ]
    );

    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
      [tenantId, user.id, roleId]
    );

    return user.id;
  }

  const inserted = await client.query(
    `INSERT INTO users (
       tenant_id,
       email,
       name,
       first_name,
       last_name,
       password_hash,
       initial_password,
       is_active,
       active_role_key,
       role_updated_at,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'teacher', NOW(), NOW(), NOW())
     RETURNING id`,
    [
      tenantId,
      teacherSeed.email,
      `${teacherSeed.firstName} ${teacherSeed.lastName}`,
      teacherSeed.firstName,
      teacherSeed.lastName,
      passwordHash,
      DEFAULT_PASSWORD,
    ]
  );

  const userId = inserted.rows[0].id;
  await client.query(
    `INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
    [tenantId, userId, roleId]
  );

  return userId;
}

async function ensureTeacher(client, tenantId, teacherSeed, userId) {
  const existing = await client.query(
    `SELECT id FROM teachers WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
    [tenantId, teacherSeed.email]
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE teachers
       SET user_id = $2,
           employee_number = $3,
           first_name = $4,
           last_name = $5,
           phone = $6,
           specialties = $7,
           bio = $8,
           qualifications = $9,
           hire_date = $10,
           contract_type = 'permanent',
           hourly_rate = 45,
           status = 'active',
           updated_at = NOW()
       WHERE id = $1`,
      [
        existing.rows[0].id,
        userId,
        teacherSeed.employeeNumber,
        teacherSeed.firstName,
        teacherSeed.lastName,
        teacherSeed.phone,
        teacherSeed.specialties,
        teacherSeed.bio,
        teacherSeed.qualifications,
        "2025-09-01",
      ]
    );
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO teachers (
       tenant_id,
       user_id,
       employee_number,
       first_name,
       last_name,
       email,
       phone,
       specialties,
       bio,
       qualifications,
       hire_date,
       contract_type,
       hourly_rate,
       status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'permanent', 45, 'active')
     RETURNING id`,
    [
      tenantId,
      userId,
      teacherSeed.employeeNumber,
      teacherSeed.firstName,
      teacherSeed.lastName,
      teacherSeed.email,
      teacherSeed.phone,
      teacherSeed.specialties,
      teacherSeed.bio,
      teacherSeed.qualifications,
      "2025-09-01",
    ]
  );

  return inserted.rows[0].id;
}

async function getOrCreateClassCourseId(client, tenantId, classId, courseId) {
  const existing = await client.query(
    `SELECT id FROM class_courses WHERE tenant_id = $1 AND class_id = $2 AND course_id = $3 LIMIT 1`,
    [tenantId, classId, courseId]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO class_courses (tenant_id, class_id, course_id, is_required)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (tenant_id, class_id, course_id) DO UPDATE SET is_required = EXCLUDED.is_required
     RETURNING id`,
    [tenantId, classId, courseId]
  );

  return inserted.rows[0].id;
}

async function upsertAssignment(client, tenantId, classCourseId, teacherId, courseName, datebut, datefin) {
  const existing = await client.query(
    `SELECT id
     FROM teacher_assignments
     WHERE tenant_id = $1 AND class_course_id = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    [tenantId, classCourseId]
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE teacher_assignments
       SET teacher_id = $2,
           contract_type = 'salarie'::assignment_contract_type,
           datebut = $3::date,
           datefin = $4::date,
           course_amount = NULL,
           status = 'active'::assignment_status,
           notes = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [
        existing.rows[0].id,
        teacherId,
        datebut,
        datefin,
        `Affectation synchronisee LPRIGL (${courseName})`,
      ]
    );
    return { id: existing.rows[0].id, mode: "updated" };
  }

  const inserted = await client.query(
    `INSERT INTO teacher_assignments (
       tenant_id,
       class_course_id,
       teacher_id,
       contract_type,
       datebut,
       datefin,
       course_amount,
       status,
       notes
     )
     VALUES (
       $1,
       $2,
       $3,
       'salarie'::assignment_contract_type,
       $4::date,
       $5::date,
       NULL,
       'active'::assignment_status,
       $6
     )
     RETURNING id`,
    [
      tenantId,
      classCourseId,
      teacherId,
      datebut,
      datefin,
      `Affectation synchronisee LPRIGL (${courseName})`,
    ]
  );

  return { id: inserted.rows[0].id, mode: "created" };
}

async function main() {
  loadEnvFile("apps/api/.env");
  loadEnvFile(".env");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL est absent. Configurez-le dans apps/api/.env ou .env.");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");

    const tenantRes = await client.query(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [TENANT_SLUG]
    );
    if (tenantRes.rows.length === 0) {
      throw new Error(`Tenant ${TENANT_SLUG} introuvable.`);
    }
    const tenantId = tenantRes.rows[0].id;
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('app.super_admin', 'false', true)`);

    const classRes = await client.query(
      `SELECT c.id, c.academic_year_id, ay.start_date, ay.end_date
       FROM classes c
       JOIN academic_years ay ON ay.id = c.academic_year_id
       WHERE c.tenant_id = $1 AND c.code = $2
       LIMIT 1`,
      [tenantId, TARGET_CLASS_CODE]
    );
    if (classRes.rows.length === 0) {
      throw new Error(`Classe ${TARGET_CLASS_CODE} introuvable sur ${TENANT_SLUG}.`);
    }

    const classId = classRes.rows[0].id;
    const datebut = isoDateOnly(classRes.rows[0].start_date);
    const datefin = isoDateOnly(classRes.rows[0].end_date);
    if (!datebut || !datefin) {
      throw new Error("Bornes de l'annee academique introuvables.");
    }

    const courseRes = await client.query(
      `SELECT c.id, c.name, c.code, c.created_at
       FROM courses c
       JOIN programmes p ON p.id = c.programme_id
       JOIN bilan_types bt ON bt.id = c.bilan_type_id
       WHERE c.tenant_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2`,
      [tenantId, TARGET_COURSE_LIMIT]
    );
    if (courseRes.rows.length !== TARGET_COURSE_LIMIT) {
      throw new Error(
        `Le jeu cible contient ${courseRes.rows.length} cours au lieu de ${TARGET_COURSE_LIMIT}.`
      );
    }

    const phpCourse = courseRes.rows.find((row) => row.name === "PHP (MySQL)");
    const csharpCourse = courseRes.rows.find((row) => row.name === "Langage C Sharp (C#)");
    if (!phpCourse || !csharpCourse) {
      throw new Error(
        "Impossible de trouver PHP (MySQL) et Langage C Sharp (C#) dans les 20 cours cibles."
      );
    }

    const remainingCourses = courseRes.rows.filter(
      (row) => row.id !== phpCourse.id && row.id !== csharpCourse.id
    );

    if (remainingCourses.length !== TEACHER_SEEDS.length - 1) {
      throw new Error(
        `Plan incoherent: ${remainingCourses.length} cours restants pour ${TEACHER_SEEDS.length - 1} enseignants.`
      );
    }

    const roleId = await ensureTeacherRoleId(client);
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

    const teacherIds = [];
    let createdUsers = 0;
    let createdTeachers = 0;

    for (const teacherSeed of TEACHER_SEEDS) {
      const beforeUser = await client.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [teacherSeed.email]
      );
      const beforeTeacher = await client.query(
        `SELECT id FROM teachers WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
        [tenantId, teacherSeed.email]
      );

      const userId = await ensureUser(client, tenantId, roleId, teacherSeed, passwordHash);
      const teacherId = await ensureTeacher(client, tenantId, teacherSeed, userId);

      if (beforeUser.rows.length === 0) createdUsers += 1;
      if (beforeTeacher.rows.length === 0) createdTeachers += 1;

      teacherIds.push({
        teacherId,
        seed: teacherSeed,
      });
    }

    const assignmentPlan = [
      { teacherId: teacherIds[0].teacherId, teacherLabel: `${teacherIds[0].seed.firstName} ${teacherIds[0].seed.lastName}`, course: phpCourse },
      { teacherId: teacherIds[0].teacherId, teacherLabel: `${teacherIds[0].seed.firstName} ${teacherIds[0].seed.lastName}`, course: csharpCourse },
      ...remainingCourses.map((course, index) => ({
        teacherId: teacherIds[index + 1].teacherId,
        teacherLabel: `${teacherIds[index + 1].seed.firstName} ${teacherIds[index + 1].seed.lastName}`,
        course,
      })),
    ];

    let createdAssignments = 0;
    let updatedAssignments = 0;

    for (const item of assignmentPlan) {
      const classCourseId = await getOrCreateClassCourseId(client, tenantId, classId, item.course.id);
      const result = await upsertAssignment(
        client,
        tenantId,
        classCourseId,
        item.teacherId,
        item.course.name,
        datebut,
        datefin
      );

      if (result.mode === "created") createdAssignments += 1;
      if (result.mode === "updated") updatedAssignments += 1;
    }

    await client.query("COMMIT");

    console.log("Seed termine avec succes.");
    console.log(
      JSON.stringify(
        {
          tenant: TENANT_SLUG,
          classCode: TARGET_CLASS_CODE,
          teachersRequested: TEACHER_SEEDS.length,
          usersCreated: createdUsers,
          teachersCreated: createdTeachers,
          assignmentsCreated: createdAssignments,
          assignmentsUpdated: updatedAssignments,
          defaultPassword: DEFAULT_PASSWORD,
          doubleTeacher: {
            teacher: `${teacherIds[0].seed.firstName} ${teacherIds[0].seed.lastName}`,
            courses: [phpCourse.name, csharpCourse.name],
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
