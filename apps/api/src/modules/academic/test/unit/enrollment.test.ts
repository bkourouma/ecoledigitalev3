import { describe, expect, it } from "vitest";
import {
  COURSE_TRANSITIONS,
  ENROLLMENT_ACTIONS_REQUIRING_REASON,
  ENROLLMENT_ACTION_TARGETS,
  ENROLLMENT_TRANSITIONS,
  SCHOOLING_COURSE_STATUSES,
  SCHOOLING_ENROLLMENT_STATUSES,
  canTransitionCourse,
  canTransitionEnrollment,
  courseConfirmationPolicyFor,
  decideCourseOnLinePaid,
  initialCourseStatus,
  initialEnrollmentStatus,
  invoicePaidConfirmsEnrollment,
  normalizeFunding,
  opensSchooling,
  statusHistory,
  validateEnrollmentAction,
  validateFunding,
} from "../../domain/enrollment";
import { canTransitionClassroom, classroomAcceptsEnrollment, classroomActivationProblem, classroomDatesProblem } from "../../domain/classroom";
import type { FundingType } from "../../domain/records";

const STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "COMPLETED", "WITHDRAWN", "TRANSFERRED_OUT", "CANCELLED"] as const;

describe("machine d'états d'une inscription (AC4.4) — matrice complète", () => {
  const legal: Record<string, string[]> = {
    PENDING: ["ACTIVE", "CANCELLED", "WITHDRAWN"],
    ACTIVE: ["SUSPENDED", "COMPLETED", "WITHDRAWN", "TRANSFERRED_OUT", "CANCELLED"],
    SUSPENDED: ["ACTIVE", "WITHDRAWN", "TRANSFERRED_OUT"],
    COMPLETED: ["ACTIVE"],
    WITHDRAWN: [],
    TRANSFERRED_OUT: [],
    CANCELLED: [],
  };
  it("49 couples : exactement les transitions légales (miroir de `enrollments_guard`)", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (from === to) continue;
        expect(canTransitionEnrollment(from, to), `${from} -> ${to}`).toBe(legal[from]!.includes(to));
      }
    }
    expect(Object.keys(ENROLLMENT_TRANSITIONS)).toHaveLength(7);
  });
  it("actions d'état : confirm n'est valable que depuis PENDING, resume que depuis SUSPENDED, reopen que depuis COMPLETED", () => {
    expect(validateEnrollmentAction("confirm", "PENDING")).toBe("ok");
    expect(validateEnrollmentAction("confirm", "ACTIVE")).toBe("illegal");
    expect(validateEnrollmentAction("resume", "SUSPENDED")).toBe("ok");
    expect(validateEnrollmentAction("resume", "ACTIVE")).toBe("illegal");
    expect(validateEnrollmentAction("reopen", "COMPLETED")).toBe("ok");
    expect(validateEnrollmentAction("reopen", "ACTIVE")).toBe("illegal");
    expect(validateEnrollmentAction("withdraw", "PENDING")).toBe("ok");
    expect(validateEnrollmentAction("withdraw", "CANCELLED")).toBe("illegal");
    expect(validateEnrollmentAction("cancel", "ACTIVE")).toBe("ok");
    expect(validateEnrollmentAction("cancel", "SUSPENDED")).toBe("illegal");
    expect(validateEnrollmentAction("suspend", "ACTIVE")).toBe("ok");
    expect(validateEnrollmentAction("complete", "SUSPENDED")).toBe("illegal");
    expect(ENROLLMENT_ACTION_TARGETS.confirm).toBe("ACTIVE");
    expect(ENROLLMENT_ACTIONS_REQUIRING_REASON).toEqual(expect.arrayContaining(["suspend", "withdraw", "cancel", "reopen"]));
  });
  it("seules les inscriptions ACTIVE/COMPLETED et les sélections CONFIRMED/COMPLETED ouvrent la scolarité (G-04)", () => {
    expect([...SCHOOLING_ENROLLMENT_STATUSES]).toEqual(["ACTIVE", "COMPLETED"]);
    expect([...SCHOOLING_COURSE_STATUSES]).toEqual(["CONFIRMED", "COMPLETED"]);
    for (const s of STATUSES) expect(opensSchooling(s)).toBe(s === "ACTIVE" || s === "COMPLETED");
  });
  it("historique : la création n'a pas d'état d'origine", () => {
    expect(statusHistory(null, "PENDING", null)).toMatchObject({ kind: "CREATED", from: null, to: { status: "PENDING" } });
    expect(statusHistory("PENDING", "ACTIVE", "ok")).toMatchObject({ kind: "STATUS", from: { status: "PENDING" }, to: { status: "ACTIVE" }, reason: "ok" });
  });
});

