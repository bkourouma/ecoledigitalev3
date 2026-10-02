/** Jeux de données des tests des écrans d'examens : valeurs FICTIVES, formes identiques aux réponses de l'API (schémas du contrat). */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  type: uuid(1),
  session: uuid(10),
  mockSession: uuid(11),
  institution: uuid(20),
  paper1: uuid(31),
  paper2: uuid(32),
  c1: uuid(41),
  c2: uuid(42),
  c3: uuid(43),
  result1: uuid(51),
  result2: uuid(52),
  center: uuid(61),
  room: uuid(62),
  batch: uuid(71),
  revision: uuid(81),
  doc: uuid(91),
  format: uuid(101),
  exportRun: uuid(111),
  score1: uuid(121),
} as const;

type Obj = Record<string, unknown>;

export const progress = (status = "REGISTRATION_OPEN", allowedNext: string[] = ["REGISTRATION_CLOSED"]) => ({
  index: ["PLANNED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "IN_PROGRESS", "RESULTS_ENTERED", "PUBLISHED", "ARCHIVED"].indexOf(status),
  total: 7,
  percent: 33,
  next: allowedNext[0] ?? null,
  allowedNext,
});

export const session = (extra: Obj = {}) => ({
  id: IDS.session,
  examTypeId: IDS.type,
  examTypeCode: "CEPE",
  examTypeLabel: "Certificat d'études primaires élémentaires",
  institutionId: IDS.institution,
  academicYearId: null,
  code: "CEPE-2027",
  label: "CEPE 2027",
  sessionKind: "OFFICIAL",
  attemptKind: "NORMAL",
  sessionYear: 2027,
  mockOfSessionId: null,
  registrationOpensOn: null,
  registrationClosesOn: null,
  startsOn: "2027-06-10",
  endsOn: null,
  status: "REGISTRATION_OPEN",
  definitionLockedAt: "2027-01-05T08:00:00.000Z",
  ruleVersionRef: null,
  sourceKind: "placeholder",
  demoRules: true,
  progress: progress(),
  createdAt: "2027-01-01T08:00:00.000Z",
  ...extra,
});

export const paper = (n: 1 | 2, extra: Obj = {}) => ({
  id: n === 1 ? IDS.paper1 : IDS.paper2,
  trackCode: null,
  code: `EP${n}`,
  label: n === 1 ? "Épreuve 1 (fictive)" : "Épreuve 2 (fictive)",
  coefficient: "1.000",
  scaleMax: "20.000",
  isOptional: false,
  ordinal: n,
  sourceKind: "placeholder",
  ...extra,
});

export const sessionDetail = (extra: Obj = {}) => ({
  ...session(),
  tracks: [],
  papers: [paper(1), paper(2)],
  counts: { candidates: 3, registered: 2, withdrawn: 0, eligible: 2, withResult: 0, published: 0, assigned: 1 },
  blockers: {},
  ...extra,
});

export const page = <T>(items: T[], total = items.length) => ({ items, total, page: 1, pageSize: 50 });

export const candidate = (n: 1 | 2 | 3 = 1, extra: Obj = {}) => ({
  id: [IDS.c1, IDS.c2, IDS.c3][n - 1],
  sessionId: IDS.session,
  studentId: uuid(200 + n),
  enrollmentId: uuid(300 + n),
  gradeLevelCode: "CM2",
  trackCode: null,
  lastName: ["KOUASSI", "TRAORE", "DIALLO"][n - 1],
  firstName: ["Awa", "Moussa", "Fatou"][n - 1],
  birthDate: "2016-03-04",
  birthPlace: "Abidjan",
  sex: n === 2 ? "M" : "F",
  registrationStatus: n === 3 ? "DRAFT" : "REGISTERED",
  eligibilityStatus: "ELIGIBLE",
  outcome: "PENDING",
  candidateNumber: n === 3 ? null : `CEPE-2027-${String(n).padStart(4, "0")}`,
  officialNumber: null,
  registeredAt: n === 3 ? null : "2027-02-01T08:00:00.000Z",
  withdrawnReason: null,
  missingPieces: n === 2 ? ["ACTE_NAISSANCE"] : [],
  displayName: ["KOUASSI Awa", "TRAORE Moussa", "DIALLO Fatou"][n - 1],
  rowVersion: 1,
  ...extra,
});

export const result = (n: 1 | 2 = 1, extra: Obj = {}) => ({
  id: n === 1 ? IDS.result1 : IDS.result2,
  sessionId: IDS.session,
  candidateId: n === 1 ? IDS.c1 : IDS.c2,
  candidateNumber: `CEPE-2027-000${n}`,
  displayName: n === 1 ? "KOUASSI Awa" : "TRAORE Moussa",
  resultCode: "ADMITTED",
  average: "14.500",
  totalPoints: null,
  rank: null,
  mentionCode: null,
  source: "ENTERED",
  ruleVersionRef: null,
  status: "DRAFT",
  publishedAt: null,
  ...extra,
});

export const center = (extra: Obj = {}) => ({
  id: IDS.center,
  code: "C1",
  name: "École test (fictive)",
  kind: "OWN",
  authorityCode: null,
  locality: "Abidjan",
  status: "ACTIVE",
  rooms: [{ id: IDS.room, centerId: IDS.center, code: "S1", label: "Salle 1", capacity: 30, active: true }],
  ...extra,
});

export const assignment = (extra: Obj = {}) => ({
  candidateId: IDS.c1,
  candidateNumber: "CEPE-2027-0001",
  displayName: "KOUASSI Awa",
  centerId: IDS.center,
  centerCode: "C1",
  centerName: "École test (fictive)",
  roomId: IDS.room,
  roomCode: "S1",
  seatNumber: 1,
  tableNumber: null,
  ...extra,
});

export const overview = (extra: Obj = {}) => ({
  centerIds: [IDS.center],
  centers: [center()],
  rooms: [{ roomId: IDS.room, centerId: IDS.center, centerCode: "C1", centerName: "École test (fictive)", code: "S1", capacity: 30, active: true, used: 1 }],
  assignments: [assignment()],
  registered: 2,
  unassigned: 1,
  capacity: 30,
  frozen: false,
  ...extra,
});

export const batch = (extra: Obj = {}) => ({
  id: IDS.batch,
  sessionId: IDS.session,
  kind: "RESULTS",
  fileName: "resultats.csv",
  sha256: "a".repeat(64),
  formatCode: "RESULTATS_AUTORITE",
  rowCount: 3,
  okCount: 2,
  errorCount: 1,
  status: "VALIDATED",
  uploadedBy: uuid(900),
  appliedAt: null,
  createdAt: "2027-06-20T08:00:00.000Z",
  ...extra,
});

export const importFormat = (extra: Obj = {}) => ({
  id: IDS.format,
  code: "RESULTATS_AUTORITE",
  version: 1,
  label: "Résultats de l'autorité (fictif)",
  examTypeId: null,
  kind: "RESULTS",
  encoding: "UTF-8",
  delimiter: ";",
  decimalSeparator: ",",
  hasHeader: true,
  columns: [
    { header: "numero", target: "key.candidate_number" },
    { header: "resultat", target: "result.code" },
  ],
  valueMap: {},
  status: "PUBLISHED",
  sourceKind: "placeholder",
  sourceReference: null,
  placeholder: true,
  ...extra,
});

export const exportFormat = (extra: Obj = {}) => ({
  id: IDS.format,
  code: "LISTE_CANDIDATS",
  version: 1,
  label: "Liste des candidats (fictif)",
  examTypeId: null,
  kind: "CANDIDATE_LIST",
  fileFormat: "CSV",
  encoding: "UTF-8",
  delimiter: ";",
  columns: [{ header: "Numéro", source: "candidate.number" }],
  status: "PUBLISHED",
  sourceKind: "placeholder",
  sourceReference: null,
  placeholder: true,
  ...extra,
});

export const exportRun = (extra: Obj = {}) => ({
  id: IDS.exportRun,
  sessionId: IDS.session,
  formatId: IDS.format,
  formatCode: "LISTE_CANDIDATS",
  formatVersion: 1,
  status: "DONE",
  rowCount: 2,
  fileSha256: "b".repeat(64),
  errorCode: null,
  requestedBy: uuid(900),
  createdAt: "2027-06-20T09:00:00.000Z",
  completedAt: "2027-06-20T09:00:01.000Z",
  ...extra,
});

export const issuedDoc = (extra: Obj = {}) => ({
  id: IDS.doc,
  sessionId: IDS.session,
  candidateId: IDS.c1,
  candidateNumber: "CEPE-2027-0001",
  kind: "CONVOCATION",
  version: 1,
  status: "ISSUED",
  officialDocumentId: uuid(901),
  issuedAt: "2027-06-01T08:00:00.000Z",
  revokedReason: null,
  createdAt: "2027-06-01T08:00:00.000Z",
  ...extra,
});

export const revision = (extra: Obj = {}) => ({
  id: IDS.revision,
  sessionId: IDS.session,
  targetKind: "RESULT",
  scoreId: null,
  resultId: IDS.result1,
  candidateId: IDS.c1,
  candidateNumber: "CEPE-2027-0001",
  proposed: { resultCode: "FAILED", average: "9.000" },
  current: { resultCode: "ADMITTED", average: "14.500" },
  reason: "Erreur de saisie constatée lors de la vérification.",
  requestedBy: uuid(902),
  requestedAt: "2027-06-25T08:00:00.000Z",
  status: "PENDING",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  ...extra,
});

export const group = (key: string, extra: Obj = {}) => ({ groupKey: key, registered: 10, present: 9, admitted: 6, failed: 3, absent: 1, excluded: 0, deferred: 0, rate: "66.667", ...extra });

export const statistics = (extra: Obj = {}) => ({
  sessionId: IDS.session,
  groupBy: "ALL",
  groups: [group("ALL")],
  total: group("ALL"),
  rateAvailable: true,
  rateNote: null,
  demoRules: true,
  compare: null,
  ...extra,
});

export const familyExam = (extra: Obj = {}) => ({
  candidateId: IDS.c1,
  studentId: uuid(201),
  displayName: "Awa KOUASSI",
  sessionId: IDS.session,
  sessionLabel: "CEPE 2027",
  examTypeCode: "CEPE",
  examTypeLabel: "CEPE",
  sessionYear: 2027,
  sessionKind: "OFFICIAL",
  registrationStatus: "REGISTERED",
  candidateNumber: "CEPE-2027-0001",
  startsOn: "2027-06-10",
  assignment: { centerName: "École test (fictive)", roomCode: "S1", seatNumber: 7 },
  outcome: null,
  documents: [issuedDoc()],
  demoRules: true,
  ...extra,
});

export const scoreMatrix = () => ({
  sessionId: IDS.session,
  papers: [
    { id: IDS.paper1, code: "EP1", label: "Épreuve 1", trackCode: null, scaleMax: "20.000", ordinal: 1 },
    { id: IDS.paper2, code: "EP2", label: "Épreuve 2", trackCode: null, scaleMax: "20.000", ordinal: 2 },
  ],
  rows: [
    { candidateId: IDS.c1, candidateNumber: "CEPE-2027-0001", displayName: "KOUASSI Awa", trackCode: null, scores: { [IDS.paper1]: { id: IDS.score1, status: "ENTERED", score: "12.000", source: "MANUAL" } } },
    { candidateId: IDS.c2, candidateNumber: "CEPE-2027-0002", displayName: "TRAORE Moussa", trackCode: null, scores: {} },
  ],
});

export const typeDto = (extra: Obj = {}) => ({
  id: IDS.type,
  code: "CEPE",
  label: "Certificat d'études primaires élémentaires",
  educationLevelCode: "PRIMARY",
  gradeLevelCode: "CM2",
  resultContractId: "exam-national@1",
  candidateNumberPattern: "{CODE}-{YEAR}-{SEQ:4}",
  sourceKind: "placeholder",
  sourceReference: null,
  status: "ACTIVE",
  placeholder: true,
  ...extra,
});
