/**
 * Contrats du module `attendance` (routes `/api/v1/attendance/*`, événements `attendance.*`).
 * Écrits avant les routes (ADR-001 règle 6) ; le client web et la PWA hors-ligne (spec 029) sont typés à partir
 * de ces schémas.
 *
 * Conventions (ADR-007, module-conventions.md) :
 *  - IDENTIFIANTS : UUID. Élèves, classes, inscriptions, séances (occurrences), périodes : références SANS clé
 *    étrangère vers les autres modules (academic, people, scheduling).
 *  - DATES calendaires : `AAAA-MM-JJ` ; INSTANTS : ISO 8601 avec fuseau (`...Z`).
 *  - STATUTS DE PRÉSENCE : des DONNÉES (`status_definitions`) ; les codes système sont `PRESENT`, `ABSENT`,
 *    `LATE`, `EXCUSED`, `EARLY_LEAVE` (élèves) et `PRESENT`, `ABSENT`, `LATE`, `ON_LEAVE` (personnel). Un
 *    établissement peut en AJOUTER ; l'API accepte donc tout code bien formé et le module le valide en base.
 *  - SAISIE RAPIDE / HORS-LIGNE : chaque pointage ou séance peut porter un `clientId` (UUID généré par
 *    l'appareil) = clé d'idempotence ; l'appareil fournit son horodatage (`clientMarkedAt`), le serveur fait foi
 *    (`receivedAt`). Rejouer un lot ne crée aucun doublon (voir `attendanceSyncBatchSchema`).
 *  - AUCUN seuil, AUCUNE équivalence (« 3 retards = 1 absence ») : des comptages bruts et des événements.
 *    Les règles d'alerte sont des PARAMÈTRES d'établissement (`alertRules`), jamais des constantes.
 *  - Messages utilisateur en français ; codes d'erreur stables `attendance.*`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const attendanceUuidSchema = z.string().uuid();

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const attendanceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine(isRealDate, "Date inexistante.");
export const attendanceInstantSchema = z.string().datetime({ offset: true });

/** Code de statut / motif / type : majuscules, chiffres, `_`. */
export const attendanceCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/, "Code attendu : majuscules, chiffres et _ (40 max).");

const note = (max = 500) => z.string().trim().min(1).max(max);
const reasonText = (min: number, max = 500) => z.string().trim().min(min, `Le motif doit faire au moins ${min} caractères.`).max(max);
const minutes = z.number().int().min(1).max(24 * 60);

