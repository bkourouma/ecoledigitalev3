#!/usr/bin/env node

/**
 * End-to-end seed for the Genie Logiciel professional workflow.
 *
 * Creates/updates:
 * - 10 students + 9 parents (one parent has two children)
 * - teachers and classrooms
 * - UE sessions for L1GL, L2GL, L3GL, M1GL, M2GL, semesters 1..3
 * - enrollments, paid orders/payments, planning, seances, attendance
 * - assignments plus direct ECUE notes/results and generated bulletin snapshots
 *
 * Idempotent for its own data: emails, references and labels use WF-GL.
 */

const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const CONNECTION_CANDIDATES = [
  process.env.DATABASE_URL,
  "postgresql://postgres:29122003@localhost:5432/dbecoledigitale",
].filter(Boolean);

const TENANT_SLUG = "ecoledigitale";
const PASSWORD = "Passw0rd!wfgl";
const FILIERE_CODES = ["L1GL", "L2GL", "L3GL", "M1GL", "M2GL"];
const SEMESTRES = ["Semestre 1", "Semestre 2", "Semestre 3"];

const STUDENTS = [
  ["Amani", "Kouadio", "F", "2004-02-14"],
  ["Boris", "Kone", "M", "2003-11-03"],
  ["Carine", "Yao", "F", "2004-07-21"],
  ["Dylan", "Nguessan", "M", "2003-05-18"],
  ["Elise", "Toure", "F", "2004-09-09"],
  ["Farid", "Bamba", "M", "2003-12-01"],
  ["Grace", "Diabate", "F", "2004-03-27"],
  ["Hamed", "Coulibaly", "M", "2003-08-16"],
  ["Ines", "Adjobi", "F", "2004-01-30"],
  ["Jules", "Ouattara", "M", "2003-10-12"],
].map(([firstName, lastName, gender, dob], index) => ({
  index,
  firstName,
  lastName,
  gender: gender === "F" ? "feminin" : "masculin",
  dob,
  email: `wfgl.etudiant${String(index + 1).padStart(2, "0")}@ecoledigitale.test`,
  studentNumber: `WFGL-STU-${String(index + 1).padStart(2, "0")}`,
}));

const PARENTS = [
  ["Mariam", "Kouadio", [0, 1]],
  ["Serge", "Yao", [2]],
  ["Odette", "Nguessan", [3]],
  ["Issa", "Toure", [4]],
  ["Awa", "Bamba", [5]],
  ["Moussa", "Diabate", [6]],
  ["Fatou", "Coulibaly", [7]],
  ["Noel", "Adjobi", [8]],
  ["Aminata", "Ouattara", [9]],
].map(([firstName, lastName, studentIndexes], index) => ({
  firstName,
  lastName,
  studentIndexes,
  email: `wfgl.parent${String(index + 1).padStart(2, "0")}@ecoledigitale.test`,
}));

const TEACHERS = [
  ["Nadia", "Soro", "Architecture logicielle"],
  ["Eric", "Koffi", "Algorithmique"],
  ["Sarah", "Traore", "Bases de donnees"],
  ["Patrick", "Amon", "Cloud et DevOps"],
  ["Mireille", "Aka", "Securite applicative"],
  ["Joel", "Konan", "Intelligence artificielle"],
  ["Helene", "Bakayoko", "Methodologie projet"],
  ["Kevin", "Assi", "Developpement web"],
].map(([firstName, lastName, specialty], index) => ({
  firstName,
  lastName,
  specialty,
  email: `wfgl.teacher${String(index + 1).padStart(2, "0")}@ecoledigitale.test`,
  employeeNumber: `WFGL-TCH-${String(index + 1).padStart(2, "0")}`,
}));

const CLASSROOMS = [
  ["WF-GL-LAB-01", "Laboratoire Genie Logiciel 1", 35, "Bloc GL"],
  ["WF-GL-LAB-02", "Laboratoire Genie Logiciel 2", 35, "Bloc GL"],
  ["WF-GL-SALLE-01", "Salle Genie Logiciel 1", 45, "Bloc GL"],
  ["WF-GL-SALLE-02", "Salle Genie Logiciel 2", 45, "Bloc GL"],
  ["WF-GL-SALLE-03", "Salle Genie Logiciel 3", 40, "Bloc GL"],
  ["WF-GL-AMphi-01", "Amphi Genie Logiciel", 80, "Bloc Central"],
].map(([code, name, capacity, building]) => ({ code, name, capacity, building }));

function arrondi(x) {
  return x == null ? null : Math.round(x * 100) / 100;
}

function noteEcue(devoir, examen) {
  if (examen == null) return null;
  return (devoir == null ? 0 : devoir) * 0.4 + examen * 0.6;
}

function safeKey(value) {
  return String(value).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
}

