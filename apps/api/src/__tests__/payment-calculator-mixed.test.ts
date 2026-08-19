import { PaymentCalculator, PricedHourRecord } from "../services/payment-calculator";
import type { TeacherPaymentConfig } from "@ecoledigitale/contracts";

/**
 * Tests — agrégation des DEUX origines sur un seul bulletin (feature 031).
 *
 * Couvre SC-002 (un seul paiement, total = somme des origines) et FR-021
 * (le seuil d'heures supplémentaires porte sur le CUMUL, pas par origine).
 * C'est l'invariant qui justifie de ne pas dupliquer le module de paie.
 */

const calculator = new PaymentCalculator({ log: { info: () => {}, error: () => {}, warn: () => {} } } as any);

function config(over: Partial<TeacherPaymentConfig> = {}): TeacherPaymentConfig {
  return {
    id: "cfg",
    tenantId: "t",
    teacherId: "teacher-1",
    configType: "hourly",
    defaultHourlyRate: 10000,
    overtimeThreshold: 10,
    overtimeMultiplier: 1.5,
    effectiveFrom: new Date("2000-01-01"),
    createdBy: "u",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as TeacherPaymentConfig;
}

/** Toutes les heures tombent dans la MÊME semaine (lundi 6 → vendredi 10 juillet 2026). */
function hour(source: "academique" | "professionnel", hours: number, day: string, rate = 10000): PricedHourRecord {
  return {
    source,
    teacherId: "teacher-1",
    sessionDate: day,
    hours,
    resolvedRate: rate,
    seanceId: source === "professionnel" ? `seance-${day}-${hours}` : null,
    ecueId: source === "professionnel" ? "ecue-1" : null,
    ueSessionId: source === "professionnel" ? "cohorte-1" : null,
    attendanceSessionId: source === "academique" ? `att-${day}-${hours}` : null,
    courseId: source === "academique" ? "course-1" : null,
    intitule: null,
    code: null,
    cohorteLibelle: null,
  };
}

const PERIOD = {
  periodStart: new Date("2026-07-01T00:00:00Z"),
  periodEnd: new Date("2026-07-31T00:00:00Z"),
};

describe("Bulletin unique, deux origines", () => {
  it("additionne les heures académiques et professionnelles (SC-002)", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "D. Camara",
      ...PERIOD,
      config: config({ overtimeThreshold: 40 }),
      hours: [
        hour("academique", 4, "2026-07-06"),
        hour("professionnel", 3, "2026-07-07", 12000),
      ],
    });

    expect(result.hoursBySource.academique).toBe(4);
    expect(result.hoursBySource.professionnel).toBe(3);
    expect(result.totalAmount).toBe(4 * 10000 + 3 * 12000);
    // Un seul résultat, donc un seul teacher_payments en aval.
    expect(result.teacherId).toBe("teacher-1");
  });

  it("le détail distingue l'origine de chaque ligne (FR-022)", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "D. Camara",
      ...PERIOD,
      config: config({ overtimeThreshold: 40 }),
      hours: [hour("academique", 4, "2026-07-06"), hour("professionnel", 3, "2026-07-07")],
    });

    const sources = result.hourDetails.map((l) => l.source);
    expect(sources).toContain("academique");
    expect(sources).toContain("professionnel");

    const acad = result.hourDetails.find((l) => l.source === "academique")!;
    expect(acad.attendanceSessionId).toBeTruthy();
    expect(acad.seanceId).toBeNull();

    const pro = result.hourDetails.find((l) => l.source === "professionnel")!;
    expect(pro.seanceId).toBeTruthy();
    expect(pro.attendanceSessionId).toBeNull();
  });

  it("les heures supplémentaires se déclenchent sur le CUMUL des origines (FR-021)", () => {
    // Seuil à 10 h/semaine. 6 h académiques + 6 h professionnelles = 12 h :
    // 2 h doivent basculer en heures supplémentaires. Un calcul par origine
    // (6 h et 6 h, chacune sous le seuil) n'en déclencherait aucune — c'est
    // précisément la faille qu'un module dupliqué introduirait.
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "D. Camara",
      ...PERIOD,
      config: config({ overtimeThreshold: 10 }),
      hours: [
        hour("academique", 6, "2026-07-06"),
        hour("professionnel", 6, "2026-07-07"),
      ],
    });

    expect(result.calculationDetails.regularHours).toBe(10);
    expect(result.calculationDetails.overtimeHours).toBe(2);
    expect(result.overtimeAmount).toBe(2 * 10000 * 1.5);
    expect(result.totalAmount).toBe(10 * 10000 + 2 * 10000 * 1.5);
  });

  it("le seuil s'apprécie par semaine calendaire, pas sur la période", () => {
    // 8 h en semaine 1 puis 8 h en semaine 2, seuil 10 : aucune heure sup.
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "D. Camara",
      ...PERIOD,
      config: config({ overtimeThreshold: 10 }),
      hours: [
        hour("professionnel", 8, "2026-07-06"), // semaine du 6 juillet
        hour("academique", 8, "2026-07-13"), // semaine du 13 juillet
      ],
    });

    expect(result.calculationDetails.overtimeHours).toBe(0);
    expect(result.calculationDetails.regularHours).toBe(16);
  });

  it("une séance à cheval sur le seuil est coupée en deux lignes", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "D. Camara",
      ...PERIOD,
      config: config({ overtimeThreshold: 10 }),
      hours: [
        hour("professionnel", 8, "2026-07-06"),
        hour("professionnel", 4, "2026-07-07"), // 2 h normales + 2 h sup
      ],
    });

    const lignesDuJour2 = result.hourDetails.filter((l) => l.seanceId?.includes("2026-07-07"));
    expect(lignesDuJour2).toHaveLength(2);
    expect(lignesDuJour2.filter((l) => l.isOvertime)).toHaveLength(1);
    expect(lignesDuJour2.find((l) => l.isOvertime)!.hoursCount).toBe(2);
    expect(lignesDuJour2.find((l) => !l.isOvertime)!.hoursCount).toBe(2);
  });

  it("configuration mixte : salaire + heures des deux origines", () => {
    const result = calculator.computePayment({
      teacherId: "teacher-1",
      teacherName: "D. Camara",
      ...PERIOD,
      config: config({ configType: "mixed", monthlySalary: 450000, overtimeThreshold: 40 }),
      hours: [hour("academique", 5, "2026-07-06"), hour("professionnel", 5, "2026-07-07")],
    });

    expect(result.paymentType).toBe("mixed");
    // Le montant horaire s'ajoute au salaire prorata.
    expect(result.totalAmount).toBeGreaterThan(10 * 10000);
    expect(result.hoursBySource.academique).toBe(5);
    expect(result.hoursBySource.professionnel).toBe(5);
  });
});
