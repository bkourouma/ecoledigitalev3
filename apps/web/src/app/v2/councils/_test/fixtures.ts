/** Fabriques de réponses d'API conformes aux contrats `councils` (le client valide chaque réponse par son schéma Zod). */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  institution: uuid(1),
  year: uuid(100),
  period: uuid(200),
  classroom: uuid(300),
  council: uuid(2001),
  councilType: uuid(2101),
  student: uuid(11),
  student2: uuid(12),
  enrollment: uuid(611),
  enrollment2: uuid(612),
  item: uuid(3001),
  item2: uuid(3002),
  partPresident: uuid(4001),
  partTeacher: uuid(4002),
  partAbsent: uuid(4003),
  staff1: uuid(5001),
  staff2: uuid(5002),
  decisionTypeA: uuid(2201),
  decisionTypeB: uuid(2202),
  decisionTypeExcl: uuid(2203),
  minutes: uuid(6001),
  unlock: uuid(7001),
  effect: uuid(8001),
  effect2: uuid(8002),
};

const T = "2026-11-02T09:30:00.000Z";

export function councilDto(over: Record<string, unknown> = {}) {
  return {
    id: IDS.council,
    institutionId: IDS.institution,
    academicYearId: IDS.year,
    classroomId: IDS.classroom,
    classroomName: "6e A",
    academicPeriodId: IDS.period,
    periodLabel: "Période 1",
    councilTypeId: IDS.councilType,
    councilTypeCode: "PERIODIC",
    councilTypeLabel: "Conseil de classe (type test)",
    scope: "PERIOD",
    status: "PLANNED",
    title: null,
    scheduledAt: "2026-12-10T14:00:00.000Z",
    location: "Salle 3",
    heldOn: null,
    openedAt: null,
    closedAt: null,
    signedAt: null,
    quorumWaived: false,
    quorumWaiverReason: null,
    reopenCount: 0,
    cancelReason: null,
    resultsStateId: uuid(9001),
    resultsDeliberationId: null,
    ruleSourceKind: "institution",
    rowVersion: 1,
    counts: { agendaItems: 2, decided: 1, participants: 3, present: 2 },
    createdAt: T,
    ...over,
  };
}

export function listDto(items: unknown[] = [councilDto()]) {
  return { items, total: items.length, page: 1, pageSize: 25 };
}

export function participantDto(over: Record<string, unknown> = {}) {
  return {
    id: IDS.partPresident,
    councilId: IDS.council,
    roleCode: "DIRECTION",
    roleLabel: "Direction (test)",
    councilFunction: "PRESIDENT",
    staffId: IDS.staff1,
    personId: null,
    displayName: "Mme DIRECTRICE",
    isVoting: true,
    canDecide: true,
    presence: "PRESENT",
    convokedAt: T,
    notifiedAt: T,
    ...over,
  };
}

export function quorumDto(over: Record<string, unknown> = {}) {
  return { met: true, presentCount: 2, requiredMin: 2, missingRoles: [], presidentPresent: true, waiverAllowed: false, ...over };
}

export function detailDto(over: { council?: Record<string, unknown>; participants?: unknown[]; quorum?: Record<string, unknown>; warnings?: unknown[] } = {}) {
  return {
    council: councilDto(over.council),
    participants: over.participants ?? [
      participantDto(),
      participantDto({ id: IDS.partTeacher, roleCode: "ENSEIGNANT", roleLabel: "Enseignant (test)", councilFunction: null, staffId: IDS.staff2, displayName: "M. PROFESSEUR", canDecide: false }),
      participantDto({ id: IDS.partAbsent, roleCode: "ENSEIGNANT", roleLabel: "Enseignant (test)", councilFunction: null, staffId: null, displayName: "M. ABSENT", canDecide: true, presence: "ABSENT", convokedAt: null }),
    ],
    quorum: quorumDto(over.quorum),
    warnings: over.warnings ?? [],
  };
}

export function agendaItemDto(over: Record<string, unknown> = {}) {
  return {
    id: IDS.item,
    councilId: IDS.council,
    enrollmentId: IDS.enrollment,
    studentId: IDS.student,
    studentName: "KOUASSI Awa",
    position: 1,
    status: "PENDING",
    factsVersion: 2,
    factsHash: "a".repeat(64),
    preparedAt: T,
    missingResults: false,
    ruleVersionRef: "RULE@1",
    decisionCount: 0,
    pendingProposals: 1,
    ...over,
  };
}

export function agendaDto(items: unknown[] = [agendaItemDto(), agendaItemDto({ id: IDS.item2, studentId: IDS.student2, enrollmentId: IDS.enrollment2, studentName: "TRAORE Moussa", position: 2, status: "DECIDED", decisionCount: 1, pendingProposals: 0 })], status = "PLANNED") {
  return { councilId: IDS.council, status, items };
}

