/**
 * Propriétés du moteur de calcul (jeux aléatoires DÉTERMINISTES, graine fixe — aucune dépendance) :
 *   P1 somme des lignes = montant des heures ; total = salaire + Σ lignes (par construction)
 *   P2 une heure n'est jamais comptée deux fois : Σ minutes de ses lignes = sa durée, au plus 2 lignes
 *   P3 chaque ligne respecte la formule exacte (indépendante : BigInt) — la même que le CHECK SQL
 *   P4 le résultat ne dépend pas de l'ordre des heures fournies
 *   P5 par semaine : normales = min(cumul, seuil), supplémentaires = max(0, cumul − seuil)
 *   P6 monotonie : ajouter une heure APRÈS toutes les autres ne diminue jamais le total ; ajouter n'importe
 *      quelle heure ne le diminue jamais de plus d'une unité par ligne créée (arrondis)
 *   P7 le salaire dû ne dépasse jamais le salaire mensuel × nombre de mois touchés, et la somme de deux
 *      périodes adjacentes ne dépasse jamais le salaire de la période réunie de plus de 2 unités (arrondis)
 */
import { describe, expect, it } from "vitest";
import { computePayslip } from "../../domain/calculation";
import { weekStart } from "../../domain/calendar";
import type { PricedHour } from "../../domain/types";
import { config, priced, prng, randInt, uuid, xof } from "../support/builders";

const period = { startDate: "2026-01-05", endDate: "2026-02-15" };

function randomHours(rand: () => number, n: number): PricedHour[] {
  const out: PricedHour[] = [];
  for (let i = 0; i < n; i++) {
    const day = randInt(rand, 5, 45); // 5 janvier → 15 février
    const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
    out.push(
      priced({
        kind: rand() < 0.5 ? "SESSION" : "ATTENDANCE",
        refId: uuid(100 + i),
        date,
        startTime: rand() < 0.3 ? null : `${String(randInt(rand, 6, 18)).padStart(2, "0")}:00`,
        minutes: randInt(rand, 1, 480),
        rate: randInt(rand, 0, 20_000),
      }),
    );
  }
  return out;
}

const exactLine = (minutes: number, rate: number, permille: number): number => Number((BigInt(minutes) * BigInt(rate) * BigInt(permille) + 30000n) / 60000n);