async function connect() {
  let lastError;
  for (const connectionString of CONNECTION_CANDIDATES) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function one(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

async function ensureRole(client, tenantId, key, name) {
  const existing = await one(
    client,
    `SELECT id FROM roles
     WHERE key=$1 AND (tenant_id=$2 OR tenant_id IS NULL)
     ORDER BY tenant_id NULLS FIRST
     LIMIT 1`,
    [key, tenantId]
  );
  if (existing) return existing.id;
  const inserted = await one(
    client,
    `INSERT INTO roles (tenant_id, key, name, is_active, is_system)
     VALUES ($1,$2,$3,true,false) RETURNING id`,
    [tenantId, key, name]
  );
  return inserted.id;
}

async function ensureUser(client, tenantId, roleId, roleKey, firstName, lastName, email) {
  const normalized = email.toLowerCase();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  let user = await one(client, "SELECT id FROM users WHERE tenant_id=$1 AND lower(email)=lower($2)", [
    tenantId,
    normalized,
  ]);
  if (!user) {
    user = await one(
      client,
      `INSERT INTO users
         (tenant_id, email, name, first_name, last_name, password_hash, initial_password,
          is_active, active_role_key, role_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,now())
       RETURNING id`,
      [tenantId, normalized, `${firstName} ${lastName}`, firstName, lastName, passwordHash, PASSWORD, roleKey]
    );
  } else {
    await client.query(
      `UPDATE users
       SET first_name=$3, last_name=$4, name=$5, active_role_key=COALESCE(active_role_key,$6), updated_at=now()
       WHERE id=$1 AND tenant_id=$2`,
      [user.id, tenantId, firstName, lastName, `${firstName} ${lastName}`, roleKey]
    );
  }

  await client.query(
    `INSERT INTO user_roles (tenant_id, user_id, role_id)
     VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING`,
    [tenantId, user.id, roleId]
  );
  return user.id;
}

async function ensureStudents(client, tenantId, roleId) {
  const ids = [];
  for (const student of STUDENTS) {
    const userId = await ensureUser(
      client,
      tenantId,
      roleId,
      "student",
      student.firstName,
      student.lastName,
      student.email
    );
    let profile = await one(client, "SELECT id FROM student_profiles WHERE tenant_id=$1 AND user_id=$2", [
      tenantId,
      userId,
    ]);
    if (!profile) {
      profile = await one(
        client,
        `INSERT INTO student_profiles
           (tenant_id, user_id, student_number, current_year, status, date_of_birth,
            place_of_birth, nationality, address, phone, is_active, is_inscribed,
            inscription_date, gender, initial_password, last_diploma)
         VALUES ($1,$2,$3,1,'active',$4,'Abidjan','Ivoirienne',
                 'Abidjan - Workflow Genie Logiciel',$5,true,true,DATE '2026-09-01',$6,$7,'Baccalaureat')
         RETURNING id`,
        [
          tenantId,
          userId,
          student.studentNumber,
          student.dob,
          `07000010${student.index}`,
          student.gender,
          PASSWORD,
        ]
      );
    } else {
      await client.query(
        `UPDATE student_profiles
         SET student_number=$3, current_year=1, status='active', is_active=true,
             is_inscribed=true, gender=$4, date_of_birth=$5, updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [profile.id, tenantId, student.studentNumber, student.gender, student.dob]
      );
    }
    ids.push(profile.id);
  }
  return ids;
}

async function ensureParents(client, tenantId, roleId, studentIds) {
  const ids = [];
  for (const parent of PARENTS) {
    const userId = await ensureUser(
      client,
      tenantId,
      roleId,
      "parent",
      parent.firstName,
      parent.lastName,
      parent.email
    );
    ids.push(userId);
    for (const studentIndex of parent.studentIndexes) {
      await client.query(
        `INSERT INTO student_parents
           (tenant_id, student_id, parent_id, relationship_type, is_primary_contact,
            emergency_contact, can_pickup, notes)
         VALUES ($1,$2,$3,'parent',$4,$5,true,'Seed workflow Genie Logiciel')
         ON CONFLICT (tenant_id, student_id, parent_id) DO NOTHING`,
        [tenantId, studentIds[studentIndex], userId, studentIndex === parent.studentIndexes[0], false]
      );
    }
  }
  return ids;
}

async function ensureTeachers(client, tenantId, roleId) {
  const ids = [];
  for (const teacher of TEACHERS) {
    const userId = await ensureUser(
      client,
      tenantId,
      roleId,
      "teacher",
      teacher.firstName,
      teacher.lastName,
      teacher.email
    );
    let row = await one(client, "SELECT id FROM teachers WHERE tenant_id=$1 AND lower(email)=lower($2)", [
      tenantId,
      teacher.email,
    ]);
    if (!row) {
      row = await one(
        client,
        `INSERT INTO teachers
           (tenant_id, user_id, employee_number, first_name, last_name, email, phone,
            specialties, qualifications, hire_date, contract_type, hourly_rate, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,DATE '2026-08-15','freelance',25000,'active')
         RETURNING id`,
        [
          tenantId,
          userId,
          teacher.employeeNumber,
          teacher.firstName,
          teacher.lastName,
          teacher.email,
          `07010020${ids.length}`,
          [teacher.specialty],
          ["Master", "Experience professionnelle"],
        ]
      );
    } else {
      await client.query(
        `UPDATE teachers
         SET user_id=$3, first_name=$4, last_name=$5, employee_number=$6,
             specialties=$7, status='active', updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [row.id, tenantId, userId, teacher.firstName, teacher.lastName, teacher.employeeNumber, [teacher.specialty]]
      );
    }
    ids.push(row.id);
  }
  return ids;
}

async function ensureClassrooms(client, tenantId) {
  const ids = [];
  for (const room of CLASSROOMS) {
    let row = await one(client, "SELECT id FROM classrooms WHERE tenant_id=$1 AND code=$2", [tenantId, room.code]);
    if (!row) {
      row = await one(
        client,
        `INSERT INTO classrooms (tenant_id, name, code, capacity, building, description, equipment, is_active)
         VALUES ($1,$2,$3,$4,$5,'Seed workflow Genie Logiciel',$6,true)
         RETURNING id`,
        [tenantId, room.name, room.code, room.capacity, room.building, ["Projecteur", "Tableau", "Wi-Fi"]]
      );
    } else {
      await client.query(
        `UPDATE classrooms SET name=$3, capacity=$4, building=$5, is_active=true, updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [row.id, tenantId, room.name, room.capacity, room.building]
      );
    }
    ids.push(row.id);
  }
  return ids;
}

async function loadGlStructure(client, tenantId) {
  const rows = await client.query(
    `SELECT p.code AS filiere_code, p.name AS filiere_name, p.id AS filiere_id,
            sm.id AS semestre_id, sm.libelle AS semestre_libelle,
            u.id AS ue_id, u.code AS ue_code, u.libelle AS ue_libelle,
            u.nb_uv::int AS nb_uv, u.prix::float8 AS prix, u.categorie,
            e.id AS ecue_id, e.code AS ecue_code, e.libelle AS ecue_libelle,
            COALESCE(e.credits, 1)::int AS ecue_credits, l.ordre
     FROM programmes p
     JOIN professional_semestres sm ON sm.filiere_id = p.id AND sm.tenant_id = p.tenant_id
     JOIN professional_semestre_ue su ON su.semestre_id = sm.id AND su.tenant_id = sm.tenant_id
     JOIN professional_ue u ON u.id = su.ue_id AND u.tenant_id = su.tenant_id
     JOIN professional_ue_ecue l ON l.ue_id = u.id AND l.tenant_id = u.tenant_id
     JOIN professional_ecue e ON e.id = l.ecue_id AND e.tenant_id = l.tenant_id
     WHERE p.tenant_id=$1 AND p.code = ANY($2)
       AND sm.libelle = ANY($3)
     ORDER BY p.code, sm.libelle, u.code, l.ordre, e.code`,
    [tenantId, FILIERE_CODES, SEMESTRES]
  );

  const map = new Map();
  for (const r of rows.rows) {
    const key = `${r.filiere_code}|${r.semestre_id}|${r.ue_id}`;
    if (!map.has(key)) {
      map.set(key, {
        filiere_code: r.filiere_code,
        filiere_name: r.filiere_name,
        filiere_id: r.filiere_id,
        semestre_id: r.semestre_id,
        semestre_libelle: r.semestre_libelle,
        ue_id: r.ue_id,
        ue_code: r.ue_code,
        ue_libelle: r.ue_libelle,
        nb_uv: r.nb_uv,
        prix: r.prix || 0,
        categorie: r.categorie,
        ecues: [],
      });
    }
    map.get(key).ecues.push({
      ecue_id: r.ecue_id,
      ecue_code: r.ecue_code,
      ecue_libelle: r.ecue_libelle,
      credits: r.ecue_credits || 1,
      ordre: r.ordre || 0,
      isConduite: /^conduite/i.test(r.ecue_libelle || "") || /EC-CON/i.test(r.ecue_code || ""),
    });
  }
  return Array.from(map.values());
}

function periodFor(filiereCode, semestreLibelle) {
  const levelIndex = FILIERE_CODES.indexOf(filiereCode);
  const semIndex = SEMESTRES.indexOf(semestreLibelle);
  const offset = levelIndex * 3 + semIndex;
  const start = new Date(Date.UTC(2026, 8 + offset * 2, 1));
  const end = new Date(Date.UTC(2026, 8 + offset * 2 + 1, 20));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function ensureSession(client, tenantId, ue, teacherId, classroomId) {
  const period = periodFor(ue.filiere_code, ue.semestre_libelle);
  const libelle = `WF-GL ${ue.filiere_code} ${ue.semestre_libelle} - ${ue.ue_code}`;
  let row = await one(client, "SELECT id FROM professional_ue_sessions WHERE tenant_id=$1 AND ue_id=$2 AND libelle=$3", [
    tenantId,
    ue.ue_id,
    libelle,
  ]);
  if (!row) {
    row = await one(
      client,
      `INSERT INTO professional_ue_sessions
         (tenant_id, ue_id, libelle, date_debut, date_fin, inscription_ouverte_le,
          inscription_fermee_le, capacite_max, enseignant_id, classroom_id, statut)
       VALUES ($1,$2,$3,$4,$5,($4::date - interval '30 days'),($5::date + interval '30 days'),
               40,$6,$7,'termine')
       RETURNING id`,
      [tenantId, ue.ue_id, libelle, period.start, period.end, teacherId, classroomId]
    );
  } else {
    await client.query(
      `UPDATE professional_ue_sessions
       SET date_debut=$4, date_fin=$5, enseignant_id=$6, classroom_id=$7, statut='termine', updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND ue_id=$3`,
      [row.id, tenantId, ue.ue_id, period.start, period.end, teacherId, classroomId]
    );
  }

  const link = await one(
    client,
    "SELECT id FROM professional_semestre_sessions WHERE tenant_id=$1 AND semestre_id=$2 AND ue_session_id=$3",
    [tenantId, ue.semestre_id, row.id]
  );
  if (!link) {
    await client.query(
      `INSERT INTO professional_semestre_sessions (tenant_id, semestre_id, ue_session_id)
       VALUES ($1,$2,$3)`,
      [tenantId, ue.semestre_id, row.id]
    );
  }
  return { id: row.id, date_debut: period.start, date_fin: period.end, libelle };
}

async function ensureEnrollmentAndPayment(client, tenantId, studentId, sessionId, ue, studentIndex) {
  const ref = `WF-GL-ORD-${STUDENTS[studentIndex].studentNumber}-${ue.ue_code}`;
  let order = await one(client, "SELECT id FROM professional_orders WHERE tenant_id=$1 AND reference=$2", [tenantId, ref]);
  if (!order) {
    order = await one(
      client,
      `INSERT INTO professional_orders (tenant_id, student_id, reference, montant_total, devise, statut)
       VALUES ($1,$2,$3,$4,'XOF','payee') RETURNING id`,
      [tenantId, studentId, ref, ue.prix]
    );
  } else {
    await client.query(
      `UPDATE professional_orders SET student_id=$3, montant_total=$4, devise='XOF', statut='payee', updated_at=now()
       WHERE id=$1 AND tenant_id=$2`,
      [order.id, tenantId, studentId, ue.prix]
    );
  }

  const enrollment = await one(
    client,
    "SELECT id FROM professional_enrollments WHERE tenant_id=$1 AND student_id=$2 AND ue_session_id=$3 AND statut <> 'annulee'",
    [tenantId, studentId, sessionId]
  );
  if (!enrollment) {
    await client.query(
      `INSERT INTO professional_enrollments
         (tenant_id, order_id, student_id, ue_session_id, prix_unitaire, statut)
       VALUES ($1,$2,$3,$4,$5,'confirmee')`,
      [tenantId, order.id, studentId, sessionId, ue.prix]
    );
  } else {
    await client.query(
      `UPDATE professional_enrollments
       SET order_id=$3, prix_unitaire=$4, statut='confirmee', updated_at=now()
       WHERE id=$1 AND tenant_id=$2`,
      [enrollment.id, tenantId, order.id, ue.prix]
    );
  }

  const payRef = `WF-GL-PAY-${STUDENTS[studentIndex].studentNumber}-${ue.ue_code}`;
  const payment = await one(
    client,
    "SELECT id FROM professional_payments WHERE tenant_id=$1 AND reference_transaction=$2",
    [tenantId, payRef]
  );
  if (!payment) {
    await client.query(
      `INSERT INTO professional_payments
         (tenant_id, order_id, montant, mode, reference_transaction, statut, paid_at, receipt_number, receipt_url)
       VALUES ($1,$2,$3,'especes',$4,'confirme',now(),$5,$6)`,
      [tenantId, order.id, ue.prix, payRef, `REC-${payRef}`, `/receipts/${payRef}.pdf`]
    );
  } else {
    await client.query(
      `UPDATE professional_payments
       SET order_id=$3, montant=$4, mode='especes', statut='confirme', paid_at=COALESCE(paid_at, now()),
           receipt_number=$5, receipt_url=$6, updated_at=now()
       WHERE id=$1 AND tenant_id=$2`,
      [payment.id, tenantId, order.id, ue.prix, `REC-${payRef}`, `/receipts/${payRef}.pdf`]
    );
  }
}

async function ensureMatricule(client, tenantId, studentId, filiereId, filiereCode, studentIndex) {
  const existing = await one(
    client,
    "SELECT id FROM professional_student_matricules WHERE tenant_id=$1 AND student_id=$2 AND filiere_id=$3",
    [tenantId, studentId, filiereId]
  );
  if (existing) return;
  const seq = 9000 + studentIndex + 1;
  await client.query(
    `INSERT INTO professional_student_matricules (tenant_id, student_id, filiere_id, seq, matricule)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING`,
    [tenantId, studentId, filiereId, seq, `IPAM-${filiereCode}-${String(seq).padStart(4, "0")}`]
  );
}

async function ensurePlanningAndSeances(client, tenantId, ue, session, teachers, classrooms, adminId) {
  const nonConduite = ue.ecues.filter((e) => !e.isConduite);
  const ecues = nonConduite.length ? nonConduite : ue.ecues;
  const sessionOrdinal = SEMESTRES.indexOf(ue.semestre_libelle);
  for (let i = 0; i < ecues.length; i++) {
    const ecue = ecues[i];
    const teacherId = ue.ue_code.endsWith("UE1") ? teachers[0] : teachers[(i + sessionOrdinal) % teachers.length];
    const classroomId = classrooms[(i + sessionOrdinal) % classrooms.length];

    const affected = await one(
      client,
      `SELECT id FROM professional_session_ecue_teachers
       WHERE tenant_id=$1 AND ue_session_id=$2 AND ecue_id=$3`,
      [tenantId, session.id, ecue.ecue_id]
    );
    if (!affected) {
      await client.query(
        `INSERT INTO professional_session_ecue_teachers (tenant_id, ue_session_id, ecue_id, enseignant_id)
         VALUES ($1,$2,$3,$4)`,
        [tenantId, session.id, ecue.ecue_id, teacherId]
      );
    } else {
      await client.query(
        `UPDATE professional_session_ecue_teachers SET enseignant_id=$3, updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [affected.id, tenantId, teacherId]
      );
    }

    const emp = await one(
      client,
      `SELECT id FROM professional_emploi_temps
       WHERE tenant_id=$1 AND ue_session_id=$2 AND ecue_id=$3 AND jour=$4 AND heure_debut=$5`,
      [tenantId, session.id, ecue.ecue_id, ((i + sessionOrdinal) % 5) + 1, "08:00"]
    );
    if (!emp) {
      await client.query(
        `INSERT INTO professional_emploi_temps
           (tenant_id, ue_session_id, ecue_id, enseignant_id, classroom_id, jour,
            heure_debut, heure_fin, created_by, date_debut, date_fin)
         VALUES ($1,$2,$3,$4,$5,$6,TIME '08:00',TIME '10:00',$7,$8,$9)`,
        [
          tenantId,
          session.id,
          ecue.ecue_id,
          teacherId,
          classroomId,
          ((i + sessionOrdinal) % 5) + 1,
          adminId,
          session.date_debut,
          session.date_fin,
        ]
      );
    }

    for (let n = 0; n < 2; n++) {
      const date = new Date(`${session.date_debut}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + 7 * (i + n + 1));
      const label = `WF-GL Seance ${n + 1} - ${ue.ue_code} - ${ecue.ecue_code}`;
      let seance = await one(
        client,
        `SELECT id FROM professional_ecue_seances
         WHERE tenant_id=$1 AND ue_session_id=$2 AND ecue_id=$3 AND libelle=$4`,
        [tenantId, session.id, ecue.ecue_id, label]
      );
      if (!seance) {
        seance = await one(
          client,
          `INSERT INTO professional_ecue_seances
             (tenant_id, ecue_id, ue_session_id, libelle, date, heure_debut, heure_fin, enseignant_id, classroom_id)
           VALUES ($1,$2,$3,$4,$5,TIME '08:00',TIME '10:00',$6,$7)
           RETURNING id`,
          [tenantId, ecue.ecue_id, session.id, label, date.toISOString().slice(0, 10), teacherId, classroomId]
        );
      } else {
        await client.query(
          `UPDATE professional_ecue_seances
           SET date=$3, enseignant_id=$4, classroom_id=$5, updated_at=now()
           WHERE id=$1 AND tenant_id=$2`,
          [seance.id, tenantId, date.toISOString().slice(0, 10), teacherId, classroomId]
        );
      }
    }
  }
}

async function ensureAttendance(client, tenantId, sessionId, studentIds, adminId) {
  const seances = await client.query(
    "SELECT id FROM professional_ecue_seances WHERE tenant_id=$1 AND ue_session_id=$2 AND libelle LIKE 'WF-GL Seance%'",
    [tenantId, sessionId]
  );
  for (const seance of seances.rows) {
    for (let i = 0; i < studentIds.length; i++) {
      const statut = i === 8 ? "retard" : i === 9 ? "absent" : i === 6 ? "excuse" : "present";
      await client.query(
        `INSERT INTO professional_ecue_attendance (tenant_id, seance_id, student_id, statut, marked_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, seance_id, student_id)
         DO UPDATE SET statut=EXCLUDED.statut, marked_by=EXCLUDED.marked_by, updated_at=now()`,
        [tenantId, seance.id, studentIds[i], statut, adminId]
      );
    }
  }
}

async function ensureAssignments(client, tenantId, ue, session, adminId) {
  for (const ecue of ue.ecues.filter((e) => !e.isConduite)) {
    for (const type of ["devoir", "examen"]) {
      const titre = `WF-GL ${type === "devoir" ? "Devoir" : "Examen"} - ${ue.ue_code} - ${ecue.ecue_code}`;
      let assignment = await one(
        client,
        `SELECT id FROM professional_assignments
         WHERE tenant_id=$1 AND ue_session_id=$2 AND ecue_id=$3 AND titre=$4`,
        [tenantId, session.id, ecue.ecue_id, titre]
      );
      const due = new Date(`${session.date_fin}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() - (type === "devoir" ? 20 : 3));
      if (!assignment) {
        await client.query(
          `INSERT INTO professional_assignments
             (tenant_id, ecue_id, ue_session_id, titre, description, type, evaluation_type,
              note_max, coefficient, starts_at, due_at, statut, created_by, subject_content)
           VALUES ($1,$2,$3,$4,'Seed workflow Genie Logiciel',$5,'pdf',20,1,$6,$7,'publie',$8,$9)`,
          [
            tenantId,
            ecue.ecue_id,
            session.id,
            titre,
            type,
            `${session.date_debut}T08:00:00Z`,
            due.toISOString(),
            adminId,
            `Sujet ${titre}: realiser les exercices demandes.`,
          ]
        );
      } else {
        await client.query(
          `UPDATE professional_assignments
           SET type=$3, evaluation_type='pdf', note_max=20, coefficient=1, statut='publie',
               starts_at=$4, due_at=$5, created_by=$6, updated_at=now()
           WHERE id=$1 AND tenant_id=$2`,
          [assignment.id, tenantId, type, `${session.date_debut}T08:00:00Z`, due.toISOString(), adminId]
        );
      }
    }
  }
}

function notePlan(studentIndex, filiereCode, semestreLibelle, ueCode, ecueIndex, isConduite) {
  if (isConduite) return { devoir: null, exam1: 14 + ((studentIndex + ecueIndex) % 4), exam2: null };

  const basePass = 12 + ((studentIndex + ecueIndex) % 5);
  const key = `${filiereCode}-${semestreLibelle}-${ueCode}`;

  if (studentIndex === 6 && (key.includes("L2GL-S2-UE2") || key.includes("M1GL-S1-UE1"))) {
    return { devoir: 11, exam1: 7, exam2: 14 };
  }
  if (studentIndex === 7 && (key.includes("L3GL-S3-UE2") || key.includes("M1GL-S2-UE3"))) {
    return { devoir: 10, exam1: 8, exam2: 13 };
  }
  if (studentIndex === 8 && key.includes("M2GL-S2-UE2")) {
    return { devoir: 11, exam1: 7, exam2: null };
  }
  if (studentIndex === 9 && key.includes("M2GL-S3-UE2")) {
    return { devoir: 8, exam1: 6, exam2: 7 };
  }
  return { devoir: basePass, exam1: basePass + 1, exam2: null };
}

async function clearSeedNotes(client, tenantId, sessionId, studentIds) {
  await client.query(
    `DELETE FROM professional_ecue_notes
     WHERE tenant_id=$1 AND ue_session_id=$2 AND student_id = ANY($3::uuid[])
       AND (libelle LIKE 'WF-GL Devoir%' OR libelle LIKE 'WF-GL Examen%')`,
    [tenantId, sessionId, studentIds]
  );
}

async function ensureNotesAndResults(client, tenantId, ue, session, studentIds, adminId) {
  await clearSeedNotes(client, tenantId, session.id, studentIds);

  for (let si = 0; si < studentIds.length; si++) {
    const studentId = studentIds[si];
    const ecueResults = [];
    for (let ei = 0; ei < ue.ecues.length; ei++) {
      const ecue = ue.ecues[ei];
      const plan = notePlan(si, ue.filiere_code, ue.semestre_libelle, ue.ue_code, ei, ecue.isConduite);

      if (!ecue.isConduite && plan.devoir != null) {
        await client.query(
          `INSERT INTO professional_ecue_notes
             (tenant_id, ecue_id, student_id, ue_session_id, nature, libelle, note, note_max, saisi_par, session)
           VALUES ($1,$2,$3,$4,'devoir',$5,$6,20,$7,1)`,
          [tenantId, ecue.ecue_id, studentId, session.id, `WF-GL Devoir - ${ecue.ecue_code}`, plan.devoir, adminId]
        );
      }
      await client.query(
        `INSERT INTO professional_ecue_notes
           (tenant_id, ecue_id, student_id, ue_session_id, nature, libelle, note, note_max, saisi_par, session)
         VALUES ($1,$2,$3,$4,'examen',$5,$6,20,$7,1)
         ON CONFLICT (tenant_id, ecue_id, student_id, ue_session_id, session)
           WHERE nature = 'examen'
         DO UPDATE SET note=EXCLUDED.note, libelle=EXCLUDED.libelle, saisi_par=EXCLUDED.saisi_par, updated_at=now()`,
        [tenantId, ecue.ecue_id, studentId, session.id, `WF-GL Examen S1 - ${ecue.ecue_code}`, plan.exam1, adminId]
      );
      if (plan.exam2 != null) {
        await client.query(
          `INSERT INTO professional_ecue_notes
             (tenant_id, ecue_id, student_id, ue_session_id, nature, libelle, note, note_max, saisi_par, session)
           VALUES ($1,$2,$3,$4,'examen',$5,$6,20,$7,2)
           ON CONFLICT (tenant_id, ecue_id, student_id, ue_session_id, session)
             WHERE nature = 'examen'
           DO UPDATE SET note=EXCLUDED.note, libelle=EXCLUDED.libelle, saisi_par=EXCLUDED.saisi_par, updated_at=now()`,
          [tenantId, ecue.ecue_id, studentId, session.id, `WF-GL Examen S2 - ${ecue.ecue_code}`, plan.exam2, adminId]
        );
      }

      const retainedExam = plan.exam2 != null ? plan.exam2 : plan.exam1;
      const retainedSession = plan.exam2 != null ? 2 : 1;
      const finalNote = ecue.isConduite ? retainedExam : noteEcue(plan.devoir, retainedExam);
      const validee = finalNote != null && finalNote >= 10;
      if (!ecue.isConduite) {
        await client.query(
          `INSERT INTO professional_ecue_results
             (tenant_id, ecue_id, student_id, ue_session_id, moyenne, moyenne_devoirs,
              note_examen, eliminee, note_source, validee, date_validation, session_obtention)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manuel',$9,CASE WHEN $9 THEN now() ELSE NULL END,$10)
           ON CONFLICT (tenant_id, ecue_id, student_id, ue_session_id)
           DO UPDATE SET moyenne=EXCLUDED.moyenne,
                         moyenne_devoirs=EXCLUDED.moyenne_devoirs,
                         note_examen=EXCLUDED.note_examen,
                         eliminee=EXCLUDED.eliminee,
                         note_source='manuel',
                         validee=EXCLUDED.validee,
                         validee_manuellement=false,
                         date_validation=EXCLUDED.date_validation,
                         session_obtention=EXCLUDED.session_obtention,
                         updated_at=now()`,
          [
            tenantId,
            ecue.ecue_id,
            studentId,
            session.id,
            arrondi(finalNote),
            arrondi(plan.devoir),
            arrondi(retainedExam),
            finalNote != null && finalNote < 5,
            validee,
            validee ? retainedSession : null,
          ]
        );
      }
      ecueResults.push({ ...ecue, finalNote, validee, retainedSession });
    }

    const gradable = ecueResults.filter((e) => !e.isConduite);
    let sum = 0;
    let credits = 0;
    let hasElim = false;
    let incomplete = false;
    for (const e of gradable) {
      if (e.finalNote == null) incomplete = true;
      else {
        const c = e.credits > 0 ? e.credits : 1;
        sum += e.finalNote * c;
        credits += c;
        if (e.finalNote < 5 && !e.validee) hasElim = true;
      }
    }
    const moyenneUe = credits > 0 ? sum / credits : null;
    const valideeUe = moyenneUe != null && moyenneUe >= 10 && !hasElim && !incomplete;
    await client.query(
      `INSERT INTO student_professional_ue_results
         (tenant_id, ue_id, student_id, ue_session_id, statut, uv_acquises, date_validation)
       VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $5='validee' THEN now() ELSE NULL END)
       ON CONFLICT (tenant_id, ue_id, student_id)
       DO UPDATE SET ue_session_id=EXCLUDED.ue_session_id,
                     statut=EXCLUDED.statut,
                     uv_acquises=EXCLUDED.uv_acquises,
                     date_validation=EXCLUDED.date_validation,
                     updated_at=now()`,
      [tenantId, ue.ue_id, studentId, session.id, valideeUe ? "validee" : "echec", valideeUe ? ue.nb_uv : 0]
    );
  }
}

async function buildAndStoreBulletins(client, tenantId, structure, studentIds) {
  const bySem = new Map();
  for (const item of structure) {
    const key = item.semestre_id;
    if (!bySem.has(key)) bySem.set(key, []);
    bySem.get(key).push(item);
  }

  for (const [semestreId, ues] of bySem.entries()) {
    const sem = ues[0];
    for (let si = 0; si < studentIds.length; si++) {
      const studentId = studentIds[si];
      const student = await one(
        client,
        `SELECT sp.id, sp.student_number, sp.date_of_birth::text, sp.place_of_birth, sp.gender,
                u.first_name, u.last_name
         FROM student_profiles sp JOIN users u ON u.id=sp.user_id
         WHERE sp.id=$1 AND sp.tenant_id=$2`,
        [studentId, tenantId]
      );
      const bulletinUes = [];
      for (const ue of ues) {
        const session = await one(
          client,
          "SELECT id, date_debut::text FROM professional_ue_sessions WHERE tenant_id=$1 AND ue_id=$2 AND libelle=$3",
          [tenantId, ue.ue_id, `WF-GL ${ue.filiere_code} ${ue.semestre_libelle} - ${ue.ue_code}`]
        );
        if (!session) continue;
        const ecues = [];
        let sum = 0;
        let credits = 0;
        let anyS2 = false;
        for (const ecue of ue.ecues) {
          const res = ecue.isConduite
            ? await one(
                client,
                `SELECT note::float8 AS note, session FROM professional_ecue_notes
                 WHERE tenant_id=$1 AND ecue_id=$2 AND student_id=$3 AND ue_session_id=$4
                   AND nature='examen'
                 ORDER BY session DESC LIMIT 1`,
                [tenantId, ecue.ecue_id, studentId, session.id]
              )
            : await one(
                client,
                `SELECT moyenne::float8 AS note, moyenne_devoirs::float8, note_examen::float8,
                        validee, session_obtention
                 FROM professional_ecue_results
                 WHERE tenant_id=$1 AND ecue_id=$2 AND student_id=$3 AND ue_session_id=$4`,
                [tenantId, ecue.ecue_id, studentId, session.id]
              );
          const note = res?.note == null ? null : Number(res.note);
          const c = ecue.credits > 0 ? ecue.credits : 1;
          if (note != null) {
            sum += note * c;
            credits += c;
          }
          if (res?.session_obtention === 2 || res?.session === 2) anyS2 = true;
          ecues.push({
            ecue_id: ecue.ecue_id,
            code: ecue.ecue_code,
            libelle: ecue.ecue_libelle,
            credits: c,
            moyenne_devoirs: arrondi(res?.moyenne_devoirs ?? null),
            note_examen: arrondi(res?.note_examen ?? note),
            note_ecue: arrondi(note),
            validee: note != null && note >= 10,
            validee_manuellement: false,
            statut: note == null ? "en_cours" : note >= 10 ? "valide" : note < 5 ? "eliminatoire" : "insuffisant",
            session_obtention: note != null && note >= 10 ? res?.session_obtention ?? res?.session ?? 1 : null,
          });
        }
        const moyenne = credits > 0 ? sum / credits : null;
        const validee = moyenne != null && moyenne >= 10 && ecues.every((e) => e.note_ecue != null && e.note_ecue >= 5);
        const hasS2Notes = await one(
          client,
          `SELECT 1 FROM professional_ecue_notes
           WHERE tenant_id=$1 AND student_id=$2 AND ue_session_id=$3 AND session=2 LIMIT 1`,
          [tenantId, studentId, session.id]
        );
        bulletinUes.push({
          ue_id: ue.ue_id,
          ue_session_id: session.id,
          code: ue.ue_code,
          libelle: ue.ue_libelle.replace(/\s*\([^)]*\)\s*$/, ""),
          categorie: ue.categorie,
          credits: ue.nb_uv,
          nb_uv: ue.nb_uv,
          moyenne_ue: arrondi(moyenne),
          validee,
          session_validation: validee ? (anyS2 ? 2 : 1) : null,
          etat: validee ? "validee" : hasS2Notes ? "dette" : "rattrapage",
          motifs: validee ? [] : ["MOYENNE_INSUFFISANTE"],
          ecues,
        });
      }

      const totalCredits = bulletinUes.reduce((sum, ue) => sum + (ue.credits || 0), 0);
      const creditsValides = bulletinUes.filter((ue) => ue.validee).reduce((sum, ue) => sum + (ue.credits || 0), 0);
      const moyenneSession =
        totalCredits > 0
          ? bulletinUes.reduce((sum, ue) => sum + (ue.moyenne_ue == null ? 0 : ue.moyenne_ue * ue.credits), 0) /
            totalCredits
          : null;
      const semestreValide = bulletinUes.length > 0 && bulletinUes.every((ue) => ue.validee);
      const anyRattrapage = bulletinUes.some((ue) => ue.etat === "rattrapage");
      const data = {
        student: {
          id: student.id,
          first_name: student.first_name,
          last_name: student.last_name,
          matricule: student.student_number,
          date_of_birth: student.date_of_birth,
          place_of_birth: student.place_of_birth,
          gender: student.gender,
        },
        filiere: { id: sem.filiere_id, name: sem.filiere_name, code: sem.filiere_code },
        semestre: { id: semestreId, libelle: sem.semestre_libelle },
        annee_academique: "2026-2027",
        effectif: studentIds.length,
        reference: `REL-WFGL-${sem.filiere_code}-${safeKey(sem.semestre_libelle)}-${student.student_number}`,
        rang: null,
        nb_ue_validees: bulletinUes.filter((ue) => ue.validee).length,
        nb_ue_total: bulletinUes.length,
        session_globale: bulletinUes.some((ue) => ue.session_validation === 2) ? 2 : 1,
        statut_etudiant: semestreValide ? "valide" : anyRattrapage ? "session2" : "dette",
        categories: [{ key: "_all", credits_obtenus: creditsValides, credits_ue: totalCredits, ues: bulletinUes }],
        ues: bulletinUes,
        moyenne_session: arrondi(moyenneSession),
        credits_valides: creditsValides,
        credits_total: totalCredits,
        semestre_valide: semestreValide,
        decision: semestreValide ? "admis" : anyRattrapage ? "rattrapage" : "ajourne",
      };

      await client.query(
        `INSERT INTO professional_bulletins (tenant_id, student_id, semestre_id, statut, data)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, student_id, semestre_id)
         DO UPDATE SET statut=EXCLUDED.statut, data=EXCLUDED.data, updated_at=now()`,
        [tenantId, studentId, semestreId, semestreValide ? "definitif" : "provisoire", JSON.stringify(data)]
      );
    }
  }
}

async function main() {
  const client = await connect();
  const counts = {
    students: 0,
    parents: 0,
    teachers: 0,
    classrooms: 0,
    sessions: 0,
    enrollments: 0,
    seances: 0,
    attendance: 0,
    assignments: 0,
    notes: 0,
    bulletins: 0,
  };

  try {
    await client.query("BEGIN");
    const tenant = await one(client, "SELECT id FROM tenants WHERE slug=$1 OR is_reference=true ORDER BY is_reference DESC LIMIT 1", [
      TENANT_SLUG,
    ]);
    if (!tenant) throw new Error("Tenant ecoledigitale introuvable.");
    const tenantId = tenant.id;
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    const [studentRole, parentRole, teacherRole] = await Promise.all([
      ensureRole(client, tenantId, "student", "Etudiant"),
      ensureRole(client, tenantId, "parent", "Parent"),
      ensureRole(client, tenantId, "teacher", "Enseignant"),
    ]);
    const admin = await one(
      client,
      "SELECT id FROM users WHERE tenant_id=$1 AND active_role_key IN ('admin','owner') ORDER BY active_role_key LIMIT 1",
      [tenantId]
    );
    const adminId = admin?.id || null;

    const studentIds = await ensureStudents(client, tenantId, studentRole);
    counts.students = studentIds.length;
    const parentIds = await ensureParents(client, tenantId, parentRole, studentIds);
    counts.parents = parentIds.length;
    const teacherIds = await ensureTeachers(client, tenantId, teacherRole);
    counts.teachers = teacherIds.length;
    const classroomIds = await ensureClassrooms(client, tenantId);
    counts.classrooms = classroomIds.length;

    const structure = await loadGlStructure(client, tenantId);
    if (structure.length === 0) throw new Error("Aucune UE/ECUE Genie Logiciel trouvee.");

    const sessionsByUe = new Map();
    for (let ui = 0; ui < structure.length; ui++) {
      const ue = structure[ui];
      const teacherId = ue.ue_code.endsWith("UE1") ? teacherIds[0] : teacherIds[ui % teacherIds.length];
      const classroomId = classroomIds[ui % classroomIds.length];
      const session = await ensureSession(client, tenantId, ue, teacherId, classroomId);
      sessionsByUe.set(ue.ue_id, session);
      counts.sessions++;

      await ensurePlanningAndSeances(client, tenantId, ue, session, teacherIds, classroomIds, adminId);
      await ensureAssignments(client, tenantId, ue, session, adminId);
      await ensureNotesAndResults(client, tenantId, ue, session, studentIds, adminId);
      await ensureAttendance(client, tenantId, session.id, studentIds, adminId);

      for (let si = 0; si < studentIds.length; si++) {
        await ensureEnrollmentAndPayment(client, tenantId, studentIds[si], session.id, ue, si);
        await ensureMatricule(client, tenantId, studentIds[si], ue.filiere_id, ue.filiere_code, si);
        counts.enrollments++;
      }
    }

    await buildAndStoreBulletins(client, tenantId, structure, studentIds);

    const summary = await client.query(
      `SELECT
         (SELECT count(*)::int FROM professional_ue_sessions WHERE tenant_id=$1 AND libelle LIKE 'WF-GL%') AS sessions,
         (SELECT count(*)::int FROM professional_ecue_seances WHERE tenant_id=$1 AND libelle LIKE 'WF-GL Seance%') AS seances,
         (SELECT count(*)::int FROM professional_ecue_attendance a
          JOIN professional_ecue_seances s ON s.id=a.seance_id
          WHERE a.tenant_id=$1 AND s.libelle LIKE 'WF-GL Seance%') AS attendance,
         (SELECT count(*)::int FROM professional_assignments WHERE tenant_id=$1 AND titre LIKE 'WF-GL%') AS assignments,
         (SELECT count(*)::int FROM professional_ecue_notes WHERE tenant_id=$1 AND libelle LIKE 'WF-GL%') AS notes,
         (SELECT count(*)::int FROM professional_bulletins WHERE tenant_id=$1 AND student_id = ANY($2::uuid[])) AS bulletins`,
      [tenantId, studentIds]
    );

    await client.query("COMMIT");
    console.log("Seed Genie Logiciel workflow termine.");
    console.log(
      JSON.stringify(
        {
          tenant: tenantId,
          students: counts.students,
          parents: counts.parents,
          teachers: counts.teachers,
          classrooms: counts.classrooms,
          attemptedSessions: counts.sessions,
          ...summary.rows[0],
          password: PASSWORD,
          twoChildrenParent: PARENTS[0].email,
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