export function factsDto(over: { results?: Record<string, unknown> | null; attendance?: Record<string, unknown> | null } = {}) {
  return {
    schema: "council-facts/1",
    results:
      over.results === null
        ? null
        : {
            status: "FINAL",
            average: "12.50",
            averageDisplay: "12,50",
            rank: 3,
            cohortSize: 28,
            mentionCode: "MENTION_X",
            missingResults: false,
            ruleVersionRef: "RULE@1",
            ruleSourceKind: "institution",
            suggestions: [{ kind: "DECISION", code: "SUGG_PASS", ref: "RULE@1" }],
            appreciations: [{ authorRole: "TEACHER", curriculumNodeId: null, body: "Élève sérieuse" }],
            ...over.results,
          },
    attendance: over.attendance === null ? null : { available: true, absentMinutes: 120, excusedMinutes: 60, absentCount: 4, excusedCount: 2, lateCount: 1, ...over.attendance },
    discipline: { available: true, measuresByKind: { WARNING: 1 }, measuresBySeverity: {}, exclusionDays: 0, conductPoints: 18 },
    funding: { type: "STATE", stateAssigned: true },
    repeating: false,
  };
}

export function proposalDto(over: Record<string, unknown> = {}) {
  return {
    id: uuid(3501),
    agendaItemId: IDS.item,
    kind: "DECISION",
    code: "SUGG_PASS",
    body: null,
    origin: "RULE_SUGGESTION",
    proposedBy: null,
    proposedByName: null,
    status: "PROPOSED",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    ruleVersionRef: "RULE@1",
    createdAt: T,
    ...over,
  };
}

export function decisionDto(over: Record<string, unknown> = {}) {
  return {
    id: uuid(3601),
    councilId: IDS.council,
    agendaItemId: IDS.item,
    enrollmentId: IDS.enrollment,
    studentId: IDS.student,
    decisionTypeId: IDS.decisionTypeA,
    decisionTypeCode: "TYPE_A",
    decisionTypeLabel: "Décision A (test)",
    family: "PASSAGE",
    exclusiveGroup: "GROUPE_X",
    suggestedCode: "SUGG_PASS",
    suggestionRef: "RULE@1",
    differsFromSuggestion: false,
    justification: null,
    mode: "CONSENSUS",
    votesFor: null,
    votesAgainst: null,
    votesAbstain: null,
    targetProgramId: null,
    targetGradeLevelId: null,
    targetLabel: null,
    deciderParticipantId: IDS.partPresident,
    deciderName: "Mme DIRECTRICE",
    recordedBy: uuid(9),
    recordedByName: "Mme DIRECTRICE",
    factsVersion: 2,
    factsHash: "a".repeat(64),
    decidedAt: T,
    status: "RECORDED",
    withdrawnReason: null,
    supersedesId: null,
    ...over,
  };
}

export function itemDetailDto(over: { item?: Record<string, unknown>; facts?: unknown; proposals?: unknown[]; decisions?: unknown[]; councilStatus?: string; ruleSourceKind?: string | null } = {}) {
  return {
    item: agendaItemDto(over.item),
    facts: over.facts === undefined ? factsDto() : over.facts,
    proposals: over.proposals ?? [proposalDto()],
    decisions: over.decisions ?? [],
    councilStatus: over.councilStatus ?? "OPEN",
    ruleSourceKind: over.ruleSourceKind === undefined ? "institution" : over.ruleSourceKind,
  };
}

export function decisionTypeDto(over: Record<string, unknown> = {}) {
  return {
    id: IDS.decisionTypeA,
    code: "TYPE_A",
    label: "Décision A (test)",
    family: "PASSAGE",
    appliesTo: "YEAR",
    exclusiveGroup: "GROUPE_X",
    requiresJustification: false,
    requiresVote: false,
    requiresTarget: false,
    resultsDecisionKind: null,
    resultsFinalCode: null,
    academicOutcomeCode: null,
    needsHumanApplication: false,
    studentStatus: null,
    isSystem: false,
    sortOrder: 0,
    active: true,
    ...over,
  };
}

