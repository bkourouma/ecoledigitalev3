/**
 * Référentiels, paramètres d'établissement et modèles de pack.
 *
 * Les référentiels (cycles, niveaux, types de périodes, plans, financements, issues, grammaire du curriculum) sont
 * de la DONNÉE par tenant, instanciée depuis le modèle du pack (`instantiatePackReferenceData`, idempotent) puis
 * modifiable (`putReference`). Aucun niveau, aucune périodicité, aucun seuil n'est codé dans le module.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  AcademicApplyTemplateResult,
  AcademicPack,
  AcademicReferenceKind,
  AcademicUpdateSettingsBody,
} from "@ecoledigitale/contracts/src/v2/academic";
import { AcademicCode, conflict, notFound, validation } from "../domain/errors";
import { patternUsesPrefix, validateRegistrationPattern } from "../domain/registration-number";
import type { EducationLevel, EnrollmentOutcome, FundingType, GradeLevel, InstitutionSettings, NodeType, PeriodPlan, PeriodType } from "../domain/records";
import type { Tx } from "@ecoledigitale/database";
import { insertProgram, listPrograms, replaceProgramGradeLevels } from "../infrastructure/curriculum-repository";
import * as ref from "../infrastructure/reference-repository";
import { assertInstitutionScope, inReadTx, inTx, type AcademicDeps, EventBuffer } from "./deps";

export type ReferenceBundle = {
  "education-levels": EducationLevel[];
  "grade-levels": GradeLevel[];
  "period-types": PeriodType[];
  "period-plans": PeriodPlan[];
  "funding-types": FundingType[];
  "enrollment-outcomes": EnrollmentOutcome[];
  "node-types": NodeType[];
};

export async function listReference<K extends AcademicReferenceKind>(deps: AcademicDeps, ctx: RequestContext, kind: K): Promise<Result<ReferenceBundle[K], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const lists: { [P in AcademicReferenceKind]: () => Promise<ReferenceBundle[P]> } = {
      "education-levels": () => ref.listEducationLevels(tx),
      "grade-levels": () => ref.listGradeLevels(tx),
      "period-types": () => ref.listPeriodTypes(tx),
      "period-plans": () => ref.listPeriodPlans(tx),
      "funding-types": () => ref.listFundingTypes(tx),
      "enrollment-outcomes": () => ref.listOutcomes(tx),
      "node-types": () => ref.listNodeTypes(tx),
    };
    return ok((await lists[kind]()) as ReferenceBundle[K]);
  });
}

type PutItems = ReadonlyArray<Record<string, any>>;

/** Upsert PAR CODE d'un référentiel (jamais de suppression). Une ligne `is_system` de la grammaire est protégée. */
export async function putReference(deps: AcademicDeps, ctx: RequestContext, kind: AcademicReferenceKind, items: PutItems): Promise<Result<{ created: number; updated: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    let created = 0;
    let updated = 0;
    const count = (r: { inserted: boolean } | null): void => {
      if (r?.inserted) created += 1;
      else updated += 1;
    };
    switch (kind) {
      case "education-levels":
        for (const i of items) count(await ref.upsertEducationLevel(tx, deps.newId(), { code: i.code, label: i.label, ordinal: i.ordinal, pack: i.pack ?? null, active: i.active ?? true, calculationContract: i.calculationContract }));
        break;
      case "grade-levels": {
        const levels = new Map((await ref.listEducationLevels(tx)).map((l) => [l.code, l.id]));
        for (const i of items) {
          const educationLevelId = levels.get(i.educationLevelCode);
          if (!educationLevelId) return err(validation(AcademicCode.EDUCATION_LEVEL_NOT_FOUND, `Cycle inconnu : ${i.educationLevelCode}.`, ["items", i.code]));
          count(await ref.upsertGradeLevel(tx, deps.newId(), { code: i.code, label: i.label, shortLabel: i.shortLabel ?? null, educationLevelId, ordinal: i.ordinal, isFinal: i.isFinal ?? false, active: i.active ?? true, terminalExamRequired: i.terminalExamRequired }));
        }
        // Niveaux suivants dans un second temps (références croisées possibles dans le même lot).
        const known = new Set((await ref.listGradeLevels(tx)).map((g) => g.code));
        for (const i of items) {
          if (i.nextGradeLevelCode && !known.has(i.nextGradeLevelCode)) return err(validation(AcademicCode.GRADE_LEVEL_NOT_FOUND, `Niveau suivant inconnu : ${i.nextGradeLevelCode}.`, ["items", i.code]));
          if (i.isFinal && i.nextGradeLevelCode) return err(validation(AcademicCode.INVALID_INPUT, `Le niveau final ${i.code} n'a pas de niveau suivant.`, ["items", i.code]));
          if (i.nextGradeLevelCode === i.code) return err(validation(AcademicCode.INVALID_INPUT, `Le niveau ${i.code} ne peut pas être son propre suivant.`, ["items", i.code]));
          if (i.nextGradeLevelCode !== undefined) await ref.setGradeLevelNext(tx, i.code, i.nextGradeLevelCode ?? null, i.isFinal ?? false);
        }
        break;
      }
      case "period-types":
        for (const i of items) count(await ref.upsertPeriodType(tx, deps.newId(), { code: i.code, label: i.label, kind: i.kind, active: i.active ?? true }));
        break;
      case "period-plans": {
        const types = new Set((await ref.listPeriodTypes(tx)).map((t) => t.code));
        for (const i of items) {
          for (const slot of i.slots as Array<{ type: string }>) {
            if (!types.has(slot.type)) return err(validation(AcademicCode.PERIOD_TYPE_UNKNOWN, `Plan ${i.code} : type de période inconnu ${slot.type}.`, ["items", i.code]));
          }
          count(await ref.upsertPeriodPlan(tx, deps.newId(), { code: i.code, label: i.label, slots: i.slots, active: i.active ?? true }));
        }
        break;
      }
      case "funding-types":
        for (const i of items) {
          count(await ref.upsertFundingType(tx, deps.newId(), { code: i.code, label: i.label, requiresReference: i.requiresReference ?? false, requiresFunder: i.requiresFunder ?? false, sortOrder: i.sortOrder ?? 0, active: i.active ?? true }));
        }
        break;
      case "enrollment-outcomes":
        for (const i of items) count(await ref.upsertOutcome(tx, deps.newId(), { code: i.code, label: i.label, kind: i.kind, active: i.active ?? true }));
        break;
      case "node-types": {
        for (const i of items) {
          const r = await ref.upsertNodeType(tx, deps.newId(), {
            code: i.code,
            label: i.label,
            allowedParentCodes: i.allowedParentCodes,
            requiresGradeLevel: i.requiresGradeLevel ?? false,
            requiresPeriodSlot: i.requiresPeriodSlot ?? false,
            requiresSubject: i.requiresSubject ?? false,
            allowsCoefficient: i.allowsCoefficient ?? false,
            allowsCredits: i.allowsCredits ?? false,
            creditsMustEqualChildren: i.creditsMustEqualChildren ?? false,
            isEnrollable: i.isEnrollable ?? false,
            isSystem: false,
            sortOrder: i.sortOrder ?? 0,
          });
          if (!r) return err(conflict(AcademicCode.REFERENCE_SYSTEM_LOCKED, `Le type de nœud système « ${i.code} » n'est pas modifiable.`));
          count(r);
        }
        break;
      }
    }
    return ok({ created, updated });
  });
}

