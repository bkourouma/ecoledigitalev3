import { PaymentCalculator, PricedHourRecord } from "../services/payment-calculator";
import type { TeacherPaymentConfig } from "@ecoledigitale/contracts";

/**
 * Tests — NON-RÉGRESSION du chemin académique (feature 031, SC-009).
 *
 * La feature déplace la collecte académique derrière un collecteur et corrige la
 * référence d'origine que le calculateur écrivait au mauvais endroit (écart E4).
 * Ces tests verrouillent le comportement attendu du chemin existant pour que
 * l'ajout du professionnel ne le modifie pas au passage.
 */

const calculator = new PaymentCalculator({ log: { info: () => {}, error: () => {}, warn: () => {} } } as any);

function config(over: Partial<TeacherPaymentConfig> = {}): TeacherPaymentConfig {
  return {
    id: "cfg",
    tenantId: "t",
    teacherId: "teacher-1",
    configType: "hourly",
    defaultHourlyRate: 8000,
    overtimeThreshold: 40,
    overtimeMultiplier: 1.5,
    effectiveFrom: new Date("2000-01-01"),
    createdBy: "u",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as TeacherPaymentConfig;
}

function acadHour(over: Partial<PricedHourRecord> = {}): PricedHourRecord {
  return {
    source: "academique",
    teacherId: "teacher-1",
    sessionDate: "2026-07-06",
    hours: 4,
    resolvedRate: 8000,
    attendanceSessionId: "att-1",
    courseId: "course-1",
    seanceId: null,
    ecueId: null,
    ueSessionId: null,
    intitule: "Mathématiques",
    code: "MATH1",
    cohorteLibelle: null,
    ...over,
  };
}

const PERIOD = {
  periodStart: new Date("2026-07-01T00:00:00Z"),
  periodEnd: new Date("2026-07-31T00:00:00Z"),
};

describe("Chemin académique — non-régression", () => {
  it("valorise les heures au tarif du cours", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "M. Kouassi",
      ...PERIOD,
      config: config(),
      hours: [acadHour({ hours: 4 }), acadHour({ hours: 3, sessionDate: "2026-07-07", attendanceSessionId: "att-2" })],
    });

    expect(result.totalAmount).toBe(7 * 8000);
    expect(result.hoursBySource.academique).toBe(7);
    expect(result.hoursBySource.professionnel).toBe(0);
  });

  it("écrit la référence dans attendance_session_id, JAMAIS dans teaching_hours_id (écart E4)", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "M. Kouassi",
      ...PERIOD,
      config: config(),
      hours: [acadHour()],
    });

    const line = result.hourDetails[0];
    expect(line.source).toBe("academique");
    expect(line.attendanceSessionId).toBe("att-1");
    // Écrire l'id d'une teacher_attendance_sessions dans teaching_hours_id
    // violait la clé étrangère et faisait échouer toute insertion de détail.
    expect(line.teachingHoursId).toBeNull();
    expect(line.seanceId).toBeNull();
  });

  it("les heures supplémentaires restent calculées par semaine au-delà du seuil", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "M. Kouassi",
      ...PERIOD,
      config: config({ overtimeThreshold: 5 }),
      hours: [acadHour({ hours: 8 })],
    });

    expect(result.calculationDetails.regularHours).toBe(5);
    expect(result.calculationDetails.overtimeHours).toBe(3);
    expect(result.overtimeAmount).toBe(3 * 8000 * 1.5);
  });

  it("un salaire reste calculé au prorata des jours ouvrés, sans dépendre des heures", () => {
    const avecHeures = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "M. Kouassi",
      ...PERIOD,
      config: config({ configType: "salary", monthlySalary: 400000, defaultHourlyRate: undefined }),
      hours: [acadHour({ hours: 20 })],
    });
    const sansHeures = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "M. Kouassi",
      ...PERIOD,
      config: config({ configType: "salary", monthlySalary: 400000, defaultHourlyRate: undefined }),
      hours: [],
    });

    expect(avecHeures.totalAmount).toBe(sansHeures.totalAmount);
  });
});
