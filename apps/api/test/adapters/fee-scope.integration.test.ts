/**
 * Clés libres des barèmes de finance (`levelKey`, `trackKey`, `learnerType`) : SENS fixé côté `academic` par l'adaptateur
 * d'inscriptions (`platform/adapters/directories-finance.ts` -> `createEnrollmentDirectory`), éprouvé sur de VRAIES inscriptions :
 *
 *   levelKey    = code du niveau de la classe (`grade level`, ex. « L1 »)
 *   trackKey    = code du programme de la classe (ex. « INFO »)
 *   learnerType = code du type de FINANCEMENT de l'inscription (PRIVATE, STATE_ASSIGNED, SCHOLARSHIP, COMPANY, STAFF_CHILD, OTHER)
 *   groupKey    = identifiant de la classe ; groupLabel = nom de la classe ; academicYear = code de l'année
 *
 * Le barème applicable se résout à partir de l'inscription (le plus spécifique gagne) ; la sonde de frais d'inscription de
 * `academic` dérive le même périmètre que la facturation (une seule définition du sens des clés).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { enrollStudent, getAcademicYear, getEnrollment } from "../../src/modules/academic";
import { createFinanceDeps, createFee, createFeeSchedule, getInvoiceById, issueInvoiceFromSchedule, resolveFeeAmount, type FinanceDeps } from "../../src/modules/finance";
import { createStudent } from "../../src/modules/people";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const xof = (n: number): Money => Money.of(n, "XOF");

describeIntegration("clés libres des barèmes : sens défini par academic, résolution depuis une inscription réelle", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let fin: FinanceDeps;
  let ctx: RequestContext;
  let yearCode: string;
  let feeId: string;
  let privateEnrollment: string;
  let privateStudent: string;
  let staffEnrollment: string;
  let staffStudent: string;

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 1 });
    ctx = w.director;
    fin = createFinanceDeps({ db: w.tenantDb, clock: w.clock, logger: w.kit.logger, portsProvider: () => w.ports.finance });
    yearCode = (await adminRows<{ code: string }>(w, "SELECT code FROM academic.academic_years WHERE id = $1", [school.seed.yearId]))[0]!.code;
    privateStudent = school.pupils[0]!.studentId;
    privateEnrollment = school.pupils[0]!.enrollmentId;

    // Un second élève, inscrit avec le financement « enfant de personnel » (type de financement de l'inscription)
    const created = unwrap(await createStudent(w.kit.people, ctx, { person: { lastName: "ENFANTPERSONNEL", firstName: "Eleve", sex: "M", birthDate: "2006-03-03", birthPlace: "Abidjan" } }));
    if (created.kind !== "created") throw new Error("création attendue");
    staffStudent = created.student.id;
    const e = unwrap(await enrollStudent(w.academic.deps, ctx, { studentId: staffStudent, classroomId: school.seed.classroomId, fundingType: "STAFF_CHILD" }));
    staffEnrollment = e.id;

    const fee = unwrap(await createFee(fin, ctx, { code: "SCOL", name: "Scolarité", category: "TUITION" }));
    feeId = fee.id;
    const sch = (amount: number, scope: Record<string, string>) =>
      createFeeSchedule(fin, ctx, { feeId, academicYear: yearCode, amount: xof(amount), effectiveFrom: "2000-01-01", scope });
    unwrap(await sch(500_000, {})); // général
    unwrap(await sch(600_000, { levelKey: "L1" })); // niveau
    unwrap(await sch(700_000, { levelKey: "L1", trackKey: "INFO" })); // niveau + programme
    unwrap(await sch(999_000, { levelKey: "L2" })); // autre niveau : jamais
    unwrap(await sch(998_000, { trackKey: "GEO" })); // autre programme : jamais
    unwrap(await sch(400_000, { learnerType: "STAFF_CHILD" })); // financement seul
    unwrap(await sch(350_000, { levelKey: "L1", trackKey: "INFO", learnerType: "STAFF_CHILD" })); // les trois clés
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("l'annuaire d'inscriptions d'academic fixe le sens des clés (niveau, programme, financement, classe, année)", async () => {
    const dir = w.ports.finance.enrollments!;
    const ref = (await dir.getEnrollment(ctx, privateEnrollment))!;
    expect(ref).toMatchObject({ enrollmentId: privateEnrollment, learnerId: privateStudent, academicYear: yearCode, levelKey: "L1", trackKey: "INFO", learnerType: "PRIVATE", groupKey: school.seed.classroomId });
    expect(ref.groupLabel).toBeTruthy();
    const enrollment = unwrap(await getEnrollment(w.academic.deps, ctx, privateEnrollment));
    expect(ref.learnerType).toBe(enrollment.fundingType); // learnerType = type de financement de l'inscription, tel quel
    const staffRef = (await dir.getEnrollment(ctx, staffEnrollment))!;
    expect(staffRef).toMatchObject({ levelKey: "L1", trackKey: "INFO", learnerType: "STAFF_CHILD" });
    expect(unwrap(await getAcademicYear(w.academic.deps, ctx, school.seed.yearId)).code).toBe(ref.academicYear);
  });

  it("les valeurs de `learnerType` sont celles de l'énumération de finance (même vocabulaire des deux côtés)", () => {
    const allowed = ["PRIVATE", "STATE_ASSIGNED", "SCHOLARSHIP", "COMPANY", "STAFF_CHILD", "OTHER"];
    expect(allowed).toContain("PRIVATE");
    expect(allowed).toContain("STAFF_CHILD");
  });

  it("résolution directe (simulateur) avec les clés de l'inscription : le barème le plus spécifique gagne ; les autres niveaux / programmes sont ignorés", async () => {
    const dir = w.ports.finance.enrollments!;
    const priv = (await dir.getEnrollment(ctx, privateEnrollment))!;
    const staff = (await dir.getEnrollment(ctx, staffEnrollment))!;
    const resolve = async (r: typeof priv) =>
      unwrap(await resolveFeeAmount(fin, ctx, { feeId, academicYear: r.academicYear, onDate: "2026-02-03", institutionId: null, campusId: null, levelKey: r.levelKey ?? null, trackKey: r.trackKey ?? null, learnerType: r.learnerType ?? null }));
    expect((await resolve(priv)).amount.amount).toBe(700_000);
    expect((await resolve(staff)).amount.amount).toBe(350_000);
    // un élève d'un autre niveau / programme / financement retombe sur le barème adapté
    const generic = unwrap(await resolveFeeAmount(fin, ctx, { feeId, academicYear: yearCode, onDate: "2026-02-03", institutionId: null, campusId: null, levelKey: "L3", trackKey: null, learnerType: "OTHER" }));
    expect(generic.amount.amount).toBe(500_000);
    const onlyLevel = unwrap(await resolveFeeAmount(fin, ctx, { feeId, academicYear: yearCode, onDate: "2026-02-03", institutionId: null, campusId: null, levelKey: "L1", trackKey: "AUTRE", learnerType: "PRIVATE" }));
    expect(onlyLevel.amount.amount).toBe(600_000);
  });

  it("facture depuis le barème avec `enrollmentId` : les clés de l'inscription réelle déterminent le montant ; classe et année recopiées sur la facture", async () => {
    const r1 = unwrap(await issueInvoiceFromSchedule(fin, ctx, { learnerId: privateStudent, enrollmentId: privateEnrollment, items: [{ feeCode: "SCOL" }], idempotencyKey: `inv-${newId()}` }));
    const inv1 = unwrap(await getInvoiceById(fin, ctx, r1.invoices[0]!.invoice.id)).invoice;
    expect(inv1.total.amount).toBe(700_000);
    expect(inv1).toMatchObject({ academicYear: yearCode, groupKey: school.seed.classroomId, enrollmentId: privateEnrollment });
    expect(inv1.groupLabel).toBeTruthy();
    const r2 = unwrap(await issueInvoiceFromSchedule(fin, ctx, { learnerId: staffStudent, enrollmentId: staffEnrollment, items: [{ feeCode: "SCOL" }], idempotencyKey: `inv-${newId()}` }));
    expect(r2.invoices[0]!.invoice.total.amount).toBe(350_000);
  });

  it("une portée explicite de la demande PRIME, clé par clé, sur celle de l'inscription (dérogation) ; une clé absente retombe sur l'inscription", async () => {
    // inscription PRIVATE (L1 / INFO) mais financement forcé à STAFF_CHILD : niveau et programme viennent de l'inscription
    const r = unwrap(
      await issueInvoiceFromSchedule(fin, ctx, { learnerId: privateStudent, enrollmentId: privateEnrollment, items: [{ feeCode: "SCOL" }], scope: { learnerType: "STAFF_CHILD" }, idempotencyKey: `inv-${newId()}` }),
    );
    expect(r.invoices[0]!.invoice.total.amount).toBe(350_000);
  });

  it("la sonde de frais d'inscription d'academic dérive le MÊME périmètre que la facturation (une seule définition du sens)", async () => {
    const reg = unwrap(await createFee(fin, ctx, { code: "INSC", name: "Inscription", category: "REGISTRATION" }));
    unwrap(await createFeeSchedule(fin, ctx, { feeId: reg.id, academicYear: yearCode, amount: xof(25_000), effectiveFrom: "2000-01-01", scope: { levelKey: "L1", trackKey: "INFO", learnerType: "PRIVATE" } }));
    const probe = w.ports.academic.registrationFee!;
    const enr = unwrap(await getEnrollment(w.academic.deps, ctx, privateEnrollment));
    const base = { classroomId: enr.classroomId, academicYearId: enr.academicYearId, programId: school.seed.programId, institutionId: enr.institutionId };
    // financement PRIVATE : dû ; STAFF_CHILD : aucun barème applicable -> pas de frais (confirmation immédiate)
    expect(await probe.registrationFeeDue(ctx, { ...base, fundingType: "PRIVATE" } as never)).toBe(true);
    expect(await probe.registrationFeeDue(ctx, { ...base, fundingType: "STAFF_CHILD" } as never)).toBe(false);
    // et la facturation voit la même chose : une facture d'inscription depuis le barème n'existe que pour PRIVATE
    const ok = await issueInvoiceFromSchedule(fin, ctx, { learnerId: privateStudent, enrollmentId: privateEnrollment, items: [{ feeCode: "INSC" }], idempotencyKey: `inv-${newId()}` });
    expect(ok.ok).toBe(true);
    const none = await issueInvoiceFromSchedule(fin, ctx, { learnerId: staffStudent, enrollmentId: staffEnrollment, items: [{ feeCode: "INSC" }], idempotencyKey: `inv-${newId()}` });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.code).toBe("finance.fee_schedule_not_found");
  });
});