// ---------------------------------------------------------------------------
// Paramètres d'établissement
// ---------------------------------------------------------------------------

/** Valeurs par défaut des paramètres tant qu'aucune ligne n'existe (celles de la base). */
export const DEFAULT_SETTINGS: Omit<InstitutionSettings, "institutionId"> = Object.freeze({
  enrollmentConfirmationPolicy: "AUTO",
  courseConfirmationPolicy: "ON_LINE_PAID",
  pendingHoldMinutes: null,
  registrationNumberPrefix: null,
  registrationNumberPattern: null,
});

export async function loadSettings(tx: Tx, institutionId: string): Promise<InstitutionSettings> {
  return (await ref.getSettings(tx, institutionId)) ?? { institutionId, ...DEFAULT_SETTINGS };
}

export async function getSettings(deps: AcademicDeps, ctx: RequestContext, institutionId: string): Promise<Result<InstitutionSettings, AppError>> {
  const scope = assertInstitutionScope(ctx, institutionId);
  if (!scope.ok) return scope;
  return inReadTx(deps, ctx, async (tx) => ok(await loadSettings(tx, institutionId)));
}

export async function updateSettings(deps: AcademicDeps, ctx: RequestContext, institutionId: string, patch: AcademicUpdateSettingsBody): Promise<Result<InstitutionSettings, AppError>> {
  const scope = assertInstitutionScope(ctx, institutionId);
  if (!scope.ok) return scope;
  return inTx(deps, ctx, async (tx) => {
    const current = await loadSettings(tx, institutionId);
    const next: InstitutionSettings = {
      institutionId,
      enrollmentConfirmationPolicy: patch.enrollmentConfirmationPolicy ?? current.enrollmentConfirmationPolicy,
      courseConfirmationPolicy: patch.courseConfirmationPolicy ?? current.courseConfirmationPolicy,
      pendingHoldMinutes: patch.pendingHoldMinutes !== undefined ? patch.pendingHoldMinutes : current.pendingHoldMinutes,
      registrationNumberPrefix: patch.registrationNumberPrefix !== undefined ? patch.registrationNumberPrefix : current.registrationNumberPrefix,
      registrationNumberPattern: patch.registrationNumberPattern !== undefined ? patch.registrationNumberPattern : current.registrationNumberPattern,
    };
    if (next.registrationNumberPattern) {
      const problems = validateRegistrationPattern(next.registrationNumberPattern);
      if (problems.length > 0) return err(validation(AcademicCode.REGISTRATION_PATTERN_INVALID, problems.join(" "), "registrationNumberPattern"));
      if (patternUsesPrefix(next.registrationNumberPattern) && !next.registrationNumberPrefix) {
        return err(validation(AcademicCode.REGISTRATION_PATTERN_INVALID, "Le motif utilise {PREFIX} : renseignez le préfixe de l'établissement.", "registrationNumberPrefix"));
      }
    }
    await ref.upsertSettings(tx, institutionId, next);
    return ok(next);
  });
}

