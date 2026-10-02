/** Libellés famille (`/me/labels`, `/children/:id/labels`) sur Postgres réel : nommage des identifiants, tutelle, lien de compte. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { academicFamilyLabelsDtoSchema } from "@ecoledigitale/contracts/src/v2/academic";
import { enrollStudent, getChildLabels, getMyLabels, updateAcademicSettings } from "../../index";
import { createAcademicTestDb, ctxFor, describeIntegration, type AcademicTestDb } from "../support/db";
import { FakeGuardianship } from "../support/ports";
import { addStudent, codeOf, makeWorld, seedHigher } from "../support/world";

describeIntegration("libellés des portails famille (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  it("le parent lié lit les libellés de son enfant ; un enfant non lié est introuvable ; l'élève lit les siens", async () => {
    const guardianship = new FakeGuardianship();
    const w = makeWorld(db, await db.createTenant(), { ports: { guardianship } });
    unwrap(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: "AUTO" }));
    const seed = await seedHigher(w);
    const parentUser = newId();
    const studentUser = newId();
    const child = addStudent(w, {}, studentUser);
    const stranger = addStudent(w);
    unwrap(await enrollStudent(w.deps, w.ctx, { studentId: child.studentId, classroomId: seed.classroomId }));
    unwrap(await enrollStudent(w.deps, w.ctx, { studentId: stranger.studentId, classroomId: seed.classroomId }));
    guardianship.link(parentUser, child.studentId);

    const parentCtx = ctxFor(w.tenantId, parentUser, ["parent"]);
    const labels = unwrap(await getChildLabels(w.deps, parentCtx, child.studentId));
    expect(academicFamilyLabelsDtoSchema.safeParse(labels).success).toBe(true);
    expect(labels.classrooms).toEqual([expect.objectContaining({ id: seed.classroomId, name: "Licence 1 A", code: "L1-A" })]);
    expect(labels.periods.map((p) => p.id)).toEqual(expect.arrayContaining(seed.periodIds));
    // nœuds du curriculum : semestre, UE et ECUE nommés (matière lisible), sans donnée de gestion
    const byId = new Map(labels.nodes.map((n) => [n.id, n]));
    expect(byId.get(seed.ue1.id)).toMatchObject({ code: "UE1", label: "UE UE1", credits: "6" });
    expect(byId.get(seed.ue1.ecueIds[0]!)).toMatchObject({ code: "E11", label: "ECUE E11", parentId: seed.ue1.id, coefficient: "2" });
    expect(Object.keys(labels.nodes[0]!).sort()).toEqual(["code", "coefficient", "credits", "id", "isTransversal", "label", "nodeTypeCode", "ordinal", "parentId"]);

    // un autre enfant (non lié) : 404, jamais les libellés d'un tiers
    expect(codeOf(await getChildLabels(w.deps, parentCtx, stranger.studentId))).toBe("academic.student_not_found");
    // un compte sans aucun lien non plus
    expect(codeOf(await getChildLabels(w.deps, ctxFor(w.tenantId, newId(), ["parent"]), child.studentId))).toBe("academic.student_not_found");

    // l'élève lit les siens (dossier lié au compte)
    const mine = unwrap(await getMyLabels(w.deps, ctxFor(w.tenantId, studentUser, ["eleve"])));
    expect(mine.classrooms.map((c) => c.id)).toEqual([seed.classroomId]);
    // un compte sans dossier : listes vides (pas d'erreur, pas de données)
    expect(unwrap(await getMyLabels(w.deps, ctxFor(w.tenantId, newId(), ["eleve"])))).toEqual({ classrooms: [], periods: [], nodes: [] });
  });
});
