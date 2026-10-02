/**
 * File d'attente LOCALE des pointages d'appel (« outbox »), pour saisir sans réseau et envoyer plus tard par lot.
 *
 * CE QUI EST STOCKÉ (et pourquoi c'est acceptable en clair) :
 *   uniquement des IDENTIFIANTS techniques (UUID de séance, de classe, d'élève), un code de statut, des minutes de retard
 *   et des horodatages. AUCUN nom, AUCUNE photo, AUCUN motif ni note libre. Un appareil volé ne révèle donc que des UUID
 *   inexploitables sans accès à l'API (qui exige jeton + tenant + permission). Pas de chiffrement local : une clé
 *   conservée dans le même navigateur n'apporterait pas de protection réelle contre un script de la page (XSS) et
 *   compliquerait la récupération ; la liste nominative de l'appel reste, elle, UNIQUEMENT en mémoire de la page.
 *
 * IDEMPOTENCE : chaque pointage porte un `clientId` (UUID). Il est RENOUVELÉ à chaque modification du pointage (l'API
 * refuse le même `clientId` avec un autre contenu) ; rejouer un lot identique ne crée donc jamais de doublon.
 *
 * PROPRIÉTAIRE : chaque entrée est rattachée à `tenant:utilisateur`. Une autre personne qui se connecte sur le même
 * appareil ne voit ni n'envoie jamais les pointages d'autrui (l'attribution serveur se fait sur l'identité du jeton).
 *
 * Aucune règle métier ici : le serveur décide (appartenance au roster, statuts valides, fenêtre de correction, conflits).
 */

import { attendanceSyncBatchSchema, type AttendanceSyncBatch, type AttendanceSyncResultDto } from "@ecoledigitale/contracts/v2/attendance";
import type { ObjectStore, OfflineDb } from "./idb";

export type CallTarget = { kind: "occurrence"; occurrenceId: string } | { kind: "daily"; classroomId: string; date: string };

export function callKey(target: CallTarget): string {
  return target.kind === "occurrence" ? `occ:${target.occurrenceId}` : `day:${target.classroomId}:${target.date}`;
}

export interface OutboxRecord {
  /** Clé d'idempotence du pointage ; renouvelée à chaque modification. */
  clientId: string;
  studentId: string;
  statusCode: string;
  minutesLate?: number;
  clientMarkedAt: string;
}

export type OutboxCallState =
  /** Des modifications attendent d'être envoyées. */
  | "PENDING"
  /** Un lot contenant cet appel est en vol. */
  | "SYNCING"
  /** Tout est envoyé et accepté. */
  | "DONE"
  /** Envoyé, mais quelque chose demande l'attention de l'utilisateur (conflit, rejet, erreur de séance). */
  | "ATTENTION";

export interface ConflictNote {
  studentId: string;
  conflictId: string | null;
}
export interface RejectNote {
  studentId: string;
  code: string | null;
}

export interface OutboxCall {
  /** Clé de stockage = identité de l'appel. */
  key: string;
  owner: string;
  target: CallTarget;
  /** Libellé NON personnel (classe, matière, date) pour reconnaître l'appel dans la liste. */
  label: string | null;
  /** Date civile de l'appel (AAAA-MM-JJ), pour l'affichage. */
  date: string;
  /** Clé d'idempotence de la séance d'appel. */
  sessionClientId: string;
  openedAt: string;
  records: Record<string, OutboxRecord>;
  /** Soumission demandée (« tous présents sauf ») ; effacée quand le serveur confirme. */
  submit: { defaultStatus: string; requestedAt: string } | null;
  state: OutboxCallState;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: { code: string } | null;
  /** Dernier identifiant de séance connu du serveur (pour rouvrir l'appel). */
  sessionId: string | null;
  submitted: boolean;
  appliedCount: number;
  conflicts: ConflictNote[];
  rejected: RejectNote[];
  updatedAt: string;
}

/** Ce que `prepareBatch` rend au moteur de synchronisation. */
export interface BatchSnapshot {
  batchId: string;
  owner: string;
  sentAt: string;
  sessions: Array<{
    key: string;
    sessionClientId: string;
    records: Array<{ studentId: string; clientId: string }>;
    submitRequestedAt: string | null;
  }>;
}

