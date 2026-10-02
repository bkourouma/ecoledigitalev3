/**
 * Imports vers `people` : élèves (avec inscription en option, par `academic`), tuteurs et liens, personnel. Écriture
 * EXCLUSIVEMENT par l'API publique de `people` (`createStudent`, `updateStudent`, `createGuardian`, `linkGuardian`,
 * `updateGuardian`, `updateGuardianLink`, `createStaff`, `updateStaff`) et `academic` (`enrollStudent`) : avec leurs règles
 * (sexe obligatoire, matricule sans trou, doublons, unicités), leur audit et leurs événements.
 *
 * Idempotence : `externalRef` (matricule d'origine du fichier, ou empreinte de la clé naturelle à défaut) pour les élèves et
 * le personnel ; table de références de `imports` pour les tuteurs ; `link_exists` pour les liens.
 *
 * Le PLAN s'exécute dans une transaction toujours annulée : il peut donc appeler les cas d'usage RÉELS pour savoir ce qui se
 * passerait (doublon probable, unicité) sans qu'aucune écriture ne subsiste.
 */
import { createHash } from "node:crypto";
import type { RequestContext } from "@ecoledigitale/kernel";
import { AcademicCode, enrollStudent, listReference } from "../../modules/academic";
import { guardianIdentityKey, type ApplyItem, type ApplyResult, type GuardianRow, type ImportActorNamePort, type ImportTargetPort, type PlanItem, type PlanResult, type PlanRun, type StaffRow, type StudentRow } from "../../modules/imports";
import {
  createGuardian,
  createStaff,
  createStudent,
  getDisplayNamesOfIdentities,
  linkGuardian,
  listGuardiansOfStudent,
  listRelationshipTypes,
  listStaffCategories,
  resolveStudentRefs,
  updateGuardian,
  updateGuardianLink,
  updateStaff,
  updateStudent,
} from "../../modules/people";
import { classroomsOfYear, yearChoices } from "./imports-academic";
import { issue, issuesFromError, type ImportWriteEnv } from "./imports-support";

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const shortHash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 24);

/** Référence externe envoyée à `people` : le matricule du fichier, sinon l'empreinte de la clé naturelle (idempotence). */
const externalRefOf = (row: { externalRef?: string }, key: string | null): string => (row.externalRef ? row.externalRef.trim() : `imp-${shortHash(key ?? "")}`);

type PersonFields = "lastName" | "firstName" | "sex" | "birthDate" | "birthPlace" | "nationality" | "email" | "phone" | "phoneAlt" | "addressLine" | "city" | "residence";
const PERSON_KEYS: readonly PersonFields[] = ["lastName", "firstName", "sex", "birthDate", "birthPlace", "nationality", "email", "phone", "phoneAlt", "addressLine", "city", "residence"];

/** Champs d'identité présents dans la ligne (les absents ne sont JAMAIS envoyés : une mise à jour n'efface rien). */
function personOf(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PERSON_KEYS) {
    const v = row[k];
    if (typeof v === "string" && v !== "") out[k] = v;
  }
  return out;
}

const duplicateNames = (duplicates: Array<{ displayName: string; studentNumber: string | null }>): string =>
  duplicates.slice(0, 3).map((d) => `${d.displayName}${d.studentNumber ? ` (${d.studentNumber})` : ""}`).join(", ");

// ---------------------------------------------------------------------------
// Élèves
// ---------------------------------------------------------------------------

