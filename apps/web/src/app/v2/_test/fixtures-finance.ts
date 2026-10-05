/** Jeux de données de test du module finance, conformes à `packages/contracts/src/v2/finance.ts` (validés par Zod). */

export const fid = (n: number): string => `00000000-0000-4000-8000-${String(n + 900_000).padStart(12, "0")}`;

type Over = Partial<Record<string, unknown>>;

export const xof = (amount: number) => ({ amount, currency: "XOF" });

export function fee(over: Over = {}) {
  return { id: fid(1), code: "SCOL-6E", name: "Scolarité 6e", category: "TUITION", description: null, currency: "XOF", active: true, ...over };
}

export function schedule(over: Over = {}) {
  return {
    id: fid(10),
    feeId: fid(1),
    academicYear: "2026-2027",
    scope: { institutionId: null, campusId: null, levelKey: "6E", trackKey: null, learnerType: null },
    amount: xof(450000),
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    planId: null,
    active: true,
    ...over,
  };
}

export function plan(over: Over = {}) {
  return {
    id: fid(20),
    code: "TRI-3",
    name: "Trois tranches",
    currency: "XOF",
    steps: [
      { label: "Inscription", share: { kind: "WEIGHT", weight: 2 }, due: { type: "OFFSET_DAYS", days: 0 } },
      { label: "Tranche 2", share: { kind: "WEIGHT", weight: 1 }, due: { type: "DATE", date: "2027-01-10" } },
    ],
    active: true,
    ...over,
  };
}

export function discount(over: Over = {}) {
  return { id: fid(30), code: "FRATRIE", name: "Fratrie", kind: "PERCENT", bps: 1000, amount: null, capAmount: null, categories: null, stackable: false, active: true, ...over };
}

export function installment(over: Over = {}) {
  return {
    id: fid(40),
    seq: 1,
    label: "Inscription",
    dueDate: "2026-09-10",
    amount: xof(150000),
    paid: xof(50000),
    credited: xof(0),
    remaining: xof(100000),
    status: "PARTIALLY_PAID",
    ...over,
  };
}

export function invoiceSummary(over: Over = {}) {
  return {
    id: fid(50),
    number: "FAC-2026-000001",
    status: "ISSUED",
    learnerId: fid(900),
    enrollmentId: null,
    academicYear: "2026-2027",
    groupKey: "6E-A",
    groupLabel: "6e A",
    payerKind: "LEARNER",
    payerRef: null,
    fundingType: "PRIVATE",
    relatedGroupId: null,
    subtotal: xof(500000),
    discount: xof(0),
    scholarship: xof(0),
    total: xof(500000),
    paid: xof(50000),
    credited: xof(0),
    balance: xof(450000),
    dueDate: "2026-09-10",
    issuedAt: "2026-09-01T08:00:00.000Z",
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    ...over,
  };
}

export function invoiceLine(over: Over = {}) {
  return {
    id: fid(60),
    position: 1,
    feeId: fid(1),
    category: "TUITION",
    description: "Scolarité 6e",
    quantity: 1,
    unitAmount: xof(500000),
    gross: xof(500000),
    discount: xof(0),
    scholarship: xof(0),
    total: xof(500000),
    sourceRef: null,
    ...over,
  };
}

export function invoiceDetail(over: Over = {}) {
  return {
    ...invoiceSummary(),
    lines: [invoiceLine()],
    installments: [installment(), installment({ id: fid(41), seq: 2, label: "Tranche 2", dueDate: "2027-01-10", amount: xof(350000), paid: xof(0), remaining: xof(350000), status: "PENDING" })],
    discounts: [],
    ...over,
  };
}

export function payment(over: Over = {}) {
  return {
    id: fid(70),
    learnerId: fid(900),
    enrollmentId: null,
    payerKind: "LEARNER",
    payerRef: null,
    payerName: "KONE Mariam",
    method: "CASH",
    status: "CONFIRMED",
    amount: xof(150000),
    allocated: xof(150000),
    refunded: xof(0),
    unallocated: xof(0),
    provider: null,
    providerRef: null,
    providerAccount: null,
    simulated: false,
    reference: null,
    cashSessionId: fid(90),
    receivedAt: "2026-09-02T09:00:00.000Z",
    confirmedAt: "2026-09-02T09:00:00.000Z",
    failureReason: null,
    ...over,
  };
}

export function receipt(over: Over = {}) {
  return {
    id: fid(80),
    number: "REC-2026-000001",
    paymentId: fid(70),
    learnerId: fid(900),
    amount: xof(150000),
    issuedAt: "2026-09-02T09:00:00.000Z",
    snapshot: {
      v: 1,
      number: "REC-2026-000001",
      issuedAt: "2026-09-02T09:00:00.000Z",
      method: "CASH",
      reference: null,
      payer: { kind: "LEARNER", ref: null, name: "KONE Mariam" },
      allocations: [{ invoiceId: fid(50), invoiceNumber: "FAC-2026-000001", installmentId: fid(40), label: "Inscription", amount: 150000 }],
      unallocated: xof(0),
      balanceAfter: xof(350000),
    },
    ...over,
  };
}

