import type { Pool, PoolClient } from "pg";
import { IdRegistry } from "./ids";
import type {
  ClassicSetup,
  HigherSetup,
  PayrollSetup,
  Scenario,
  StudentDecl,
  TeacherDecl,
} from "../scenarios/types";

/**
 * SEEDER LEGACY : charge un scénario déclaratif dans les tables legacy.
 *
 * Il écrit directement en SQL (aucun service legacy n'est appelé) : un seeder ne doit pas exécuter le code
 * qu'on caractérise. Les calculs (résultats ECUE, UE, bulletins, paie) sont déclenchés ensuite par les
 * étapes du scénario, via les VRAIS services et routes legacy.
 *
 * Le seeder v2 de la Phase 2 lira les mêmes scénarios et produira le même monde dans le modèle cible.
 *
 * Contournements de schéma, documentés dans le README (« Contournements du harnais ») :
 *   - une commande `professional_orders` payée est créée par (étudiant, promotion) : une inscription à une
 *     cohorte exige `order_id` NOT NULL ;
 *   - le mot de passe des utilisateurs est un marqueur non utilisable, jamais un secret.
 */

export interface SeedContext {
  pool: Pool;
  ids: IdRegistry;
  tenantId: string;
  adminUserId: string;
  /** `group:ue` -> id de la cohorte (professional_ue_sessions). */
  cohortIds: Map<string, string>;
  /** clé de semestre -> id. */
  semesterIds: Map<string, string>;
  /** ECUE -> UE qui la porte (par programme). */
  ecueUe: Map<string, string>;
  /** `group:ecue` -> cohorte qui porte l'ECUE dans ce groupe. */
  cohortOfEcue: Map<string, string>;
}

const PASSWORD_MARKER = "characterization-no-login";

type Row = Record<string, unknown>;