export function createStudentsImportPort(env: ImportWriteEnv): ImportTargetPort<StudentRow> {
  /** Classes d'une année, par code : lues une fois par import (un import ne dure pas assez pour périmer). */
  const classCache = new Map<string, { at: number; byCode: Map<string, string>; funding: Set<string> }>();
  async function classesFor(ctx: RequestContext, yearId: string, jobId: string) {
    const hit = classCache.get(jobId);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
    for (const [k, v] of classCache) if (Date.now() - v.at > 30 * 60_000) classCache.delete(k);
    const classes = await classroomsOfYear(env, ctx, yearId);
    const funding = await listReference(env.academic, ctx, "funding-types");
    const entry = { at: Date.now(), byCode: new Map(classes.map((c) => [norm(c.code), c.id])), funding: new Set(funding.ok ? funding.value.map((f) => norm(f.code)) : []) };
    classCache.set(jobId, entry);
    return entry;
  }
  const bodyOf = (row: StudentRow): Record<string, unknown> => ({
    person: personOf(row),
    ...(row.nationalStudentId ? { nationalStudentId: row.nationalStudentId } : {}),
    ...(row.birthCertificateNumber ? { birthCertificateNumber: row.birthCertificateNumber } : {}),
  });

  return {
    async choices(ctx, optionKey) {
      return optionKey === "academicYearId" ? yearChoices(env, ctx) : [];
    },
    async checkOptions(ctx, options) {
      const y = options["academicYearId"];
      if (y === undefined || y === "") return [];
      return (await yearChoices(env, ctx)).some((c) => c.value === y) ? [] : [issue("academicYearId", "imports.options_invalid", "Année scolaire inconnue.")];
    },
    async plan(ctx, items: readonly PlanItem<StudentRow>[], run: PlanRun): Promise<PlanResult[]> {
      const out: PlanResult[] = [];
      const yearId = typeof run.options["academicYearId"] === "string" ? run.options["academicYearId"] : "";
      const wantsClass = items.some((i) => i.row.classCode);
      const classes = wantsClass && yearId ? await classesFor(ctx, yearId, run.jobId) : null;
      const acknowledge = run.options["duplicatePolicy"] === "ACKNOWLEDGE";
      for (const item of items) {
        const row = item.row;
        const issues = [];
        if (row.classCode) {
          if (!yearId) issues.push(issue("classCode", "imports.options_invalid", "La colonne « Classe » exige l'option « Année scolaire des inscriptions »."));
          else if (classes && !classes.byCode.has(norm(row.classCode))) issues.push(issue("classCode", "imports.reference_unknown", `Classe « ${row.classCode} » inconnue pour cette année scolaire.`));
          if (row.fundingType && classes && !classes.funding.has(norm(row.fundingType))) issues.push(issue("fundingType", "imports.reference_unknown", `Type de financement « ${row.fundingType} » inconnu.`));
        }
        const r = await createStudent(env.people, ctx, { ...bodyOf(row), externalRef: externalRefOf(row, item.key), validateOnly: true } as never);
        if (!r.ok) {
          out.push({ rowNo: item.rowNo, action: "ERROR", issues: [...issues, ...issuesFromError(r.error)] });
          continue;
        }
        if (r.value.kind === "created") {
          // Même matricule d'origine déjà en base : l'élève existe.
          out.push({ rowNo: item.rowNo, action: issues.some((i) => i.severity === "ERROR") ? "ERROR" : run.onExisting === "UPDATE" ? "UPDATE" : "SKIP", entityId: r.value.student.id, issues });
          continue;
        }
        const dups = r.value.duplicates;
        if (dups.length > 0) {
          issues.push(
            acknowledge
              ? issue(null, "people.possible_duplicate", `Doublon probable avec : ${duplicateNames(dups)}. L'élève sera créé malgré tout (motif tracé).`, "WARNING")
              : issue(null, "people.possible_duplicate", `Doublon probable avec : ${duplicateNames(dups)}. Vérifiez, ou choisissez « créer malgré le doublon ».`),
          );
        }
        out.push({ rowNo: item.rowNo, action: issues.some((i) => i.severity === "ERROR") ? "ERROR" : "CREATE", issues });
      }
      return out;
    },
    async apply(ctx, item: ApplyItem<StudentRow>, run: PlanRun): Promise<ApplyResult> {
      const row = item.row;
      let studentId: string;
      let outcome: ApplyResult["outcome"];
      if (item.action === "CREATE") {
        const acknowledge = run.options["duplicatePolicy"] === "ACKNOWLEDGE";
        const r = await createStudent(env.people, ctx, {
          ...bodyOf(row),
          externalRef: externalRefOf(row, item.key),
          ...(acknowledge ? { acknowledgeDuplicate: true, duplicateReason: `Import ${run.jobId} : doublon probable confirmé` } : {}),
        } as never);
        if (!r.ok) return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
        if (r.value.kind !== "created") return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue(null, "imports.write_failed", "Création non effectuée.")] };
        studentId = r.value.student.id;
        outcome = r.value.replayed ? "SKIPPED" : "CREATED";
      } else {
        if (!item.knownEntityId) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue(null, "people.student_not_found", "Élève à mettre à jour introuvable.")] };
        studentId = item.knownEntityId;
        const patch: Record<string, unknown> = {};
        const person = personOf(row);
        if (Object.keys(person).length > 0) patch["person"] = person;
        if (row.nationalStudentId) patch["nationalStudentId"] = row.nationalStudentId;
        if (row.birthCertificateNumber) patch["birthCertificateNumber"] = row.birthCertificateNumber;
        if (Object.keys(patch).length === 0) outcome = "SKIPPED";
        else {
          const r = await updateStudent(env.people, ctx, studentId, patch as never);
          if (!r.ok) return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
          outcome = "UPDATED";
        }
      }
      if (row.classCode) {
        const yearId = String(run.options["academicYearId"] ?? "");
        const classes = await classesFor(ctx, yearId, run.jobId);
        const classroomId = classes.byCode.get(norm(row.classCode));
        if (!classroomId) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("classCode", "imports.reference_unknown", `Classe « ${row.classCode} » inconnue.`)] };
        const e = await enrollStudent(env.academic, ctx, {
          studentId,
          classroomId,
          ...(row.fundingType ? { fundingType: row.fundingType } : {}),
          ...(row.assignmentReference ? { assignmentReference: row.assignmentReference } : {}),
        } as never);
        if (!e.ok && e.error.code !== AcademicCode.ALREADY_ENROLLED) return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(e.error) };
      }
      return { rowNo: item.rowNo, outcome, entityId: studentId, issues: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Tuteurs et liens
// ---------------------------------------------------------------------------

export function createGuardiansImportPort(env: ImportWriteEnv): ImportTargetPort<GuardianRow> {
  /** Tuteurs « qui seront créés par ce fichier » : une même personne sur plusieurs lignes n'est pas un doublon. */
  const planned = new Map<string, { at: number; keys: Set<string> }>();
  const personKey = (row: GuardianRow): string => guardianIdentityKey(row);

  async function relationshipCodes(ctx: RequestContext) {
    const r = await listRelationshipTypes(env.people, ctx);
    const list = r.ok ? r.value.filter((t) => t.active) : [];
    return { byKey: new Map(list.flatMap((t) => [[norm(t.code), t.code] as const, [norm(t.label), t.code] as const])), codes: list.map((t) => t.code) };
  }
  async function refs(ctx: RequestContext, values: readonly string[]) {
    const r = await resolveStudentRefs(env.people, ctx, values);
    return new Map((r.ok ? r.value : []).map((m) => [norm(m.ref), m.studentId]));
  }
  const flagsOf = (row: GuardianRow) => ({
    ...(row.isPrimaryContact !== undefined ? { isPrimaryContact: row.isPrimaryContact } : {}),
    ...(row.isEmergencyContact !== undefined ? { isEmergencyContact: row.isEmergencyContact } : {}),
    ...(row.isFinancialResponsible !== undefined ? { isFinancialResponsible: row.isFinancialResponsible } : {}),
    ...(row.hasLegalCustody !== undefined ? { hasLegalCustody: row.hasLegalCustody } : {}),
    ...(row.canPickup !== undefined ? { canPickup: row.canPickup } : {}),
    ...(row.portalAccess !== undefined ? { portalAccess: row.portalAccess } : {}),
  });
  const personBody = (row: GuardianRow): Record<string, unknown> => ({
    person: personOf(row),
    ...(row.occupation ? { occupation: row.occupation } : {}),
    ...(row.employer ? { employer: row.employer } : {}),
  });

  return {
    async plan(ctx, items: readonly PlanItem<GuardianRow>[], run: PlanRun): Promise<PlanResult[]> {
      const out: PlanResult[] = [];
      const students = await refs(ctx, items.map((i) => i.row.studentRef));
      const rel = await relationshipCodes(ctx);
      const memo = planned.get(run.jobId) ?? { at: Date.now(), keys: new Set<string>() };
      memo.at = Date.now();
      planned.set(run.jobId, memo);
      for (const [k, v] of planned) if (Date.now() - v.at > 60 * 60_000) planned.delete(k);
      const acknowledge = run.options["duplicatePolicy"] === "ACKNOWLEDGE";
      for (const item of items) {
        const row = item.row;
        const issues = [];
        const studentId = students.get(norm(row.studentRef));
        if (!studentId) issues.push(issue("studentRef", "imports.reference_unknown", `Aucun élève avec le matricule « ${row.studentRef} » (importez d'abord les élèves).`));
        if (!rel.byKey.has(norm(row.relationship))) issues.push(issue("relationship", "imports.reference_unknown", `Lien de parenté « ${row.relationship} » inconnu (liens : ${rel.codes.slice(0, 8).join(", ") || "aucun"}).`));
        if (issues.length > 0) {
          out.push({ rowNo: item.rowNo, action: "ERROR", issues });
          continue;
        }
        const pk = personKey(row);
        const knownGuardian = Object.values(item.related)[0] ?? null;
        let action: "CREATE" | "UPDATE" | "SKIP" = "CREATE";
        if (knownGuardian) {
          // Le tuteur existe : le lien existe-t-il déjà ?
          const links = await listGuardiansOfStudent(env.people, ctx, studentId as string);
          const linked = links.ok && links.value.some((g) => g.guardian.id === knownGuardian);
          action = linked ? (run.onExisting === "UPDATE" ? "UPDATE" : "SKIP") : "CREATE";
        } else if (!memo.keys.has(pk)) {
          // Nouveau tuteur : essai à blanc (transaction annulée) pour détecter un doublon probable existant.
          const dry = await createGuardian(env.people, ctx, personBody(row) as never);
          if (!dry.ok) {
            if (dry.error.code === "people.possible_duplicate" && acknowledge) issues.push(issue(null, dry.error.code, "Doublon probable : le tuteur sera créé malgré tout (motif tracé).", "WARNING"));
            else {
              out.push({ rowNo: item.rowNo, action: "ERROR", issues: issuesFromError(dry.error) });
              continue;
            }
          }
          memo.keys.add(pk);
        }
        out.push({ rowNo: item.rowNo, action, ...(knownGuardian ? { entityId: knownGuardian } : {}), issues });
      }
      return out;
    },
    async apply(ctx, item: ApplyItem<GuardianRow>, run: PlanRun): Promise<ApplyResult> {
      const row = item.row;
      const students = await refs(ctx, [row.studentRef]);
      const studentId = students.get(norm(row.studentRef));
      if (!studentId) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("studentRef", "imports.reference_unknown", `Aucun élève avec le matricule « ${row.studentRef} ».`)] };
      const rel = await relationshipCodes(ctx);
      const relationshipCode = rel.byKey.get(norm(row.relationship));
      if (!relationshipCode) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("relationship", "imports.reference_unknown", `Lien de parenté « ${row.relationship} » inconnu.`)] };

      const personRefKey = Object.keys(item.related)[0] ?? `guardians|person|${personKey(row)}`;
      const refs2: Array<{ key: string; entityType: string; entityId: string }> = [];
      let guardianId = item.related[personRefKey] ?? null;
      if (!guardianId) {
        const acknowledge = run.options["duplicatePolicy"] === "ACKNOWLEDGE";
        const created = await createGuardian(env.people, ctx, { ...personBody(row), ...(acknowledge ? { acknowledgeDuplicate: true, duplicateReason: `Import ${run.jobId} : doublon probable confirmé` } : {}) } as never);
        if (!created.ok) return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(created.error) };
        guardianId = created.value.guardian.id;
        refs2.push({ key: personRefKey, entityType: "guardian", entityId: guardianId });
      } else if (item.action === "UPDATE") {
        const u = await updateGuardian(env.people, ctx, guardianId, personBody(row) as never);
        if (!u.ok) return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(u.error) };
      }
      const linked = await linkGuardian(env.people, ctx, studentId, { guardianId, relationshipCode, ...flagsOf(row) } as never);
      if (linked.ok) return { rowNo: item.rowNo, outcome: item.action === "UPDATE" ? "UPDATED" : "CREATED", entityId: linked.value.id, issues: [], refs: refs2 };
      if (linked.error.code === "people.link_exists") {
        // Lien déjà posé : politique « mettre à jour » -> drapeaux du lien ; sinon ignoré (rejeu).
        const links = await listGuardiansOfStudent(env.people, ctx, studentId);
        const existing = links.ok ? links.value.find((g) => g.guardian.id === guardianId) : undefined;
        const linkId = existing?.link.id ?? null;
        if (item.action === "UPDATE" && linkId) {
          const u = await updateGuardianLink(env.people, ctx, studentId, linkId, { relationshipCode, ...flagsOf(row) } as never);
          if (!u.ok) return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(u.error) };
          return { rowNo: item.rowNo, outcome: "UPDATED", entityId: linkId, issues: [], refs: refs2 };
        }
        return { rowNo: item.rowNo, outcome: "SKIPPED", entityId: linkId ?? guardianId, issues: [issue(null, "imports.already_imported", "Ce lien existe déjà : ligne ignorée.", "WARNING")], refs: refs2 };
      }
      return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(linked.error) };
    },
  };
}

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------

