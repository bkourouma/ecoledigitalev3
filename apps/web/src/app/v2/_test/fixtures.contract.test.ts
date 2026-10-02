/**
 * Garde-fou des jeux de données de test : chaque fabrique est validée contre le schéma Zod COURANT du contrat.
 *
 * Quand un contrat (`packages/contracts/src/v2/*`) gagne un champ obligatoire, c'est CE fichier qui échoue en
 * premier, avec le chemin exact du champ manquant — il suffit alors d'ajouter la valeur dans la fabrique concernée
 * (`fixtures*.ts`) au lieu de réparer chaque test d'écran un par un.
 */
import { describe, expect, it } from "vitest";
import {
  academicClassroomDtoSchema,
  academicCurriculumNodeDtoSchema,
  academicCurriculumTreeDtoSchema,
  academicCurriculumVersionDtoSchema,
  academicEducationLevelDtoSchema,
  academicGradeLevelDtoSchema,
  academicNodeTypeDtoSchema,
  academicPeriodDtoSchema,
  academicProgramDtoSchema,
  academicYearDtoSchema,
} from "@ecoledigitale/contracts/v2/academic";
import {
  financeCashRegisterDtoSchema,
  financeCashSessionDtoSchema,
  financeCashSessionSummaryDtoSchema,
  financeDiscountDtoSchema,
  financeFeeDtoSchema,
  financeInstallmentDtoSchema,
  financeInvoiceDetailDtoSchema,
  financeInvoiceLineDtoSchema,
  financeInvoiceSummaryDtoSchema,
  financePaymentDtoSchema,
  financePaymentViewDtoSchema,
  financePlanDtoSchema,
  financeReceiptDtoSchema,
  financeRefundDtoSchema,
  financeScholarshipDtoSchema,
  financeSummaryDtoSchema,
} from "@ecoledigitale/contracts/v2/finance";
import {
  payrollAdjustmentDtoSchema,
  payrollConfigDtoSchema,
  payrollLineDtoSchema,
  payrollPayslipDetailDtoSchema,
  payrollPayslipDtoSchema,
  payrollPeriodDtoSchema,
  payrollRateDtoSchema,
  payrollSettingsDtoSchema,
} from "@ecoledigitale/contracts/v2/payroll";
import * as academic from "./fixtures";
import * as finance from "./fixtures-finance";
import * as payroll from "./fixtures-payroll";

type Parser = { safeParse: (value: unknown) => { success: boolean; error?: { issues: Array<{ path: Array<string | number>; message: string }> } } };

function expectValid(schema: Parser, value: unknown) {
  const result = schema.safeParse(value);
  const issues = result.success ? [] : (result.error?.issues ?? []).map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`);
  expect(issues).toEqual([]);
}

describe("fabriques academic conformes aux contrats courants", () => {
  it.each([
    ["year", academicYearDtoSchema, () => academic.year()],
    ["period", academicPeriodDtoSchema, () => academic.period()],
    ["program", academicProgramDtoSchema, () => academic.program()],
    ["classroom", academicClassroomDtoSchema, () => academic.classroom()],
    ["version", academicCurriculumVersionDtoSchema, () => academic.version()],
    ["node", academicCurriculumNodeDtoSchema, () => ({ ...academic.node(), children: undefined })],
    ["tree", academicCurriculumTreeDtoSchema, () => ({ version: academic.version(), roots: [academic.node({ children: [academic.node({ id: academic.uuid(802), parentId: academic.uuid(800) })] })] })],
  ] as Array<[string, Parser, () => unknown]>)("%s", (_name, schema, make) => expectValid(schema, make()));

  it.each([
    ["nodeTypes", academicNodeTypeDtoSchema, academic.nodeTypes],
    ["gradeLevels", academicGradeLevelDtoSchema, academic.gradeLevels],
    ["educationLevels", academicEducationLevelDtoSchema, academic.educationLevels],
  ] as Array<[string, Parser, unknown[]]>)("%s", (_name, schema, items) => {
    for (const item of items) expectValid(schema, item);
  });
});

describe("fabriques finance conformes aux contrats courants", () => {
  it.each([
    ["fee", financeFeeDtoSchema, () => finance.fee()],
    ["plan", financePlanDtoSchema, () => finance.plan()],
    ["discount", financeDiscountDtoSchema, () => finance.discount()],
    ["installment", financeInstallmentDtoSchema, () => finance.installment()],
    ["invoiceSummary", financeInvoiceSummaryDtoSchema, () => finance.invoiceSummary()],
    ["invoiceLine", financeInvoiceLineDtoSchema, () => finance.invoiceLine()],
    ["invoiceDetail", financeInvoiceDetailDtoSchema, () => finance.invoiceDetail()],
    ["payment", financePaymentDtoSchema, () => finance.payment()],
    ["receipt", financeReceiptDtoSchema, () => finance.receipt()],
    ["paymentView", financePaymentViewDtoSchema, () => finance.paymentView()],
    ["refund", financeRefundDtoSchema, () => finance.refund()],
    ["cashRegister", financeCashRegisterDtoSchema, () => finance.cashRegister()],
    ["cashSession", financeCashSessionDtoSchema, () => finance.cashSession()],
    ["cashSessionSummary", financeCashSessionSummaryDtoSchema, () => finance.cashSessionSummary()],
    ["summary", financeSummaryDtoSchema, () => finance.summary()],
    ["scholarship", financeScholarshipDtoSchema, () => finance.scholarship()],
  ] as Array<[string, Parser, () => unknown]>)("%s", (_name, schema, make) => expectValid(schema, make()));
});

describe("fabriques payroll conformes aux contrats courants", () => {
  it.each([
    ["period", payrollPeriodDtoSchema, () => payroll.period()],
    ["payslip", payrollPayslipDtoSchema, () => payroll.payslip()],
    ["line", payrollLineDtoSchema, () => payroll.line()],
    ["adjustment", payrollAdjustmentDtoSchema, () => payroll.adjustment()],
    ["payslipDetail", payrollPayslipDetailDtoSchema, () => payroll.payslipDetail()],
    ["config", payrollConfigDtoSchema, () => payroll.config()],
    ["rate", payrollRateDtoSchema, () => payroll.rate()],
    ["settings", payrollSettingsDtoSchema, () => payroll.settings()],
  ] as Array<[string, Parser, () => unknown]>)("%s", (_name, schema, make) => expectValid(schema, make()));
});
