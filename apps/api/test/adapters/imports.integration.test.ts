/**
 * Imports Excel / CSV (031) avec les VRAIS adaptateurs et les VRAIS modules cibles (Postgres réel, toutes les migrations v2) :
 * people (élèves, tuteurs, personnel), academic (inscriptions, classes, curriculum), assess (notes), finance (soldes
 * d'ouverture). Preuves : écriture par les cas d'usage publics (règles, audit, événements), idempotence au rejeu, doublons
 * probables détectés par le module cible, refus d'une ligne sans effet partiel, MFA des soldes financiers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createAssessment } from "../../src/modules/assess";
import { createProgram, createCurriculumVersion, listReference } from "../../src/modules/academic";
import { createImportsDeps, getImportJob, requestImportRun, type ImportsDeps } from "../../src/modules/imports";
import { buildPlatformPorts } from "../../src/platform/adapters";
import { MemoryStorage, prepareJob, runJob, type World as ImportWorld } from "../../src/modules/imports/test/support/world";
import { csvOf } from "../../src/modules/imports/test/support/files";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

describeIntegration("imports : adaptateurs réels sur les modules cibles", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let deps: ImportsDeps;
  let ctx: RequestContext;
  let world: ImportWorld;
  const audited: Array<{ action: string; entity: string }> = [];
  const storage = new MemoryStorage();

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 3 });
    ctx = w.director;
    await w.db.admin.query("INSERT INTO tenancy.institutions (id, tenant_id, code, name, pack, education_system, country_code) VALUES ($1, $2, 'ecole-test', 'École test', 'HIGHER', 'LMD', 'CI') ON CONFLICT DO NOTHING", [w.academic.institutionId, w.tenantId]);
    const ports = buildPlatformPorts(w.kit, null, {}, { audit: { record: async (_tx, entry) => void audited.push({ action: entry.action, entity: entry.entity }) } });
    deps = createImportsDeps({
      db: w.tenantDb,
      clock: w.clock,
      ports: { ...ports.imports, storage },
      config: { heartbeatMs: 50, leaseSeconds: 20 },
    });
    world = { viewer: { manage: true }, db: { admin: w.db.admin } } as unknown as ImportWorld;
  }, 300_000);
  beforeEach(async () => {
    await w.db.admin.query("UPDATE imports.jobs SET status = 'CANCELLED' WHERE status IN ('UPLOADED','MAPPED','VALIDATING','VALIDATED','QUEUED')");
  });
  afterAll(async () => {
    await w?.drop();
  });

  /** Problèmes d'un import, lisibles : « ligne : code : message ». */
  const problems = async (jobId: string): Promise<string[]> => {
    const page = unwrap(await (await import("../../src/modules/imports")).listImportRows(deps, ctx, jobId, { onlyProblems: true, limit: 50, offset: 0 }, world.viewer));
    return page.items.flatMap((r) => [...r.issues, ...r.outcomeIssues].filter((i) => i.severity === "ERROR").map((i) => r.rowNo + " : " + i.code + " : " + i.message));
  };
  const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await adminRows<{ n: string }>(w, sql, params))[0]?.n ?? 0);

  it("élèves : création par people.createStudent, inscription par academic, doublon probable refusé, rejeu sans doublon", async () => {
    const rows = [
      ["MAT-2025-001", "KONE", "Aminata", "F", "03/04/2012", "Abidjan", "L1-A"],
      ["MAT-2025-002", "TRAORE", "Ibrahim", "M", "21/11/2011", "Bouaké", "L1-A"],
      ["MAT-2025-003", "YAO", "Adjoua", "F", "05/05/2010", "Daloa", ""],
      ["MAT-2025-004", "BAMBA", "Koffi", "", "05/05/2010", "Daloa", ""], // sexe manquant
      ["MAT-2025-005", "ETUDIANT1", "Prenom1", "F", "11/01/2005", "Abidjan", ""], // même identité qu'un élève existant
      ["MAT-2025-006", "DIALLO", "Awa", "F", "07/07/2009", "Yamoussoukro", "INCONNUE"], // classe inconnue
    ];
    const before = await count("SELECT count(*) AS n FROM people.students");
    const job = await prepareJob(world, deps, ctx, csvOf([["Matricule", "Nom", "Prénoms", "Sexe", "Date de naissance", "Lieu de naissance", "Classe"], ...rows]), {
      importerOptions: { academicYearId: school.seed.yearId },
    });
    expect(job.status).toBe("VALIDATED");
    expect(job.validRows).toBe(3);
    expect(job.invalidRows).toBe(3);
    const preview = (await import("../../src/modules/imports")).getImportPreview;
    const pv = unwrap(await preview(deps, ctx, job.id, world.viewer));
    expect(pv.topIssues.map((t) => t.code)).toEqual(expect.arrayContaining(["imports.required", "people.possible_duplicate", "imports.reference_unknown"]));
    expect(await count("SELECT count(*) AS n FROM people.students")).toBe(before); // la validation n'écrit rien

    const out = await runJob(world, deps, ctx, job.id);
    expect(out.status).toBe("COMPLETED_WITH_ERRORS");
    expect(await count("SELECT count(*) AS n FROM people.students")).toBe(before + 3);
    const created = await adminRows<{ external_ref: string; student_number: string }>(w, "SELECT external_ref, student_number FROM people.students WHERE external_ref LIKE 'MAT-2025-%' ORDER BY external_ref");
    expect(created.map((c) => c.external_ref)).toEqual(["MAT-2025-001", "MAT-2025-002", "MAT-2025-003"]);
    expect(created.every((c) => c.student_number.length > 0)).toBe(true); // matricule gapless attribué par people
    // inscription par academic pour les deux lignes avec classe
    expect(await count("SELECT count(*) AS n FROM academic.enrollments e JOIN people.students s ON s.id = e.student_id WHERE s.external_ref IN ('MAT-2025-001','MAT-2025-002')")).toBe(2);
    expect(await count("SELECT count(*) AS n FROM academic.enrollments e JOIN people.students s ON s.id = e.student_id WHERE s.external_ref = 'MAT-2025-003'")).toBe(0);
    // événements et audit des modules cibles : mêmes garanties que par leurs routes
    expect(await count("SELECT count(*) AS n FROM kernel.domain_events WHERE type = 'people.student.created' AND occurred_at > now() - interval '1 minute'")).toBeGreaterThanOrEqual(3);
    expect(audited.filter((a) => a.action === "people.student.created").length).toBe(3);
    expect(audited.some((a) => a.action === "imports.run.request")).toBe(true); // l'import lui-même est audité (même recorder)

    // rejeu du même fichier : aucun élève de plus
    const again = await prepareJob(world, deps, ctx, csvOf([["Matricule", "Nom", "Prénoms", "Sexe", "Date de naissance", "Lieu de naissance", "Classe"], ...rows]), { importerOptions: { academicYearId: school.seed.yearId } });
    expect(again.plannedSkip).toBe(3);
    expect(again.plannedCreate).toBe(0);
    await runJob(world, deps, ctx, again.id);
    expect(await count("SELECT count(*) AS n FROM people.students")).toBe(before + 3);
  });

  it("élèves : « créer malgré le doublon » crée la fiche et trace le motif dans l'audit de people", async () => {
    const before = await count("SELECT count(*) AS n FROM people.students");
    const job = await prepareJob(world, deps, ctx, csvOf([["Matricule", "Nom", "Prénoms", "Sexe", "Date de naissance"], ["MAT-DUP-1", "ETUDIANT1", "Prenom1", "F", "11/01/2005"]]), { importerOptions: { duplicatePolicy: "ACKNOWLEDGE" } });
    expect(job.validRows).toBe(1);
    await runJob(world, deps, ctx, job.id);
    expect(await count("SELECT count(*) AS n FROM people.students")).toBe(before + 1);
    expect(audited.some((a) => a.action === "people.student.duplicate_acknowledged")).toBe(true);
  });

  it("élèves : mise à jour par matricule d'origine (politique UPDATE), sans effacer les champs absents", async () => {
    const job = await prepareJob(world, deps, ctx, csvOf([["Matricule", "Nom", "Prénoms", "Sexe", "Lieu de naissance"], ["MAT-2025-003", "YAO", "Adjoua", "F", "Gagnoa"]]), { onExisting: "UPDATE" });
    expect(job.plannedUpdate).toBe(1);
    await runJob(world, deps, ctx, job.id, "VALID_ONLY", "UPDATE");
    const row = (await adminRows<{ birth_place: string; birth_date: string | null }>(w, "SELECT p.birth_place, p.birth_date::text FROM people.students s JOIN people.persons p ON p.id = s.person_id WHERE s.external_ref = 'MAT-2025-003'"))[0]!;
    expect(row.birth_place).toBe("Gagnoa");
    expect(row.birth_date).toBe("2010-05-05"); // la date n'était pas dans le fichier : conservée
  });

  it("tuteurs : création unique d'un tuteur de deux enfants, deux liens, relation résolue par libellé, rejeu sans doublon", async () => {
    const header = ["Matricule élève", "Nom", "Prénoms", "Téléphone", "Lien de parenté", "Contact principal"];
    const rows = [
      ["MAT-2025-001", "KONE", "Mariam", "07 01 02 03 04", "Mère", "oui"],
      ["MAT-2025-002", "KONE", "Mariam", "07 01 02 03 04", "Mère", "oui"],
      ["MAT-2025-003", "YAO", "Kouassi", "05 11 22 33 44", "Père", "oui"],
      ["MAT-INCONNU", "DIALLO", "Fanta", "01 02 03 04 05", "Mère", ""],
      ["MAT-2025-001", "BAMBA", "Sali", "01 99 88 77 66", "Cousin(e)", ""],
    ];
    const job = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "guardians" });
    expect(job.status).toBe("VALIDATED");
    expect(job.validRows).toBe(3);
    expect(job.invalidRows).toBe(2); // élève inconnu ; lien « Cousin(e) » inconnu
    const before = await count("SELECT count(*) AS n FROM people.guardians");
    await runJob(world, deps, ctx, job.id);
    expect(await count("SELECT count(*) AS n FROM people.guardians")).toBe(before + 2); // Mariam une seule fois
    expect(await count("SELECT count(*) AS n FROM people.student_guardians sg JOIN people.students s ON s.id = sg.student_id WHERE s.external_ref IN ('MAT-2025-001','MAT-2025-002','MAT-2025-003')")).toBe(3);

    const again = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "guardians" });
    expect(again.plannedSkip).toBe(3);
    await runJob(world, deps, ctx, again.id);
    expect(await count("SELECT count(*) AS n FROM people.guardians")).toBe(before + 2);
    expect(await count("SELECT count(*) AS n FROM people.student_guardians")).toBe(3);
  });

  it("personnel : catégorie résolue par libellé ou code, idempotent par matricule d'origine", async () => {
    const header = ["Matricule", "Nom", "Prénoms", "Sexe", "Date de naissance", "Catégorie", "Poste", "Date d'embauche"];
    const rows = [
      ["ENS-001", "YAO", "Kouadio", "M", "15/08/1985", "TEACHER", "Professeur de mathématiques", "01/09/2015"],
      ["ENS-002", "BAMBA", "Fatoumata", "F", "02/02/1990", "Catégorie inconnue", "", ""],
    ];
    const job = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "staff" });
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(1);
    await runJob(world, deps, ctx, job.id);
    expect(await count("SELECT count(*) AS n FROM people.staff WHERE external_ref = 'ENS-001'")).toBe(1);
    const again = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "staff" });
    expect(again.plannedSkip).toBe(1);
  });

  it("classes : création par academic.createClassroom, existante ignorée, programme ou niveau inconnu refusé", async () => {
    const header = ["Code", "Nom", "Programme", "Niveau", "Effectif"];
    const rows = [
      ["L1-B", "Licence 1 B", "INFO", "L1", "80"],
      ["L1-A", "Licence 1 A", "INFO", "L1", "100"],
      ["L1-X", "Licence 1 X", "INCONNU", "L1", ""],
      ["L1-Y", "Licence 1 Y", "INFO", "L9", ""],
    ];
    const options = { institutionId: w.academic.institutionId, academicYearId: school.seed.yearId };
    const job = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "classrooms", importerOptions: options });
    expect(job).toMatchObject({ validRows: 2, plannedCreate: 1, plannedSkip: 1, invalidRows: 2 });
    await runJob(world, deps, ctx, job.id);
    expect(await count("SELECT count(*) AS n FROM academic.classrooms WHERE code = 'L1-B' AND capacity = 80")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM academic.classrooms WHERE code = 'L1-A'")).toBe(1);
  });

  it("curriculum : noeuds, matières créées au besoin, coefficients et crédits repris tels quels, parent déclaré plus haut", async () => {
    const levels = unwrap(await listReference(w.academic.deps, ctx, "education-levels"));
    const grades = unwrap(await listReference(w.academic.deps, ctx, "grade-levels"));
    const program = unwrap(await createProgram(w.academic.deps, ctx, { institutionId: w.academic.institutionId, educationLevelId: levels.find((l) => l.code === "LICENCE")!.id, code: "GEST", label: "Gestion", gradeLevelIds: [grades.find((g) => g.code === "L1")!.id] }));
    const version = unwrap(await createCurriculumVersion(w.academic.deps, ctx, { programId: program.id, academicYearId: school.seed.yearId }));
    const header = ["Code", "Libellé", "Type", "Parent", "Matière", "Niveau", "Coefficient", "Crédits", "Type de période", "N° de période"];
    const rows = [
      ["L1G", "Licence 1 Gestion", "LEVEL", "", "", "L1", "", "", "", ""],
      ["S1G", "Semestre 1", "PERIOD", "L1G", "", "", "", "", "SEMESTER", "1"],
      ["UEG1", "UE Compta", "UE", "S1G", "", "", "", "6", "", ""],
      ["COMPTA", "Comptabilité", "ECUE", "UEG1", "COMPTA", "", "2,5", "3", "", ""],
      ["ORPHAN", "Orphelin", "ECUE", "INTROUVABLE", "", "", "1", "1", "", ""],
    ];
    const job = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "curriculum", importerOptions: { curriculumVersionId: version.id } });
    expect(await problems(job.id)).toEqual([expect.stringContaining("INTROUVABLE")]);
    expect(job.invalidRows).toBe(1); // parent introuvable
    expect(job.validRows).toBe(4);
    const out = await runJob(world, deps, ctx, job.id);
    expect(out.status).toBe("COMPLETED_WITH_ERRORS");
    const node = (await adminRows<{ coefficient: string; credits: string }>(w, "SELECT coefficient::text, credits::text FROM academic.curriculum_nodes WHERE version_id = $1 AND code = 'COMPTA'", [version.id]))[0]!;
    expect(Number(node.coefficient)).toBe(2.5);
    expect(Number(node.credits)).toBe(3);
    expect(await count("SELECT count(*) AS n FROM academic.subjects WHERE code = 'COMPTA'")).toBe(1); // matière créée
    expect(await count("SELECT count(*) AS n FROM academic.curriculum_nodes WHERE version_id = $1", [version.id])).toBe(4);
  });

  it("notes : codes ABS / DISP, note hors barème refusée dès la validation, aucun calcul, rejeu idempotent", async () => {
    const assessment = unwrap(
      await createAssessment(school.assess, school.teacher.ctx, {
        typeId: school.types["DEVOIR"] as string,
        classroomId: school.seed.classroomId,
        curriculumNodeId: school.seed.ue1.ecueIds[0] as string,
        academicPeriodId: school.ref.academicPeriodId,
        title: "Devoir importé",
        assessedOn: (await adminRows<{ d: string }>(w, "SELECT (starts_on + 12)::text AS d FROM academic.academic_periods WHERE id = $1", [school.ref.academicPeriodId]))[0]!.d,
      }),
    );
    const numbers = await adminRows<{ student_number: string; id: string }>(w, "SELECT s.student_number, s.id FROM people.students s JOIN people.persons p ON p.id = s.person_id WHERE s.id = ANY($1::uuid[]) ORDER BY p.last_name", [school.pupils.map((p) => p.studentId)]);
    expect(numbers).toHaveLength(3);
    const header = ["Matricule", "Note"];
    const rows = [
      [numbers[0]!.student_number, "14,5"],
      [numbers[1]!.student_number, "ABS"],
      [numbers[2]!.student_number, "25"], // barème 20 : refusé
      ["INCONNU-1", "10"],
    ];
    const job = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "grades", importerOptions: { assessmentId: assessment.id } });
    expect(await problems(job.id)).toEqual([expect.stringContaining("dépasse le barème"), expect.stringContaining("INCONNU-1")]);
    expect(job).toMatchObject({ validRows: 2, invalidRows: 2 });
    const errors = (await import("../../src/modules/imports")).listImportRows;
    const bad = unwrap(await errors(deps, ctx, job.id, { validation: "INVALID", limit: 10, offset: 0 }, world.viewer));
    expect(bad.items.flatMap((r) => r.issues.map((i) => i.code))).toEqual(expect.arrayContaining(["assess.score_out_of_scale", "imports.reference_unknown"]));
    await runJob(world, deps, ctx, job.id);
    const grades = await adminRows<{ entry_status: string; score: string | null }>(w, "SELECT entry_status, score::text FROM assess.grades WHERE assessment_id = $1 AND entry_status <> 'NOT_GRADED' ORDER BY entry_status", [assessment.id]);
    expect(grades.map((g) => g.entry_status).sort()).toEqual(["ABSENT_UNEXCUSED", "ENTERED"]);
    expect(Number(grades.find((g) => g.entry_status === "ENTERED")!.score)).toBe(14.5);
    // rejeu : la note identique est reconnue (aucune écriture)
    const again = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "grades", importerOptions: { assessmentId: assessment.id } });
    expect(again.plannedSkip).toBe(2);
    expect(await count("SELECT count(*) AS n FROM results.period_results WHERE true")).toBe(0); // aucun résultat calculé par l'import
  });

  it("soldes d'ouverture : factures et avoir de reprise, montants entiers XOF, MFA exigée, rejeu neutre", async () => {
    const numbers = await adminRows<{ student_number: string }>(w, "SELECT s.student_number FROM people.students s JOIN people.persons p ON p.id = s.person_id WHERE s.id = ANY($1::uuid[]) ORDER BY p.last_name LIMIT 2", [school.pupils.map((p) => p.studentId)]);
    const header = ["Référence", "Matricule", "Type", "Montant", "Libellé", "Facture visée", "Motif"];
    const rows = [
      ["REPRISE-0001", numbers[0]!.student_number, "FACTURE", "150 000", "Solde scolarité", "", ""],
      ["REPRISE-0002", numbers[1]!.student_number, "FACTURE", "85000", "Solde scolarité", "", ""],
      ["REPRISE-0003", numbers[1]!.student_number, "AVOIR", "10000", "", "REPRISE-0002", "Remise fratrie"],
      ["REPRISE-0004", numbers[0]!.student_number, "FACTURE", "1500,5", "Décimale", "", ""],
    ];
    const options = { academicYear: "2024-2025" };
    const job = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "opening_balances", importerOptions: options });
    expect(job).toMatchObject({ validRows: 3, invalidRows: 1 });
    const bad = unwrap(await (await import("../../src/modules/imports")).listImportRows(deps, ctx, job.id, { validation: "INVALID", limit: 5, offset: 0 }, world.viewer));
    expect(bad.items[0]?.issues[0]?.code).toBe("imports.amount_not_integer");

    // Sans MFA : refusé par le cas d'usage (en plus du garde de permission sensible de l'API).
    const noMfa = { ...ctx, mfa: false } as RequestContext;
    const refused = await requestImportRun(deps, noMfa, job.id, { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true }, world.viewer);
    expect(!refused.ok && refused.error.code).toBe("imports.mfa_required");
    // Politique « mettre à jour » interdite pour des documents financiers.
    const upd = await requestImportRun(deps, ctx, job.id, { runMode: "VALID_ONLY", onExisting: "UPDATE", confirm: true }, world.viewer);
    expect(upd.ok).toBe(false);

    const before = await count("SELECT count(*) AS n FROM finance.invoices");
    const out = await runJob(world, deps, ctx, job.id);
    expect(out.status).toBe("COMPLETED_WITH_ERRORS");
    expect(await count("SELECT count(*) AS n FROM finance.invoices")).toBe(before + 2);
    const inv = await adminRows<{ total: string; credited: string; status: string }>(w, "SELECT total_amount::text AS total, credited_amount::text AS credited, status FROM finance.invoices ORDER BY created_at DESC LIMIT 2");
    expect(inv.map((i) => Number(i.credited)).sort((a, b) => a - b)).toEqual([0, 10000]);
    expect(inv.map((i) => Number(i.total)).sort((a, b) => a - b)).toEqual([85000, 150000]);

    const again = await prepareJob(world, deps, ctx, csvOf([header, ...rows]), { importerKey: "opening_balances", importerOptions: options });
    expect(again.plannedSkip).toBe(3);
    await runJob(world, deps, ctx, again.id);
    expect(await count("SELECT count(*) AS n FROM finance.invoices")).toBe(before + 2);
    expect((await import("../../src/modules/imports")).getImportJob).toBeDefined();
    const done = unwrap(await getImportJob(deps, ctx, job.id, world.viewer));
    expect(done.createdCount).toBe(3);
  });
});