// ---------------------------------------------------------------------------
// Modèle de pack (US : « Un tenant provisionné reçoit ses référentiels sans intervention de développeur »)
// ---------------------------------------------------------------------------

export interface InstantiateOptions {
  pack?: AcademicPack | undefined;
  educationSystem?: string | undefined;
  /** Opération sensible déclenchée par un opérateur (audit). */
  audited?: boolean;
}

/**
 * Applique le modèle `(système éducatif, pack)` à l'établissement : cycles, niveaux, types de périodes, plans,
 * grammaire du curriculum, financements, issues, programmes et paramètres (créés SEULEMENT s'ils n'existent pas).
 * IDEMPOTENT : ré-appliquer ne duplique rien ; une ligne PERSONNALISÉE par le tenant est CONSERVÉE (rapport des
 * écarts) ; rien n'est jamais retiré.
 */
export async function instantiatePackReferenceData(
  deps: AcademicDeps,
  ctx: RequestContext,
  institutionId: string,
  options: InstantiateOptions = {},
): Promise<Result<AcademicApplyTemplateResult, AppError>> {
  const scope = assertInstitutionScope(ctx, institutionId);
  if (!scope.ok) return scope;
  const info = await deps.ports.institutions.getInstitution(ctx, institutionId);
  if (!info) return err(notFound(AcademicCode.INSTITUTION_NOT_FOUND, "Établissement", institutionId));
  const pack = options.pack ?? info.pack;
  const educationSystem = options.educationSystem ?? info.educationSystem;
  if (!pack || !educationSystem) {
    return err(validation(AcademicCode.TEMPLATE_UNKNOWN, "Le pack et le système éducatif de l'établissement sont requis pour choisir un modèle.", "pack"));
  }
  const template = deps.ports.templates.getSection(pack, educationSystem, "academic");
  if (!template) return err(notFound(AcademicCode.TEMPLATE_UNKNOWN, `Modèle académique ${educationSystem}/${pack}`));

  return inTx(deps, ctx, async (tx) => {
    const created: Record<string, number> = {};
    const existing: Record<string, number> = {};
    const customized: string[] = [];
    const tally = (section: string, code: string, r: ref.TplResult): void => {
      if (r === "created") created[section] = (created[section] ?? 0) + 1;
      else if (r === "updated") existing[section] = (existing[section] ?? 0) + 1;
      else {
        existing[section] = (existing[section] ?? 0) + 1;
        customized.push(`${section}:${code}`);
      }
    };

    for (const l of template.educationLevels) tally("educationLevels", l.code, await ref.tplEducationLevel(tx, deps.newId(), pack, { code: l.code, label: l.label, ordinal: l.ordinal, calculationContract: l.calculationContract ?? null }));
    for (const g of template.gradeLevels) {
      tally("gradeLevels", g.code, await ref.tplGradeLevel(tx, deps.newId(), { code: g.code, label: g.label, shortLabel: g.shortLabel ?? null, educationLevelCode: g.educationLevel, ordinal: g.ordinal, terminalExamRequired: g.terminalExamRequired ?? false }));
    }
    for (const g of template.gradeLevels) await ref.tplGradeLevelNext(tx, g.code, g.next, g.isFinal ?? false);
    for (const t of template.periodTypes) tally("periodTypes", t.code, await ref.tplPeriodType(tx, deps.newId(), t));
    for (const p of template.periodPlans) tally("periodPlans", p.code, await ref.tplPeriodPlan(tx, deps.newId(), p));
    for (const n of template.nodeTypes) {
      tally(
        "nodeTypes",
        n.code,
        await ref.tplNodeType(tx, deps.newId(), {
          code: n.code,
          label: n.label,
          allowedParentCodes: n.allowedParents,
          requiresGradeLevel: n.requiresGradeLevel ?? false,
          requiresPeriodSlot: n.requiresPeriodSlot ?? false,
          requiresSubject: n.requiresSubject ?? false,
          allowsCoefficient: n.allowsCoefficient ?? false,
          allowsCredits: n.allowsCredits ?? false,
          creditsMustEqualChildren: n.creditsMustEqualChildren ?? false,
          isEnrollable: n.enrollable ?? false,
          isSystem: n.system ?? false,
          sortOrder: n.sortOrder ?? 0,
        }),
      );
    }
    for (const [i, f] of template.fundingTypes.entries()) {
      tally("fundingTypes", f.code, await ref.tplFundingType(tx, deps.newId(), { code: f.code, label: f.label, requiresReference: f.requiresReference ?? false, requiresFunder: f.requiresFunder ?? false, sortOrder: i }));
    }
    for (const o of template.enrollmentOutcomes) tally("enrollmentOutcomes", o.code, await ref.tplOutcome(tx, deps.newId(), o));

    // Programmes de l'établissement (par code) : créés s'ils n'existent pas ; jamais modifiés ensuite.
    if (template.programs.length > 0) {
      const levels = new Map((await ref.listEducationLevels(tx)).map((l) => [l.code, l.id]));
      const grades = new Map((await ref.listGradeLevels(tx)).map((g) => [g.code, g.id]));
      const programs = new Map((await listPrograms(tx, { institutionId })).map((p) => [p.code, p]));
      for (const p of template.programs) {
        if (programs.has(p.code)) {
          tally("programs", p.code, "updated");
          continue;
        }
        const programId = deps.newId();
        await insertProgram(tx, {
          id: programId,
          institutionId,
          educationLevelId: levels.get(p.educationLevel) as string,
          parentProgramId: null,
          code: p.code,
          label: p.label,
          kindCode: p.kindCode ?? "PROGRAM",
          domainCode: p.domainCode ?? null,
          description: null,
          durationMonths: null,
          attributes: {},
        });
        await replaceProgramGradeLevels(tx, programId, p.gradeLevels.map((g) => grades.get(g) as string));
        tally("programs", p.code, "created");
      }
    }

    const s = template.settings;
    const settingsCreated = await ref.insertSettingsIfAbsent(tx, institutionId, {
      enrollmentConfirmationPolicy: s.enrollmentConfirmationPolicy,
      courseConfirmationPolicy: s.courseConfirmationPolicy ?? "ON_LINE_PAID",
      pendingHoldMinutes: s.pendingHoldMinutes,
      registrationNumberPrefix: s.registrationNumberPrefix ?? null,
      registrationNumberPattern: s.registrationNumberPattern ?? null,
    });
    tally("settings", institutionId, settingsCreated ? "created" : "updated");

    const firstTime = await ref.recordTemplateApplication(tx, {
      id: deps.newId(),
      institutionId,
      pack,
      educationSystem,
      templateVersion: template.templateVersion,
      appliedBy: ctx.userId,
      summary: { created, existing, customizedKept: customized },
    });

    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "academic.template.applied",
      resourceType: "institution",
      resourceId: institutionId,
      sensitive: true,
      after: { pack, educationSystem, templateVersion: template.templateVersion, created, customizedKept: customized.length },
      metadata: { alreadyApplied: !firstTime },
    });
    await events.flush(tx);

    return ok({ institutionId, pack, educationSystem, templateVersion: template.templateVersion, alreadyApplied: !firstTime, created, existing, customizedKept: customized });
  });
}