describe("propriétés du moteur de calcul", () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`graine ${seed} : P1-P5 (lignes, minutes, formule, ordre, semaines)`, () => {
      const rand = prng(seed);
      const cfg = config({
        type: seed % 3 === 0 ? "MIXED" : "HOURLY",
        monthlySalary: seed % 3 === 0 ? xof(randInt(rand, 50_000, 900_000)) : null,
        overtimeThresholdMinutes: randInt(rand, 120, 3000),
        overtimeMultiplierPermille: randInt(rand, 1000, 3000),
      });
      const hours = randomHours(rand, randInt(rand, 1, 25));
      const c = computePayslip({ period, config: cfg, hours, currency: "XOF" });

      // P1
      const sumLines = c.lines.reduce((s, l) => s + l.amount.amount, 0);
      expect(c.regularHoursAmount.amount + c.overtimeAmount.amount).toBe(sumLines);
      expect(c.grossAmount.amount).toBe(c.salaryAmount.amount + sumLines);
      expect(c.baseAmount.amount).toBe(c.salaryAmount.amount + c.lines.filter((l) => !l.isOvertime).reduce((s, l) => s + l.amount.amount, 0));

      // P2 + P3
      for (const h of hours) {
        const mine = c.lines.filter((l) => l.sourceRefId === h.refId);
        expect(mine.reduce((s, l) => s + l.minutes, 0)).toBe(h.minutes);
        expect(mine.length).toBeGreaterThanOrEqual(1);
        expect(mine.length).toBeLessThanOrEqual(2);
        expect(mine.filter((l) => l.isOvertime).length).toBeLessThanOrEqual(1);
        expect(mine.filter((l) => !l.isOvertime).length).toBeLessThanOrEqual(1);
      }
      for (const l of c.lines) {
        expect(l.amount.amount).toBe(exactLine(l.minutes, l.rate.amount, l.multiplierPermille));
        expect(l.isOvertime ? l.multiplierPermille === cfg.overtimeMultiplierPermille : l.multiplierPermille === 1000).toBe(true);
      }

      // P4 — permutation
      const shuffled = [...hours].sort(() => rand() - 0.5);
      const again = computePayslip({ period, config: cfg, hours: shuffled, currency: "XOF" });
      expect(again.lines).toEqual(c.lines);
      expect(again.grossAmount.amount).toBe(c.grossAmount.amount);

      // P5 — par semaine
      const weeks = new Map<string, number>();
      for (const h of hours) weeks.set(weekStart(h.date), (weeks.get(weekStart(h.date)) ?? 0) + h.minutes);
      for (const [wk, total] of weeks) {
        const inWeek = c.lines.filter((l) => weekStart(l.sessionDate) === wk);
        expect(inWeek.filter((l) => !l.isOvertime).reduce((s, l) => s + l.minutes, 0)).toBe(Math.min(total, cfg.overtimeThresholdMinutes));
        expect(inWeek.filter((l) => l.isOvertime).reduce((s, l) => s + l.minutes, 0)).toBe(Math.max(0, total - cfg.overtimeThresholdMinutes));
      }
      // positions consécutives (ordre d'affichage stable)
      expect(c.lines.map((l) => l.position)).toEqual(c.lines.map((_, i) => i));
    });
  }

  it("P6 — monotonie : une heure ajoutée après toutes les autres ne diminue jamais le total ; ailleurs, au plus 1 unité par ligne d'arrondi", () => {
    for (let seed = 100; seed < 160; seed++) {
      const rand = prng(seed);
      const cfg = config({ overtimeThresholdMinutes: randInt(rand, 120, 2400), overtimeMultiplierPermille: randInt(rand, 1000, 2500) });
      const base = randomHours(rand, randInt(rand, 1, 15));
      const before = computePayslip({ period, config: cfg, hours: base, currency: "XOF" });
      // après toutes les autres : le dernier jour, origine SESSION (dernière), sans heure de début
      const last = priced({ kind: "SESSION", refId: uuid(5000), date: "2026-02-15", startTime: null, minutes: randInt(rand, 1, 480), rate: randInt(rand, 0, 20_000) });
      const afterLast = computePayslip({ period, config: cfg, hours: [...base, last], currency: "XOF" });
      expect(afterLast.grossAmount.amount).toBeGreaterThanOrEqual(before.grossAmount.amount);
      // n'importe où
      const anywhere = priced({ kind: "ATTENDANCE", refId: uuid(5001), date: "2026-01-06", startTime: "06:00", minutes: randInt(rand, 1, 480), rate: randInt(rand, 0, 20_000) });
      const withAny = computePayslip({ period, config: cfg, hours: [...base, anywhere], currency: "XOF" });
      expect(withAny.grossAmount.amount).toBeGreaterThanOrEqual(before.grossAmount.amount - withAny.lines.length);
    }
  });

  it("P6bis — avec un taux unique, la monotonie est stricte même au milieu (pas d'effet d'arrondi inverse)", () => {
    for (let seed = 200; seed < 240; seed++) {
      const rand = prng(seed);
      const rate = randInt(rand, 1000, 20_000);
      const cfg = config({ overtimeThresholdMinutes: randInt(rand, 120, 2400), overtimeMultiplierPermille: 1500 });
      const base = randomHours(rand, 10).map((h) => ({ ...h, rate: xof(rate) }));
      const extra = { ...priced({ refId: uuid(6000), date: "2026-01-14", minutes: randInt(rand, 60, 300) }), rate: xof(rate) };
      const a = computePayslip({ period, config: cfg, hours: base, currency: "XOF" });
      const b = computePayslip({ period, config: cfg, hours: [...base, extra], currency: "XOF" });
      expect(b.grossAmount.amount).toBeGreaterThanOrEqual(a.grossAmount.amount);
    }
  });

  it("P7 — salaire : deux périodes adjacentes valent la période réunie, à deux unités d'arrondi près", () => {
    for (let seed = 300; seed < 340; seed++) {
      const rand = prng(seed);
      const monthly = randInt(rand, 50_000, 2_000_000);
      const cfg = config({ type: "SALARY", monthlySalary: xof(monthly), defaultHourlyRate: null });
      const sal = (s: string, e: string) => computePayslip({ period: { startDate: s, endDate: e }, config: cfg, hours: [], currency: "XOF" });
      const whole = sal("2026-01-01", "2026-01-31");
      expect(whole.salaryAmount.amount).toBe(monthly);
      const cut = randInt(rand, 2, 28);
      const d = (n: number) => `2026-01-${String(n).padStart(2, "0")}`;
      const left = sal("2026-01-01", d(cut - 1));
      const right = sal(d(cut), "2026-01-31");
      expect(Math.abs(left.salaryAmount.amount + right.salaryAmount.amount - monthly)).toBeLessThanOrEqual(1);
      // aucun jour réclamé deux fois entre deux périodes disjointes
      expect(new Set([...left.salaryDays, ...right.salaryDays]).size).toBe(left.salaryDays.length + right.salaryDays.length);
    }
  });

  it("P8 — réclamer les jours déjà payés ne paie jamais deux fois : A puis B (chevauchantes) ≤ A ∪ B, à l'unité d'arrondi près", () => {
    for (let seed = 400; seed < 440; seed++) {
      const rand = prng(seed);
      const monthly = randInt(rand, 50_000, 2_000_000);
      const cfg = config({ type: "SALARY", monthlySalary: xof(monthly), defaultHourlyRate: null });
      const a = { startDate: "2026-01-05", endDate: `2026-01-${String(randInt(rand, 10, 28)).padStart(2, "0")}` };
      const b = { startDate: `2026-01-${String(randInt(rand, 6, 20)).padStart(2, "0")}`, endDate: "2026-01-31" };
      const pa = computePayslip({ period: a, config: cfg, hours: [], currency: "XOF" });
      const pb = computePayslip({ period: b, config: cfg, hours: [], currency: "XOF", claimedSalaryDays: new Set(pa.salaryDays) });
      expect(pa.salaryAmount.amount + pb.salaryAmount.amount).toBeLessThanOrEqual(monthly + 1);
      expect(pb.salaryDays.some((d) => pa.salaryDays.includes(d))).toBe(false);
    }
  });
});
