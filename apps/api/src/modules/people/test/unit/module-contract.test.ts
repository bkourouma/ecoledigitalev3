import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMISSION_KEY_RE, resolveModuleOrder } from "@ecoledigitale/kernel";
import {
  PEOPLE_ERROR_CODES,
  PEOPLE_EVENTS,
  peopleChangeStatusBodySchema,
  peopleCreateAssignmentBodySchema,
  peopleCreateGuardianBodySchema,
  peopleCreateStaffBodySchema,
  peopleCreateStudentBodySchema,
  peopleLinkGuardianBodySchema,
  peopleListStudentsQuerySchema,
  peopleOwnContactPatchSchema,
  peopleSettingsPatchSchema,
  peopleAvailabilityInputSchema,
} from "@ecoledigitale/contracts/src/v2/people";
import { buildPermissionCatalog, rbacManifest, resolveSystemRoles, SYSTEM_ROLE_TEMPLATES, type SystemRoleTemplate } from "../../../rbac";
import manifest from "../../manifest";
import { PeopleErrors } from "../../domain/errors";
import { newId } from "@ecoledigitale/kernel";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string): string => readFileSync(resolve(here, rel), "utf8");

describe("manifeste du module people", () => {
  it("est valide, de socle CORE, dépend de rbac seulement et s'insère dans l'ordre topologique", () => {
    expect(manifest.key).toBe("people");
    expect(manifest.packs).toEqual(["CORE"]);
    expect(manifest.dependsOn).toEqual(["rbac"]);
    expect(resolveModuleOrder([rbacManifest, manifest]).map((m) => m.key)).toEqual(["rbac", "people"]);
  });
  it("toutes les clés de permission respectent la convention ressource.action et sont uniques", () => {
    const keys = manifest.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(k).toMatch(PERMISSION_KEY_RE);
      expect(k).toMatch(/^(student|guardian|staff|teaching|people)\./);
    }
  });
  it("les permissions sensibles sont exactement celles qui exigent la MFA (sorties, sensible, export, anonymisation, contrats)", () => {
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    expect(sensitive).toEqual(["staff.contract.manage", "staff.status.update", "student.anonymize", "student.export", "student.sensitive.read", "student.status.update"]);
  });
  it("chaque permission utilisée par une route est déclarée au manifeste", () => {
    const source = read("../../http/plugin.ts");
    const used = new Set<string>();
    // Toute chaîne qui a la forme d'une clé de permission du module (ressource.action[.sous-action]).
    for (const m of source.matchAll(/"((?:student|guardian|staff|teaching|people)\.[a-z_]+(?:\.[a-z_]+)?)"/g)) used.add(m[1] as string);
    expect(used.size).toBeGreaterThan(25);
    const declared = new Set(manifest.permissions.map((p) => p.key));
    expect([...used].filter((k) => !declared.has(k))).toEqual([]);
  });
  it("les événements publiés sont exactement ceux du contrat, nommés module.entité.verbe-passé", () => {
    expect([...manifest.events.publishes].sort()).toEqual(Object.values(PEOPLE_EVENTS).sort());
    for (const e of manifest.events.publishes) expect(e).toMatch(/^people\.[a-z_]+\.[a-z_]+$/);
  });
  it("les menus ne renvoient qu'à des permissions déclarées", () => {
    const declared = new Set(manifest.permissions.map((p) => p.key));
    for (const m of manifest.menus) expect(declared.has(m.permission)).toBe(true);
  });
});

describe("alignement avec les modèles de rôles système (rbac)", () => {
  const catalog = buildPermissionCatalog([rbacManifest, manifest]);
  const resolved = (templates: readonly SystemRoleTemplate[] = SYSTEM_ROLE_TEMPLATES) => new Map(resolveSystemRoles(catalog, templates).map((r) => [r.template.key, new Set(r.permissions)]));
  it("le parent reçoit student.child.* (via *.child.*) et jamais student.read ; l'élève reçoit student.self.*", () => {
    const roles = resolved();
    const parent = roles.get("parent") as Set<string>;
    expect(parent.has("student.child.read")).toBe(true);
    expect(parent.has("student.child.update")).toBe(true);
    expect(parent.has("student.read")).toBe(false);
    expect(parent.has("student.list")).toBe(false);
    expect(parent.has("guardian.manage")).toBe(false);
    const eleve = roles.get("eleve") as Set<string>;
    expect(eleve.has("student.self.read")).toBe(true);
    expect(eleve.has("student.self.update")).toBe(true);
    expect(eleve.has("student.child.read")).toBe(false);
  });
  it("le secrétariat gère les dossiers, les tuteurs et les exports ; l'économe et le directeur des études lisent le personnel", () => {
    const roles = resolved();
    const sec = roles.get("secretariat") as Set<string>;
    for (const k of ["student.create", "student.update", "student.sensitive.read", "student.export", "guardian.manage"]) expect(sec.has(k)).toBe(true);
    expect(sec.has("staff.contract.read")).toBe(false);
    expect((roles.get("econome") as Set<string>).has("staff.read")).toBe(true);
    const de = roles.get("directeur_etudes") as Set<string>;
    expect(de.has("teaching.assign")).toBe(true);
    expect(de.has("staff.read")).toBe(true);
    expect(de.has("student.sensitive.read")).toBe(false);
  });
  it("modèle d'enseignant CIBLE (demande à rbac) : student.class.read et staff.own.* à la place de student.read / student.list", () => {
    const target = SYSTEM_ROLE_TEMPLATES.map((t) =>
      t.key === "enseignant" ? { ...t, permissions: [...t.permissions.filter((p) => p !== "student.read" && p !== "student.list"), "student.class.read", "staff.own.*"] } : t,
    );
    const teacher = resolved(target).get("enseignant") as Set<string>;
    expect(teacher.has("student.class.read")).toBe(true);
    expect(teacher.has("staff.own.read")).toBe(true);
    expect(teacher.has("staff.own.update")).toBe(true);
    expect(teacher.has("student.read")).toBe(false);
    expect(teacher.has("student.list")).toBe(false);
  });
});

