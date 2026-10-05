/**
 * Contrats du module `stateassign` (routes `/api/v1/stateassign/*`, événements `stateassign.*`) — spec v2/006-secondary,
 * US10 : élèves affectés par l'État (`STATE_ASSIGNED`, PRD §20).
 *
 * Conventions :
 *  - IDENTIFIANTS : UUID. Élèves, inscriptions, factures, bourses, documents sont des références SANS clé étrangère,
 *    vérifiées par des PORTS (people, academic, finance, documents).
 *  - MONTANTS : entiers en unités mineures (XOF : le franc) + devise, jamais un flottant. Les montants DÉCLARÉS par
 *    l'acte d'affectation sont distincts des montants FACTURÉS (`finance`) ; l'écart se calcule : facturé − déclaré.
 *  - INSTANTS : ISO 8601 avec fuseau ; DATES civiles : `YYYY-MM-DD`.
 *  - L'humain décide : vérifier, activer, rejeter, suspendre, terminer, amender, planifier ou annuler une échéance,
 *    réaliser un contrôle sont des actes d'un utilisateur identifié (imposé par la base). Le rapprochement calcule ;
 *    le STATUT de rapprochement est calculé par la base, jamais saisi.
 *  - Aucune règle officielle, aucun barème : tolérances, délais de grâce, contrôles exigés sont des réglages
 *    d'établissement, vides ou à zéro par défaut.
 *  - Messages en français ; codes d'erreur stables `stateassign.*` (`STATEASSIGN_ERROR_CODES`).
 *  - Le client ne déduit rien : il affiche ce que l'API renvoie (statuts, retards, écarts calculés côté serveur).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives et énumérations
// ---------------------------------------------------------------------------

export const stateassignUuidSchema = z.string().uuid();
export const stateassignInstantSchema = z.string().datetime({ offset: true });
export const stateassignDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date attendue au format AAAA-MM-JJ.");

/** Montant : entier en unités mineures + devise (jamais un flottant). */
export const stateassignMoneySchema = z.object({
  amount: z.number().int().safe(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type StateassignMoney = z.infer<typeof stateassignMoneySchema>;

/** Montant saisi : entier ≥ 0 (unités mineures). La devise est celle de l'établissement (défaut XOF). */
export const stateassignAmountInputSchema = z.number().int("Un montant est un entier (unités mineures).").min(0).max(Number.MAX_SAFE_INTEGER);

export const ASSIGNMENT_STATUSES = ["RECEIVED", "VERIFIED", "ACTIVE", "SUSPENDED", "ENDED", "REJECTED", "TRANSFERRED", "SUPERSEDED"] as const;
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

/** Statuts d'un dossier « vivant » : un seul par inscription. */
export const LIVE_ASSIGNMENT_STATUSES = ["RECEIVED", "VERIFIED", "ACTIVE", "SUSPENDED"] as const;

export const ASSIGNMENT_SOURCES = ["MANUAL", "IMPORT", "GATEWAY"] as const;
export const assignmentSourceSchema = z.enum(ASSIGNMENT_SOURCES);
export type AssignmentSource = z.infer<typeof assignmentSourceSchema>;

export const RECONCILIATION_STATUSES = ["NEVER", "BALANCED", "DISCREPANCY"] as const;
export const reconciliationStatusSchema = z.enum(RECONCILIATION_STATUSES);
export type ReconciliationStatus = z.infer<typeof reconciliationStatusSchema>;

export const CONTROL_KINDS = ["ATTENDANCE", "IDENTITY", "FINANCE_RECONCILIATION", "DOCUMENTS", "OTHER"] as const;
export const controlKindSchema = z.enum(CONTROL_KINDS);
export type ControlKind = z.infer<typeof controlKindSchema>;

export const CONTROL_STATUSES = ["PENDING", "OK", "ANOMALY", "WAIVED"] as const;
export const controlStatusSchema = z.enum(CONTROL_STATUSES);
export type ControlStatus = z.infer<typeof controlStatusSchema>;

export const ASSIGNMENT_DOCUMENT_KINDS = ["ASSIGNMENT_ORDER", "ATTENDANCE_CERTIFICATE", "RECEIPT", "CORRESPONDENCE", "OTHER"] as const;
export const assignmentDocumentKindSchema = z.enum(ASSIGNMENT_DOCUMENT_KINDS);
export type AssignmentDocumentKind = z.infer<typeof assignmentDocumentKindSchema>;

export const ASSIGNMENT_DOCUMENT_STATUSES = ["ACTIVE", "WITHDRAWN"] as const;

export const RECEIVABLE_STATUSES = ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;
export const receivableStatusSchema = z.enum(RECEIVABLE_STATUSES);
export type ReceivableStatus = z.infer<typeof receivableStatusSchema>;

export const EXPORT_DATASETS = ["ASSIGNMENTS", "RECEIVABLES", "CONTROLS"] as const;
export const exportDatasetSchema = z.enum(EXPORT_DATASETS);
export type ExportDataset = z.infer<typeof exportDatasetSchema>;

/** Tranches d'ancienneté du retard (jours après l'échéance + délai de grâce) : présentation, pas une règle. */
export const RECEIVABLE_AGING_BUCKETS = ["NOT_DUE", "D1_30", "D31_60", "D61_90", "D91_PLUS"] as const;
export const receivableAgingBucketSchema = z.enum(RECEIVABLE_AGING_BUCKETS);
export type ReceivableAgingBucket = z.infer<typeof receivableAgingBucketSchema>;

export const stateassignReasonSchema = z.string().trim().min(5, "Un motif de 5 caractères minimum est requis.").max(2000);
const optionalText = (max: number) => z.string().trim().max(max);

// ---------------------------------------------------------------------------
// Réglages d'établissement
// ---------------------------------------------------------------------------

export const stateassignSettingsDtoSchema = z.object({
  institutionId: stateassignUuidSchema,
  /** Aucun réglage enregistré : valeurs prudentes (séparation des tâches, tolérance 0, aucun contrôle, aucune planification). */
  isDefault: z.boolean(),
  requireSeparateVerifier: z.boolean(),
  /** Écart toléré (unités mineures) entre montants déclarés et facturés ; 0 par défaut. */
  reconciliationTolerance: z.number().int().min(0),
  requiredControlKinds: z.array(controlKindSchema),
  /** `null` : AUCUNE planification automatique de contrôle. */
  controlDueOffsetDays: z.number().int().min(0).max(366).nullable(),
  receivableGraceDays: z.number().int().min(0).max(366),
  updatedAt: stateassignInstantSchema.nullable(),
});
export type StateassignSettingsDto = z.infer<typeof stateassignSettingsDtoSchema>;

export const stateassignUpdateSettingsBodySchema = z
  .object({
    requireSeparateVerifier: z.boolean(),
    reconciliationTolerance: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    requiredControlKinds: z.array(controlKindSchema).max(5),
    controlDueOffsetDays: z.number().int().min(0).max(366).nullable(),
    receivableGraceDays: z.number().int().min(0).max(366),
  })
  .strict();
export type StateassignUpdateSettingsBody = z.infer<typeof stateassignUpdateSettingsBodySchema>;

export const stateassignSettingsQuerySchema = z.object({ institutionId: stateassignUuidSchema }).strict();

// ---------------------------------------------------------------------------
// Dossier d'affectation
// ---------------------------------------------------------------------------

export const assignmentFinanceLinksSchema = z.object({
  scholarshipId: stateassignUuidSchema.nullable(),
  stateInvoiceId: stateassignUuidSchema.nullable(),
  parentInvoiceId: stateassignUuidSchema.nullable(),
});

export const assignmentReconciliationSchema = z.object({
  status: reconciliationStatusSchema,
  lastReconciledAt: stateassignInstantSchema.nullable(),
  /** facturé − déclaré, part de l'État (négatif : facturé en moins). `null` tant que jamais rapproché. */
  stateDelta: stateassignMoneySchema.nullable(),
  parentDelta: stateassignMoneySchema.nullable(),
  /** Montants facturés au dernier rapprochement (déclaré + écart). */
  stateBilled: stateassignMoneySchema.nullable(),
  parentBilled: stateassignMoneySchema.nullable(),
});

export const assignmentDtoSchema = z.object({
  id: stateassignUuidSchema,
  institutionId: stateassignUuidSchema,
  academicYearId: stateassignUuidSchema,
  enrollmentId: stateassignUuidSchema,
  studentId: stateassignUuidSchema,
  /** « NOM Prénom » (décoration : absent si l'annuaire est indisponible). */
  studentName: z.string().nullable(),
  version: z.number().int().min(1),
  supersedesId: stateassignUuidSchema.nullable(),
  reference: z.string(),
  issuedOn: stateassignDateSchema.nullable(),
  issuingAuthority: z.string().nullable(),
  source: assignmentSourceSchema,
  externalRef: z.string().nullable(),
  /** Montants DÉCLARÉS par l'acte d'affectation. */
  declaredState: stateassignMoneySchema.nullable(),
  declaredParent: stateassignMoneySchema.nullable(),
  status: assignmentStatusSchema,
  receivedBy: stateassignUuidSchema.nullable(),
  receivedAt: stateassignInstantSchema,
  verifiedBy: stateassignUuidSchema.nullable(),
  verifiedAt: stateassignInstantSchema.nullable(),
  verificationNote: z.string().nullable(),
  activatedAt: stateassignInstantSchema.nullable(),
  suspendedAt: stateassignInstantSchema.nullable(),
  suspensionReason: z.string().nullable(),
  endedOn: stateassignDateSchema.nullable(),
  endReason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  finance: assignmentFinanceLinksSchema,
  reconciliation: assignmentReconciliationSchema,
  notes: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: stateassignInstantSchema,
});
export type AssignmentDto = z.infer<typeof assignmentDtoSchema>;

export const assignmentVersionDtoSchema = z.object({
  id: stateassignUuidSchema,
  version: z.number().int(),
  status: assignmentStatusSchema,
  reference: z.string(),
  declaredState: stateassignMoneySchema.nullable(),
  declaredParent: stateassignMoneySchema.nullable(),
  issuedOn: stateassignDateSchema.nullable(),
  endedOn: stateassignDateSchema.nullable(),
  endReason: z.string().nullable(),
  receivedAt: stateassignInstantSchema,
  verifiedAt: stateassignInstantSchema.nullable(),
});

export const assignmentEventDtoSchema = z.object({
  id: stateassignUuidSchema,
  assignmentId: stateassignUuidSchema,
  action: z.enum(["CREATED", "STATUS_CHANGED", "RECONCILED", "LINKED"]),
  fromStatus: assignmentStatusSchema.nullable(),
  toStatus: assignmentStatusSchema.nullable(),
  actorId: stateassignUuidSchema.nullable(),
  actorKind: z.enum(["user", "system", "superAdmin"]).nullable(),
  reason: z.string().nullable(),
  data: z.record(z.unknown()),
  occurredAt: stateassignInstantSchema,
});

export const controlDtoSchema = z.object({
  id: stateassignUuidSchema,
  assignmentId: stateassignUuidSchema,
  kind: controlKindSchema,
  academicPeriodId: stateassignUuidSchema.nullable(),
  dueOn: stateassignDateSchema,
  status: controlStatusSchema,
  performedBy: stateassignUuidSchema.nullable(),
  performedAt: stateassignInstantSchema.nullable(),
  findings: z.string().nullable(),
  /** Faits constatés (comptages d'`attendance`…), jamais calculés par ce module. */
  evidence: z.record(z.unknown()),
  anomalyResolution: z.string().nullable(),
  anomalyResolvedAt: stateassignInstantSchema.nullable(),
  /** Date d'échéance dépassée et contrôle toujours à faire (dérivé à la date du jour). */
  overdue: z.boolean(),
  createdAt: stateassignInstantSchema,
});
export type ControlDto = z.infer<typeof controlDtoSchema>;

export const assignmentDocumentDtoSchema = z.object({
  id: stateassignUuidSchema,
  assignmentId: stateassignUuidSchema,
  kind: assignmentDocumentKindSchema,
  documentRef: stateassignUuidSchema,
  label: z.string().nullable(),
  receivedOn: stateassignDateSchema.nullable(),
  addedBy: stateassignUuidSchema,
  status: z.enum(ASSIGNMENT_DOCUMENT_STATUSES),
  withdrawnBy: stateassignUuidSchema.nullable(),
  withdrawnAt: stateassignInstantSchema.nullable(),
  withdrawnReason: z.string().nullable(),
  createdAt: stateassignInstantSchema,
});
export type AssignmentDocumentDto = z.infer<typeof assignmentDocumentDtoSchema>;

export const receivableDtoSchema = z.object({
  id: stateassignUuidSchema,
  assignmentId: stateassignUuidSchema,
  institutionId: stateassignUuidSchema,
  academicYearId: stateassignUuidSchema,
  enrollmentId: stateassignUuidSchema,
  studentId: stateassignUuidSchema,
  studentName: z.string().nullable(),
  assignmentReference: z.string().nullable(),
  seq: z.number().int(),
  label: z.string(),
  dueOn: stateassignDateSchema,
  expected: stateassignMoneySchema,
  received: stateassignMoneySchema,
  /** Reste à recevoir (attendu − reçu ; 0 pour une échéance annulée). */
  outstanding: stateassignMoneySchema,
  /** Statut CALCULÉ par la base depuis les montants. */
  status: receivableStatusSchema,
  /** Jours de retard à la date de lecture (après le délai de grâce) ; 0 si non échue, soldée ou annulée. */
  daysOverdue: z.number().int().min(0),
  overdue: z.boolean(),
  agingBucket: receivableAgingBucketSchema,
  lastReconciledAt: stateassignInstantSchema.nullable(),
  overdueFlaggedAt: stateassignInstantSchema.nullable(),
  cancelReason: z.string().nullable(),
  /** Version de la ligne : à renvoyer pour modifier ou annuler (concurrence optimiste). */
  rowVersion: z.number().int().min(1),
  createdAt: stateassignInstantSchema,
});
export type ReceivableDto = z.infer<typeof receivableDtoSchema>;

export const receivableEventDtoSchema = z.object({
  id: stateassignUuidSchema,
  receivableId: stateassignUuidSchema,
  action: z.enum(["CREATED", "RESCHEDULED", "AMOUNT_CHANGED", "RECEIVED_UPDATED", "STATUS_CHANGED", "OVERDUE_FLAGGED", "CANCELLED"]),
  fromStatus: receivableStatusSchema.nullable(),
  toStatus: receivableStatusSchema.nullable(),
  fromAmount: stateassignMoneySchema.nullable(),
  toAmount: stateassignMoneySchema.nullable(),
  actorId: stateassignUuidSchema.nullable(),
  actorKind: z.enum(["user", "system", "superAdmin"]).nullable(),
  reason: z.string().nullable(),
  data: z.record(z.unknown()),
  occurredAt: stateassignInstantSchema,
});

/** Facturation lue chez `finance` pour le rapprochement (lecture au moment de la demande). */
export const stateFundingBillingSchema = z.object({
  currency: z.string(),
  stateInvoices: z.array(
    z.object({
      invoiceId: stateassignUuidSchema,
      number: z.string().nullable(),
      status: z.string(),
      total: stateassignMoneySchema,
      paid: stateassignMoneySchema,
      credited: stateassignMoneySchema,
      dueDate: stateassignDateSchema,
      scholarshipId: stateassignUuidSchema.nullable(),
    }),
  ),
  parentInvoices: z.array(
    z.object({
      invoiceId: stateassignUuidSchema,
      number: z.string().nullable(),
      status: z.string(),
      total: stateassignMoneySchema,
      paid: stateassignMoneySchema,
      credited: stateassignMoneySchema,
      dueDate: stateassignDateSchema,
    }),
  ),
  /**
   * Cumul de financements (O-04) : factures des AUTRES financeurs de l'élève (bourse, entreprise…), une par prise en charge. Leur part
   * s'ajoute à celle de la famille pour comparer au montant « famille » déclaré par l'acte (la famille ne paie que le reste).
   */
  otherFunderInvoices: z
    .array(
      z.object({
        invoiceId: stateassignUuidSchema,
        number: z.string().nullable(),
        status: z.string(),
        total: stateassignMoneySchema,
        paid: stateassignMoneySchema,
        credited: stateassignMoneySchema,
        dueDate: stateassignDateSchema,
        scholarshipId: stateassignUuidSchema.nullable(),
        funderKind: z.string().nullable(),
        funderName: z.string().nullable(),
      }),
    )
    .default([]),
  /** Paiements reçus de l'État (financeur) : lecture, jamais copiés ici. */
  statePayments: z.array(
    z.object({
      paymentId: stateassignUuidSchema,
      receivedAt: stateassignInstantSchema,
      amount: stateassignMoneySchema,
      allocated: stateassignMoneySchema,
      reference: z.string().nullable(),
    }),
  ),
  /** Paiements de financeur SANS référence de prise en charge alors que l'élève a plusieurs financeurs : non rattachés à l'État. */
  unattributedPayments: z
    .array(
      z.object({
        paymentId: stateassignUuidSchema,
        receivedAt: stateassignInstantSchema,
        amount: stateassignMoneySchema,
        allocated: stateassignMoneySchema,
        reference: z.string().nullable(),
      }),
    )
    .default([]),
  scholarshipIds: z.array(stateassignUuidSchema),
});
export type StateFundingBillingDto = z.infer<typeof stateFundingBillingSchema>;

export const assignmentDetailDtoSchema = z.object({
  assignment: assignmentDtoSchema,
  versions: z.array(assignmentVersionDtoSchema),
  controls: z.array(controlDtoSchema),
  documents: z.array(assignmentDocumentDtoSchema),
  events: z.array(assignmentEventDtoSchema),
  receivables: z.array(receivableDtoSchema),
  receivablesSummary: z.object({
    expected: stateassignMoneySchema,
    received: stateassignMoneySchema,
    outstanding: stateassignMoneySchema,
    overdue: stateassignMoneySchema,
    /** Déclaré (État) − planifié : part du montant déclaré sans échéance. `null` sans montant déclaré. */
    unscheduled: stateassignMoneySchema.nullable(),
  }),
  /** Statut de l'inscription chez `academic` (financement et référence), relu au moment de la demande. */
  enrollment: z
    .object({
      fundingType: z.string(),
      assignmentReference: z.string().nullable(),
      status: z.string(),
      /** La référence d'`academic` est celle du dossier vérifié (une seule source). */
      referenceMatchesAssignment: z.boolean(),
    })
    .nullable(),
});
export type AssignmentDetailDto = z.infer<typeof assignmentDetailDtoSchema>;

// ---------------------------------------------------------------------------
// Requêtes et corps
// ---------------------------------------------------------------------------

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
};

export const assignmentListQuerySchema = z
  .object({
    institutionId: stateassignUuidSchema.optional(),
    academicYearId: stateassignUuidSchema.optional(),
    studentId: stateassignUuidSchema.optional(),
    enrollmentId: stateassignUuidSchema.optional(),
    status: assignmentStatusSchema.optional(),
    reconciliationStatus: reconciliationStatusSchema.optional(),
    /** Recherche par référence (préfixe ou fragment). */
    q: z.string().trim().min(1).max(100).optional(),
    /** `true` : inclut les versions remplacées et les dossiers rejetés (sinon, dossiers courants seulement). */
    includeHistory: z.enum(["true", "false"]).optional(),
    ...pageQuery,
  })
  .strict();
export type AssignmentListQuery = z.infer<typeof assignmentListQuerySchema>;

export const assignmentListResponseSchema = z.object({
  items: z.array(assignmentDtoSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AssignmentListResponse = z.infer<typeof assignmentListResponseSchema>;

/** `recordAssignment` HTTP : toujours la source MANUAL (import et passerelle passent par leurs ports). */
export const recordAssignmentBodySchema = z
  .object({
    enrollmentId: stateassignUuidSchema,
    reference: z.string().trim().min(1, "La référence d'affectation est requise.").max(120),
    issuedOn: stateassignDateSchema.nullable().optional(),
    issuingAuthority: optionalText(200).nullable().optional(),
    declaredStateAmount: stateassignAmountInputSchema.nullable().optional(),
    declaredParentAmount: stateassignAmountInputSchema.nullable().optional(),
    notes: optionalText(2000).nullable().optional(),
  })
  .strict();
export type RecordAssignmentBody = z.infer<typeof recordAssignmentBodySchema>;

/** Correction d'un dossier RECEIVED (avant vérification). Après : avenant. */
export const updateAssignmentBodySchema = z
  .object({
    reference: z.string().trim().min(1).max(120).optional(),
    issuedOn: stateassignDateSchema.nullable().optional(),
    issuingAuthority: optionalText(200).nullable().optional(),
    declaredStateAmount: stateassignAmountInputSchema.nullable().optional(),
    declaredParentAmount: stateassignAmountInputSchema.nullable().optional(),
    notes: optionalText(2000).nullable().optional(),
    rowVersion: z.number().int().min(1),
  })
  .strict();
export type UpdateAssignmentBody = z.infer<typeof updateAssignmentBodySchema>;

export const verifyAssignmentBodySchema = z.object({ note: optionalText(2000).nullable().optional(), rowVersion: z.number().int().min(1) }).strict();
export const rejectAssignmentBodySchema = z.object({ reason: stateassignReasonSchema, rowVersion: z.number().int().min(1) }).strict();
export const activateAssignmentBodySchema = z.object({ rowVersion: z.number().int().min(1) }).strict();
export const suspendAssignmentBodySchema = z.object({ reason: stateassignReasonSchema, rowVersion: z.number().int().min(1) }).strict();
export const resumeAssignmentBodySchema = z.object({ rowVersion: z.number().int().min(1) }).strict();
export const endAssignmentBodySchema = z
  .object({ endedOn: stateassignDateSchema, reason: stateassignReasonSchema, rowVersion: z.number().int().min(1) })
  .strict();
export const transferOutAssignmentBodySchema = endAssignmentBodySchema;

export const amendAssignmentBodySchema = z
  .object({
    reason: stateassignReasonSchema,
    effectiveOn: stateassignDateSchema,
    reference: z.string().trim().min(1).max(120).optional(),
    issuedOn: stateassignDateSchema.nullable().optional(),
    issuingAuthority: optionalText(200).nullable().optional(),
    declaredStateAmount: stateassignAmountInputSchema.nullable().optional(),
    declaredParentAmount: stateassignAmountInputSchema.nullable().optional(),
    rowVersion: z.number().int().min(1),
  })
  .strict();
export type AmendAssignmentBody = z.infer<typeof amendAssignmentBodySchema>;

export const amendAssignmentResponseSchema = z.object({ superseded: assignmentDtoSchema, current: assignmentDtoSchema });

export const reconcileAssignmentResultSchema = z.object({
  assignment: assignmentDtoSchema,
  billing: stateFundingBillingSchema,
  receivables: z.array(receivableDtoSchema),
  /** Versements de l'État reçus au-delà des échéances planifiées. */
  unallocated: stateassignMoneySchema,
  linkedScholarship: z.boolean(),
  warnings: z.array(z.string()),
});
export type ReconcileAssignmentResult = z.infer<typeof reconcileAssignmentResultSchema>;

// --- Contrôles ---

export const planControlBodySchema = z
  .object({
    kind: controlKindSchema,
    academicPeriodId: stateassignUuidSchema.nullable().optional(),
    dueOn: stateassignDateSchema,
  })
  .strict();
export const completeControlBodySchema = z
  .object({
    outcome: z.enum(["OK", "ANOMALY"]),
    findings: optionalText(4000).nullable().optional(),
  })
  .strict();
export const waiveControlBodySchema = z.object({ reason: stateassignReasonSchema }).strict();
export const resolveControlBodySchema = z.object({ resolution: stateassignReasonSchema }).strict();

export const attendanceFactsSchema = z.object({
  /** Faits fournis par `attendance` (jamais calculés ici) : minutes d'absence, dont justifiées, et retards. */
  absentMinutes: z.number().int().min(0),
  excusedMinutes: z.number().int().min(0),
  lateCount: z.number().int().min(0),
  periodId: stateassignUuidSchema.nullable(),
});
export type AttendanceFactsDto = z.infer<typeof attendanceFactsSchema>;

export const controlsDueQuerySchema = z
  .object({
    institutionId: stateassignUuidSchema.optional(),
    academicYearId: stateassignUuidSchema.optional(),
    status: controlStatusSchema.optional(),
    kind: controlKindSchema.optional(),
    /** `true` : seulement les contrôles à faire dont l'échéance est dépassée. */
    overdueOnly: z.enum(["true", "false"]).optional(),
    ...pageQuery,
  })
  .strict();
export const controlReportRowSchema = z.object({
  control: controlDtoSchema,
  assignmentReference: z.string(),
  assignmentStatus: assignmentStatusSchema,
  studentId: stateassignUuidSchema,
  studentName: z.string().nullable(),
  institutionId: stateassignUuidSchema,
  academicYearId: stateassignUuidSchema,
});
export const controlsDueResponseSchema = z.object({ items: z.array(controlReportRowSchema), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });

// --- Documents ---

export const addAssignmentDocumentBodySchema = z
  .object({
    kind: assignmentDocumentKindSchema,
    documentRef: stateassignUuidSchema,
    label: optionalText(200).nullable().optional(),
    receivedOn: stateassignDateSchema.nullable().optional(),
  })
  .strict();
export const withdrawAssignmentDocumentBodySchema = z.object({ reason: stateassignReasonSchema }).strict();

// --- Créances ---

export const scheduleReceivableBodySchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    dueOn: stateassignDateSchema,
    expectedAmount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type ScheduleReceivableBody = z.infer<typeof scheduleReceivableBodySchema>;

export const updateReceivableBodySchema = z
  .object({
    label: z.string().trim().min(1).max(200).optional(),
    dueOn: stateassignDateSchema.optional(),
    expectedAmount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    rowVersion: z.number().int().min(1),
  })
  .strict();
export const cancelReceivableBodySchema = z.object({ reason: stateassignReasonSchema, rowVersion: z.number().int().min(1) }).strict();

export const receivableListQuerySchema = z
  .object({
    institutionId: stateassignUuidSchema.optional(),
    academicYearId: stateassignUuidSchema.optional(),
    studentId: stateassignUuidSchema.optional(),
    assignmentId: stateassignUuidSchema.optional(),
    status: receivableStatusSchema.optional(),
    overdueOnly: z.enum(["true", "false"]).optional(),
    dueFrom: stateassignDateSchema.optional(),
    dueTo: stateassignDateSchema.optional(),
    ...pageQuery,
  })
  .strict();
export const receivableListResponseSchema = z.object({
  items: z.array(receivableDtoSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  asOf: stateassignDateSchema,
});
export type ReceivableListResponse = z.infer<typeof receivableListResponseSchema>;

export const receivablesAgingQuerySchema = z
  .object({ institutionId: stateassignUuidSchema.optional(), academicYearId: stateassignUuidSchema.optional() })
  .strict();
export const receivablesAgingResponseSchema = z.object({
  asOf: stateassignDateSchema,
  currency: z.string(),
  buckets: z.array(z.object({ bucket: receivableAgingBucketSchema, count: z.number().int(), outstanding: stateassignMoneySchema })),
  totals: z.object({
    expected: stateassignMoneySchema,
    received: stateassignMoneySchema,
    outstanding: stateassignMoneySchema,
    overdue: stateassignMoneySchema,
    receivables: z.number().int(),
    overdueReceivables: z.number().int(),
  }),
});
export type ReceivablesAgingResponse = z.infer<typeof receivablesAgingResponseSchema>;

// --- États de rapprochement ---

export const reconciliationReportQuerySchema = z
  .object({
    institutionId: stateassignUuidSchema.optional(),
    academicYearId: stateassignUuidSchema.optional(),
    reconciliationStatus: reconciliationStatusSchema.optional(),
    ...pageQuery,
  })
  .strict();
export const reconciliationReportResponseSchema = z.object({
  items: z.array(assignmentDtoSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  counts: z.object({ never: z.number().int(), balanced: z.number().int(), discrepancy: z.number().int() }),
});
export type ReconciliationReportResponse = z.infer<typeof reconciliationReportResponseSchema>;

export const stateassignSummaryQuerySchema = z
  .object({ institutionId: stateassignUuidSchema.optional(), academicYearId: stateassignUuidSchema.optional() })
  .strict();
export const stateassignSummaryResponseSchema = z.object({
  asOf: stateassignDateSchema,
  currency: z.string(),
  assignmentsByStatus: z.record(z.number().int()),
  declaredState: stateassignMoneySchema,
  declaredParent: stateassignMoneySchema,
  receivables: z.object({ expected: stateassignMoneySchema, received: stateassignMoneySchema, outstanding: stateassignMoneySchema, overdue: stateassignMoneySchema }),
  controls: z.object({ pending: z.number().int(), overdue: z.number().int(), anomalies: z.number().int() }),
  reconciliation: z.object({ never: z.number().int(), balanced: z.number().int(), discrepancy: z.number().int() }),
});
export type StateassignSummaryResponse = z.infer<typeof stateassignSummaryResponseSchema>;

// ---------------------------------------------------------------------------
// Exports (formats en données)
// ---------------------------------------------------------------------------

export const exportColumnSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/),
  header: z.string().trim().min(1).max(100),
});
export type ExportColumn = z.infer<typeof exportColumnSchema>;

export const exportFormatDtoSchema = z.object({
  id: stateassignUuidSchema,
  institutionId: stateassignUuidSchema,
  code: z.string(),
  label: z.string(),
  dataset: exportDatasetSchema,
  columns: z.array(exportColumnSchema),
  delimiter: z.enum([";", ",", "\t"]),
  includeBom: z.boolean(),
  active: z.boolean(),
  updatedAt: stateassignInstantSchema,
});
export type ExportFormatDto = z.infer<typeof exportFormatDtoSchema>;

export const createExportFormatBodySchema = z
  .object({
    institutionId: stateassignUuidSchema,
    code: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/, "Code : minuscules, chiffres, - et _ (2 à 40 caractères)."),
    label: z.string().trim().min(1).max(120),
    dataset: exportDatasetSchema,
    columns: z.array(exportColumnSchema).min(1).max(40),
    delimiter: z.enum([";", ",", "\t"]).default(";"),
    includeBom: z.boolean().default(true),
  })
  .strict();
export type CreateExportFormatBody = z.infer<typeof createExportFormatBodySchema>;

export const updateExportFormatBodySchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    columns: z.array(exportColumnSchema).min(1).max(40).optional(),
    delimiter: z.enum([";", ",", "\t"]).optional(),
    includeBom: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const exportFormatListQuerySchema = z.object({ institutionId: stateassignUuidSchema.optional(), dataset: exportDatasetSchema.optional() }).strict();

/** Catalogue des colonnes disponibles par jeu (clés stables, libellés français) : le client compose un format avec. */
export const exportCatalogResponseSchema = z.object({
  datasets: z.array(
    z.object({
      dataset: exportDatasetSchema,
      label: z.string(),
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      /** Format neutre intégré (colonnes du catalogue, ni officiel ni modifiable) : utilisé quand aucun format n'est choisi. */
      standardColumns: z.array(exportColumnSchema),
    }),
  ),
});
export type ExportCatalogResponse = z.infer<typeof exportCatalogResponseSchema>;

export const exportQuerySchema = z
  .object({
    /** Format de l'établissement ; absent = format neutre intégré du jeu. */
    formatId: stateassignUuidSchema.optional(),
    institutionId: stateassignUuidSchema.optional(),
    academicYearId: stateassignUuidSchema.optional(),
    status: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export const exportMetaSchema = z.object({
  dataset: exportDatasetSchema,
  rowCount: z.number().int(),
  totalCount: z.number().int(),
  truncated: z.boolean(),
  maxRows: z.number().int(),
});
export type ExportMeta = z.infer<typeof exportMetaSchema>;

// ---------------------------------------------------------------------------
// Passerelle (future) et vue famille
// ---------------------------------------------------------------------------

export const stateGatewayStatusSchema = z.object({
  configured: z.boolean(),
  adapter: z.string(),
  /** Explication affichable : en V1, aucun appel externe n'existe. */
  message: z.string(),
});
export type StateGatewayStatusDto = z.infer<typeof stateGatewayStatusSchema>;

/** Vue FAMILLE : le statut, jamais les montants de l'État, les échéances, les écarts ni les contrôles. */
export const childAssignmentDtoSchema = z.object({
  studentId: stateassignUuidSchema,
  hasAssignment: z.boolean(),
  status: assignmentStatusSchema.nullable(),
  /** Un humain a vérifié le dossier. */
  verified: z.boolean(),
  reference: z.string().nullable(),
  issuedOn: stateassignDateSchema.nullable(),
  academicYearId: stateassignUuidSchema.nullable(),
});
export type ChildAssignmentDto = z.infer<typeof childAssignmentDtoSchema>;

export const stateassignMeContextSchema = z.object({
  features: z.object({ core: z.boolean(), gateway: z.boolean() }),
});

// ---------------------------------------------------------------------------
// Erreurs et événements
// ---------------------------------------------------------------------------

export const STATEASSIGN_ERROR_CODES = [
  "stateassign.invalid_input",
  "stateassign.forbidden",
  "stateassign.port_unavailable",
  "stateassign.assignment_not_found",
  "stateassign.receivable_not_found",
  "stateassign.control_not_found",
  "stateassign.document_not_found",
  "stateassign.export_format_not_found",
  "stateassign.institution_not_found",
  "stateassign.enrollment_not_found",
  "stateassign.enrollment_not_eligible",
  "stateassign.enrollment_funding_refused",
  "stateassign.document_ref_not_found",
  "stateassign.duplicate_live_assignment",
  "stateassign.duplicate_reference",
  "stateassign.duplicate_control",
  "stateassign.duplicate_document",
  "stateassign.duplicate_export_format",
  "stateassign.version_conflict",
  "stateassign.transition_invalid",
  "stateassign.four_eyes_required",
  "stateassign.human_actor_required",
  "stateassign.content_frozen",
  "stateassign.control_state",
  "stateassign.control_transition",
  "stateassign.resolution_required",
  "stateassign.receivable_state",
  "stateassign.declared_amount_required",
  "stateassign.receivable_exceeds_declared",
  "stateassign.receivable_cancel_received",
  "stateassign.amendment_below_schedule",
  "stateassign.amendment_empty",
  "stateassign.reconciliation_unavailable",
  "stateassign.gateway_not_configured",
  "stateassign.export_column_unknown",
  "stateassign.immutable",
] as const;
export type StateassignErrorCode = (typeof STATEASSIGN_ERROR_CODES)[number];

const eventBase = {
  v: z.literal(1),
  assignmentId: stateassignUuidSchema,
  enrollmentId: stateassignUuidSchema,
  studentId: stateassignUuidSchema,
  institutionId: stateassignUuidSchema,
  academicYearId: stateassignUuidSchema,
  version: z.number().int().min(1),
};

/** Aucun nom, aucune référence d'acte : des identifiants, des statuts, des montants entiers. */
export const stateassignAssignmentEventPayloadSchema = z.object({
  ...eventBase,
  status: assignmentStatusSchema,
  previousStatus: assignmentStatusSchema.nullable(),
  source: assignmentSourceSchema,
});
export type StateassignAssignmentEventPayload = z.infer<typeof stateassignAssignmentEventPayloadSchema>;

export const stateassignControlEventPayloadSchema = z.object({
  v: z.literal(1),
  controlId: stateassignUuidSchema,
  assignmentId: stateassignUuidSchema,
  enrollmentId: stateassignUuidSchema,
  studentId: stateassignUuidSchema,
  institutionId: stateassignUuidSchema,
  kind: controlKindSchema,
  status: controlStatusSchema,
  dueOn: stateassignDateSchema,
});

export const stateassignReconciliationEventPayloadSchema = z.object({
  ...eventBase,
  status: reconciliationStatusSchema,
  stateDelta: stateassignMoneySchema,
  parentDelta: stateassignMoneySchema,
});

export const stateassignReceivableEventPayloadSchema = z.object({
  v: z.literal(1),
  receivableId: stateassignUuidSchema,
  assignmentId: stateassignUuidSchema,
  enrollmentId: stateassignUuidSchema,
  studentId: stateassignUuidSchema,
  institutionId: stateassignUuidSchema,
  dueOn: stateassignDateSchema,
  expected: stateassignMoneySchema,
  received: stateassignMoneySchema,
  status: receivableStatusSchema,
  daysOverdue: z.number().int().min(0),
});

export const stateassignEventPayloadSchemas = {
  "stateassign.assignment.received": stateassignAssignmentEventPayloadSchema,
  "stateassign.assignment.verified": stateassignAssignmentEventPayloadSchema,
  "stateassign.assignment.activated": stateassignAssignmentEventPayloadSchema,
  "stateassign.assignment.suspended": stateassignAssignmentEventPayloadSchema,
  "stateassign.assignment.resumed": stateassignAssignmentEventPayloadSchema,
  "stateassign.assignment.ended": stateassignAssignmentEventPayloadSchema,
  "stateassign.assignment.transferred": stateassignAssignmentEventPayloadSchema,
  "stateassign.assignment.superseded": stateassignAssignmentEventPayloadSchema,
  "stateassign.assignment.rejected": stateassignAssignmentEventPayloadSchema,
  "stateassign.control.due": stateassignControlEventPayloadSchema,
  "stateassign.control.performed": stateassignControlEventPayloadSchema,
  "stateassign.control.anomaly_detected": stateassignControlEventPayloadSchema,
  "stateassign.reconciliation.discrepancy": stateassignReconciliationEventPayloadSchema,
  "stateassign.receivable.scheduled": stateassignReceivableEventPayloadSchema,
  "stateassign.receivable.overdue": stateassignReceivableEventPayloadSchema,
  "stateassign.receivable.received": stateassignReceivableEventPayloadSchema,
  "stateassign.receivable.cancelled": stateassignReceivableEventPayloadSchema,
} as const;
