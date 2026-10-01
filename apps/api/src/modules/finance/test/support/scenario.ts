/**
 * Jeu de données commun aux tests d'intégration : catalogue, barèmes, plan d'échéancier
 * (exemple du PRD §32), apprenants.
 */
import { Money, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createFee, createFeeSchedule, createInstallmentPlan } from "../../application/catalog";
import type { FinanceDeps } from "../../application/deps";
import type { Fee } from "../../domain/fee";
import type { InstallmentPlan } from "../../domain/installments";
import type { FeeSchedule } from "../../domain/fee-schedule";

export const YEAR = "2025-2026";
export const xof = (n: number): Money => Money.of(n, "XOF");

export interface Catalog {
  tuition: Fee;
  canteen: Fee;
  registration: Fee;
  plan: InstallmentPlan;
  tuitionSchedule: FeeSchedule;
  canteenSchedule: FeeSchedule;
}

/**
 * Scolarité 500 000 (plan : inscription 100 000 + 15/10 : 150 000 + 15/01 : 150 000 + 15/03 : 100 000),
 * cantine 60 000, inscription 25 000. Barèmes valables pour l'année 2025-2026.
 */
export async function seedCatalog(deps: FinanceDeps, ctx: RequestContext): Promise<Catalog> {
  const tuition = unwrap(await createFee(deps, ctx, { code: "SCOL", name: "Scolarité", category: "TUITION" }));
  const canteen = unwrap(await createFee(deps, ctx, { code: "CANT", name: "Cantine", category: "CANTEEN" }));
  const registration = unwrap(await createFee(deps, ctx, { code: "INSC", name: "Inscription", category: "REGISTRATION" }));
  const plan = unwrap(
    await createInstallmentPlan(deps, ctx, {
      code: "STD4",
      name: "Standard en 4 tranches",
      steps: [
        { label: "Inscription", share: { kind: "WEIGHT", weight: 100 }, due: { type: "OFFSET_DAYS", days: 0 } },
        { label: "1re tranche", share: { kind: "WEIGHT", weight: 150 }, due: { type: "MONTH_DAY", month: 10, day: 15 } },
        { label: "2e tranche", share: { kind: "WEIGHT", weight: 150 }, due: { type: "MONTH_DAY", month: 1, day: 15 } },
        { label: "3e tranche", share: { kind: "WEIGHT", weight: 100 }, due: { type: "MONTH_DAY", month: 3, day: 15 } },
      ],
    }),
  );
  const tuitionSchedule = unwrap(
    await createFeeSchedule(deps, ctx, {
      feeId: tuition.id,
      academicYear: YEAR,
      amount: xof(500_000),
      effectiveFrom: "2025-06-01",
      planId: plan.id,
    }),
  );
  const canteenSchedule = unwrap(
    await createFeeSchedule(deps, ctx, { feeId: canteen.id, academicYear: YEAR, amount: xof(60_000), effectiveFrom: "2025-06-01" }),
  );
  unwrap(await createFeeSchedule(deps, ctx, { feeId: registration.id, academicYear: YEAR, amount: xof(25_000), effectiveFrom: "2025-06-01" }));
  return { tuition, canteen, registration, plan, tuitionSchedule, canteenSchedule };
}

export const learnerId = (): string => newId();
