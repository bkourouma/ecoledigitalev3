/**
 * Lecture d'un élément `CONFIDENTIAL` : l'UNIQUE porte par laquelle son contenu sort. Elle exige l'habilitation
 * `schoollife.confidential.read` (sensible, MFA), le périmètre de l'élève et — selon le réglage de l'établissement — un motif ;
 * elle JOURNALISE la lecture (lecteur = utilisateur de la session, motif, instant : ajout seul) AVANT de renvoyer le contenu,
 * dans la même transaction (si la journalisation échoue, rien n'est renvoyé), puis publie un événement sans contenu et audite.
 * Un élément non confidentiel se lit sans journal (niveau STANDARD / RESTRICTED : permissions de lecture habituelles).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { SchoolLifeConfidentialReadInput, SchoolLifeConvocationDto, SchoolLifeIncidentDto, SchoolLifeMeasureDto, SchoolLifeNoteDto } from "@ecoledigitale/contracts/src/v2/schoollife";
import { SchoolLifeEvents } from "../domain/events";
import { forbidden, invalid, notFound, SchoolLifeCode } from "../domain/errors";
import * as convocationsRepo from "../infrastructure/convocations-repository";
import * as history from "../infrastructure/history-repository";
import * as incidentsRepo from "../infrastructure/incidents-repository";
import * as measuresRepo from "../infrastructure/measures-repository";
import * as notesRepo from "../infrastructure/notes-repository";
import * as reference from "../infrastructure/reference-repository";
import { EventBuffer, inTx, requireHuman, type CallerCaps, type SchoolLifeDeps } from "./deps";
import { assertStudentScope, loadTypes, studentNames, staffMaySee, viewerOf } from "./support";
import { appealDto, convocationDto, incidentDto, measureDto, noteDto } from "./views";

export type ConfidentialContent =
  | { entityKind: "INCIDENT"; incident: SchoolLifeIncidentDto }
  | { entityKind: "MEASURE"; measure: SchoolLifeMeasureDto }
  | { entityKind: "NOTE"; note: SchoolLifeNoteDto }
  | { entityKind: "CONVOCATION"; convocation: SchoolLifeConvocationDto };

/** Motif enregistré quand l'établissement n'en exige pas (la base exige 5 caractères au minimum). */
export const DEFAULT_READ_PURPOSE = "Consultation (motif non exigé par l'établissement)";

