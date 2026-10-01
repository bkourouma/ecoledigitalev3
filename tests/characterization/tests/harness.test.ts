import { describe, expect, inject, it } from "vitest";
import { EXPECTED_SQL_MIGRATION_FAILURES, LEGACY_HARNESS_PATCHES } from "../harness/migrations";
import { createScenarioDatabase } from "../harness/db";

/**
 * Vérifie le harnais lui-même : la reconstruction du schéma legacy est reproductible et contient les tables
 * que le code caractérisé lit. Si une migration est modifiée, ce test le signale AVANT que les snapshots
 * ne se mettent à dériver pour une cause qui n'a rien à voir avec les règles métier.
 */
const templateDb = inject("templateDb");
const outcomes = inject("migrationOutcomes");

describe("harnais : schéma legacy", () => {
  it("dispose d'un Postgres éphémère", () => {
    expect(templateDb, "TEST_DATABASE_URL absent : lancez `pnpm test:characterization`").toBeTruthy();
  });

  it("la chaîne Prisma s'applique intégralement", () => {
    const prisma = outcomes.filter((o) => o.chain === "prisma");
    expect(prisma.length).toBeGreaterThanOrEqual(16);
    expect(prisma.filter((o) => !o.ok)).toEqual([]);
  });

  it("les seules migrations SQL en échec sont celles documentées (et pour la raison documentée)", () => {
    const failed = Object.fromEntries(outcomes.filter((o) => o.chain === "sql" && !o.ok).map((o) => [o.name, true]));
    expect(Object.keys(failed).sort()).toEqual(Object.keys(EXPECTED_SQL_MIGRATION_FAILURES).sort());
  });

  it("tous les correctifs du harnais s'appliquent", () => {
    const patches = outcomes.filter((o) => o.chain === "patch");
    expect(patches.map((p) => p.name)).toEqual(LEGACY_HARNESS_PATCHES.map((p) => p.name));
    expect(patches.filter((p) => !p.ok)).toEqual([]);
  });

  it("les tables lues par le code caractérisé existent", async () => {
    const db = await createScenarioDatabase(templateDb!, "harness");
    try {
      const { rows } = await db.pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
      );
      const present = new Set(rows.map((r) => r.table_name as string));
      const required = [
        "tenants", "users", "student_profiles", "teachers", "programmes", "cycles", "academic_years",
        "academic_year_periods", "bilan_types", "courses", "classes", "class_courses", "student_enrollments",
        "student_period_course_averages", "student_period_attendance_summaries",
        "teacher_assignments", "teacher_attendance_sessions",
        "professional_ue", "professional_ecue", "professional_ue_ecue", "professional_ue_sessions",
        "professional_semestres", "professional_semestre_ue", "professional_semestre_sessions",
        "professional_enrollments", "professional_orders", "professional_ecue_notes",
        "professional_ecue_results", "student_professional_ue_results", "professional_bulletins",
        "professional_student_matricules", "professional_assignments", "professional_assignment_submissions",
        "professional_ecue_seances", "professional_ecue_attendance", "professional_session_ecue_teachers",
        "payment_periods", "payment_period_teachers", "teacher_payment_configs", "teacher_payments",
        "payment_hour_details", "course_hourly_rates", "professional_ecue_hourly_rates",
      ];
      expect(required.filter((t) => !present.has(t))).toEqual([]);
    } finally {
      await db.drop();
    }
  });
});