describe("contrats Zod : entrées strictes", () => {
  const person = { lastName: "Traoré", firstName: "Aminata", sex: "F" as const };
  it("création d'élève : sexe obligatoire sans valeur par défaut (code stable), person XOR personId, motif de doublon", () => {
    expect(peopleCreateStudentBodySchema.safeParse({ person }).success).toBe(true);
    const noSex = peopleCreateStudentBodySchema.safeParse({ person: { lastName: "A", firstName: "B" } });
    expect(noSex.success).toBe(false);
    if (!noSex.success) expect(JSON.stringify(noSex.error.issues)).toContain("people.sex_required");
    expect(peopleCreateStudentBodySchema.safeParse({}).success).toBe(false);
    expect(peopleCreateStudentBodySchema.safeParse({ person, personId: newId() }).success).toBe(false);
    expect(peopleCreateStudentBodySchema.safeParse({ personId: newId() }).success).toBe(true);
    expect(peopleCreateStudentBodySchema.safeParse({ person, acknowledgeDuplicate: true }).success).toBe(false);
    expect(peopleCreateStudentBodySchema.safeParse({ person, acknowledgeDuplicate: true, duplicateReason: "Jumeaux" }).success).toBe(true);
  });
  it("un champ inconnu est refusé, jamais ignoré", () => {
    expect(peopleCreateStudentBodySchema.safeParse({ person, initialPassword: "x" }).success).toBe(false);
    expect(peopleCreateStudentBodySchema.safeParse({ person: { ...person, password: "x" } }).success).toBe(false);
    expect(peopleLinkGuardianBodySchema.safeParse({ guardianId: newId(), relationshipCode: "FATHER", isAdmin: true }).success).toBe(false);
    expect(peopleCreateGuardianBodySchema.safeParse({ person, role: "admin" }).success).toBe(false);
  });
  it("téléphone 5 à 40 caractères, e-mail valide, code pays ISO", () => {
    expect(peopleCreateStudentBodySchema.safeParse({ person: { ...person, phone: "1234" } }).success).toBe(false);
    expect(peopleCreateStudentBodySchema.safeParse({ person: { ...person, phone: "+".concat("2".repeat(39)) } }).success).toBe(true);
    expect(peopleCreateStudentBodySchema.safeParse({ person: { ...person, phone: "2".repeat(41) } }).success).toBe(false);
    expect(peopleCreateStudentBodySchema.safeParse({ person: { ...person, email: "pas-un-email" } }).success).toBe(false);
    expect(peopleCreateStudentBodySchema.safeParse({ person: { ...person, nationality: "civ" } }).success).toBe(false);
    expect(peopleCreateStudentBodySchema.safeParse({ person: { ...person, birthDate: "2024-02-30x" } }).success).toBe(false);
  });
  it("pagination plafonnée à 200 dans la requête de liste", () => {
    expect(peopleListStudentsQuerySchema.parse({}).limit).toBe(50);
    expect(peopleListStudentsQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(peopleListStudentsQuerySchema.safeParse({ limit: "200" }).success).toBe(true);
  });
  it("coordonnées propres : seulement e-mail, téléphones et adresse ; jamais l'identité", () => {
    expect(peopleOwnContactPatchSchema.safeParse({ phone: "+2250707070707" }).success).toBe(true);
    expect(peopleOwnContactPatchSchema.safeParse({ lastName: "X" }).success).toBe(false);
    expect(peopleOwnContactPatchSchema.safeParse({}).success).toBe(false);
  });
  it("statut, personnel, affectation, disponibilité, paramètres", () => {
    expect(peopleChangeStatusBodySchema.safeParse({ status: "WITHDRAWN", reasonText: "x" }).success).toBe(true);
    expect(peopleChangeStatusBodySchema.safeParse({ status: "DELETED" }).success).toBe(false);
    expect(peopleCreateStaffBodySchema.safeParse({ person, categoryCode: "teacher" }).success).toBe(false); // code en majuscules
    expect(peopleCreateAssignmentBodySchema.safeParse({ staffId: newId(), academicYearId: newId(), classroomId: newId(), roleCode: "BOSS", startsOn: "2025-09-01" }).success).toBe(false);
    expect(peopleAvailabilityInputSchema.safeParse({ weekday: 1, startTime: "08:00", endTime: "10:00" }).success).toBe(true);
    expect(peopleAvailabilityInputSchema.safeParse({ weekday: 1, startTime: "23:00", endTime: "01:00" }).success).toBe(false); // pas de chevauchement de minuit
    expect(peopleAvailabilityInputSchema.safeParse({ weekday: 8, startTime: "08:00", endTime: "10:00" }).success).toBe(false);
    expect(peopleSettingsPatchSchema.safeParse({ studentNumberPattern: "{SEQ:5}" }).success).toBe(true);
    expect(peopleSettingsPatchSchema.safeParse({ studentNumberPattern: "ABC" }).success).toBe(false);
    expect(peopleSettingsPatchSchema.safeParse({ studentRetentionDays: -1 }).success).toBe(false);
  });
});

describe("codes d'erreur stables", () => {
  it("chaque fabrique de PeopleErrors utilise un code déclaré dans le contrat", () => {
    const declared = new Set<string>(PEOPLE_ERROR_CODES);
    const samples = [
      PeopleErrors.studentNotFound(), PeopleErrors.guardianNotFound(), PeopleErrors.staffNotFound(), PeopleErrors.personNotFound(), PeopleErrors.linkNotFound(),
      PeopleErrors.assignmentNotFound(), PeopleErrors.contractNotFound(), PeopleErrors.qualificationNotFound(), PeopleErrors.classroomNotFound(),
      PeopleErrors.possibleDuplicate([]), PeopleErrors.sexRequired(), PeopleErrors.birthDateImplausible(), PeopleErrors.invalidTransition("A", "B"),
      PeopleErrors.reasonRequired("x"), PeopleErrors.personAlreadyStudent(), PeopleErrors.personAlreadyGuardian(), PeopleErrors.personAlreadyStaff(),
      PeopleErrors.primaryGuardianConflict(), PeopleErrors.linkExists(), PeopleErrors.linkClosed(), PeopleErrors.relationshipUnknown("X"),
      PeopleErrors.relationshipNotGuardian(), PeopleErrors.categoryUnknown("X"), PeopleErrors.categoryForbidden("X"), PeopleErrors.assignmentStaffNotActive("LEFT"),
      PeopleErrors.assignmentConflict("m"), PeopleErrors.assignmentInvalid("m"), PeopleErrors.assignmentClosed(), PeopleErrors.nodeTransversal(),
      PeopleErrors.nodeNotInClassroom(), PeopleErrors.periodOutsideYear(), PeopleErrors.academicUnavailable(), PeopleErrors.contractOverlap(),
      PeopleErrors.accountProvisioningUnavailable(), PeopleErrors.accountExists(), PeopleErrors.accountEmailRequired(), PeopleErrors.identityUnknown(),
      PeopleErrors.identityAlreadyLinked(), PeopleErrors.storageUnavailable(), PeopleErrors.invalidImage("m"), PeopleErrors.retentionNotConfigured(),
      PeopleErrors.retentionNotElapsed("2030-01-01"), PeopleErrors.notArchived(), PeopleErrors.alreadyAnonymized(), PeopleErrors.exportTooLarge(5000),
      PeopleErrors.externalRefConflict(), PeopleErrors.nationalIdConflict(), PeopleErrors.numberPatternInvalid("m"), PeopleErrors.referenceInUse("m"),
      PeopleErrors.teachingStaffMissing([]), PeopleErrors.contractTypeUnknown("X"),
    ];
    for (const e of samples) {
      if (e.kind === "forbidden") continue;
      expect(declared.has(e.code), e.code).toBe(true);
    }
    expect(PeopleErrors.accountProvisioningUnavailable().httpStatus).toBe(501);
    expect(PeopleErrors.possibleDuplicate([]).httpStatus).toBe(409);
    expect(PeopleErrors.studentNotFound().httpStatus).toBe(404);
  });
});

describe("garde-fous du code (spec 008 §7)", () => {
  const files = ["../../application/students.ts", "../../application/guardians.ts", "../../application/staff.ts", "../../application/teaching.ts", "../../application/accounts.ts", "../../http/plugin.ts"];
  it("aucun new Date() dans le code applicatif et HTTP (Clock injecté)", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/new Date\(\)/);
  });
  it("aucun SQL hors de infrastructure/ (application, domain et http sans SELECT/INSERT/UPDATE littéraux)", () => {
    for (const f of [...files, "../../domain/normalize.ts", "../../domain/assignments.ts"]) {
      expect(read(f), f).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE people|DELETE FROM)\b/);
    }
  });
  it("aucune valeur par défaut de sexe, aucun mot de passe en clair dans le code du module", () => {
    const all = [...files, "../../infrastructure/students-repo.ts", "../../infrastructure/persons-repo.ts", "../../domain/errors.ts"].map(read).join("\n");
    expect(all).not.toMatch(/sex\s*[:=]\s*["']M["']\s*(?:\?\?|\|\|)/);
    expect(all).not.toMatch(/initial_password|initialPassword|testpassword/i);
  });
});