export async function readConfidential(deps: SchoolLifeDeps, ctx: RequestContext, caps: CallerCaps, input: SchoolLifeConfidentialReadInput): Promise<Result<ConfidentialContent, AppError>> {
  const human = requireHuman(ctx);
  if (!human.ok) return human;
  const viewer = viewerOf(caps);
  return inTx<ConfidentialContent>(deps, ctx, async (tx) => {
    // Chargement de l'élément et de l'élève concerné ; hors habilitation ou périmètre : introuvable (jamais d'indice d'existence).
    let studentId: string | null = null;
    let institutionId = "";
    let confidentiality = "STANDARD";
    let status = "";
    let kindKey = "";
    switch (input.entityKind) {
      case "INCIDENT": {
        const row = await incidentsRepo.getIncident(tx, input.entityId);
        if (!row) break;
        institutionId = row.institutionId;
        confidentiality = row.confidentiality;
        status = row.status;
        kindKey = "INCIDENT";
        // L'élève « de référence » : les auteurs désignés ; l'accès exige le périmètre sur AU MOINS UN élève impliqué (ou portée générale).
        const involved = await incidentsRepo.listInvolvements(tx, [row.id]);
        let allowed = viewer.readAll || row.reportedBy === human.value;
        for (const v of involved) if (!allowed && (await deps.ports.people.staffCanReadStudent(ctx, v.studentId))) allowed = true;
        studentId = allowed ? (involved[0]?.studentId ?? "") : null;
        break;
      }
      case "MEASURE": {
        const row = await measuresRepo.getMeasure(tx, input.entityId);
        if (!row) break;
        institutionId = row.institutionId;
        confidentiality = row.confidentiality;
        status = row.status;
        kindKey = "MEASURE";
        studentId = (await assertStudentScope(deps, ctx, caps, row.studentId)).ok ? row.studentId : null;
        break;
      }
      case "NOTE": {
        const row = await notesRepo.getNote(tx, input.entityId);
        if (!row) break;
        institutionId = row.institutionId;
        confidentiality = row.confidentiality;
        status = row.status;
        kindKey = "NOTE";
        studentId = (await assertStudentScope(deps, ctx, caps, row.studentId)).ok ? row.studentId : null;
        break;
      }
      case "CONVOCATION": {
        const row = await convocationsRepo.getConvocation(tx, input.entityId);
        if (!row) break;
        institutionId = row.institutionId;
        confidentiality = row.confidentiality;
        status = row.status;
        kindKey = "CONVOCATION";
        studentId = (await assertStudentScope(deps, ctx, caps, row.studentId)).ok ? row.studentId : null;
        break;
      }
    }
    if (studentId === null || !staffMaySee(viewer, kindKey, confidentiality, status)) return err(notFound(SchoolLifeCode.NOT_FOUND, "Élément de vie scolaire", input.entityId));

    // Journal AVANT le contenu (uniquement pour un élément confidentiel).
    if (confidentiality === "CONFIDENTIAL") {
      if (!caps.confidentialRead) return err(forbidden(SchoolLifeCode.CONFIDENTIAL_FORBIDDEN, "La lecture d'un élément confidentiel exige une habilitation spécifique."));
      const settings = await reference.getSettings(tx, institutionId);
      const purposeRequired = settings?.confidentialReadRequiresPurpose ?? true;
      const purpose = input.purpose?.trim();
      if (purposeRequired && !purpose) return err(invalid(SchoolLifeCode.PURPOSE_REQUIRED, "Précisez le motif de la lecture (il sera journalisé).", "purpose"));
      const readId = deps.newId();
      await history.insertConfidentialRead(tx, { id: readId, tenantId: ctx.tenantId, entityKind: input.entityKind, entityId: input.entityId, readerUserId: human.value, purpose: purpose || DEFAULT_READ_PURPOSE });
      const events = new EventBuffer(deps, ctx);
      events.add(SchoolLifeEvents.CONFIDENTIAL_ACCESSED, { v: 1, entityKind: input.entityKind, entityId: input.entityId }, { type: "schoollife.confidential_read", id: readId });
      events.audit({ action: "schoollife.confidential.read", resourceType: input.entityKind.toLowerCase(), resourceId: input.entityId, sensitive: true, reason: purpose || DEFAULT_READ_PURPOSE });
      await events.flush(tx);
    }

    switch (input.entityKind) {
      case "INCIDENT": {
        const row = (await incidentsRepo.getIncident(tx, input.entityId))!;
        const involvements = await incidentsRepo.listInvolvements(tx, [row.id]);
        const types = await loadTypes(tx, [row.typeId]);
        const names = await studentNames(deps, ctx, involvements.map((i) => i.studentId));
        return ok({ entityKind: "INCIDENT", incident: incidentDto(row, involvements, { types, names }, { unmask: true, showStatements: caps.incidentReview === true }) });
      }
      case "MEASURE": {
        const row = (await measuresRepo.getMeasure(tx, input.entityId))!;
        const types = await loadTypes(tx, [row.typeId]);
        const names = await studentNames(deps, ctx, [row.studentId]);
        const appeals = await measuresRepo.listAppealsOf(tx, [row.id]);
        const dto = measureDto(row, appeals, { types, names }, { unmask: true });
        return ok({ entityKind: "MEASURE", measure: { ...dto, appeals: appeals.map(appealDto) } });
      }
      case "NOTE": {
        const row = (await notesRepo.getNote(tx, input.entityId))!;
        const types = await loadTypes(tx, [row.typeId]);
        const names = await studentNames(deps, ctx, [row.studentId]);
        return ok({ entityKind: "NOTE", note: noteDto(row, { types, names }, { unmask: true }) });
      }
      case "CONVOCATION": {
        const row = (await convocationsRepo.getConvocation(tx, input.entityId))!;
        const names = await studentNames(deps, ctx, [row.studentId]);
        return ok({ entityKind: "CONVOCATION", convocation: convocationDto(row, { types: new Map(), names }, { unmask: true }) });
      }
    }
  });
}

/** Journal des lectures confidentielles (direction) : qui, quand, pourquoi. Jamais le contenu. */
export async function listConfidentialReadsView(deps: SchoolLifeDeps, ctx: RequestContext, input: { entityKind?: string | undefined; entityId?: string | undefined; page: number; pageSize: number }) {
  const limit = Math.min(200, Math.max(1, input.pageSize));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await history.listConfidentialReads(tx, { entityKind: input.entityKind, entityId: input.entityId, limit, offset: (Math.max(1, input.page) - 1) * limit });
      return ok(rows.map((r) => ({ id: r.id, entityKind: r.entityKind, entityId: r.entityId, readerUserId: r.readerUserId, purpose: r.purpose, occurredAt: r.occurredAt.toISOString() })));
    },
    { readOnly: true },
  );
}