describe("machine d'états d'une sélection de cours", () => {
  it("PENDING -> CONFIRMED | CANCELLED ; CONFIRMED -> COMPLETED | CANCELLED ; COMPLETED et CANCELLED terminaux", () => {
    expect(canTransitionCourse("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransitionCourse("PENDING", "COMPLETED")).toBe(false);
    expect(canTransitionCourse("CONFIRMED", "COMPLETED")).toBe(true);
    expect(canTransitionCourse("CONFIRMED", "PENDING")).toBe(false);
    expect(canTransitionCourse("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransitionCourse("CANCELLED", "CONFIRMED")).toBe(false);
    expect(Object.keys(COURSE_TRANSITIONS)).toHaveLength(4);
  });
});

describe("classe : machine d'états et activation", () => {
  it("transitions légales", () => {
    expect(canTransitionClassroom("DRAFT", "ACTIVE")).toBe(true);
    expect(canTransitionClassroom("ACTIVE", "COMPLETED")).toBe(true);
    expect(canTransitionClassroom("COMPLETED", "ACTIVE")).toBe(true);
    expect(canTransitionClassroom("CANCELLED", "DRAFT")).toBe(true);
    expect(canTransitionClassroom("CANCELLED", "ACTIVE")).toBe(false);
    expect(canTransitionClassroom("ARCHIVED", "ACTIVE")).toBe(false);
  });
  it("une classe brouillon ou active accepte des inscriptions, pas les autres", () => {
    expect(classroomAcceptsEnrollment("DRAFT")).toBe(true);
    expect(classroomAcceptsEnrollment("ACTIVE")).toBe(true);
    for (const s of ["COMPLETED", "CANCELLED", "ARCHIVED"] as const) expect(classroomAcceptsEnrollment(s)).toBe(false);
  });
  it("une classe active exige un curriculum publié (Q-07)", () => {
    expect(classroomActivationProblem({ curriculumVersionId: null, versionStatus: null })).toBe("curriculum_required");
    expect(classroomActivationProblem({ curriculumVersionId: "v", versionStatus: "DRAFT" })).toBe("curriculum_draft");
    expect(classroomActivationProblem({ curriculumVersionId: "v", versionStatus: "PUBLISHED" })).toBeNull();
    expect(classroomActivationProblem({ curriculumVersionId: "v", versionStatus: "LOCKED" })).toBeNull();
    expect(classroomDatesProblem("2026-09-02", "2026-09-01")).toBe(true);
    expect(classroomDatesProblem("2026-09-01", "2026-09-01")).toBe(false);
    expect(classroomDatesProblem(null, "2026-09-01")).toBe(false);
  });
});

const fund = (over: Partial<FundingType> & Pick<FundingType, "code">): FundingType => ({ id: over.code, label: over.code, requiresReference: false, requiresFunder: false, sortOrder: 0, active: true, ...over });

describe("financement (AC4.3, PRD §20) : exigences en DONNÉES", () => {
  it("STATE_ASSIGNED sans référence est refusé ; avec référence accepté", () => {
    const def = fund({ code: "STATE_ASSIGNED", requiresReference: true });
    expect(validateFunding(def, { fundingType: "STATE_ASSIGNED", assignmentReference: null, funderLabel: null })?.message).toContain("référence");
    expect((validateFunding(def, { fundingType: "STATE_ASSIGNED", assignmentReference: "  ", funderLabel: null }) as { code: string }).code).toBe("academic.funding_reference_required");
    expect(validateFunding(def, { fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-2026-001", funderLabel: null })).toBeNull();
  });
  it("boursier et entreprise exigent un financeur ; privé n'a pas de référence", () => {
    const sch = fund({ code: "SCHOLARSHIP", requiresFunder: true });
    expect((validateFunding(sch, { fundingType: "SCHOLARSHIP", assignmentReference: null, funderLabel: null }) as { code: string }).code).toBe("academic.funding_funder_required");
    expect(validateFunding(sch, { fundingType: "SCHOLARSHIP", assignmentReference: null, funderLabel: "Fondation X" })).toBeNull();
    const priv = fund({ code: "PRIVATE" });
    expect((validateFunding(priv, { fundingType: "PRIVATE", assignmentReference: "x", funderLabel: null }) as { code: string }).code).toBe("academic.funding_reference_forbidden");
    expect(validateFunding(priv, { fundingType: "PRIVATE", assignmentReference: null, funderLabel: null })).toBeNull();
  });
  it("type inconnu ou inactif", () => {
    expect((validateFunding(undefined, { fundingType: "X", assignmentReference: null, funderLabel: null }) as { code: string }).code).toBe("academic.funding_type_unknown");
    expect((validateFunding(fund({ code: "OTHER", active: false }), { fundingType: "OTHER", assignmentReference: null, funderLabel: null }) as { code: string }).code).toBe("academic.funding_type_unknown");
    expect(normalizeFunding({ fundingType: "OTHER", assignmentReference: "  R ", funderLabel: " " })).toEqual({ assignmentReference: "R", funderLabel: null });
  });
});

describe("politique de confirmation à deux niveaux (décision métier validée, AC5.5)", () => {
  it("inscription : AUTO active à la création ; les politiques liées au paiement attendent, sauf « aucun frais d'inscription »", () => {
    expect(initialEnrollmentStatus("AUTO", null)).toBe("ACTIVE");
    expect(initialEnrollmentStatus("ON_REGISTRATION_FEE_PAID", null)).toBe("PENDING");
    expect(initialEnrollmentStatus("ON_REGISTRATION_FEE_PAID", true)).toBe("PENDING");
    expect(initialEnrollmentStatus("ON_REGISTRATION_FEE_PAID", false)).toBe("ACTIVE");
    expect(initialEnrollmentStatus("ON_FULL_PAYMENT", false)).toBe("PENDING");
    expect(initialEnrollmentStatus("MANUAL", false)).toBe("PENDING");
  });
  it("une facture soldée confirme l'inscription VISÉE : frais d'inscription ou paiement intégral selon la politique", () => {
    const withFee = { enrollmentId: "e1", containsRegistrationFee: true };
    const noFee = { enrollmentId: "e1", containsRegistrationFee: false };
    expect(invoicePaidConfirmsEnrollment("ON_REGISTRATION_FEE_PAID", withFee, "PENDING")).toBe(true);
    expect(invoicePaidConfirmsEnrollment("ON_REGISTRATION_FEE_PAID", noFee, "PENDING")).toBe(false);
    expect(invoicePaidConfirmsEnrollment("ON_REGISTRATION_FEE_PAID", { enrollmentId: "e1", containsRegistrationFee: null }, "PENDING")).toBe(false);
    expect(invoicePaidConfirmsEnrollment("ON_FULL_PAYMENT", noFee, "PENDING")).toBe(true);
    expect(invoicePaidConfirmsEnrollment("AUTO", withFee, "PENDING")).toBe(false);
    expect(invoicePaidConfirmsEnrollment("MANUAL", withFee, "PENDING")).toBe(false);
    // jamais « toutes les inscriptions de l'étudiant » : pas d'inscription visée => rien
    expect(invoicePaidConfirmsEnrollment("ON_FULL_PAYMENT", { enrollmentId: null, containsRegistrationFee: true }, "PENDING")).toBe(false);
    // seule une inscription en attente se confirme
    for (const s of ["ACTIVE", "SUSPENDED", "COMPLETED", "WITHDRAWN", "CANCELLED"] as const) expect(invoicePaidConfirmsEnrollment("ON_FULL_PAYMENT", withFee, s)).toBe(false);
  });
  it("cours : la politique effective dépend de la source ; AUTO confirme seulement si l'inscription est active", () => {
    expect(courseConfirmationPolicyFor("OPTION", "ON_LINE_PAID")).toBe("AUTO");
    expect(courseConfirmationPolicyFor("CARRY_OVER", "ON_LINE_PAID")).toBe("AUTO");
    expect(courseConfirmationPolicyFor("A_LA_CARTE", "ON_LINE_PAID")).toBe("ON_LINE_PAID");
    expect(courseConfirmationPolicyFor("RESIT", "MANUAL")).toBe("MANUAL");
    expect(initialCourseStatus("AUTO", "ACTIVE")).toBe("CONFIRMED");
    expect(initialCourseStatus("AUTO", "PENDING")).toBe("PENDING");
    expect(initialCourseStatus("ON_LINE_PAID", "ACTIVE")).toBe("PENDING");
    expect(initialCourseStatus("MANUAL", "ACTIVE")).toBe("PENDING");
  });
  it("cours : effet d'une ligne soldée (ON_LINE_PAID)", () => {
    expect(decideCourseOnLinePaid("ON_LINE_PAID", "PENDING", "ACTIVE")).toBe("confirm");
    expect(decideCourseOnLinePaid("ON_LINE_PAID", "PENDING", "PENDING")).toBe("remember_payment");
    expect(decideCourseOnLinePaid("ON_LINE_PAID", "CANCELLED", "ACTIVE")).toBe("reinstate_or_orphan");
    expect(decideCourseOnLinePaid("ON_LINE_PAID", "CONFIRMED", "ACTIVE")).toBe("ignore");
    expect(decideCourseOnLinePaid("ON_LINE_PAID", "COMPLETED", "ACTIVE")).toBe("ignore");
    expect(decideCourseOnLinePaid("MANUAL", "PENDING", "ACTIVE")).toBe("ignore");
    expect(decideCourseOnLinePaid("AUTO", "PENDING", "ACTIVE")).toBe("ignore");
  });
});
