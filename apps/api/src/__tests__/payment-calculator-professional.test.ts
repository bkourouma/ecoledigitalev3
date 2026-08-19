import { PaymentCalculator, PricedHourRecord } from "../services/payment-calculator";
import type { TeacherPaymentConfig } from "@ecoledigitale/contracts";

/**
 * Tests — collecte et valorisation des heures PROFESSIONNELLES (feature 031, US2).
 *
 * Couvre SC-001 (un enseignant du professionnel est payé) et la traçabilité
 * SC-003 (chaque ligne de détail référence sa séance).
 */

const calculator = new PaymentCalculator({ log: { info: () => {}, error: () => {}, warn: () => {} } } as any);

function config(over: Partial<TeacherPaymentConfig> = {}): TeacherPaymentConfig {
  return {
    id: "cfg",
    tenantId: "t",
    teacherId: "teacher-1",
    configType: "hourly",
    defaultHourlyRate: 10000,
    overtimeThreshold: 40,
    overtimeMultiplier: 1.5,
    effectiveFrom: new Date("2000-01-01"),
    createdBy: "u",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as TeacherPaymentConfig;
}

function proHour(over: Partial<PricedHourRecord> = {}): PricedHourRecord {
  return {
    source: "professionnel",
    teacherId: "teacher-1",
    sessionDate: "2026-07-06", // un lundi
    hours: 2,
    resolvedRate: 12000,
    seanceId: "seance-1",
    ecueId: "ecue-1",
    ueSessionId: "cohorte-1",
    attendanceSessionId: null,
    courseId: null,
    intitule: "Algorithmique",
    code: "INF101",
    cohorteLibelle: "Promo 2026 - S1",
    ...over,
  };
}

const PERIOD = {
  periodStart: new Date("2026-07-01T00:00:00Z"),
  periodEnd: new Date("2026-07-31T00:00:00Z"),
};

describe("Heures professionnelles — valorisation", () => {
  it("paie les heures d'ECUE au tarif résolu (SC-001)", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "K. Traoré",
      ...PERIOD,
      config: config(),
      hours: [
        proHour({ seanceId: "s1", hours: 2, resolvedRate: 12000 }),
        proHour({ seanceId: "s2", hours: 3, resolvedRate: 12000, sessionDate: "2026-07-07" }),
      ],
    });

    expect(result.totalAmount).toBe(5 * 12000);
    expect(result.hoursBySource.professionnel).toBe(5);
    expect(result.hoursBySource.academique).toBe(0);
  });

  it("chaque ligne de détail référence sa séance et jamais teaching_hours (SC-003)", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "K. Traoré",
      ...PERIOD,
      config: config(),
      hours: [proHour({ seanceId: "s1" }), proHour({ seanceId: "s2", sessionDate: "2026-07-07" })],
    });

    expect(result.hourDetails).toHaveLength(2);
    for (const line of result.hourDetails) {
      expect(line.source).toBe("professionnel");
      expect(line.seanceId).toBeTruthy();
      // La FK teaching_hours ne doit JAMAIS être alimentée par ce chemin :
      // c'est l'erreur qui rendait le calcul horaire inopérant (écart E4).
      expect(line.teachingHoursId).toBeNull();
      expect(line.attendanceSessionId).toBeNull();
    }
    expect(result.hourDetails.map((l) => l.seanceId)).toEqual(["s1", "s2"]);
  });

  it("applique un tarif différent par séance (tarif nominatif vs générique)", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "K. Traoré",
      ...PERIOD,
      config: config(),
      hours: [
        proHour({ seanceId: "s1", hours: 2, resolvedRate: 18000 }), // nominatif
        proHour({ seanceId: "s2", hours: 2, resolvedRate: 12000, sessionDate: "2026-07-07" }), // générique
      ],
    });

    expect(result.totalAmount).toBe(2 * 18000 + 2 * 12000);
  });

  it("sans heure validée, un enseignant horaire est à zéro sans ligne de détail (SC-004)", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "K. Traoré",
      ...PERIOD,
      config: config(),
      hours: [],
    });

    expect(result.totalAmount).toBe(0);
    expect(result.hourDetails).toHaveLength(0);
    expect(result.calculationDetails.breakdown[0].description).toMatch(/Aucune heure/);
  });

  it("un salarié voit ses heures listées sans effet sur le montant", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "A. Cissé",
      ...PERIOD,
      config: config({ configType: "salary", monthlySalary: 450000, defaultHourlyRate: undefined }),
      hours: [proHour({ hours: 4 })],
    });

    expect(result.paymentType).toBe("salary");
    expect(result.hoursBySource.professionnel).toBe(4);
    // Le montant ne dépend que du salaire : les heures sont informatives.
    expect(result.hourDetails).toHaveLength(0);
    expect(result.totalAmount).toBeGreaterThan(0);
  });
});
