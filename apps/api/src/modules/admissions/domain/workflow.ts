/**
 * Domaine du workflow : types, MIROIR de la validation à la publication (`admissions.workflows_guard`, SQL) pour afficher TOUS
 * les défauts d'un coup dans l'éditeur (le déclencheur ne renvoie que le premier et reste l'autorité), et décision attendue par
 * statut canonique. Pur : aucun import d'infrastructure.
 */
import type { AdmissionClosureKind, AdmissionDecisionKind, AdmissionStatus } from "@ecoledigitale/contracts/src/v2/admissions";

export interface StageFacts {
  readonly code: string;
  readonly canonicalStatus: AdmissionStatus;
  readonly isInitial: boolean;
  readonly isTerminal: boolean;
  readonly holdsSeat: boolean;
  readonly requiresDecision: boolean;
  readonly createsEnrollment: boolean;
  readonly closureKind: AdmissionClosureKind | null;
}

export interface TransitionFacts {
  readonly fromStage: string;
  readonly toStage: string;
}

export interface WorkflowDefect {
  readonly code: string;
  readonly message: string;
  readonly stages?: readonly string[];
}

const REQUIRED_STATUSES: readonly AdmissionStatus[] = ["SUBMITTED", "ACCEPTED", "REJECTED", "ENROLLED"];

/** Défauts bloquant la publication, dans l'ordre du déclencheur SQL. Liste vide = publiable. */
export function validateWorkflow(stages: readonly StageFacts[], transitions: readonly TransitionFacts[]): WorkflowDefect[] {
  const defects: WorkflowDefect[] = [];
  const byCode = new Map(stages.map((s) => [s.code, s]));
  const initial = stages.filter((s) => s.isInitial);
  if (initial.length !== 1) defects.push({ code: "admissions.workflow_initial", message: `Il faut exactement une étape initiale (trouvé ${initial.length}).` });
  for (const status of REQUIRED_STATUSES) {
    if (!stages.some((s) => s.canonicalStatus === status)) {
      defects.push({ code: "admissions.workflow_missing_status", message: `Le workflow doit comporter une étape de statut ${status}.` });
    }
  }
  const enrolled = stages.filter((s) => s.canonicalStatus === "ENROLLED");
  if (enrolled.length !== 1) defects.push({ code: "admissions.workflow_enrolled", message: `Une seule étape ENROLLED est permise (trouvé ${enrolled.length}).` });
  const creates = stages.filter((s) => s.createsEnrollment);
  if (creates.length !== 1) defects.push({ code: "admissions.workflow_creates_enrollment", message: `Exactement une étape doit créer l'inscription (trouvé ${creates.length}).` });
  for (const status of ["ACCEPTED", "REJECTED"] as const) {
    if (!stages.some((s) => s.canonicalStatus === status && s.requiresDecision)) {
      defects.push({ code: "admissions.workflow_decision_missing", message: `Une étape de statut ${status} doit exiger une décision formelle.` });
    }
  }
  const outgoing = new Map<string, string[]>();
  for (const t of transitions) outgoing.set(t.fromStage, [...(outgoing.get(t.fromStage) ?? []), t.toStage]);
  const terminalWithExit = stages.filter((s) => s.isTerminal && (outgoing.get(s.code)?.length ?? 0) > 0).map((s) => s.code);
  if (terminalWithExit.length > 0) defects.push({ code: "admissions.workflow_terminal_exit", message: `Étape(s) terminale(s) avec sortie : ${terminalWithExit.join(", ")}.`, stages: terminalWithExit });
  const deadEnds = stages.filter((s) => !s.isTerminal && (outgoing.get(s.code)?.length ?? 0) === 0).map((s) => s.code);
  if (deadEnds.length > 0) defects.push({ code: "admissions.workflow_dead_end", message: `Étape(s) sans issue : ${deadEnds.join(", ")}.`, stages: deadEnds });
  const start = initial[0];
  if (start) {
    const seen = new Set<string>([start.code]);
    const queue = [start.code];
    while (queue.length > 0) {
      const code = queue.shift() as string;
      for (const next of outgoing.get(code) ?? []) {
        if (!seen.has(next) && byCode.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const unreachable = stages.filter((s) => !seen.has(s.code)).map((s) => s.code);
    if (unreachable.length > 0) defects.push({ code: "admissions.workflow_unreachable", message: `Étape(s) inatteignable(s) : ${unreachable.join(", ")}.`, stages: unreachable });
  }
  const badEntry = transitions.filter((t) => byCode.get(t.toStage)?.canonicalStatus === "ENROLLED" && !byCode.get(t.fromStage)?.createsEnrollment).map((t) => t.fromStage);
  if (badEntry.length > 0) defects.push({ code: "admissions.workflow_enrolled_entry", message: "ENROLLED ne s'atteint que depuis l'étape qui crée l'inscription.", stages: badEntry });
  return defects;
}

/** Cohérence structurelle d'une saisie avant écriture (références de transition, doublons de code). */
export function checkWorkflowInput(stages: readonly { code: string; ordinal: number }[], transitions: readonly TransitionFacts[]): string[] {
  const problems: string[] = [];
  const codes = new Set<string>();
  const ordinals = new Set<number>();
  for (const s of stages) {
    if (codes.has(s.code)) problems.push(`Code d'étape en double : ${s.code}.`);
    if (ordinals.has(s.ordinal)) problems.push(`Rang en double : ${s.ordinal}.`);
    codes.add(s.code);
    ordinals.add(s.ordinal);
  }
  const pairs = new Set<string>();
  for (const t of transitions) {
    if (!codes.has(t.fromStage)) problems.push(`Transition : étape de départ inconnue ${t.fromStage}.`);
    if (!codes.has(t.toStage)) problems.push(`Transition : étape d'arrivée inconnue ${t.toStage}.`);
    if (t.fromStage === t.toStage) problems.push(`Transition vers la même étape : ${t.fromStage}.`);
    const key = `${t.fromStage}>${t.toStage}`;
    if (pairs.has(key)) problems.push(`Transition en double : ${key}.`);
    pairs.add(key);
  }
  return problems;
}

/**
 * Type de décision attendu pour entrer dans une étape (miroir de `decisions_guard`). `WITHDRAW` couvre les clôtures de la
 * famille, de l'expiration, de l'absence et du doublon ; `REJECT` le refus de l'école ; `RECONSIDER` un retour à l'étude.
 */
export function decisionKindFor(stage: { canonicalStatus: AdmissionStatus; closureKind: AdmissionClosureKind | null }): AdmissionDecisionKind | null {
  switch (stage.canonicalStatus) {
    case "ACCEPTED":
      return "ACCEPT";
    case "WAITLISTED":
      return "WAITLIST";
    case "REJECTED":
      return stage.closureKind === "REJECTED_BY_SCHOOL" ? "REJECT" : stage.closureKind ? "WITHDRAW" : null;
    case "SUBMITTED":
    case "UNDER_REVIEW":
    case "MISSING_DOCUMENT":
      return "RECONSIDER";
    default:
      return null;
  }
}

/** Le statut canonique est-il une clôture sans inscription (statistiques, anonymisation) ? */
export const isClosedWithoutEnrollment = (status: AdmissionStatus): boolean => status === "REJECTED";