export interface PreparedBatch {
  batch: AttendanceSyncBatch;
  snapshot: BatchSnapshot;
}

export const MAX_SESSIONS_PER_BATCH = 50;
export const MAX_RECORDS_PER_SESSION = 500;
export const MAX_RECORDS_PER_BATCH = 2000;
const MAX_CLOCK_OFFSET_MS = 86_400_000;

export class OutboxUnavailableError extends Error {
  constructor() {
    super("Aucun utilisateur identifié : la file hors ligne est indisponible.");
    this.name = "OutboxUnavailableError";
  }
}

interface MetaRow {
  key: string;
  value: unknown;
}

export interface OutboxDeps {
  db: OfflineDb;
  /** `tenant:utilisateur` courant, ou `null` si personne n'est connecté. */
  owner: () => string | null;
  now?: () => Date;
  uuid?: () => string;
}

export function randomUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class AttendanceOutbox {
  private readonly calls: ObjectStore<OutboxCall>;
  private readonly meta: ObjectStore<MetaRow>;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(private readonly deps: OutboxDeps) {
    this.calls = deps.db.store<OutboxCall>("attendance_calls");
    this.meta = deps.db.store<MetaRow>("meta");
    this.now = deps.now ?? (() => new Date());
    this.uuid = deps.uuid ?? randomUuid;
  }

  get persistent(): boolean {
    return this.deps.db.persistent;
  }

  /** Sérialise toutes les opérations (lecture-modification-écriture) : pas de course entre deux gestes rapprochés. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private owner(): string {
    const o = this.deps.owner();
    if (!o) throw new OutboxUnavailableError();
    return o;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------------------------------------------

  /** Les appels du propriétaire courant, du plus récent au plus ancien. */
  list(): Promise<OutboxCall[]> {
    return this.serial(async () => {
      const owner = this.deps.owner();
      if (!owner) return [];
      return (await this.calls.getAll()).filter((c) => c.owner === owner).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  get(target: CallTarget): Promise<OutboxCall | undefined> {
    return this.serial(async () => {
      const owner = this.deps.owner();
      const call = await this.calls.get(callKey(target));
      return call && owner && call.owner === owner ? call : undefined;
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Écriture locale
  // -------------------------------------------------------------------------------------------------------------

  private async load(target: CallTarget, label: string | null, date: string): Promise<OutboxCall> {
    const owner = this.owner();
    const key = callKey(target);
    const existing = await this.calls.get(key);
    if (existing && existing.owner === owner) return existing;
    const nowIso = this.now().toISOString();
    return {
      key,
      owner,
      target,
      label,
      date,
      sessionClientId: this.uuid(),
      openedAt: nowIso,
      records: {},
      submit: null,
      state: "PENDING",
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      sessionId: null,
      submitted: false,
      appliedCount: 0,
      conflicts: [],
      rejected: [],
      updatedAt: nowIso,
    };
  }

  /** Nouvelle activité de l'utilisateur sur l'appel : remet l'appel en attente d'envoi (sauf lot en vol). */
  private touch(call: OutboxCall): OutboxCall {
    const nowIso = this.now().toISOString();
    return {
      ...call,
      state: call.state === "SYNCING" ? "SYNCING" : "PENDING",
      lastError: call.state === "SYNCING" ? call.lastError : null,
      updatedAt: nowIso,
    };
  }

  /** Enregistre (ou remplace) le pointage d'un élève. Nouveau `clientId` à chaque modification. */
  recordMark(input: { target: CallTarget; label?: string | null; date: string; studentId: string; statusCode: string; minutesLate?: number | null }): Promise<OutboxCall> {
    return this.serial(async () => {
      const call = await this.load(input.target, input.label ?? null, input.date);
      const nowIso = this.now().toISOString();
      const record: OutboxRecord = {
        clientId: this.uuid(),
        studentId: input.studentId,
        statusCode: input.statusCode,
        clientMarkedAt: nowIso,
        ...(input.minutesLate ? { minutesLate: input.minutesLate } : {}),
      };
      const next = this.touch({ ...call, records: { ...call.records, [input.studentId]: record }, submitted: false });
      await this.calls.put(next);
      return next;
    });
  }

  /** Retire un pointage pas encore envoyé (l'utilisateur est revenu à l'état du serveur). */
  clearMark(target: CallTarget, studentId: string): Promise<OutboxCall | undefined> {
    return this.serial(async () => {
      const owner = this.owner();
      const call = await this.calls.get(callKey(target));
      if (!call || call.owner !== owner || !(studentId in call.records)) return call;
      const records = { ...call.records };
      delete records[studentId];
      const next = this.touch({ ...call, records });
      await this.calls.put(next);
      return next;
    });
  }

  /** Demande la soumission de l'appel (envoyée avec le prochain lot). */
  requestSubmit(input: { target: CallTarget; label?: string | null; date: string; defaultStatus: string }): Promise<OutboxCall> {
    return this.serial(async () => {
      const call = await this.load(input.target, input.label ?? null, input.date);
      const next = this.touch({ ...call, submit: { defaultStatus: input.defaultStatus, requestedAt: this.now().toISOString() }, submitted: false });
      await this.calls.put(next);
      return next;
    });
  }

  /** Remet un appel en attention/erreur dans la file d'envoi (bouton « Réessayer »). */
  retry(target: CallTarget): Promise<void> {
    return this.serial(async () => {
      const owner = this.owner();
      const call = await this.calls.get(callKey(target));
      if (!call || call.owner !== owner || call.state === "SYNCING") return;
      await this.calls.put({ ...call, state: "PENDING", lastError: null, updatedAt: this.now().toISOString() });
    });
  }

  /** Abandonne un appel local (rejet définitif, ou choix de l'utilisateur). */
  discard(target: CallTarget): Promise<void> {
    return this.serial(async () => {
      const owner = this.owner();
      const call = await this.calls.get(callKey(target));
      if (call && call.owner === owner) await this.calls.delete(call.key);
    });
  }

  /** Efface les appels terminés (« DONE ») plus anciens que `maxAgeMs`, tous propriétaires confondus. */
  purgeDone(maxAgeMs: number): Promise<number> {
    return this.serial(async () => {
      const limit = this.now().getTime() - maxAgeMs;
      let removed = 0;
      for (const c of await this.calls.getAll()) {
        if (c.state === "DONE" && Date.parse(c.updatedAt) < limit) {
          await this.calls.delete(c.key);
          removed += 1;
        }
      }
      return removed;
    });
  }

  /** Après un plantage de page en plein envoi : les appels « en vol » redeviennent « en attente » (envoi rejouable). */
  recoverInterrupted(): Promise<number> {
    return this.serial(async () => {
      let n = 0;
      for (const c of await this.calls.getAll()) {
        if (c.state === "SYNCING") {
          await this.calls.put({ ...c, state: "PENDING" });
          n += 1;
        }
      }
      return n;
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Méta : identifiant d'appareil, décalage d'horloge
  // -------------------------------------------------------------------------------------------------------------

  deviceId(): Promise<string> {
    return this.serial(async () => {
      const row = await this.meta.get("deviceId");
      if (row && typeof row.value === "string") return row.value;
      const id = `web-${this.uuid()}`.slice(0, 64);
      await this.meta.put({ key: "deviceId", value: id });
      return id;
    });
  }

  clockOffsetMs(): Promise<number> {
    return this.serial(async () => {
      const row = await this.meta.get("clockOffsetMs");
      return row && typeof row.value === "number" ? row.value : 0;
    });
  }

  /** Décalage appareil -> serveur déduit de la réponse (`receivedAt` serveur moins `clientSentAt`) ; borné, négligé sous 5 s. */
  setClockOffsetFromResult(clientSentAt: string, receivedAt: string): Promise<number> {
    return this.serial(async () => {
      const raw = Date.parse(receivedAt) - Date.parse(clientSentAt);
      const offset = Number.isFinite(raw) && Math.abs(raw) >= 5000 ? Math.max(-MAX_CLOCK_OFFSET_MS, Math.min(MAX_CLOCK_OFFSET_MS, Math.round(raw))) : 0;
      await this.meta.put({ key: "clockOffsetMs", value: offset });
      return offset;
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Envoi
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Compose le prochain lot (appels « en attente » du propriétaire, dans les limites du contrat) et les passe « en vol ».
   * Renvoie `null` s'il n'y a rien à envoyer. Le lot est validé par le schéma du contrat avant tout envoi : une donnée
   * locale corrompue ne part jamais ; l'appel concerné passe en « attention ».
   */
  prepareBatch(): Promise<PreparedBatch | null> {
    return this.serial(async () => {
      const owner = this.deps.owner();
      if (!owner) return null;
      const eligible = (await this.calls.getAll())
        .filter((c) => c.owner === owner && c.state === "PENDING" && (Object.keys(c.records).length > 0 || c.submit !== null))
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      if (eligible.length === 0) return null;

      const offset = await this.readOffset();
      const deviceId = await this.readDeviceId();
      const sentAt = this.now().toISOString();
      const sessions: AttendanceSyncBatch["sessions"] = [];
      const snapshotSessions: BatchSnapshot["sessions"] = [];
      const included: OutboxCall[] = [];
      let total = 0;

      for (const call of eligible) {
        if (sessions.length >= MAX_SESSIONS_PER_BATCH) break;
        const all = Object.values(call.records).sort((a, b) => a.clientMarkedAt.localeCompare(b.clientMarkedAt));
        const room = MAX_RECORDS_PER_BATCH - total;
        const slice = all.slice(0, Math.min(MAX_RECORDS_PER_SESSION, room));
        if (slice.length === 0 && all.length > 0) break; // lot plein
        const complete = slice.length === all.length;
        total += slice.length;
        sessions.push({
          clientId: call.sessionClientId,
          target: call.target.kind === "occurrence" ? { occurrenceId: call.target.occurrenceId } : { scope: "DAILY", classroomId: call.target.classroomId, date: call.target.date },
          clientOpenedAt: call.openedAt,
          records: slice.map((r) => ({
            clientId: r.clientId,
            studentId: r.studentId,
            statusCode: r.statusCode,
            ...(r.minutesLate ? { minutesLate: r.minutesLate } : {}),
            clientMarkedAt: r.clientMarkedAt,
          })),
          // La soumission n'est envoyée qu'avec le DERNIER morceau des pointages de l'appel.
          ...(complete && call.submit ? { submit: { defaultStatus: call.submit.defaultStatus } } : {}),
        });
        snapshotSessions.push({
          key: call.key,
          sessionClientId: call.sessionClientId,
          records: slice.map((r) => ({ studentId: r.studentId, clientId: r.clientId })),
          submitRequestedAt: complete && call.submit ? call.submit.requestedAt : null,
        });
        included.push(call);
      }
      if (sessions.length === 0) return null;

      const batchId = this.uuid();
      const batch: AttendanceSyncBatch = {
        batchId,
        deviceId,
        clientSentAt: sentAt,
        ...(offset !== 0 ? { clockOffsetMs: offset } : {}),
        sessions,
      };
      const valid = attendanceSyncBatchSchema.safeParse(batch);
      if (!valid.success) {
        for (const call of included) await this.calls.put({ ...call, state: "ATTENTION", lastError: { code: "local.invalid_batch" } });
        return null;
      }
      for (const call of included) await this.calls.put({ ...call, state: "SYNCING", attempts: call.attempts + 1, lastAttemptAt: sentAt });
      return { batch, snapshot: { batchId, owner, sentAt, sessions: snapshotSessions } };
    });
  }

  private async readOffset(): Promise<number> {
    const row = await this.meta.get("clockOffsetMs");
    return row && typeof row.value === "number" ? row.value : 0;
  }

  private async readDeviceId(): Promise<string> {
    const row = await this.meta.get("deviceId");
    if (row && typeof row.value === "string") return row.value;
    const id = `web-${this.uuid()}`.slice(0, 64);
    await this.meta.put({ key: "deviceId", value: id });
    return id;
  }

  /** Échec d'acheminement (réseau, délai, serveur indisponible) : le lot est rejouable tel quel, rien n'est perdu. */
  releaseAfterFailure(snapshot: BatchSnapshot): Promise<void> {
    return this.serial(async () => {
      for (const s of snapshot.sessions) {
        const call = await this.calls.get(s.key);
        if (call && call.owner === snapshot.owner && call.state === "SYNCING") await this.calls.put({ ...call, state: "PENDING" });
      }
    });
  }

  /** Échec définitif du lot entier (requête refusée) : les appels passent en « attention » avec le code d'erreur. */
  failBatch(snapshot: BatchSnapshot, code: string): Promise<void> {
    return this.serial(async () => {
      for (const s of snapshot.sessions) {
        const call = await this.calls.get(s.key);
        if (call && call.owner === snapshot.owner) await this.calls.put({ ...call, state: "ATTENTION", lastError: { code } });
      }
    });
  }

  /** Applique la réponse de l'API (voir l'en-tête du fichier pour les règles). */
  applyResult(snapshot: BatchSnapshot, result: AttendanceSyncResultDto): Promise<void> {
    return this.serial(async () => {
      const bySession = new Map(result.sessions.map((s) => [s.clientId, s]));
      for (const snap of snapshot.sessions) {
        const call = await this.calls.get(snap.key);
        if (!call || call.owner !== snapshot.owner) continue;
        const res = bySession.get(snap.sessionClientId);
        if (!res) {
          // Séance absente de la réponse : on ne conclut rien, l'envoi sera rejoué.
          await this.calls.put({ ...call, state: "PENDING" });
          continue;
        }
        if (res.outcome === "REJECTED") {
          await this.calls.put({ ...call, state: "ATTENTION", lastError: { code: res.errorCode ?? "attendance.rejected" }, sessionId: res.sessionId ?? call.sessionId });
          continue;
        }

        const records = { ...call.records };
        const resByRecord = new Map(res.records.map((r) => [r.clientId, r]));
        let applied = call.appliedCount;
        const conflicts = [...call.conflicts];
        const rejected = [...call.rejected];
        for (const sent of snap.records) {
          const r = resByRecord.get(sent.clientId);
          if (!r) continue; // pas de réponse pour ce pointage : conservé, rejoué
          // Modifié pendant le vol (nouveau clientId) : la version plus récente reste en file.
          const unchanged = records[sent.studentId]?.clientId === sent.clientId;
          if (unchanged) delete records[sent.studentId];
          if (r.outcome === "APPLIED") applied += 1;
          else if (r.outcome === "CONFLICT") conflicts.push({ studentId: sent.studentId, conflictId: r.conflictId });
          else if (r.outcome === "REJECTED") rejected.push({ studentId: sent.studentId, code: r.errorCode });
          // UNCHANGED / REPLAYED : déjà connu du serveur, rien à signaler.
        }

        let submit = call.submit;
        let submitted = call.submitted;
        let lastError: OutboxCall["lastError"] = null;
        if (snap.submitRequestedAt !== null && submit && submit.requestedAt === snap.submitRequestedAt) {
          if (res.submitted) {
            submit = null;
            submitted = true;
          } else if (res.errorCode) {
            // Soumission refusée (ex. des élèves non pointés) : les pointages sont gardés, l'utilisateur doit agir.
            submit = null;
            lastError = { code: res.errorCode };
          }
        }
        const pending = Object.keys(records).length > 0 || submit !== null;
        const attention = conflicts.length > 0 || rejected.length > 0 || lastError !== null;
        await this.calls.put({
          ...call,
          records,
          submit,
          submitted,
          lastError,
          conflicts,
          rejected,
          appliedCount: applied,
          sessionId: res.sessionId ?? call.sessionId,
          state: pending ? "PENDING" : attention ? "ATTENTION" : "DONE",
          updatedAt: this.now().toISOString(),
        });
      }
    });
  }

  /** Efface les notes (conflits, rejets, erreur) d'un appel terminé après lecture par l'utilisateur. */
  dismiss(target: CallTarget): Promise<void> {
    return this.serial(async () => {
      const owner = this.owner();
      const call = await this.calls.get(callKey(target));
      if (!call || call.owner !== owner) return;
      if (Object.keys(call.records).length > 0 || call.submit !== null) {
        await this.calls.put({ ...call, conflicts: [], rejected: [], lastError: null });
      } else {
        await this.calls.delete(call.key);
      }
    });
  }
}

/** Nombre de pointages et d'appels encore à envoyer (pour l'indicateur). */
export function pendingTotals(calls: ReadonlyArray<OutboxCall>): { calls: number; records: number } {
  let n = 0;
  let r = 0;
  for (const c of calls) {
    const records = Object.keys(c.records).length;
    if (records > 0 || c.submit !== null) {
      n += 1;
      r += records;
    }
  }
  return { calls: n, records: r };
}
