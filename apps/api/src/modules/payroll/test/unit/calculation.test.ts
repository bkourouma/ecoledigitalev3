/** Moteur de calcul pur : exemples chiffrés (golden), arrondis, seuil d'heures supplémentaires, salaire. */
import { describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { computePayslip, lineAmount, PayrollCalculationError, compareHours } from "../../domain/calculation";
import { config, priced, STAFF, uuid, xof } from "../support/builders";

const period = { startDate: "2026-01-05", endDate: "2026-01-31" };
const compute = (cfg = config(), hours = [] as ReturnType<typeof priced>[], claimed?: Set<string>) =>
  computePayslip({ period, config: cfg, hours, currency: "XOF", ...(claimed ? { claimedSalaryDays: claimed } : {}) });

describe("montant d'une ligne : demi-supérieur, en entiers", () => {
  it("minutes × taux × multiplicateur / 60 000, arrondi demi-supérieur", () => {
    expect(lineAmount(60, xof(10_000), 1000).amount).toBe(10_000);
    expect(lineAmount(150, xof(10_000), 1000).amount).toBe(25_000);
    // 1 h à 3 333 × 1,5 = 4 999,5 → 5 000 (la moitié exacte monte)
    expect(lineAmount(60, xof(3333), 1500).amount).toBe(5000);
    // la moitié exacte : 30 min à 1 F/h = 0,5 → 1 ; 29 min = 0,48 → 0 ; 31 min = 0,52 → 1
    expect(lineAmount(30, xof(1), 1000).amount).toBe(1);
    expect(lineAmount(29, xof(1), 1000).amount).toBe(0);
    expect(lineAmount(31, xof(1), 1000).amount).toBe(1);
    // 4 h à 3 333 × 1,5 : la ligne est exactement 4 × 4 999,5 = 19 998 (le legacy enregistrait 19 999,98 pour 4 × 5 000,00)
    expect(lineAmount(240, xof(3333), 1500).amount).toBe(19_998);
    expect(lineAmount(1, xof(0), 5000).amount).toBe(0);
  });

  it("n'utilise aucun flottant : un produit intermédiaire au-delà de 2^53 reste exact", () => {
    const big = lineAmount(1440, Money.of(4_000_000_000_000, "XOF"), 5000); // 1440 × 4e12 × 5000 > 2^53
    expect(big.amount).toBe(Number((1440n * 4_000_000_000_000n * 5000n + 30000n) / 60000n));
  });
});

describe("horaire : cumul hebdomadaire, seuil, séance à cheval", () => {
  it("T1 — 6 h validées à 10 000 F/h : 60 000 F, une ligne par séance", () => {
    const c = compute(config(), [priced({ date: "2026-01-06", minutes: 150 }), priced({ date: "2026-01-08", minutes: 210 })]);
    expect(c.grossAmount.amount).toBe(60_000);
    expect(c.lines.map((l) => l.amount.amount)).toEqual([25_000, 35_000]);
    expect(c.lines.every((l) => !l.isOvertime && l.multiplierPermille === 1000)).toBe(true);
    expect(c.regularMinutes).toBe(360);
    expect(c.overtimeMinutes).toBe(0);
  });

  it("une séance de 5,5 h d'Awa (2 h 30 + 3 h) vaut 55 000 F — S17-T", () => {
    const c = compute(config(), [priced({ date: "2026-01-05", minutes: 150 }), priced({ date: "2026-01-31", minutes: 180, startTime: null })]);
    expect(c.grossAmount.amount).toBe(55_000);
  });

  it("le seuil exact ne déclenche rien ; une minute de plus bascule UNE minute en heures supplémentaires", () => {
    const at = compute(config({ overtimeThresholdMinutes: 600 }), [priced({ date: "2026-01-12", minutes: 600 })]);
    expect(at.overtimeMinutes).toBe(0);
    expect(at.lines).toHaveLength(1);
    const over = compute(config({ overtimeThresholdMinutes: 600 }), [priced({ date: "2026-01-12", minutes: 601 })]);
    expect(over.overtimeMinutes).toBe(1);
    expect(over.lines.map((l) => [l.minutes, l.isOvertime])).toEqual([[600, false], [1, true]]);
  });

  it("une séance à cheval sur le seuil est COUPÉE en deux lignes (le legacy ne produisait aucun bulletin)", () => {
    const cfg = config({ overtimeThresholdMinutes: 600, overtimeMultiplierPermille: 1500 });
    const h1 = priced({ date: "2026-01-12", minutes: 480, rate: 8000 }); // 8 h
    const h2 = priced({ date: "2026-01-13", minutes: 240, rate: 8000 }); // 4 h : 2 h normales + 2 h majorées
    const c = compute(cfg, [h1, h2]);
    expect(c.lines.map((l) => [l.sourceRefId === h1.refId ? "h1" : "h2", l.minutes, l.isOvertime, l.multiplierPermille, l.amount.amount])).toEqual([
      ["h1", 480, false, 1000, 64_000],
      ["h2", 120, false, 1000, 16_000],
      ["h2", 120, true, 1500, 24_000],
    ]);
    expect(c.grossAmount.amount).toBe(104_000);
    // deux lignes pour la même séance mais jamais la même (séance, majoration)
    const keys = c.lines.map((l) => `${l.sourceRefId}|${l.isOvertime}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("T2/AC3.4 — le cumul porte sur les DEUX origines : 30 h de présences + 30 h de séances déclenchent les heures sup (seuil 40 h)", () => {
    const hours = [
      priced({ kind: "ATTENDANCE", date: "2026-01-12", minutes: 900 }),
      priced({ kind: "ATTENDANCE", date: "2026-01-13", minutes: 900 }),
      priced({ kind: "SESSION", date: "2026-01-14", minutes: 900 }),
      priced({ kind: "SESSION", date: "2026-01-15", minutes: 900 }),
    ];
    const c = compute(config({ overtimeThresholdMinutes: 2400 }), hours);
    expect(c.minutesBySource).toEqual({ SESSION: 1800, ATTENDANCE: 1800 });
    expect(c.regularMinutes).toBe(2400);
    expect(c.overtimeMinutes).toBe(1200);
    // sans cumul inter-origines (30 h + 30 h scindées), aucune heure sup ne serait déclenchée
    const scindees = [hours.slice(0, 2), hours.slice(2)].map((h) => compute(config(), h).overtimeMinutes);
    expect(scindees).toEqual([0, 0]);
    expect(c.lines.some((l) => l.isOvertime)).toBe(true);
  });

  it("les semaines (lundi-dimanche) ne se cumulent pas : dimanche et lundi suivant sont deux semaines", () => {
    const cfg = config({ overtimeThresholdMinutes: 600 });
    const c = compute(cfg, [priced({ date: "2026-01-11", minutes: 600 }), priced({ date: "2026-01-12", minutes: 600 })]); // dim 11 / lun 12
    expect(c.overtimeMinutes).toBe(0);
    const same = compute(cfg, [priced({ date: "2026-01-12", minutes: 600 }), priced({ date: "2026-01-18", minutes: 60 })]); // lun 12 / dim 18
    expect(same.overtimeMinutes).toBe(60);
  });

  it("le multiplicateur 1,0 (1 000 ‰) est permis : ligne majorée au même taux", () => {
    const c = compute(config({ overtimeThresholdMinutes: 60, overtimeMultiplierPermille: 1000 }), [priced({ date: "2026-01-12", minutes: 120 })]);
    expect(c.lines.map((l) => [l.isOvertime, l.multiplierPermille])).toEqual([[false, 1000], [true, 1000]]);
    expect(c.grossAmount.amount).toBe(20_000);
  });

  it("le taux 0 est une valeur : l'heure est payée 0, jamais traitée comme absente", () => {
    const c = compute(config(), [priced({ date: "2026-01-12", minutes: 120, rate: 0 })]);
    expect(c.lines).toHaveLength(1);
    expect(c.grossAmount.isZero()).toBe(true);
  });

  it("ordre total : à date égale ATTENDANCE précède SESSION, puis heure de début (nulle en dernier), puis identifiant", () => {
    const a = priced({ kind: "SESSION", date: "2026-01-12", startTime: "08:00", refId: uuid(2), minutes: 60 });
    const b = priced({ kind: "ATTENDANCE", date: "2026-01-12", startTime: null, refId: uuid(3), minutes: 60 });
    const c = priced({ kind: "SESSION", date: "2026-01-12", startTime: "07:00", refId: uuid(1), minutes: 60 });
    const d = priced({ kind: "SESSION", date: "2026-01-12", startTime: null, refId: uuid(0), minutes: 60 });
    expect([a, b, c, d].sort(compareHours).map((h) => h.refId)).toEqual([uuid(3), uuid(1), uuid(2), uuid(0)]);
  });
});

describe("salaire : prorata des jours ouvrés, mois par mois, entiers", () => {
  const salary = (monthly: number | null, annual: number | null = null) => config({ type: "SALARY", monthlySalary: monthly === null ? null : xof(monthly), annualSalary: annual === null ? null : xof(annual), defaultHourlyRate: null });

  it("période d'un seul mois : formule historique, arrondie à l'unité (400 000 × 20/22 = 363 636,36 → 363 636)", () => {
    const c = compute(salary(400_000));
    expect(c.salaryAmount.amount).toBe(363_636);
    expect(c.salaryDays).toHaveLength(20);
    expect(c.details.salaryMonths).toEqual([{ month: "2026-01", workingDaysInMonth: 22, workingDaysInPeriod: 20, alreadyPaidDays: 0, daysDue: 20, amount: 363_636 }]);
  });

  it("mois entier = salaire mensuel exactement", () => {
    const c = computePayslip({ period: { startDate: "2026-01-01", endDate: "2026-01-31" }, config: salary(400_000), hours: [], currency: "XOF" });
    expect(c.salaryAmount.amount).toBe(400_000);
  });

  it("salaire annuel / 12 : 4 800 000 → 400 000 par mois, sans erreur d'arrondi cumulée", () => {
    const c = computePayslip({ period: { startDate: "2026-01-01", endDate: "2026-01-31" }, config: salary(null, 4_800_000), hours: [], currency: "XOF" });
    expect(c.salaryAmount.amount).toBe(400_000);
    const odd = computePayslip({ period: { startDate: "2026-01-05", endDate: "2026-01-31" }, config: salary(null, 1_000_000), hours: [], currency: "XOF" });
    // 1 000 000 × 20 / (12 × 22) = 75 757,57… → 75 758
    expect(odd.salaryAmount.amount).toBe(75_758);
  });

  it("période de plusieurs mois : prorata mois par mois, somme des mois (le legacy ramenait tout au mois de début)", () => {
    const c = computePayslip({ period: { startDate: "2026-01-15", endDate: "2026-03-10" }, config: salary(300_000), hours: [], currency: "XOF" });
    // janvier : 15→30 = 12 jours ouvrés / 22 ; février : 20 / 20 ; mars : 1→10 = 7 / 22
    expect(c.details.salaryMonths.map((m) => [m.month, m.daysDue, m.workingDaysInMonth, m.amount])).toEqual([
      ["2026-01", 12, 22, 163_636],
      ["2026-02", 20, 20, 300_000],
      ["2026-03", 7, 22, 95_455],
    ]);
    expect(c.salaryAmount.amount).toBe(163_636 + 300_000 + 95_455);
  });

  it("jours déjà payés par un autre bulletin : exclus (périodes chevauchantes ne paient pas deux fois)", () => {
    const first = compute(salary(400_000));
    expect(first.salaryAmount.amount).toBe(363_636);
    const second = compute(salary(400_000), [], new Set(first.salaryDays));
    expect(second.salaryAmount.amount).toBe(0);
    expect(second.salaryDays).toEqual([]);
    expect(second.details.salaryMonths[0]?.alreadyPaidDays).toBe(20);
    // période chevauchante à moitié : seuls les jours restants sont dus
    const partial = computePayslip({ period: { startDate: "2026-01-19", endDate: "2026-02-06" }, config: salary(400_000), hours: [], currency: "XOF", claimedSalaryDays: new Set(first.salaryDays) });
    expect(partial.details.salaryMonths.map((m) => [m.month, m.daysDue])).toEqual([["2026-01", 0], ["2026-02", 5]]);
  });

  it("T3 — un salarié voit son montant inchangé par ses séances, listées à titre informatif sans ligne", () => {
    const sansHeures = compute(salary(400_000));
    const avec = compute(salary(400_000), [priced({ date: "2026-01-20", minutes: 120, rate: 0, rateOrigin: "SALARY_ZERO" })]);
    expect(avec.salaryAmount.amount).toBe(sansHeures.salaryAmount.amount);
    expect(avec.lines).toEqual([]);
    expect(avec.details.informationalMinutes).toBe(120);
    expect(avec.grossAmount.amount).toBe(363_636);
  });

  it("les week-ends ne comptent pas : une période de samedi-dimanche ne doit rien", () => {
    const c = computePayslip({ period: { startDate: "2026-01-10", endDate: "2026-01-11" }, config: salary(400_000), hours: [], currency: "XOF" });
    expect(c.salaryAmount.amount).toBe(0);
    expect(c.salaryDays).toEqual([]);
  });
});

describe("mixte : salaire + horaire", () => {
  it("Maya : 100 000 × 20/22 = 90 909 + 4 h au tarif ECUE 9 000 = 126 909 (legacy 126 909,09)", () => {
    const cfg = config({ type: "MIXED", monthlySalary: xof(100_000), defaultHourlyRate: xof(8000) });
    const c = compute(cfg, [priced({ date: "2026-01-26", minutes: 120, rate: 9000, rateOrigin: "NODE_GENERIC" }), priced({ date: "2026-01-27", minutes: 120, rate: 9000, rateOrigin: "NODE_GENERIC" })]);
    expect(c.salaryAmount.amount).toBe(90_909);
    expect(c.regularHoursAmount.amount).toBe(36_000);
    expect(c.grossAmount.amount).toBe(126_909);
    expect(c.baseAmount.amount).toBe(126_909);
    expect(c.overtimeAmount.amount).toBe(0);
  });

  it("base = salaire + heures normales ; heures supplémentaires à part ; total = base + supplémentaires", () => {
    const cfg = config({ type: "MIXED", monthlySalary: xof(200_000), overtimeThresholdMinutes: 600 });
    const c = compute(cfg, [priced({ date: "2026-01-12", minutes: 480, rate: 8000 }), priced({ date: "2026-01-13", minutes: 240, rate: 8000 })]);
    expect(c.baseAmount.amount).toBe(c.salaryAmount.amount + c.regularHoursAmount.amount);
    expect(c.grossAmount.amount).toBe(c.baseAmount.amount + c.overtimeAmount.amount);
  });
});

describe("garde-fous du calcul", () => {
  it("refuse une heure fournie deux fois : une heure ne se paie qu'une fois", () => {
    const h = priced({ date: "2026-01-12", minutes: 60 });
    expect(() => compute(config(), [h, { ...h }])).toThrow(PayrollCalculationError);
  });

  it("refuse l'heure d'un autre enseignant, une durée nulle, un seuil nul, une majoration < ×1", () => {
    expect(() => compute(config(), [priced({ date: "2026-01-12", minutes: 60, staffId: uuid(777) })])).toThrow(/n'appartient pas/);
    expect(() => compute(config(), [priced({ date: "2026-01-12", minutes: 0 })])).toThrow(/Durée invalide/);
    expect(() => compute(config({ overtimeThresholdMinutes: 0 }), [])).toThrow(/seuil/);
    expect(() => compute(config({ overtimeMultiplierPermille: 999 }), [])).toThrow(/majoration/);
  });

  it("refuse une configuration salariale sans salaire", () => {
    expect(() => compute(config({ type: "SALARY", monthlySalary: null, annualSalary: null }))).toThrow(/sans salaire/);
  });

  it("refuse de mélanger deux devises", () => {
    const h = { ...priced({ date: "2026-01-12", minutes: 60 }), rate: Money.of(100, "EUR") };
    expect(() => compute(config(), [h])).toThrow(/devises/);
  });

  it("sans heure, un horaire donne un calcul vide (le cas d'usage l'écarte NO_HOURS)", () => {
    const c = compute(config(), []);
    expect(c.lines).toEqual([]);
    expect(c.grossAmount.isZero()).toBe(true);
  });

  it("STAFF exporté pour les doublures est cohérent avec la configuration", () => {
    expect(config().staffId).toBe(STAFF);
  });
});