async function insert(client: Pool | PoolClient, table: string, row: Row): Promise<void> {
  const cols = Object.keys(row);
  const values = cols.map((c) => {
    const v = row[c];
    return v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) ? JSON.stringify(v) : v;
  });
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  await client.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders.join(", ")})`, values);
}

function pad(n: number, w = 4): string {
  return String(n).padStart(w, "0");
}

/** Établissement, administrateur, étudiants et enseignants (utilisateurs + profils). */
export async function seedBase(pool: Pool, scenario: Scenario): Promise<SeedContext> {
  const ids = new IdRegistry(scenario.meta.name);
  const tenantId = ids.id("tenant", scenario.tenant.slug);
  const adminUserId = ids.id("user", "admin");
  await insert(pool, "tenants", {
    id: tenantId,
    slug: scenario.tenant.slug,
    name: scenario.tenant.name,
    settings_json: {},
  });
  await insert(pool, "users", {
    id: adminUserId,
    tenant_id: tenantId,
    email: `admin@${scenario.tenant.slug}.test`,
    name: "Administrateur Test",
    first_name: "Administrateur",
    last_name: "Test",
    password_hash: PASSWORD_MARKER,
  });

  for (const s of scenario.students) await seedStudent(pool, ids, tenantId, scenario.tenant.slug, s);
  for (const t of scenario.teachers) await seedTeacher(pool, ids, tenantId, scenario.tenant.slug, t);

  return {
    pool,
    ids,
    tenantId,
    adminUserId,
    cohortIds: new Map(),
    semesterIds: new Map(),
    ecueUe: new Map(),
    cohortOfEcue: new Map(),
  };
}

async function seedStudent(pool: Pool, ids: IdRegistry, tenantId: string, slug: string, s: StudentDecl) {
  const userId = ids.id("user-student", s.key);
  await insert(pool, "users", {
    id: userId,
    tenant_id: tenantId,
    email: `${s.key}@${slug}.test`,
    name: `${s.firstName} ${s.lastName}`,
    first_name: s.firstName,
    last_name: s.lastName,
    password_hash: PASSWORD_MARKER,
  });
  await insert(pool, "student_profiles", {
    id: ids.id("student", s.key),
    tenant_id: tenantId,
    user_id: userId,
    student_number: s.studentNumber ?? `ETU-${s.key.toUpperCase()}`,
    date_of_birth: s.birthDate ?? "2005-01-01",
    place_of_birth: s.birthPlace ?? "Conakry",
    gender: s.gender ?? "masculin",
    is_repeating: s.repeating ?? false,
  });
}

async function seedTeacher(pool: Pool, ids: IdRegistry, tenantId: string, slug: string, t: TeacherDecl) {
  const userId = ids.id("user-teacher", t.key);
  await insert(pool, "users", {
    id: userId,
    tenant_id: tenantId,
    email: t.email ?? `${t.key}@${slug}.test`,
    name: `${t.firstName} ${t.lastName}`,
    first_name: t.firstName,
    last_name: t.lastName,
    password_hash: PASSWORD_MARKER,
  });
  await insert(pool, "teachers", {
    id: ids.id("teacher", t.key),
    tenant_id: tenantId,
    user_id: userId,
    first_name: t.firstName,
    last_name: t.lastName,
    email: t.email ?? `${t.key}@${slug}.test`,
    contract_type: t.status === "permanent" ? "permanent" : "freelance",
    status: "active",
  });
}

async function ensureCycle(ctx: SeedContext, type: "academic" | "professional"): Promise<string> {
  const id = ctx.ids.id("cycle", type);
  const exists = await ctx.pool.query("SELECT 1 FROM cycles WHERE id = $1", [id]);
  if (exists.rowCount === 0) {
    await insert(ctx.pool, "cycles", {
      id,
      tenant_id: ctx.tenantId,
      name: type === "academic" ? "Cycle classique" : "Cycle supérieur",
      code: type === "academic" ? "CLA" : "SUP",
      type,
      duration_months: 36,
      status: "active",
    });
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Pile Professional                                                    */
/* ------------------------------------------------------------------ */

export async function seedHigher(ctx: SeedContext, setup: HigherSetup): Promise<void> {
  const { pool, ids, tenantId } = ctx;
  const cycleId = await ensureCycle(ctx, "professional");

  for (const p of setup.programmes) {
    await insert(pool, "programmes", {
      id: ids.id("programme", p.key),
      tenant_id: tenantId,
      cycle_id: cycleId,
      name: p.name,
      code: p.code,
      domaine: p.domain ?? null,
      status: "active",
    });

    for (const e of p.ecues) {
      await insert(pool, "professional_ecue", {
        id: ids.id("ecue", e.key),
        tenant_id: tenantId,
        code: e.code,
        libelle: e.label,
        credits: e.credits,
      });
    }

    for (const u of p.ues) {
      await insert(pool, "professional_ue", {
        id: ids.id("ue", u.key),
        tenant_id: tenantId,
        filiere_id: ids.id("programme", p.key),
        code: u.code,
        libelle: u.label,
        nb_uv: u.declaredCredits,
        categorie: u.category ?? null,
      });
      let order = 0;
      for (const ecueKey of u.ecues) {
        await insert(pool, "professional_ue_ecue", {
          tenant_id: tenantId,
          ue_id: ids.id("ue", u.key),
          ecue_id: ids.id("ecue", ecueKey),
          ordre: order++,
          coefficient: 1,
        });
        ctx.ecueUe.set(ecueKey, u.key);
      }
    }

    for (const sem of p.semesters) {
      const semId = ids.id("semester", sem.key);
      ctx.semesterIds.set(sem.key, semId);
      await insert(pool, "professional_semestres", {
        id: semId,
        tenant_id: tenantId,
        filiere_id: ids.id("programme", p.key),
        libelle: sem.label,
        created_by: ctx.adminUserId,
      });
      for (const ueKey of sem.ues) {
        await insert(pool, "professional_semestre_ue", {
          tenant_id: tenantId,
          semestre_id: semId,
          ue_id: ids.id("ue", ueKey),
        });
      }
    }
  }

  // Promotions : une cohorte (professional_ue_sessions) par UE du programme, inscription de tous les étudiants.
  for (const g of setup.groups) {
    const programme = setup.programmes.find((p) => p.key === g.programme);
    if (!programme) throw new Error(`Promotion ${g.key} : programme ${g.programme} inconnu`);
    const link = g.semesterLink ?? "ue";
    const start = new Date(`${g.start}T00:00:00Z`);
    const opening = new Date(start.getTime() - 30 * 86400_000).toISOString();
    for (const u of programme.ues) {
      const sessionId = ids.id("cohort", `${g.key}:${u.key}`);
      ctx.cohortIds.set(`${g.key}:${u.key}`, sessionId);
      await insert(pool, "professional_ue_sessions", {
        id: sessionId,
        tenant_id: tenantId,
        ue_id: ids.id("ue", u.key),
        // Le nom de la promotion précède l'UE, séparé par un tiret cadratin : c'est la convention que le legacy parse.
        libelle: `${g.name} — ${u.label}`,
        date_debut: g.start,
        date_fin: g.end,
        inscription_ouverte_le: opening,
        inscription_fermee_le: start.toISOString(),
        statut: g.status ?? "en_cours",
      });
      for (const e of u.ecues) ctx.cohortOfEcue.set(`${g.key}:${e}`, sessionId);
      if (link === "session" || link === "both") {
        for (const sem of programme.semesters) {
          if (!sem.ues.includes(u.key)) continue;
          await insert(pool, "professional_semestre_sessions", {
            tenant_id: tenantId,
            semestre_id: ctx.semesterIds.get(sem.key)!,
            ue_session_id: sessionId,
          });
        }
      }
    }

    // Matricules professionnels de la filière (séquence par ordre de déclaration).
    let seq = 0;
    for (const sk of g.students) {
      seq++;
      await insert(pool, "professional_student_matricules", {
        tenant_id: tenantId,
        student_id: ids.id("student", sk),
        filiere_id: ids.id("programme", programme.key),
        seq,
        matricule: `${programme.code}-${pad(seq)}`,
      });
      const orderId = ids.id("order", `${g.key}:${sk}`);
      await insert(pool, "professional_orders", {
        id: orderId,
        tenant_id: tenantId,
        student_id: ids.id("student", sk),
        reference: `CMD-${g.key}-${sk}`.toUpperCase(),
        montant_total: 0,
        statut: "payee",
        nature: "ue",
        programme_id: ids.id("programme", programme.key),
      });
      for (const u of programme.ues) {
        // La conduite est une note unique saisie sans inscription à sa cohorte (voir computeStudentBulletin).
        if (u.conduct) continue;
        await insert(pool, "professional_enrollments", {
          tenant_id: tenantId,
          order_id: orderId,
          student_id: ids.id("student", sk),
          ue_session_id: ctx.cohortIds.get(`${g.key}:${u.key}`)!,
          prix_unitaire: 0,
          statut: "confirmee",
        });
      }
    }

    for (const t of g.teaching ?? []) {
      const cohort = ctx.cohortOfEcue.get(`${g.key}:${t.ecue}`);
      if (!cohort) throw new Error(`Promotion ${g.key} : ECUE ${t.ecue} sans cohorte`);
      await insert(pool, "professional_session_ecue_teachers", {
        tenant_id: tenantId,
        ue_session_id: cohort,
        ecue_id: ids.id("ecue", t.ecue),
        enseignant_id: ids.id("teacher", t.teacher),
      });
    }
  }

  await seedGrades(ctx, setup);
  await seedAttendance(ctx, setup);
}

async function seedGrades(ctx: SeedContext, setup: HigherSetup): Promise<void> {
  const { pool, ids, tenantId } = ctx;
  const assessments = new Map<string, string>(); // clé d'évaluation -> id
  let tick = 0;
  for (const gr of setup.grades) {
    const cohort = ctx.cohortOfEcue.get(`${gr.group}:${gr.ecue}`);
    if (!cohort) throw new Error(`Note ${gr.student}/${gr.ecue} : promotion ${gr.group} sans cohorte pour cette ECUE`);
    const max = gr.max ?? 20;
    const session = gr.session ?? 1;
    if ((gr.via ?? "manual") === "manual") {
      await insert(pool, "professional_ecue_notes", {
        tenant_id: tenantId,
        ecue_id: ids.id("ecue", gr.ecue),
        student_id: ids.id("student", gr.student),
        ue_session_id: cohort,
        nature: gr.nature,
        libelle: gr.label ?? null,
        note: gr.value,
        note_max: max,
        saisi_par: ctx.adminUserId,
        session,
      });
      continue;
    }
    // Évaluation avec copie notée (captée automatiquement par le calcul des résultats).
    const aKey = `${gr.group}:${gr.ecue}:${gr.nature}:${gr.label ?? ""}:${max}`;
    let aId = assessments.get(aKey);
    if (!aId) {
      aId = ids.id("assessment", aKey);
      assessments.set(aKey, aId);
      await insert(pool, "professional_assignments", {
        id: aId,
        tenant_id: tenantId,
        ecue_id: ids.id("ecue", gr.ecue),
        ue_session_id: cohort,
        titre: gr.label ?? (gr.nature === "examen" ? "Examen" : "Devoir"),
        type: gr.nature === "examen" ? "examen" : "devoir",
        note_max: max,
        created_by: ctx.adminUserId,
      });
    }
    tick++;
    await insert(pool, "professional_assignment_submissions", {
      tenant_id: tenantId,
      assignment_id: aId,
      student_id: ids.id("student", gr.student),
      statut: "note",
      note: gr.value,
      // Horodatage croissant et déterministe : « l'examen le plus récemment noté » est ainsi reproductible.
      graded_at: new Date(Date.UTC(2026, 0, 10, 8, 0, 0) + tick * 1000).toISOString(),
      graded_by: ctx.adminUserId,
    });
  }
}

async function seedAttendance(ctx: SeedContext, setup: HigherSetup): Promise<void> {
  const { pool, ids, tenantId } = ctx;
  const seances = new Map<string, string>();
  for (const a of setup.attendance ?? []) {
    const cohort = ctx.cohortOfEcue.get(`${a.group}:${a.ecue}`);
    if (!cohort) throw new Error(`Présence ${a.student}/${a.ecue} : cohorte introuvable`);
    const sKey = `${a.group}:${a.ecue}:${a.date}`;
    let seanceId = seances.get(sKey);
    if (!seanceId) {
      seanceId = ids.id("attendance-seance", sKey);
      seances.set(sKey, seanceId);
      await insert(pool, "professional_ecue_seances", {
        id: seanceId,
        tenant_id: tenantId,
        ecue_id: ids.id("ecue", a.ecue),
        ue_session_id: cohort,
        libelle: `Séance du ${a.date}`,
        date: a.date,
        heure_debut: "08:00",
        heure_fin: "10:00",
        statut: "realisee",
      });
    }
    await insert(pool, "professional_ecue_attendance", {
      tenant_id: tenantId,
      seance_id: seanceId,
      student_id: ids.id("student", a.student),
      statut: a.status === "excused" ? "excuse" : a.status === "late" ? "retard" : a.status,
      marked_by: ctx.adminUserId,
      ...(a.status === "excused"
        ? { justification: "Justificatif présenté", justifie_par: ctx.adminUserId, justifie_le: "2026-01-12T09:00:00Z" }
        : {}),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Pile classique                                                       */
/* ------------------------------------------------------------------ */

export async function seedClassic(ctx: SeedContext, setup: ClassicSetup): Promise<void> {
  const { pool, ids, tenantId } = ctx;
  const cycleId = await ensureCycle(ctx, "academic");
  const yearId = ids.id("academic-year", setup.academicYear.name);
  await insert(pool, "academic_years", {
    id: yearId,
    tenant_id: tenantId,
    name: setup.academicYear.name,
    start_date: setup.academicYear.start,
    end_date: setup.academicYear.end,
    is_active: true,
  });
  let order = 0;
  for (const p of setup.periods) {
    await insert(pool, "academic_year_periods", {
      id: ids.id("period", p.key),
      tenant_id: tenantId,
      academic_year_id: yearId,
      name: p.name,
      start_date: p.start,
      end_date: p.end,
      sort_order: order++,
    });
  }
  const programmeId = ids.id("programme", setup.programme.key);
  await insert(pool, "programmes", {
    id: programmeId,
    tenant_id: tenantId,
    cycle_id: cycleId,
    name: setup.programme.name,
    code: setup.programme.code,
    status: "active",
  });

  const sectionOf = (c: { section?: string }) => c.section ?? "Sans type de bilan"; // courses.bilan_type_id est NOT NULL en base
  const sections = [...new Set(setup.courses.map(sectionOf))];
  for (const s of sections) {
    await insert(pool, "bilan_types", { id: ids.id("section", s), tenant_id: tenantId, name: s });
  }
  // created_at fixé et décroissant : le legacy trie les matières par `created_at DESC`.
  let n = setup.courses.length;
  for (const c of setup.courses) {
    await insert(pool, "courses", {
      id: ids.id("course", c.key),
      tenant_id: tenantId,
      name: c.name,
      code: c.code,
      hours_total: 0,
      delivery_mode: "presential",
      programme_id: programmeId,
      coef: c.coefficient,
      bilan_type_id: ids.id("section", sectionOf(c)),
      created_at: new Date(Date.UTC(2025, 8, 1, 8, n--, 0)).toISOString(),
    });
  }
  for (const cl of setup.classes) {
    const classId = ids.id("class", cl.key);
    await insert(pool, "classes", {
      id: classId,
      tenant_id: tenantId,
      programme_id: programmeId,
      academic_year_id: yearId,
      name: cl.name,
      code: cl.key.toUpperCase().slice(0, 50),
    });
    for (const c of setup.courses) {
      await insert(pool, "class_courses", {
        id: ids.id("class-course", `${cl.key}:${c.key}`),
        tenant_id: tenantId,
        class_id: classId,
        course_id: ids.id("course", c.key),
      });
    }
    for (const sk of cl.students) {
      await insert(pool, "student_enrollments", {
        tenant_id: tenantId,
        student_id: ids.id("student", sk),
        class_id: classId,
        academic_year_id: yearId,
        status: "active",
      });
    }
  }
  for (const a of setup.averages) {
    await insert(pool, "student_period_course_averages", {
      tenant_id: tenantId,
      academic_year_period_id: ids.id("period", a.period),
      class_id: ids.id("class", a.class),
      student_id: ids.id("student", a.student),
      course_id: ids.id("course", a.course),
      average: a.value,
    });
  }
  for (const a of setup.absences ?? []) {
    await insert(pool, "student_period_attendance_summaries", {
      tenant_id: tenantId,
      academic_year_period_id: ids.id("period", a.period),
      class_id: ids.id("class", a.class),
      student_id: ids.id("student", a.student),
      absence_hours: a.absenceHours,
      justified_hours: a.justifiedHours,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Paie                                                                 */
/* ------------------------------------------------------------------ */

const ACADEMIC_SLOT_BY_HOURS: Record<number, string> = {
  1: "08:00-10:00",
  2: "08:00-10:00",
  3: "08:00-12:00",
  4: "08:00-12:00",
};

export async function seedPayroll(ctx: SeedContext, setup: PayrollSetup, teachers: TeacherDecl[]): Promise<void> {
  const { pool, ids, tenantId } = ctx;
  if (setup.classic) await seedClassic(ctx, setup.classic);
  if (setup.higher) await seedHigher(ctx, setup.higher);

  for (const c of setup.configs) {
    await insert(pool, "teacher_payment_configs", {
      tenant_id: tenantId,
      teacher_id: ids.id("teacher", c.teacher),
      config_type: c.type,
      monthly_salary: c.monthlySalary ?? null,
      default_hourly_rate: c.hourlyRate ?? null,
      overtime_threshold: c.overtimeThreshold ?? 40,
      overtime_multiplier: c.overtimeMultiplier ?? 1.5,
      effective_from: c.from,
      effective_to: c.to ?? null,
      created_by: ctx.adminUserId,
    });
  }

  for (const r of setup.rates) {
    if (r.ecue) {
      await insert(pool, "professional_ecue_hourly_rates", {
        tenant_id: tenantId,
        ecue_id: ids.id("ecue", r.ecue),
        enseignant_id: r.teacher ? ids.id("teacher", r.teacher) : null,
        montant_horaire: r.amount,
        valide_du: r.from,
        valide_au: r.to ?? null,
        created_by: ctx.adminUserId,
      });
    } else if (r.course) {
      await insert(pool, "course_hourly_rates", {
        tenant_id: tenantId,
        course_id: ids.id("course", r.course),
        teacher_id: r.teacher ? ids.id("teacher", r.teacher) : null,
        rate_amount: r.amount,
        rate_type: "theory",
        effective_from: r.from,
        effective_to: r.to ?? null,
        created_by: ctx.adminUserId,
      });
    }
  }

  // Séances académiques : affectation (teacher_assignments) puis séance de présence enseignant.
  const assignments = new Set<string>();
  const teacherByKey = new Map(teachers.map((t) => [t.key, t]));
  for (const s of setup.academicSessions) {
    const ccId = ids.id("class-course", `${s.class}:${s.course}`);
    const aKey = `${s.teacher}:${s.class}:${s.course}`;
    const assignmentId = ids.id("assignment", aKey);
    if (!assignments.has(aKey)) {
      assignments.add(aKey);
      await insert(pool, "teacher_assignments", {
        id: assignmentId,
        tenant_id: tenantId,
        class_course_id: ccId,
        teacher_id: ids.id("teacher", s.teacher),
        contract_type: teacherByKey.get(s.teacher)?.status === "permanent" ? "salarie" : "vacataire",
        datebut: "2025-09-01",
        datefin: "2026-08-31",
        status: "active",
      });
    }
    await insert(pool, "teacher_attendance_sessions", {
      id: ids.id("academic-session", s.key),
      tenant_id: tenantId,
      assignment_id: assignmentId,
      class_course_id: ccId,
      session_date: s.date,
      time_slot: ACADEMIC_SLOT_BY_HOURS[s.hours] ?? "08:00-12:00",
      session_title: `Séance ${s.key}`,
      duration_hours: s.hours,
      teacher_id: ids.id("teacher", s.teacher),
      status: s.status,
    });
  }

  // Séances d'ECUE (pile Professional).
  for (const s of setup.seances) {
    const cohort = ctx.cohortOfEcue.get(`${s.group}:${s.ecue}`);
    if (!cohort) throw new Error(`Séance ${s.key} : cohorte introuvable pour ${s.group}/${s.ecue}`);
    await insert(pool, "professional_ecue_seances", {
      id: ids.id("seance", s.key),
      tenant_id: tenantId,
      ecue_id: ids.id("ecue", s.ecue),
      ue_session_id: cohort,
      libelle: `Séance ${s.key}`,
      date: s.date,
      heure_debut: s.start ?? null,
      heure_fin: s.end ?? null,
      enseignant_id: ids.id("teacher", s.teacher),
      statut: s.status,
      duree_payee: s.paidVolume ?? null,
      duree_payee_par: s.paidVolume != null ? ctx.adminUserId : null,
      duree_payee_le: s.paidVolume != null ? "2026-01-05T08:00:00Z" : null,
      validated_by: s.validated ? ctx.adminUserId : null,
      validated_at: s.validated ? "2026-01-05T09:00:00Z" : null,
    });
  }
}