export function createStaffImportPort(env: ImportWriteEnv): ImportTargetPort<StaffRow> {
  async function categories(ctx: RequestContext) {
    const r = await listStaffCategories(env.people, ctx);
    const list = r.ok ? r.value.filter((c) => c.active !== false) : [];
    return { byKey: new Map(list.flatMap((c) => [[norm(c.code), c.code] as const, [norm(c.label), c.code] as const])), codes: list.map((c) => c.code) };
  }
  const bodyOf = (row: StaffRow, categoryCode: string): Record<string, unknown> => ({
    person: personOf(row),
    categoryCode,
    ...(row.jobTitle ? { jobTitle: row.jobTitle } : {}),
    ...(row.hiredOn ? { hiredOn: row.hiredOn } : {}),
  });
  return {
    async plan(ctx, items: readonly PlanItem<StaffRow>[], run: PlanRun): Promise<PlanResult[]> {
      const cats = await categories(ctx);
      const acknowledge = run.options["duplicatePolicy"] === "ACKNOWLEDGE";
      const out: PlanResult[] = [];
      for (const item of items) {
        const row = item.row;
        const code = cats.byKey.get(norm(row.categoryCode));
        if (!code) {
          out.push({ rowNo: item.rowNo, action: "ERROR", issues: [issue("categoryCode", "imports.reference_unknown", `Catégorie « ${row.categoryCode} » inconnue (catégories : ${cats.codes.slice(0, 8).join(", ") || "aucune"}).`)] });
          continue;
        }
        const r = await createStaff(env.people, ctx, { ...bodyOf(row, code), externalRef: externalRefOf(row, item.key), validateOnly: true } as never);
        if (!r.ok) {
          out.push({ rowNo: item.rowNo, action: "ERROR", issues: issuesFromError(r.error) });
          continue;
        }
        if (r.value.kind === "created") {
          out.push({ rowNo: item.rowNo, action: run.onExisting === "UPDATE" ? "UPDATE" : "SKIP", entityId: r.value.staff.id, issues: [] });
          continue;
        }
        const dups = r.value.duplicates;
        if (dups.length > 0 && !acknowledge) {
          out.push({ rowNo: item.rowNo, action: "ERROR", issues: [issue(null, "people.possible_duplicate", `Doublon probable avec : ${duplicateNames(dups)}. Vérifiez, ou choisissez « créer malgré le doublon ».`)] });
          continue;
        }
        out.push({ rowNo: item.rowNo, action: "CREATE", issues: dups.length > 0 ? [issue(null, "people.possible_duplicate", `Doublon probable avec : ${duplicateNames(dups)}. La fiche sera créée malgré tout.`, "WARNING")] : [] });
      }
      return out;
    },
    async apply(ctx, item: ApplyItem<StaffRow>, run: PlanRun): Promise<ApplyResult> {
      const row = item.row;
      const cats = await categories(ctx);
      const code = cats.byKey.get(norm(row.categoryCode));
      if (!code) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue("categoryCode", "imports.reference_unknown", `Catégorie « ${row.categoryCode} » inconnue.`)] };
      if (item.action === "CREATE") {
        const acknowledge = run.options["duplicatePolicy"] === "ACKNOWLEDGE";
        const r = await createStaff(env.people, ctx, {
          ...bodyOf(row, code),
          externalRef: externalRefOf(row, item.key),
          ...(acknowledge ? { acknowledgeDuplicate: true, duplicateReason: `Import ${run.jobId} : doublon probable confirmé` } : {}),
        } as never);
        if (!r.ok) return { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
        if (r.value.kind !== "created") return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue(null, "imports.write_failed", "Création non effectuée.")] };
        return { rowNo: item.rowNo, outcome: r.value.replayed ? "SKIPPED" : "CREATED", entityId: r.value.staff.id, issues: [] };
      }
      if (!item.knownEntityId) return { rowNo: item.rowNo, outcome: "FAILED", issues: [issue(null, "people.staff_not_found", "Fiche à mettre à jour introuvable.")] };
      const person = personOf(row);
      const patch: Record<string, unknown> = { categoryCode: code, ...(row.jobTitle ? { jobTitle: row.jobTitle } : {}), ...(row.hiredOn ? { hiredOn: row.hiredOn } : {}) };
      if (Object.keys(person).length > 0) patch["person"] = person;
      const r = await updateStaff(env.people, ctx, item.knownEntityId, patch as never);
      return r.ok ? { rowNo: item.rowNo, outcome: "UPDATED", entityId: item.knownEntityId, issues: [] } : { rowNo: item.rowNo, outcome: "FAILED", issues: issuesFromError(r.error) };
    },
  };
}

/** Nom d'affichage de l'auteur d'un import (annuaire des comptes de `people`). */
export function createImportActorNames(env: ImportWriteEnv): ImportActorNamePort {
  return {
    async displayName(ctx, userId) {
      const names = await getDisplayNamesOfIdentities(env.people, ctx, [userId]);
      return names.get(userId) ?? null;
    },
  };
}