export function referenceDto(over: { decisionTypes?: unknown[]; settings?: unknown[] } = {}) {
  return {
    roles: [
      { id: uuid(2301), code: "DIRECTION", label: "Direction (test)", isVoting: true, countsForQuorum: true, maySign: true, canDecide: true, isExternal: false, sortOrder: 0, active: true },
      { id: uuid(2302), code: "ENSEIGNANT", label: "Enseignant (test)", isVoting: true, countsForQuorum: true, maySign: true, canDecide: false, isExternal: false, sortOrder: 1, active: true },
    ],
    councilTypes: [{ id: IDS.councilType, code: "PERIODIC", label: "Conseil de classe (type test)", scope: "PERIOD", minResultsStatus: "GRADING_LOCKED", minParticipants: 2, requiredRoleCodes: [], signerFunctions: ["PRESIDENT", "SECRETARY"], signerRoleCodes: [], requiresDecisionPerStudent: false, sortOrder: 0, active: true }],
    decisionTypes: over.decisionTypes ?? [
      decisionTypeDto(),
      decisionTypeDto({ id: IDS.decisionTypeB, code: "TYPE_B", label: "Décision B (test)", exclusiveGroup: null, requiresJustification: true }),
      decisionTypeDto({ id: IDS.decisionTypeExcl, code: "TYPE_EXCL", label: "Exclusion (test)", family: "EXCLUSION", exclusiveGroup: null, needsHumanApplication: true, studentStatus: "SUSPENDED" }),
    ],
    settings: over.settings ?? [{ institutionId: IDS.institution, requireSeparateUnlocker: true, effectsTrigger: "SIGNED", guardianVisibility: "AFTER_SIGNATURE", allowQuorumWaiver: false, minutesTemplateKey: null }],
  };
}

export function minutesDto(over: Record<string, unknown> = {}) {
  return {
    id: IDS.minutes,
    councilId: IDS.council,
    version: 1,
    status: "GENERATED",
    schemaName: "council-minutes/1",
    snapshotHash: "b".repeat(64),
    generatedAt: T,
    generatedBy: uuid(9),
    renderStatus: "RENDERED",
    renderHash: "c".repeat(64),
    signedAt: null,
    supersedesId: null,
    revokedReason: null,
    signatures: [],
    missingSigners: [{ participantId: IDS.partPresident, displayName: "Mme DIRECTRICE", roleCode: "DIRECTION" }],
    placeholderNotice: null,
    ...over,
  };
}

export function minutesDetailDto(minutes = minutesDto()) {
  return {
    minutes,
    snapshot: {
      schema: "council-minutes/1",
      institution: { institutionId: IDS.institution, name: "Établissement test" },
      classroom: { classroomId: IDS.classroom, name: "6e A", gradeLevelCode: null },
      period: { periodId: IDS.period, label: "Période 1", academicYearId: IDS.year },
      council: { councilId: IDS.council, typeCode: "PERIODIC", typeLabel: "Conseil de classe (type test)", scope: "PERIOD", heldOn: "2026-12-10", location: null, reopenCount: 0, quorumWaived: false, quorumWaiverReason: null },
      participants: [],
      students: [{ enrollmentId: IDS.enrollment, studentId: IDS.student, name: "KOUASSI Awa", factsVersion: 2, factsHash: "a".repeat(64), facts: factsDto(), decisions: [{ decisionTypeCode: "TYPE_A", family: "PASSAGE", suggestedCode: "SUGG_PASS", differsFromSuggestion: false, justification: null, mode: "CONSENSUS", votesFor: null, votesAgainst: null, votesAbstain: null, targetLabel: null, deciderName: "Mme DIRECTRICE" }], appreciation: "Élève sérieuse", distinctions: [] }],
      signers: [],
      references: { ruleVersionRef: "RULE@1", ruleSourceKind: "institution" },
      placeholderNotice: minutes.placeholderNotice,
    },
  };
}

export function unlockDto(over: Record<string, unknown> = {}) {
  return {
    id: IDS.unlock,
    councilId: IDS.council,
    requestedBy: uuid(9),
    requestedByName: "Mme DIRECTRICE",
    requestedAt: T,
    reason: "Erreur de saisie constatée après signature du procès-verbal",
    status: "REQUESTED",
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    decisionNote: null,
    fourEyesWaived: false,
    consumedAt: null,
    ...over,
  };
}

export function effectDto(over: Record<string, unknown> = {}) {
  return {
    id: IDS.effect,
    councilId: IDS.council,
    decisionId: uuid(3601),
    proposalId: null,
    kind: "STUDENT_STATUS_REQUEST",
    status: "AWAITING_HUMAN",
    attempts: 0,
    lastError: null,
    externalRef: null,
    irreversible: false,
    appliedAt: null,
    appliedBy: null,
    revertedAt: null,
    revertReason: null,
    studentId: IDS.student,
    studentName: "KOUASSI Awa",
    decisionTypeCode: "TYPE_EXCL",
    createdAt: T,
    ...over,
  };
}

export function effectsDto(items: unknown[] = [effectDto()]) {
  return { items, total: items.length };
}

export function familyDto(over: Record<string, unknown> = {}) {
  return {
    studentId: IDS.student,
    studentName: "KOUASSI Awa",
    items: [{ councilId: IDS.council, councilTypeLabel: "Conseil de classe (type test)", periodLabel: "Période 1", heldOn: "2026-12-10", decisionTypeLabel: "Décision A (test)", family: "PASSAGE", targetLabel: "Cible (test)", appreciation: "Bon travail", distinctions: ["DISTINCTION_TEST"] }],
    ...over,
  };
}
