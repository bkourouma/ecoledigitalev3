/**
 * Construction PURE d'un snapshot `reportcard/1` (spec 013 §5) : on fige, à l'émission, tout ce qu'il faut pour rendre le
 * document — résultats (valeurs exactes ET d'affichage, jamais recalculées), identité de l'élève, branding et signataires
 * RÉSOLUS, version de gabarit et options — de sorte que le rendu ne dépend d'AUCUNE donnée vivante (AC2.3, AC2.3b).
 *
 * Aucune E/S, aucune horloge (l'instant d'émission est fourni) : le même jeu d'entrées donne le même snapshot, donc le même hash.
 */
import { REPORTCARD_SNAPSHOT_SCHEMA_V1, reportcardExplainSchema, reportcardSnapshotSchema, type ReportcardsDocumentKind } from "@ecoledigitale/contracts/src/v2/reportcards";
import type { Branding, FinalResultBundle, ReportcardExplain, ReportcardSnapshot, Scope, SignatureSlot, Signatory } from "./types";
import type { ResolvedOptions } from "./options-schema";
import { canonicalJson, snapshotHash } from "./canonical";

export interface ResolvedSignatory {
  readonly slot: string;
  readonly slotLabel: string;
  readonly name: string;
  readonly title: string | null;
  readonly jobFunction: string | null;
  readonly signatureKey: string | null;
}

export interface SignatoryProblem {
  readonly slot: string;
  readonly slotLabel: string;
  readonly required: boolean;
  readonly code: "unassigned" | "unknown" | "inactive" | "not_yet_valid" | "expired";
  readonly message: string;
}

/**
 * Résout les signataires de chaque emplacement du gabarit à la date `onDate` (AAAA-MM-JJ). Un emplacement OBLIGATOIRE sans
 * signataire valide est un problème bloquant (aucune génération sans identité complète, AC5.5) ; un emplacement facultatif
 * sans signataire est simplement omis.
 */
export function resolveSignatories(input: {
  slots: readonly SignatureSlot[];
  assignments: readonly { slot: string; signatoryId: string }[];
  signatories: readonly Signatory[];
  onDate: string;
}): { resolved: ResolvedSignatory[]; problems: SignatoryProblem[] } {
  const byId = new Map(input.signatories.map((s) => [s.id, s]));
  const resolved: ResolvedSignatory[] = [];
  const problems: SignatoryProblem[] = [];
  for (const slot of input.slots) {
    const assignment = input.assignments.find((a) => a.slot === slot.slot);
    const fail = (code: SignatoryProblem["code"], message: string): void => {
      problems.push({ slot: slot.slot, slotLabel: slot.label, required: slot.required, code, message });
    };
    if (!assignment) {
      fail("unassigned", `Aucun signataire n'est affecté à l'emplacement « ${slot.label} ».`);
      continue;
    }
    const s = byId.get(assignment.signatoryId);
    if (!s) fail("unknown", `Le signataire de l'emplacement « ${slot.label} » est introuvable.`);
    else if (!s.active) fail("inactive", `Le signataire de l'emplacement « ${slot.label} » est désactivé.`);
    else if (s.validFrom && input.onDate < s.validFrom) fail("not_yet_valid", `Le signataire de l'emplacement « ${slot.label} » n'est pas encore en fonction.`);
    else if (s.validTo && input.onDate > s.validTo) fail("expired", `Le mandat du signataire de l'emplacement « ${slot.label} » est échu.`);
    else {
      resolved.push({ slot: slot.slot, slotLabel: slot.label, name: s.fullName, title: s.title, jobFunction: s.jobFunction, signatureKey: s.signatureObjectKey });
    }
  }
  return { resolved, problems };
}

export const blockingSignatoryProblems = (problems: readonly SignatoryProblem[]): SignatoryProblem[] => problems.filter((p) => p.required);

export interface BuildSnapshotInput {
  kind: ReportcardsDocumentKind;
  scope: Scope;
  version: number;
  provisional: boolean;
  issuedAt: Date;
  issuedBy: { id: string | null; name: string };
  bundle: FinalResultBundle;
  branding: Branding;
  signatories: readonly ResolvedSignatory[];
  template: { key: string; version: number; configVersion: number; options: ResolvedOptions };
}

export type BuildSnapshotResult =
  | { ok: true; snapshot: ReportcardSnapshot; explain: ReportcardExplain; hash: string; title: string }
  | { ok: false; issues: Array<{ path: string; message: string }> };

export function documentTitle(kind: ReportcardsDocumentKind, scope: Scope, enrollment: ReportcardSnapshot["enrollment"], provisional: boolean): string {
  let title: string;
  if (kind === "TRANSCRIPT") title = "Relevé de notes cumulé";
  else if (scope === "YEAR") title = `Bulletin annuel — ${enrollment.academicYearLabel}`;
  else title = `Bulletin de notes — ${enrollment.periodLabel ?? "période"} — ${enrollment.academicYearLabel}`;
  return provisional ? `${title} (provisoire)` : title;
}

/** Construit, valide (Zod `reportcard/1`) et hache un snapshot. Ne lève pas : renvoie les problèmes. */
export function buildSnapshot(input: BuildSnapshotInput): BuildSnapshotResult {
  const { bundle, branding } = input;
  const title = documentTitle(input.kind, input.scope, bundle.enrollment, input.provisional);
  const candidate: ReportcardSnapshot = {
    meta: {
      schema: REPORTCARD_SNAPSHOT_SCHEMA_V1,
      kind: input.kind,
      scope: input.scope,
      version: input.version,
      provisional: input.provisional,
      issuedAt: input.issuedAt.toISOString(),
      issuedBy: { id: input.issuedBy.id, name: input.issuedBy.name },
      locale: "fr",
      title,
    },
    student: { ...bundle.student },
    enrollment: { ...bundle.enrollment },
    institution: {
      legalName: branding.legalName,
      shortName: branding.shortName,
      headerLeft: [...branding.headerLeft],
      headerRight: [...branding.headerRight],
      address: branding.address,
      phone: branding.phone,
      email: branding.email,
      website: branding.website,
      registrationRef: branding.registrationRef,
      logoKey: branding.logoObjectKey,
      emblemKey: branding.emblemObjectKey,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      footerText: branding.footerText,
      brandingVersion: branding.version,
    },
    results: { lines: bundle.lines.map((l) => ({ ...l })), summary: { ...bundle.summary }, annual: bundle.annual ? { ...bundle.annual } : null },
    attendance: bundle.attendance ? { ...bundle.attendance } : null,
    deliberation: bundle.deliberation ? { ...bundle.deliberation } : null,
    appreciations: { general: bundle.generalAppreciation },
    ...(bundle.competencies ? { competencies: bundle.competencies } : {}),
    signatories: input.signatories.map((s) => ({ ...s })),
    rules: { ...bundle.rules },
    template: { key: input.template.key, version: input.template.version, configVersion: input.template.configVersion, options: { ...input.template.options } },
    labels: { ...bundle.labels },
  };
  const parsed = reportcardSnapshotSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const explain = reportcardExplainSchema.safeParse(bundle.explain);
  if (!explain.success) {
    return { ok: false, issues: explain.error.issues.map((i) => ({ path: `explain.${i.path.join(".")}`, message: i.message })) };
  }
  try {
    canonicalJson({ snapshot: parsed.data, explain: explain.data });
  } catch (e) {
    return { ok: false, issues: [{ path: "", message: e instanceof Error ? e.message : "canonisation impossible" }] };
  }
  return { ok: true, snapshot: parsed.data, explain: explain.data, hash: snapshotHash(parsed.data, explain.data), title };
}