export const ATTENDANCE_SESSION_SCOPES = ["DAILY", "SESSION"] as const;
export const attendanceSessionScopeSchema = z.enum(ATTENDANCE_SESSION_SCOPES);
export const ATTENDANCE_SESSION_STATUSES = ["OPEN", "SUBMITTED", "VALIDATED", "CANCELLED"] as const;
export const attendanceSessionStatusSchema = z.enum(ATTENDANCE_SESSION_STATUSES);
export const ATTENDANCE_SESSION_SOURCES = ["MANUAL", "OFFLINE_SYNC", "LIVE_CLASS", "IMPORT"] as const;
export const attendanceSessionSourceSchema = z.enum(ATTENDANCE_SESSION_SOURCES);
export const ATTENDANCE_RECORD_SOURCES = ["TEACHER", "ADMIN", "LIVE_CLASS", "OFFLINE_SYNC", "IMPORT", "JUSTIFICATION"] as const;
export const attendanceRecordSourceSchema = z.enum(ATTENDANCE_RECORD_SOURCES);
export const ATTENDANCE_JUSTIFICATION_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "WITHDRAWN", "REVOKED"] as const;
export const attendanceJustificationStatusSchema = z.enum(ATTENDANCE_JUSTIFICATION_STATUSES);
export const ATTENDANCE_SUBMITTER_KINDS = ["GUARDIAN", "STUDENT", "STAFF"] as const;
export const attendanceSubmitterKindSchema = z.enum(ATTENDANCE_SUBMITTER_KINDS);
export const ATTENDANCE_LEAVE_STATUSES = ["REQUESTED", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const attendanceLeaveStatusSchema = z.enum(ATTENDANCE_LEAVE_STATUSES);
export const ATTENDANCE_STAFF_SOURCES = ["MANUAL", "SELF", "OFFLINE_SYNC", "IMPORT", "QR", "BADGE", "BIOMETRIC"] as const;
export const attendanceStaffSourceSchema = z.enum(ATTENDANCE_STAFF_SOURCES);
export const ATTENDANCE_SUBJECT_KINDS = ["STUDENT", "STAFF"] as const;
export const attendanceSubjectKindSchema = z.enum(ATTENDANCE_SUBJECT_KINDS);
export const ATTENDANCE_CALL_SCOPES = ["DAILY", "SESSION", "BOTH"] as const;
export const attendanceCallScopeSchema = z.enum(ATTENDANCE_CALL_SCOPES);
export const ATTENDANCE_ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const attendanceAttachmentTypeSchema = z.enum(ATTENDANCE_ATTACHMENT_TYPES);

/** Indicateurs évaluables par une règle d'alerte (comptages bruts du récapitulatif effectif). */
export const ATTENDANCE_ALERT_METRICS = [
  "ABSENT_COUNT",
  "UNEXCUSED_ABSENT_COUNT",
  "LATE_COUNT",
  "ABSENT_MINUTES",
  "UNEXCUSED_ABSENT_MINUTES",
  "ABSENCE_RATE_BPS",
] as const;
export const attendanceAlertMetricSchema = z.enum(ATTENDANCE_ALERT_METRICS);

// ---------------------------------------------------------------------------
// Paramètres de route / requêtes de liste
// ---------------------------------------------------------------------------

export const attendanceIdParamsSchema = z.object({ id: attendanceUuidSchema }).strict();
export const attendanceRecordParamsSchema = z.object({ id: attendanceUuidSchema, rid: attendanceUuidSchema }).strict();
export const attendanceAttachmentParamsSchema = z.object({ id: attendanceUuidSchema, aid: attendanceUuidSchema }).strict();
export const attendanceStudentParamsSchema = z.object({ id: attendanceUuidSchema }).strict();
export const attendanceChildParamsSchema = z.object({ studentId: attendanceUuidSchema }).strict();

const limitQuery = z.coerce.number().int().min(1).max(200);
const pageQuery = { limit: limitQuery.optional(), cursor: z.string().min(1).max(200).optional() };

export const attendanceListSessionsQuerySchema = z
  .object({
    classroomId: attendanceUuidSchema.optional(),
    date: attendanceDateSchema.optional(),
    from: attendanceDateSchema.optional(),
    to: attendanceDateSchema.optional(),
    status: attendanceSessionStatusSchema.optional(),
    staffId: attendanceUuidSchema.optional(),
    occurrenceId: attendanceUuidSchema.optional(),
    ...pageQuery,
  })
  .strict();

// ---------------------------------------------------------------------------
// Séances d'appel et pointages
// ---------------------------------------------------------------------------

const openByOccurrence = z.object({ occurrenceId: attendanceUuidSchema, clientId: attendanceUuidSchema.optional() }).strict();
const openDaily = z
  .object({
    scope: z.literal("DAILY"),
    classroomId: attendanceUuidSchema,
    date: attendanceDateSchema,
    /** Remplaçant occasionnel désigné par la direction (`attendance.manage`). */
    takenByStaffId: attendanceUuidSchema.optional(),
    clientId: attendanceUuidSchema.optional(),
  })
  .strict();
/** Appel sans occurrence : uniquement pour les sources externes (visio, import) et la direction. */
const openExternal = z
  .object({
    scope: z.literal("SESSION"),
    classroomId: attendanceUuidSchema,
    date: attendanceDateSchema,
    curriculumNodeId: attendanceUuidSchema,
    offeringId: attendanceUuidSchema.optional(),
    source: z.enum(["LIVE_CLASS", "IMPORT"]),
    startsAt: attendanceInstantSchema.optional(),
    endsAt: attendanceInstantSchema.optional(),
    durationMinutes: z.number().int().min(1).max(24 * 60).optional(),
  })
  .strict();
export const attendanceOpenSessionBodySchema = z.union([openByOccurrence, openDaily, openExternal]);
export type AttendanceOpenSessionBody = z.infer<typeof attendanceOpenSessionBodySchema>;

export const attendanceMarkEntrySchema = z
  .object({
    studentId: attendanceUuidSchema,
    statusCode: attendanceCodeSchema,
    /** Retard : minutes (obligatoires si la politique d'appel l'exige). */
    minutesLate: minutes.optional(),
    /** Départ anticipé : minutes manquées (sinon déduites de `leftAt`). */
    minutesMissed: minutes.optional(),
    arrivedAt: attendanceInstantSchema.optional(),
    leftAt: attendanceInstantSchema.optional(),
    note: note(500).optional(),
  })
  .strict();
export type AttendanceMarkEntry = z.infer<typeof attendanceMarkEntrySchema>;

/** Marquage en lot. Idempotent : rejouer le même lot ne change rien (dernier arrivé gagne, tant que non validé). */
export const attendanceMarkRecordsBodySchema = z
  .object({ entries: z.array(attendanceMarkEntrySchema).min(1).max(500) })
  .strict();

export const attendanceMarkWithJustificationBodySchema = z
  .object({
    studentId: attendanceUuidSchema,
    reasonCode: attendanceCodeSchema,
    comment: note(1000).optional(),
    /** `ABSENT` par défaut ; `LATE` / `EARLY_LEAVE` gardent leur statut avec `excused = true`. */
    statusCode: attendanceCodeSchema.optional(),
    minutesLate: minutes.optional(),
    minutesMissed: minutes.optional(),
  })
  .strict();

export const attendanceSubmitSessionBodySchema = z
  .object({
    /** Statut donné aux élèves non marqués (« tous présents sauf »). Obligatoire s'il en reste. */
    defaultStatus: attendanceCodeSchema.optional(),
    /** Raccourci de `defaultStatus: "PRESENT"`. */
    allPresent: z.boolean().optional(),
  })
  .strict()
  .refine((b) => !(b.allPresent && b.defaultStatus && b.defaultStatus !== "PRESENT"), "allPresent est incompatible avec un autre statut par défaut.");

export const attendanceReasonBodySchema = z.object({ reason: reasonText(5) }).strict();
export const attendanceEmptyBodySchema = z.object({}).strict();

export const attendanceExternalMarksBodySchema = z
  .object({
    sessionId: attendanceUuidSchema,
    entries: z
      .array(
        z
          .object({
            studentId: attendanceUuidSchema,
            statusCode: attendanceCodeSchema,
            evidence: z.object({ note: note(200).optional() }).strict().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Synchronisation hors-ligne (idempotente, tolérante au rejeu)
// ---------------------------------------------------------------------------

export const attendanceSyncRecordSchema = z
  .object({
    /** Clé d'idempotence du pointage (UUID généré par l'appareil). */
    clientId: attendanceUuidSchema,
    studentId: attendanceUuidSchema,
    statusCode: attendanceCodeSchema,
    minutesLate: minutes.optional(),
    minutesMissed: minutes.optional(),
    arrivedAt: attendanceInstantSchema.optional(),
    leftAt: attendanceInstantSchema.optional(),
    note: note(500).optional(),
    /** Instant du pointage selon l'horloge de l'appareil. */
    clientMarkedAt: attendanceInstantSchema,
  })
  .strict();

const syncTarget = z.union([
  z.object({ occurrenceId: attendanceUuidSchema }).strict(),
  z.object({ scope: z.literal("DAILY"), classroomId: attendanceUuidSchema, date: attendanceDateSchema }).strict(),
]);

export const attendanceSyncSessionSchema = z
  .object({
    /** Clé d'idempotence de la séance (UUID généré par l'appareil). */
    clientId: attendanceUuidSchema,
    target: syncTarget,
    clientOpenedAt: attendanceInstantSchema,
    records: z.array(attendanceSyncRecordSchema).max(500),
    /** Soumettre l'appel après application des pointages (jamais bloquant pour le lot). */
    submit: z.object({ defaultStatus: attendanceCodeSchema.optional() }).strict().optional(),
  })
  .strict();

export const attendanceSyncBatchSchema = z
  .object({
    /** Identifiant du lot (traçabilité ; l'idempotence est portée par les `clientId` des opérations). */
    batchId: attendanceUuidSchema.optional(),
    deviceId: z.string().trim().min(1).max(64),
    clientSentAt: attendanceInstantSchema,
    /** Décalage horloge appareil → serveur connu de l'appareil (ms), pour corriger les horodatages. */
    clockOffsetMs: z.number().int().min(-86_400_000).max(86_400_000).optional(),
    sessions: z.array(attendanceSyncSessionSchema).min(1).max(50),
  })
  .strict()
  .refine((b) => b.sessions.reduce((n, s) => n + s.records.length, 0) <= 2000, "Un lot ne dépasse pas 2000 pointages.");
export type AttendanceSyncBatch = z.infer<typeof attendanceSyncBatchSchema>;

export const ATTENDANCE_SYNC_RECORD_OUTCOMES = ["APPLIED", "UNCHANGED", "REPLAYED", "CONFLICT", "REJECTED"] as const;
export const ATTENDANCE_SYNC_CONFLICT_KINDS = ["SESSION_LOCKED", "WINDOW_CLOSED", "STALE"] as const;

export const attendanceSyncResultDtoSchema = z.object({
  batchId: attendanceUuidSchema.nullable(),
  /** Horloge du serveur à la réception : l'appareil en déduit son décalage pour le lot suivant. */
  receivedAt: z.string(),
  sessions: z.array(
    z.object({
      clientId: attendanceUuidSchema,
      outcome: z.enum(["OPENED", "EXISTING", "REPLAYED", "REJECTED"]),
      sessionId: attendanceUuidSchema.nullable(),
      sessionStatus: attendanceSessionStatusSchema.nullable(),
      submitted: z.boolean(),
      errorCode: z.string().nullable(),
      records: z.array(
        z.object({
          clientId: attendanceUuidSchema,
          outcome: z.enum(ATTENDANCE_SYNC_RECORD_OUTCOMES),
          recordId: attendanceUuidSchema.nullable(),
          conflictId: attendanceUuidSchema.nullable(),
          errorCode: z.string().nullable(),
        }),
      ),
    }),
  ),
  totals: z.object({ applied: z.number().int(), unchanged: z.number().int(), replayed: z.number().int(), conflicts: z.number().int(), rejected: z.number().int() }),
});
export type AttendanceSyncResultDto = z.infer<typeof attendanceSyncResultDtoSchema>;

export const attendanceListConflictsQuerySchema = z
  .object({ status: z.enum(["OPEN", "RESOLVED"]).optional(), sessionId: attendanceUuidSchema.optional(), ...pageQuery })
  .strict();
export const attendanceResolveConflictBodySchema = z
  .object({ resolution: z.enum(["ACCEPT_INCOMING", "KEEP_EXISTING"]), note: note(500).optional() })
  .strict();

export const attendanceSyncConflictDtoSchema = z.object({
  id: attendanceUuidSchema,
  kind: z.enum(ATTENDANCE_SYNC_CONFLICT_KINDS),
  sessionId: attendanceUuidSchema,
  enrollmentId: attendanceUuidSchema,
  studentId: attendanceUuidSchema,
  clientOpId: attendanceUuidSchema,
  incoming: z.record(z.unknown()),
  existing: z.record(z.unknown()).nullable(),
  deviceId: z.string().nullable(),
  submittedBy: attendanceUuidSchema,
  clientMarkedAt: z.string().nullable(),
  receivedAt: z.string(),
  status: z.enum(["OPEN", "RESOLVED"]),
  resolution: z.enum(["ACCEPT_INCOMING", "KEEP_EXISTING"]).nullable(),
  resolvedBy: attendanceUuidSchema.nullable(),
  resolvedAt: z.string().nullable(),
  resolutionNote: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Justificatifs
// ---------------------------------------------------------------------------

export const attendanceSubmitJustificationBodySchema = z
  .object({
    studentId: attendanceUuidSchema,
    fromDate: attendanceDateSchema,
    toDate: attendanceDateSchema,
    reasonCode: attendanceCodeSchema,
    comment: note(1000).optional(),
  })
  .strict()
  .refine((b) => b.toDate >= b.fromDate, { message: "La fin de la fenêtre précède son début.", path: ["toDate"] });

export const attendanceAttachDocumentBodySchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    /** Contenu du fichier encodé en base64 (le type réel est contrôlé par octets magiques, jamais déclaré). */
    contentBase64: z.string().min(4).regex(/^[A-Za-z0-9+/]+={0,2}$/, "Contenu base64 attendu."),
  })
  .strict();

export const attendanceAcceptJustificationBodySchema = z.object({ note: note(500).optional() }).strict();
export const attendanceRejectJustificationBodySchema = z.object({ note: reasonText(3) }).strict();
export const attendanceRevokeJustificationBodySchema = z.object({ reason: reasonText(5) }).strict();

export const attendanceListJustificationsQuerySchema = z
  .object({
    studentId: attendanceUuidSchema.optional(),
    status: attendanceJustificationStatusSchema.optional(),
    from: attendanceDateSchema.optional(),
    to: attendanceDateSchema.optional(),
    ...pageQuery,
  })
  .strict();

export const attendanceAttachmentDtoSchema = z.object({
  id: attendanceUuidSchema,
  justificationId: attendanceUuidSchema,
  fileName: z.string(),
  detectedMime: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  uploadedBy: attendanceUuidSchema,
  uploadedAt: z.string(),
});

export const attendanceJustificationDtoSchema = z.object({
  id: attendanceUuidSchema,
  studentId: attendanceUuidSchema,
  enrollmentId: attendanceUuidSchema,
  fromDate: attendanceDateSchema,
  toDate: attendanceDateSchema,
  reasonCode: z.string(),
  comment: z.string().nullable(),
  submittedByKind: attendanceSubmitterKindSchema,
  submittedByUser: attendanceUuidSchema,
  submittedAt: z.string(),
  status: attendanceJustificationStatusSchema,
  decidedBy: attendanceUuidSchema.nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  revokedBy: attendanceUuidSchema.nullable(),
  revokedAt: z.string().nullable(),
  revocationReason: z.string().nullable(),
  attachments: z.array(attendanceAttachmentDtoSchema),
  /** Nombre de pointages couverts (renseigné après acceptation). */
  coveredRecordCount: z.number().int(),
});
export const attendanceSignedUrlDtoSchema = z.object({ url: z.string(), expiresAt: z.string(), fileName: z.string(), detectedMime: z.string() });

// ---------------------------------------------------------------------------
// Récapitulatifs et surcharge
// ---------------------------------------------------------------------------

export const attendanceSummaryQuerySchema = z.object({ periodId: attendanceUuidSchema }).strict();
export const attendanceSetOverrideBodySchema = z
  .object({
    enrollmentId: attendanceUuidSchema,
    periodId: attendanceUuidSchema,
    absentMinutes: z.number().int().min(0).max(10_000_000),
    excusedMinutes: z.number().int().min(0).max(10_000_000),
    reason: reasonText(5),
  })
  .strict()
  .refine((b) => b.excusedMinutes <= b.absentMinutes, { message: "Les minutes justifiées ne peuvent pas dépasser les minutes d'absence.", path: ["excusedMinutes"] });
export const attendanceRemoveOverrideQuerySchema = z
  .object({ enrollmentId: attendanceUuidSchema, periodId: attendanceUuidSchema, reason: reasonText(5).optional() })
  .strict();
export const attendanceRecomputeBodySchema = z
  .object({ enrollmentId: attendanceUuidSchema.optional(), periodId: attendanceUuidSchema.optional() })
  .strict()
  .refine((b) => b.enrollmentId !== undefined || b.periodId !== undefined, "Précisez une inscription ou une période.");

const summaryCountsShape = {
  sessionsTotal: z.number().int(),
  presentCount: z.number().int(),
  absentCount: z.number().int(),
  excusedCount: z.number().int(),
  lateCount: z.number().int(),
  excusedLateCount: z.number().int(),
  earlyLeaveCount: z.number().int(),
  unmarkedCount: z.number().int(),
  absentMinutes: z.number().int(),
  excusedMinutes: z.number().int(),
  lateMinutes: z.number().int(),
};
export const attendanceSummaryCountsDtoSchema = z.object(summaryCountsShape);
export type AttendanceSummaryCountsDto = z.infer<typeof attendanceSummaryCountsDtoSchema>;

export const attendanceSummaryDtoSchema = z.object({
  enrollmentId: attendanceUuidSchema,
  periodId: attendanceUuidSchema,
  studentId: attendanceUuidSchema.nullable(),
  windowFrom: attendanceDateSchema.nullable(),
  windowTo: attendanceDateSchema.nullable(),
  /** Comptages dérivés des pointages (cache recalculé). */
  derived: attendanceSummaryCountsDtoSchema,
  override: z
    .object({ absentMinutes: z.number().int(), excusedMinutes: z.number().int(), reason: z.string(), setBy: attendanceUuidSchema, setAt: z.string() })
    .nullable(),
  /** Valeur EFFECTIVE : surcharge (minutes) si elle existe, sinon dérivé. */
  effective: attendanceSummaryCountsDtoSchema,
  overridden: z.boolean(),
  computedAt: z.string().nullable(),
});
export type AttendanceSummaryDto = z.infer<typeof attendanceSummaryDtoSchema>;

export const attendanceClassroomSummaryDtoSchema = z.object({
  classroomId: attendanceUuidSchema,
  periodId: attendanceUuidSchema,
  rows: z.array(attendanceSummaryDtoSchema),
});

// ---------------------------------------------------------------------------
// Pointages, séances (sorties)
// ---------------------------------------------------------------------------

export const attendanceRecordDtoSchema = z.object({
  id: attendanceUuidSchema,
  sessionId: attendanceUuidSchema,
  enrollmentId: attendanceUuidSchema,
  studentId: attendanceUuidSchema,
  statusCode: z.string(),
  originalStatusCode: z.string().nullable(),
  excused: z.boolean(),
  minutesLate: z.number().int().nullable(),
  countedMinutes: z.number().int().nullable(),
  arrivedAt: z.string().nullable(),
  leftAt: z.string().nullable(),
  justificationId: attendanceUuidSchema.nullable(),
  note: z.string().nullable(),
  markedBy: attendanceUuidSchema,
  markedAt: z.string(),
  clientMarkedAt: z.string().nullable(),
  sourceDetail: z.string().nullable(),
});

export const attendanceSessionDtoSchema = z.object({
  id: attendanceUuidSchema,
  institutionId: attendanceUuidSchema,
  academicYearId: attendanceUuidSchema,
  classroomId: attendanceUuidSchema,
  curriculumNodeId: attendanceUuidSchema.nullable(),
  offeringId: attendanceUuidSchema.nullable(),
  occurrenceId: attendanceUuidSchema.nullable(),
  scope: attendanceSessionScopeSchema,
  sessionDate: attendanceDateSchema,
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  takenByStaffId: attendanceUuidSchema.nullable(),
  takenByUserId: attendanceUuidSchema.nullable(),
  status: attendanceSessionStatusSchema,
  source: attendanceSessionSourceSchema,
  clientId: attendanceUuidSchema.nullable(),
  submittedAt: z.string().nullable(),
  validatedAt: z.string().nullable(),
  validatedBy: attendanceUuidSchema.nullable(),
  reopenedCount: z.number().int(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const attendanceSessionDetailDtoSchema = z.object({
  session: attendanceSessionDtoSchema,
  students: z.array(
    z.object({
      enrollmentId: attendanceUuidSchema,
      studentId: attendanceUuidSchema,
      displayName: z.string().nullable(),
      /** Faux si l'élève n'est plus (ou pas encore) au roster mais possède un pointage historique. */
      inRoster: z.boolean(),
      record: attendanceRecordDtoSchema.nullable(),
    }),
  ),
  counts: z.object({ rosterSize: z.number().int(), marked: z.number().int(), unmarked: z.number().int(), absent: z.number().int(), late: z.number().int() }),
  /** Peut-on encore corriger les pointages (statut, fenêtre de correction, droits) ? */
  editable: z.boolean(),
});
export type AttendanceSessionDetailDto = z.infer<typeof attendanceSessionDetailDtoSchema>;

export const attendanceOpenSessionResultDtoSchema = z.object({ session: attendanceSessionDtoSchema, created: z.boolean() });
export const attendanceMarkResultDtoSchema = z.object({
  session: attendanceSessionDtoSchema,
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  records: z.array(attendanceRecordDtoSchema),
});
export const attendanceRecordHistoryDtoSchema = z.object({
  items: z.array(
    z.object({ id: attendanceUuidSchema, recordId: attendanceUuidSchema, fromStatus: z.string().nullable(), toStatus: z.string().nullable(), actorId: attendanceUuidSchema.nullable(), reason: z.string().nullable(), changedAt: z.string() }),
  ),
});

// ---------------------------------------------------------------------------
// Rapports
// ---------------------------------------------------------------------------

export const attendanceAbsencesQuerySchema = z
  .object({
    studentId: attendanceUuidSchema.optional(),
    classroomId: attendanceUuidSchema.optional(),
    periodId: attendanceUuidSchema.optional(),
    from: attendanceDateSchema.optional(),
    to: attendanceDateSchema.optional(),
    statusCode: attendanceCodeSchema.optional(),
    excused: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    format: z.enum(["json", "csv"]).optional(),
    ...pageQuery,
  })
  .strict();
export const attendanceComplianceQuerySchema = z
  .object({ from: attendanceDateSchema, to: attendanceDateSchema, institutionId: attendanceUuidSchema.optional(), staffId: attendanceUuidSchema.optional() })
  .strict();
export const attendanceStaffSummaryQuerySchema = z
  .object({ from: attendanceDateSchema, to: attendanceDateSchema, staffId: attendanceUuidSchema.optional() })
  .strict();
export const attendanceCertificateQuerySchema = z.object({ periodId: attendanceUuidSchema }).strict();

export const attendanceAbsenceRowDtoSchema = z.object({
  recordId: attendanceUuidSchema,
  sessionId: attendanceUuidSchema,
  studentId: attendanceUuidSchema,
  enrollmentId: attendanceUuidSchema,
  classroomId: attendanceUuidSchema,
  sessionDate: attendanceDateSchema,
  statusCode: z.string(),
  excused: z.boolean(),
  countedMinutes: z.number().int().nullable(),
  minutesLate: z.number().int().nullable(),
  justificationId: attendanceUuidSchema.nullable(),
});
export const attendanceAbsencesPageDtoSchema = z.object({ items: z.array(attendanceAbsenceRowDtoSchema), nextCursor: z.string().nullable() });

export const attendanceComplianceDtoSchema = z.object({
  from: attendanceDateSchema,
  to: attendanceDateSchema,
  expected: z.number().int(),
  taken: z.number().int(),
  missing: z.number().int(),
  /** Taux d'appel en points de base (10 000 = 100 %) ; `null` si aucune séance attendue. Donnée brute, sans seuil. */
  rateBps: z.number().int().nullable(),
  byStaff: z.array(z.object({ staffId: attendanceUuidSchema.nullable(), expected: z.number().int(), taken: z.number().int(), missing: z.number().int(), rateBps: z.number().int().nullable() })),
  byClassroom: z.array(z.object({ classroomId: attendanceUuidSchema, expected: z.number().int(), taken: z.number().int(), missing: z.number().int(), rateBps: z.number().int().nullable() })),
  missingOccurrences: z.array(z.object({ occurrenceId: attendanceUuidSchema, classroomId: attendanceUuidSchema, date: attendanceDateSchema, staffIds: z.array(attendanceUuidSchema) })),
});

export const attendanceCertificateDtoSchema = z.object({
  studentId: attendanceUuidSchema,
  displayName: z.string().nullable(),
  enrollmentId: attendanceUuidSchema,
  classroomId: attendanceUuidSchema,
  periodId: attendanceUuidSchema,
  windowFrom: attendanceDateSchema.nullable(),
  windowTo: attendanceDateSchema.nullable(),
  summary: attendanceSummaryCountsDtoSchema,
  overridden: z.boolean(),
});

export const attendanceStaffSummaryDtoSchema = z.object({
  from: attendanceDateSchema,
  to: attendanceDateSchema,
  rows: z.array(
    z.object({
      staffId: attendanceUuidSchema,
      days: z.number().int(),
      byStatus: z.record(z.number().int()),
      lateMinutes: z.number().int(),
      approvedLeaveDays: z.number().int(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Personnel : présence et congés
// ---------------------------------------------------------------------------

export const attendanceMarkStaffBodySchema = z
  .object({
    staffId: attendanceUuidSchema,
    workDate: attendanceDateSchema,
    statusCode: attendanceCodeSchema,
    occurrenceId: attendanceUuidSchema.optional(),
    checkInAt: attendanceInstantSchema.optional(),
    checkOutAt: attendanceInstantSchema.optional(),
    minutesLate: minutes.optional(),
    note: note(500).optional(),
    /** Correction explicite d'un jour de congé approuvé. */
    overrideLeave: z.boolean().optional(),
    clientId: attendanceUuidSchema.optional(),
  })
  .strict();
export const attendanceCheckInBodySchema = z
  .object({
    staffId: attendanceUuidSchema.optional(),
    workDate: attendanceDateSchema.optional(),
    statusCode: z.enum(["PRESENT", "LATE"]).optional(),
    minutesLate: minutes.optional(),
    at: attendanceInstantSchema.optional(),
    clientId: attendanceUuidSchema.optional(),
  })
  .strict();
export const attendanceCheckOutBodySchema = z
  .object({ staffId: attendanceUuidSchema.optional(), workDate: attendanceDateSchema.optional(), at: attendanceInstantSchema.optional() })
  .strict();
export const attendanceListStaffRecordsQuerySchema = z
  .object({ staffId: attendanceUuidSchema.optional(), from: attendanceDateSchema, to: attendanceDateSchema, statusCode: attendanceCodeSchema.optional(), ...pageQuery })
  .strict();

export const attendanceRequestLeaveBodySchema = z
  .object({
    staffId: attendanceUuidSchema.optional(),
    leaveTypeCode: attendanceCodeSchema,
    startsOn: attendanceDateSchema,
    endsOn: attendanceDateSchema,
    halfDayStart: z.boolean().optional(),
    halfDayEnd: z.boolean().optional(),
    reason: note(1000).optional(),
    /** Référence d'un document (module documents, spec 024). */
    documentRef: attendanceUuidSchema.optional(),
  })
  .strict()
  .refine((b) => b.endsOn >= b.startsOn, { message: "La fin du congé précède son début.", path: ["endsOn"] });
export const attendanceLeaveDecisionBodySchema = z.object({ note: note(500).optional() }).strict();
export const attendanceLeaveRejectBodySchema = z.object({ note: reasonText(3) }).strict();
export const attendanceListLeavesQuerySchema = z
  .object({ staffId: attendanceUuidSchema.optional(), status: attendanceLeaveStatusSchema.optional(), from: attendanceDateSchema.optional(), to: attendanceDateSchema.optional(), ...pageQuery })
  .strict();

export const attendanceStaffRecordDtoSchema = z.object({
  id: attendanceUuidSchema,
  staffId: attendanceUuidSchema,
  workDate: attendanceDateSchema,
  occurrenceId: attendanceUuidSchema.nullable(),
  statusCode: z.string(),
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
  minutesLate: z.number().int().nullable(),
  leaveId: attendanceUuidSchema.nullable(),
  note: z.string().nullable(),
  source: attendanceStaffSourceSchema,
  markedBy: attendanceUuidSchema,
  markedAt: z.string(),
});
export const attendanceLeaveDtoSchema = z.object({
  id: attendanceUuidSchema,
  staffId: attendanceUuidSchema,
  leaveTypeCode: z.string(),
  startsOn: attendanceDateSchema,
  endsOn: attendanceDateSchema,
  halfDayStart: z.boolean(),
  halfDayEnd: z.boolean(),
  reason: z.string().nullable(),
  status: attendanceLeaveStatusSchema,
  requestedBy: attendanceUuidSchema,
  requestedAt: z.string(),
  decidedBy: attendanceUuidSchema.nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  documentRef: attendanceUuidSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Paramétrage (référentiels de pack)
// ---------------------------------------------------------------------------

export const attendanceUpsertStatusBodySchema = z
  .object({
    subjectKind: attendanceSubjectKindSchema,
    code: attendanceCodeSchema,
    label: z.string().trim().min(1).max(80),
    countsAsPresent: z.boolean().optional(),
    countsAsAbsence: z.boolean().optional(),
    countsAsLate: z.boolean().optional(),
    isJustified: z.boolean().optional(),
    requiresJustification: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export const attendanceUpsertReasonBodySchema = z
  .object({ code: attendanceCodeSchema, label: z.string().trim().min(1).max(80), requiresAttachment: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional(), active: z.boolean().optional() })
  .strict();
export const attendanceUpsertLeaveTypeBodySchema = z
  .object({ code: attendanceCodeSchema, label: z.string().trim().min(1).max(80), isPaid: z.boolean().optional(), requiresApproval: z.boolean().optional(), requiresAttachment: z.boolean().optional(), active: z.boolean().optional() })
  .strict();
export const attendanceUpsertCallPolicyBodySchema = z
  .object({
    institutionId: attendanceUuidSchema,
    educationLevelCode: z.string().trim().min(1).max(40),
    callScope: attendanceCallScopeSchema,
    editWindowMinutes: z.number().int().min(0).max(10_000_000).nullable().optional(),
    lateRequiresMinutes: z.boolean().optional(),
    dailyMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  })
  .strict();

export const attendanceAlertRuleSchema = z
  .object({
    code: attendanceCodeSchema,
    metric: attendanceAlertMetricSchema,
    /** Seuil FOURNI par l'établissement (paramètre de pack / RuleSet) : jamais une constante du module. */
    threshold: z.number().int().min(1).max(100_000_000),
    active: z.boolean().default(true),
  })
  .strict();
export type AttendanceAlertRuleInput = z.input<typeof attendanceAlertRuleSchema>;

export const attendanceUpsertSettingsBodySchema = z
  .object({
    attachmentMaxBytes: z.number().int().min(1).max(25 * 1024 * 1024).nullable().optional(),
    allowedAttachmentTypes: z.array(attendanceAttachmentTypeSchema).max(4).nullable().optional(),
    allowFutureJustifications: z.boolean().optional(),
    alertRules: z.array(attendanceAlertRuleSchema).max(50).optional(),
  })
  .strict();

export const attendanceStatusDefinitionDtoSchema = z.object({
  subjectKind: attendanceSubjectKindSchema,
  code: z.string(),
  label: z.string(),
  countsAsPresent: z.boolean(),
  countsAsAbsence: z.boolean(),
  countsAsLate: z.boolean(),
  isJustified: z.boolean(),
  requiresJustification: z.boolean(),
  sortOrder: z.number().int(),
  isSystem: z.boolean(),
  active: z.boolean(),
});
export const attendanceReasonDtoSchema = z.object({ id: attendanceUuidSchema, code: z.string(), label: z.string(), requiresAttachment: z.boolean(), sortOrder: z.number().int(), active: z.boolean() });
export const attendanceLeaveTypeDtoSchema = z.object({ id: attendanceUuidSchema, code: z.string(), label: z.string(), isPaid: z.boolean(), requiresApproval: z.boolean(), requiresAttachment: z.boolean(), active: z.boolean() });
export const attendanceCallPolicyDtoSchema = z.object({
  institutionId: attendanceUuidSchema,
  educationLevelCode: z.string(),
  callScope: attendanceCallScopeSchema,
  editWindowMinutes: z.number().int().nullable(),
  lateRequiresMinutes: z.boolean(),
  dailyMinutes: z.number().int().nullable(),
});
export const attendanceSettingsDtoSchema = z.object({
  attachmentMaxBytes: z.number().int().nullable(),
  allowedAttachmentTypes: z.array(z.string()).nullable(),
  allowFutureJustifications: z.boolean(),
  alertRules: z.array(attendanceAlertRuleSchema),
});

// ---------------------------------------------------------------------------
// Portails (élève / parent / personnel)
// ---------------------------------------------------------------------------

export const attendancePortalQuerySchema = z
  .object({ periodId: attendanceUuidSchema.optional(), from: attendanceDateSchema.optional(), to: attendanceDateSchema.optional(), ...pageQuery })
  .strict();
export const attendancePortalDtoSchema = z.object({
  studentId: attendanceUuidSchema,
  records: z.array(attendanceAbsenceRowDtoSchema),
  justifications: z.array(attendanceJustificationDtoSchema),
  summary: attendanceSummaryDtoSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Événements (outbox, payload `{ v: 1, … }`) — jamais de motif ni de pièce
// ---------------------------------------------------------------------------

const ev = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });

export const attendanceEventPayloadSchemas = {
  "attendance.session.opened": ev({ sessionId: attendanceUuidSchema, classroomId: attendanceUuidSchema, date: attendanceDateSchema, scope: attendanceSessionScopeSchema, occurrenceId: attendanceUuidSchema.nullable(), source: attendanceSessionSourceSchema }),
  "attendance.session.submitted": ev({ sessionId: attendanceUuidSchema, classroomId: attendanceUuidSchema, date: attendanceDateSchema, scope: attendanceSessionScopeSchema, occurrenceId: attendanceUuidSchema.nullable(), curriculumNodeId: attendanceUuidSchema.nullable(), takenByStaffId: attendanceUuidSchema.nullable(), absentCount: z.number().int(), lateCount: z.number().int(), recordCount: z.number().int() }),
  "attendance.session.validated": ev({ sessionId: attendanceUuidSchema, classroomId: attendanceUuidSchema, date: attendanceDateSchema, occurrenceId: attendanceUuidSchema.nullable() }),
  "attendance.session.reopened": ev({ sessionId: attendanceUuidSchema, classroomId: attendanceUuidSchema, date: attendanceDateSchema, occurrenceId: attendanceUuidSchema.nullable(), reopenedCount: z.number().int() }),
  "attendance.session.cancelled": ev({ sessionId: attendanceUuidSchema, classroomId: attendanceUuidSchema, date: attendanceDateSchema, occurrenceId: attendanceUuidSchema.nullable(), cause: z.enum(["MANUAL", "OCCURRENCE_CANCELLED"]) }),
  "attendance.absence.recorded": ev({ sessionId: attendanceUuidSchema, recordId: attendanceUuidSchema, enrollmentId: attendanceUuidSchema, studentId: attendanceUuidSchema, classroomId: attendanceUuidSchema, date: attendanceDateSchema, occurrenceId: attendanceUuidSchema.nullable(), statusCode: z.string(), excused: z.boolean(), countedMinutes: z.number().int().nullable(), correction: z.boolean() }),
  "attendance.late.recorded": ev({ sessionId: attendanceUuidSchema, recordId: attendanceUuidSchema, enrollmentId: attendanceUuidSchema, studentId: attendanceUuidSchema, classroomId: attendanceUuidSchema, date: attendanceDateSchema, occurrenceId: attendanceUuidSchema.nullable(), statusCode: z.string(), excused: z.boolean(), minutesLate: z.number().int().nullable(), correction: z.boolean() }),
  "attendance.justification.submitted": ev({ justificationId: attendanceUuidSchema, studentId: attendanceUuidSchema, fromDate: attendanceDateSchema, toDate: attendanceDateSchema, submittedByKind: attendanceSubmitterKindSchema }),
  "attendance.justification.accepted": ev({ justificationId: attendanceUuidSchema, studentId: attendanceUuidSchema, fromDate: attendanceDateSchema, toDate: attendanceDateSchema, coveredRecordCount: z.number().int() }),
  "attendance.justification.rejected": ev({ justificationId: attendanceUuidSchema, studentId: attendanceUuidSchema, fromDate: attendanceDateSchema, toDate: attendanceDateSchema }),
  "attendance.justification.revoked": ev({ justificationId: attendanceUuidSchema, studentId: attendanceUuidSchema, fromDate: attendanceDateSchema, toDate: attendanceDateSchema, restoredRecordCount: z.number().int() }),
  "attendance.staff_leave.requested": ev({ leaveId: attendanceUuidSchema, staffId: attendanceUuidSchema, startsOn: attendanceDateSchema, endsOn: attendanceDateSchema }),
  "attendance.staff_leave.approved": ev({ leaveId: attendanceUuidSchema, staffId: attendanceUuidSchema, leaveTypeCode: z.string(), startsOn: attendanceDateSchema, endsOn: attendanceDateSchema }),
  "attendance.staff_leave.rejected": ev({ leaveId: attendanceUuidSchema, staffId: attendanceUuidSchema, startsOn: attendanceDateSchema, endsOn: attendanceDateSchema }),
  "attendance.staff_leave.cancelled": ev({ leaveId: attendanceUuidSchema, staffId: attendanceUuidSchema, startsOn: attendanceDateSchema, endsOn: attendanceDateSchema, wasApproved: z.boolean() }),
  "attendance.staff_absence.recorded": ev({ recordId: attendanceUuidSchema, staffId: attendanceUuidSchema, workDate: attendanceDateSchema, statusCode: z.string(), occurrenceId: attendanceUuidSchema.nullable() }),
  "attendance.summary.recomputed": ev({ enrollmentId: attendanceUuidSchema, periodId: attendanceUuidSchema, studentId: attendanceUuidSchema.nullable(), overridden: z.boolean(), cause: z.string() }),
  "attendance.alert.triggered": ev({ ruleCode: z.string(), metric: attendanceAlertMetricSchema, threshold: z.number().int(), value: z.number().int(), enrollmentId: attendanceUuidSchema, studentId: attendanceUuidSchema, periodId: attendanceUuidSchema }),
  "attendance.alert.cleared": ev({ ruleCode: z.string(), metric: attendanceAlertMetricSchema, threshold: z.number().int(), value: z.number().int(), enrollmentId: attendanceUuidSchema, studentId: attendanceUuidSchema, periodId: attendanceUuidSchema }),
  "attendance.sync.conflict_recorded": ev({ conflictId: attendanceUuidSchema, kind: z.enum(ATTENDANCE_SYNC_CONFLICT_KINDS), sessionId: attendanceUuidSchema, studentId: attendanceUuidSchema }),
} as const;
export type AttendanceEventType = keyof typeof attendanceEventPayloadSchemas;
export const ATTENDANCE_EVENT_TYPES = Object.keys(attendanceEventPayloadSchemas) as AttendanceEventType[];