export function paymentView(over: Over = {}) {
  return {
    payment: payment(),
    receipt: receipt(),
    allocations: [{ id: fid(100), invoiceId: fid(50), installmentId: fid(40), lineId: null, amount: xof(150000), reversed: xof(0), net: xof(150000) }],
    replayed: false,
    ...over,
  };
}

export function refund(over: Over = {}) {
  return {
    id: fid(110),
    paymentId: fid(70),
    amount: xof(20000),
    reason: "Erreur de saisie du caissier",
    status: "REQUESTED",
    requestedBy: fid(500),
    requestedAt: "2026-09-03T09:00:00.000Z",
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    cashSessionId: null,
    ...over,
  };
}

export function cashRegister(over: Over = {}) {
  return { id: fid(120), code: "C1", name: "Caisse principale", campusId: null, active: true, ...over };
}

export function cashSession(over: Over = {}) {
  return {
    id: fid(90),
    registerId: fid(120),
    cashierId: fid(500),
    status: "OPEN",
    openingFloat: xof(50000),
    openedAt: "2026-09-02T07:30:00.000Z",
    closedAt: null,
    expected: null,
    counted: null,
    variance: null,
    closeNote: null,
    ...over,
  };
}

export function cashSessionSummary(over: Over = {}) {
  return {
    session: cashSession(),
    movements: { received: xof(150000), refunded: xof(0), paymentCount: 1, refundCount: 0 },
    ...over,
  };
}

export function summary(over: Over = {}) {
  return {
    currency: "XOF",
    asOf: "2026-10-01",
    invoiceCount: 120,
    billed: xof(60000000),
    credited: xof(1000000),
    netBilled: xof(59000000),
    collected: xof(41000000),
    outstanding: xof(18000000),
    overdue: xof(7500000),
    overdueInvoiceCount: 31,
    unallocatedPayments: xof(0),
    collectionRateBps: 6949,
    ...over,
  };
}

export function receivableRow(over: Over = {}) {
  return {
    key: "6E-A",
    label: "6e A",
    invoiceCount: 30,
    learnerCount: 30,
    billed: xof(15000000),
    credited: xof(0),
    collected: xof(10000000),
    outstanding: xof(5000000),
    overdue: xof(2000000),
    collectionRateBps: 6667,
    ...over,
  };
}

export function learnerReceivable(over: Over = {}) {
  return { ...receivableRow({ key: fid(900), label: null }), learnerId: fid(900), oldestOverdueDate: "2026-09-10", ...over };
}

export function agedBalance(over: Over = {}) {
  const bucket = (amount: number, invoiceCount: number) => ({ amount: xof(amount), invoiceCount });
  return {
    asOf: "2026-10-01",
    currency: "XOF",
    buckets: { NOT_DUE: bucket(9000000, 40), D1_30: bucket(4000000, 20), D31_60: bucket(3000000, 12), D61_90: bucket(1500000, 6), D91_PLUS: bucket(500000, 2) },
    total: xof(18000000),
    learners: [{ learnerId: fid(900), buckets: { NOT_DUE: xof(0), D1_30: xof(100000), D31_60: xof(0), D61_90: xof(0), D91_PLUS: xof(0) }, total: xof(100000) }],
    ...over,
  };
}

export function trendPoint(over: Over = {}) {
  return { bucket: "2026-09-01", collected: xof(12000000), refunded: xof(100000), net: xof(11900000), paymentCount: 80, ...over };
}

export function scholarship(over: Over = {}) {
  return {
    id: fid(130),
    learnerId: fid(900),
    academicYear: "2026-2027",
    funderKind: "STATE",
    funderName: "État de Côte d'Ivoire",
    reference: "AFF-2026-001",
    coverage: { kind: "PERCENT", bps: 7000 },
    capAmount: null,
    categories: null,
    status: "ACTIVE",
    priority: 0,
    ...over,
  };
}

export function funding(over: Over = {}) {
  return { account: { learnerId: fid(900), fundingType: "STATE_ASSIGNED", assignmentRef: "AFF-2026-001" }, scholarships: [scholarship()], ...over };
}

export function statement(over: Over = {}) {
  return {
    learnerId: fid(900),
    currency: "XOF",
    invoices: [invoiceSummary()],
    payments: [payment()],
    totals: { billed: xof(500000), credited: xof(0), collected: xof(150000), outstanding: xof(350000), unallocatedPayments: xof(0) },
    ...over,
  };
}
