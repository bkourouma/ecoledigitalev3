/**
 * Brouillons LOCAUX de saisie de notes (un par évaluation), pour continuer à saisir sans réseau et envoyer plus tard.
 *
 * CE QUI EST STOCKÉ (même politique que `attendance-outbox.ts`) :
 *   identifiants techniques (UUID d'évaluation et d'inscription), la valeur saisie (note décimale en CHAÎNE, ou état),
 *   le commentaire de ligne saisi par l'enseignant, des versions de ligne et des horodatages. AUCUN nom d'élève : la grille
 *   nominative reste en mémoire de la page. Pas de chiffrement local (une clé dans le même navigateur ne protège pas d'un
 *   script de la page) ; l'isolation est faite par propriétaire `tenant:utilisateur`, et la déconnexion efface ce qui est
 *   déjà envoyé (voir `purge.ts`).
 *
 * AUCUN ÉCRASEMENT SILENCIEUX :
 *   chaque ligne porte la `baseVersion` (version de ligne lue au moment de la saisie). L'API refuse (409
 *   `assess.stale_grade`) toute ligne dont la version a changé. Ce refus — ou une différence constatée à la réouverture de
 *   la feuille — place la saisie dans `conflicts` AVEC la valeur du serveur ; elle n'est jamais renvoyée avant un choix
 *   explicite de l'utilisateur (garder la mienne : la nouvelle `baseVersion` est alors celle du serveur ; prendre le serveur).
 *
 * IDEMPOTENCE : un lot en vol (`inflight`) conserve sa clé ET son contenu exacts. Après une coupure, le rejeu envoie le
 * même lot avec la même `Idempotency-Key` : l'API répond `replayed: true` sans rien écrire de plus. Les saisies faites
 * pendant le vol restent dans `entries` et partent dans un lot suivant (nouvelle clé).
 *
 * Aucune règle métier ici : le serveur décide (barème, période verrouillée, état de l'évaluation, appartenance).
 */

import type { ObjectStore, OfflineDb } from "./idb";
import { randomUuid } from "./attendance-outbox";

export type DraftEntryStatus = "ENTERED" | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED" | "EXEMPT" | "NOT_GRADED";

/** Valeur d'une note (saisie ou lue du serveur). `score` : chaîne décimale canonique, jamais un flottant. */
export interface GradeValue {
  entryStatus: DraftEntryStatus;
  score: string | null;
  comment: string | null;
}

export interface DraftEntry extends GradeValue {
  enrollmentId: string;
  /** Version de ligne lue au moment de la saisie ; `null` : aucune note enregistrée à ce moment. */
  baseVersion: number | null;
  editedAt: string;
}

export interface DraftConflict {
  enrollmentId: string;
  /** Ma saisie (hors ligne). */
  mine: GradeValue & { editedAt: string };
  /** Valeur actuelle du serveur ; `null` tant qu'elle n'a pas pu être relue (réseau). */
  server: (GradeValue & { rowVersion: number }) | null;
  detectedAt: string;
}

export interface InflightBatch {
  /** Clé d'idempotence du lot (en-tête `Idempotency-Key`). */
  batchKey: string;
  entries: Array<GradeValue & { enrollmentId: string; baseVersion: number | null }>;
  sentAt: string;
}

export type BlockedKind = "locked" | "error";

export interface GradeDraft {
  /** `grades:<owner>:<assessmentId>` */
  key: string;
  owner: string;
  assessmentId: string;
  /** Libellé NON personnel (intitulé de l'évaluation) pour reconnaître le brouillon dans une liste. */
  label: string | null;
  entries: Record<string, DraftEntry>;
  inflight: InflightBatch | null;
  conflicts: Record<string, DraftConflict>;
  /** Envoi impossible tant que l'utilisateur n'a pas agi : évaluation figée / période verrouillée (`locked`) ou refus (`error`). */
  blocked: { kind: BlockedKind; code: string } | null;
  attempts: number;
  lastAttemptAt: string | null;
  updatedAt: string;
}

export type DraftStatus = "SYNCED" | "PENDING" | "CONFLICT" | "FAILED" | "LOCKED";

/** Limites de la file (protègent le stockage de l'appareil). */
export const MAX_DRAFT_ASSESSMENTS = 25;
export const MAX_ENTRIES_PER_DRAFT = 1000;
/** Lignes par lot envoyé (l'API accepte 500 par défaut ; marge pour un réglage plus bas). */
export const MAX_ENTRIES_PER_BATCH = 200;

export class DraftUnavailableError extends Error {
  constructor() {
    super("Aucun utilisateur identifié : les brouillons hors ligne sont indisponibles.");
    this.name = "DraftUnavailableError";
  }
}

export class DraftLimitError extends Error {
  constructor(readonly limit: "assessments" | "entries") {
    super(limit === "assessments" ? "Trop d'évaluations en attente sur cet appareil." : "Trop de lignes en attente pour cette évaluation.");
    this.name = "DraftLimitError";
  }
}

/** Clé de stockage : le PROPRIÉTAIRE en fait partie, deux identités ne peuvent donc jamais se remplacer mutuellement. */
export const draftKey = (owner: string, assessmentId: string): string => `grades:${owner}:${assessmentId}`;

export function sameValue(a: GradeValue, b: GradeValue): boolean {
  const norm = (v: string | null) => (v === null || v === "" ? null : v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);
  const c = (v: string | null) => (v && v.trim() !== "" ? v.trim() : null);
  return a.entryStatus === b.entryStatus && norm(a.score) === norm(b.score) && c(a.comment) === c(b.comment);
}

export function pendingCount(d: GradeDraft): number {
  return Object.keys(d.entries).length;
}

export function statusOf(d: GradeDraft): DraftStatus {
  if (d.blocked?.kind === "locked") return "LOCKED";
  if (Object.keys(d.conflicts).length > 0) return "CONFLICT";
  if (d.blocked) return "FAILED";
  return "PENDING";
}

/** Brouillon sans rien à envoyer ni à arbitrer : il est supprimé. */
function isEmpty(d: GradeDraft): boolean {
  return Object.keys(d.entries).length === 0 && d.inflight === null && Object.keys(d.conflicts).length === 0 && d.blocked === null;
}

export interface ServerGrade extends GradeValue {
  enrollmentId: string;
  rowVersion: number;
}

export interface GradeDraftDeps {
  db: OfflineDb;
  /** `tenant:utilisateur` courant, ou `null`. */
  owner: () => string | null;
  now?: () => Date;
  uuid?: () => string;
}

export class GradeDrafts {
  private readonly store: ObjectStore<GradeDraft>;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(private readonly deps: GradeDraftDeps) {
    this.store = deps.db.store<GradeDraft>("grade_drafts");
    this.now = deps.now ?? (() => new Date());
    this.uuid = deps.uuid ?? randomUuid;
  }

  get persistent(): boolean {
    return this.deps.db.persistent;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private owner(): string {
    const o = this.deps.owner();
    if (!o) throw new DraftUnavailableError();
    return o;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  /** Écrit, ou supprime si plus rien à faire. */
  private async write(d: GradeDraft): Promise<GradeDraft | undefined> {
    if (isEmpty(d)) {
      await this.store.delete(d.key);
      return undefined;
    }
    await this.store.put(d);
    return d;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Lecture
  // -------------------------------------------------------------------------------------------------------------

  list(): Promise<GradeDraft[]> {
    return this.serial(async () => {
      const owner = this.deps.owner();
      if (!owner) return [];
      return (await this.store.getAll()).filter((d) => d.owner === owner).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  get(assessmentId: string): Promise<GradeDraft | undefined> {
    return this.serial(async () => {
      return this.get0(assessmentId);
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Écriture locale
  // -------------------------------------------------------------------------------------------------------------

  private blank(assessmentId: string, label: string | null): GradeDraft {
    return { key: draftKey(this.owner(), assessmentId), owner: this.owner(), assessmentId, label, entries: {}, inflight: null, conflicts: {}, blocked: null, attempts: 0, lastAttemptAt: null, updatedAt: this.nowIso() };
  }

  private async load(assessmentId: string, label: string | null): Promise<GradeDraft> {
    const owner = this.owner();
    const existing = await this.store.get(draftKey(owner, assessmentId));
    if (existing && existing.owner === owner) return existing;
    // Nouvelle évaluation : respecte la limite du nombre d'évaluations en attente.
    const mine = (await this.store.getAll()).filter((d) => d.owner === owner);
    if (mine.length >= MAX_DRAFT_ASSESSMENTS) throw new DraftLimitError("assessments");
    return this.blank(assessmentId, label);
  }

  /**
   * Remplace l'ensemble des saisies en attente de l'évaluation par celles de la grille (« tout ce qui diffère du serveur »).
   * Les lignes en conflit sont IGNORÉES : elles n'repartent qu'après le choix de l'utilisateur. Le lot en vol est conservé tel quel.
   */
  replaceEntries(assessmentId: string, label: string | null, entries: ReadonlyArray<Omit<DraftEntry, "editedAt"> & { editedAt?: string }>): Promise<GradeDraft | undefined> {
    return this.serial(async () => {
      if (entries.length === 0) {
        const owner = this.owner();
        const existing = await this.store.get(draftKey(owner, assessmentId));
        if (!existing || existing.owner !== owner) return undefined;
        return this.write({ ...existing, entries: {}, updatedAt: this.nowIso() });
      }
      const draft = await this.load(assessmentId, label);
      const now = this.nowIso();
      const next: Record<string, DraftEntry> = {};
      for (const e of entries) {
        if (e.enrollmentId in draft.conflicts) continue;
        const previous = draft.entries[e.enrollmentId];
        // L'instant de saisie ne change pas tant que la valeur ne change pas.
        const keepTime = previous && sameValue(previous, e) && previous.baseVersion === e.baseVersion;
        next[e.enrollmentId] = { ...e, editedAt: keepTime ? previous.editedAt : (e.editedAt ?? now) };
      }
      if (Object.keys(next).length > MAX_ENTRIES_PER_DRAFT) throw new DraftLimitError("entries");
      // Une nouvelle saisie lève un blocage « erreur » (l'utilisateur a agi) ; un verrouillage reste (l'évaluation est figée).
      const blocked = draft.blocked?.kind === "locked" ? draft.blocked : null;
      return this.write({ ...draft, label: label ?? draft.label, entries: next, blocked, updatedAt: now });
    });
  }

  /** Remet un brouillon en échec dans la file d'envoi (bouton « Réessayer »). */
  retry(assessmentId: string): Promise<void> {
    return this.serial(async () => {
      const d = await this.get0(assessmentId);
      if (!d || d.blocked?.kind === "locked") return;
      await this.write({ ...d, blocked: null, updatedAt: this.nowIso() });
    });
  }

  /** Abandonne le brouillon (choix de l'utilisateur, ou verrouillage définitif). */
  discard(assessmentId: string): Promise<void> {
    return this.serial(async () => {
      const d = await this.get0(assessmentId);
      if (d) await this.store.delete(d.key);
    });
  }

  /** Lecture sans passer par la chaîne (déjà dans la chaîne). */
  private async get0(assessmentId: string): Promise<GradeDraft | undefined> {
    const owner = this.deps.owner();
    if (!owner) return undefined;
    const d = await this.store.get(draftKey(owner, assessmentId));
    return d && d.owner === owner ? d : undefined;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Rapprochement avec la feuille lue du serveur (ouverture de l'écran)
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Compare les saisies locales à la feuille lue :
   *  - version identique à celle de la saisie -> la saisie est restituée dans la grille ;
   *  - valeur serveur déjà identique -> la saisie est abandonnée (rien à envoyer) ;
   *  - sinon -> CONFLIT (la grille garde la valeur du serveur, ma saisie est mise de côté).
   * Les lignes dont l'inscription a disparu de la feuille sont abandonnées et comptées.
   * Une évaluation qui n'est plus en brouillon bloque l'envoi (`locked`).
   */
  reconcile(assessmentId: string, sheet: { status: string; grades: ReadonlyArray<ServerGrade>; enrollmentIds: ReadonlyArray<string> }): Promise<ReconcileResult> {
    return this.serial(async () => {
      const stored = await this.get0(assessmentId);
      const empty: ReconcileResult = { restored: [], conflicts: [], dropped: 0, locked: false };
      if (!stored) return empty;
      // L'évaluation est de nouveau en brouillon (retournée pour correction) : un verrouillage passé est levé.
      const draft: GradeDraft = sheet.status === "DRAFT" && stored.blocked?.kind === "locked" ? { ...stored, blocked: null } : stored;
      const byEnrollment = new Map(sheet.grades.map((g) => [g.enrollmentId, g]));
      const known = new Set(sheet.enrollmentIds);
      const now = this.nowIso();
      const entries = { ...draft.entries };
      const conflicts = { ...draft.conflicts };
      const restored: DraftEntry[] = [];
      const newConflicts: DraftConflict[] = [];
      let dropped = 0;

      if (sheet.status !== "DRAFT") {
        const blocked = { kind: "locked" as const, code: "assess.grade_frozen" };
        await this.write({ ...draft, blocked, updatedAt: now });
        return { ...empty, locked: true };
      }

      const inflightIds = new Set(draft.inflight?.entries.map((e) => e.enrollmentId) ?? []);
      for (const e of Object.values(draft.entries)) {
        if (!known.has(e.enrollmentId) && !byEnrollment.has(e.enrollmentId)) {
          delete entries[e.enrollmentId];
          dropped += 1;
          continue;
        }
        const server = byEnrollment.get(e.enrollmentId);
        const serverVersion = server?.rowVersion ?? null;
        if (serverVersion === e.baseVersion) {
          restored.push(e);
        } else if (server && sameValue(server, e)) {
          delete entries[e.enrollmentId];
        } else if (inflightIds.has(e.enrollmentId) && server && draft.inflight?.entries.some((s) => s.enrollmentId === e.enrollmentId && sameValue(s, server))) {
          // Le lot en vol a bien été appliqué (réponse perdue) : la ligne a avancé de version ; on garde la saisie plus récente.
          restored.push({ ...e, baseVersion: serverVersion });
          entries[e.enrollmentId] = { ...e, baseVersion: serverVersion };
        } else {
          const c: DraftConflict = {
            enrollmentId: e.enrollmentId,
            mine: { entryStatus: e.entryStatus, score: e.score, comment: e.comment, editedAt: e.editedAt },
            server: server ? { entryStatus: server.entryStatus, score: server.score, comment: server.comment, rowVersion: server.rowVersion } : null,
            detectedAt: now,
          };
          conflicts[e.enrollmentId] = c;
          newConflicts.push(c);
          delete entries[e.enrollmentId];
        }
      }
      // Conflits déjà connus : on rafraîchit la valeur du serveur (elle a pu changer encore).
      for (const c of Object.values(conflicts)) {
        const server = byEnrollment.get(c.enrollmentId);
        if (server) conflicts[c.enrollmentId] = { ...c, server: { entryStatus: server.entryStatus, score: server.score, comment: server.comment, rowVersion: server.rowVersion } };
      }
      await this.write({ ...draft, entries, conflicts, updatedAt: now });
      return { restored, conflicts: Object.values(conflicts), dropped, locked: false };
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Envoi
  // -------------------------------------------------------------------------------------------------------------

  /**
   * Lot à envoyer : le lot en vol s'il existe (rejeu à l'identique), sinon un nouveau tiré des saisies
   * (au plus `MAX_ENTRIES_PER_BATCH` lignes, les plus anciennes d'abord). `null` : rien à envoyer.
   */
  prepareBatch(assessmentId: string): Promise<{ batch: InflightBatch; draft: GradeDraft } | null> {
    return this.serial(async () => {
      const d = await this.get0(assessmentId);
      if (!d || d.blocked) return null;
      if (d.inflight) {
        const next = { ...d, attempts: d.attempts + 1, lastAttemptAt: this.nowIso() };
        await this.store.put(next);
        return { batch: d.inflight, draft: next };
      }
      const chosen = Object.values(d.entries)
        .sort((a, b) => a.editedAt.localeCompare(b.editedAt) || a.enrollmentId.localeCompare(b.enrollmentId))
        .slice(0, MAX_ENTRIES_PER_BATCH);
      if (chosen.length === 0) return null;
      const sentAt = this.nowIso();
      const batch: InflightBatch = {
        batchKey: this.uuid(),
        sentAt,
        entries: chosen.map((e) => ({ enrollmentId: e.enrollmentId, entryStatus: e.entryStatus, score: e.score, comment: e.comment, baseVersion: e.baseVersion })),
      };
      const next = { ...d, inflight: batch, attempts: d.attempts + 1, lastAttemptAt: sentAt, updatedAt: sentAt };
      await this.store.put(next);
      return { batch, draft: next };
    });
  }

  /**
   * Le serveur a accepté le lot `batchKey` : les saisies identiques à ce qui a été envoyé sont retirées ; une saisie
   * plus récente sur la même ligne reste, avec la nouvelle version de ligne. Si la ligne a, entre-temps, été modifiée par
   * quelqu'un d'autre (rejeu : valeur courante différente de l'envoi), la saisie plus récente devient un CONFLIT.
   */
  applySuccess(assessmentId: string, batchKey: string, grades: ReadonlyArray<ServerGrade>): Promise<{ conflicts: DraftConflict[] }> {
    return this.serial(async () => {
      const d = await this.get0(assessmentId);
      if (!d) return { conflicts: [] };
      const sent = d.inflight && d.inflight.batchKey === batchKey ? d.inflight.entries : [];
      const byEnrollment = new Map(grades.map((g) => [g.enrollmentId, g]));
      const entries = { ...d.entries };
      const conflicts = { ...d.conflicts };
      const raised: DraftConflict[] = [];
      const now = this.nowIso();
      for (const s of sent) {
        const g = byEnrollment.get(s.enrollmentId);
        const current = entries[s.enrollmentId];
        if (!current) continue;
        if (sameValue(current, s)) {
          delete entries[s.enrollmentId];
        } else if (g) {
          if (sameValue(g, s)) {
            entries[s.enrollmentId] = { ...current, baseVersion: g.rowVersion };
          } else {
            const c: DraftConflict = {
              enrollmentId: s.enrollmentId,
              mine: { entryStatus: current.entryStatus, score: current.score, comment: current.comment, editedAt: current.editedAt },
              server: { entryStatus: g.entryStatus, score: g.score, comment: g.comment, rowVersion: g.rowVersion },
              detectedAt: now,
            };
            conflicts[s.enrollmentId] = c;
            raised.push(c);
            delete entries[s.enrollmentId];
          }
        }
      }
      await this.write({ ...d, entries, conflicts, inflight: d.inflight && d.inflight.batchKey === batchKey ? null : d.inflight, blocked: null, updatedAt: now });
      return { conflicts: raised };
    });
  }

  /**
   * 409 `assess.stale_grade` : le lot entier est refusé (tout ou rien). Les lignes périmées (`staleIds`) deviennent des conflits
   * (avec la valeur du serveur si on a pu la relire) — sauf si le serveur a déjà la même valeur (rien à arbitrer : abandonnée).
   * Les autres lignes restent à envoyer dans un nouveau lot (nouvelle clé).
   */
  applyStale(assessmentId: string, batchKey: string, staleIds: ReadonlyArray<string>, serverGrades: ReadonlyArray<ServerGrade> | null): Promise<{ conflicts: DraftConflict[]; alreadyEqual: number }> {
    return this.serial(async () => {
      const d = await this.get0(assessmentId);
      if (!d) return { conflicts: [], alreadyEqual: 0 };
      const byEnrollment = new Map((serverGrades ?? []).map((g) => [g.enrollmentId, g]));
      const entries = { ...d.entries };
      const conflicts = { ...d.conflicts };
      const raised: DraftConflict[] = [];
      let alreadyEqual = 0;
      const now = this.nowIso();
      // Sans lecture du serveur, on considère périmées toutes les lignes annoncées par l'API.
      for (const id of staleIds) {
        const e = entries[id];
        if (!e) continue;
        const g = byEnrollment.get(id);
        if (g && sameValue(g, e)) {
          delete entries[id];
          alreadyEqual += 1;
          continue;
        }
        const c: DraftConflict = {
          enrollmentId: id,
          mine: { entryStatus: e.entryStatus, score: e.score, comment: e.comment, editedAt: e.editedAt },
          server: g ? { entryStatus: g.entryStatus, score: g.score, comment: g.comment, rowVersion: g.rowVersion } : null,
          detectedAt: now,
        };
        conflicts[id] = c;
        raised.push(c);
        delete entries[id];
      }
      await this.write({ ...d, entries, conflicts, inflight: d.inflight && d.inflight.batchKey === batchKey ? null : d.inflight, updatedAt: now });
      return { conflicts: raised, alreadyEqual };
    });
  }

  /** Complète la valeur du serveur de conflits détectés sans pouvoir la lire (retour du réseau). */
  fillServerValues(assessmentId: string, grades: ReadonlyArray<ServerGrade>): Promise<DraftConflict[]> {
    return this.serial(async () => {
      const d = await this.get0(assessmentId);
      if (!d) return [];
      const byEnrollment = new Map(grades.map((g) => [g.enrollmentId, g]));
      const conflicts = { ...d.conflicts };
      for (const c of Object.values(conflicts)) {
        const g = byEnrollment.get(c.enrollmentId);
        if (g) conflicts[c.enrollmentId] = { ...c, server: { entryStatus: g.entryStatus, score: g.score, comment: g.comment, rowVersion: g.rowVersion } };
      }
      await this.write({ ...d, conflicts });
      return Object.values(conflicts);
    });
  }

  /** Refus définitif du lot (évaluation figée, période verrouillée, refus de validation…) : le brouillon est bloqué. */
  block(assessmentId: string, batchKey: string | null, kind: BlockedKind, code: string): Promise<void> {
    return this.serial(async () => {
      const d = await this.get0(assessmentId);
      if (!d) return;
      const inflight = d.inflight && (batchKey === null || d.inflight.batchKey === batchKey) ? null : d.inflight;
      await this.write({ ...d, inflight, blocked: { kind, code }, updatedAt: this.nowIso() });
    });
  }

  /** Clé d'idempotence réutilisée pour un autre contenu (cas anormal) : le lot en vol est abandonné, un nouveau sera composé. */
  dropInflight(assessmentId: string, batchKey: string): Promise<void> {
    return this.serial(async () => {
      const d = await this.get0(assessmentId);
      if (!d || !d.inflight || d.inflight.batchKey !== batchKey) return;
      await this.write({ ...d, inflight: null });
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Résolution d'un conflit
  // -------------------------------------------------------------------------------------------------------------

  /**
   * `mine` : ma saisie repart, basée sur la version COURANTE du serveur (choix explicite : c'est ici que l'utilisateur
   * accepte d'écraser). `server` : ma saisie est abandonnée. Sans valeur serveur connue, `mine` est refusé (`null`).
   */
  resolveConflict(assessmentId: string, enrollmentId: string, choice: "mine" | "server"): Promise<{ entry: DraftEntry | null; serverRowVersion: number | null } | null> {
    return this.serial(async () => {
      const d = await this.get0(assessmentId);
      const c = d?.conflicts[enrollmentId];
      if (!d || !c) return null;
      const conflicts = { ...d.conflicts };
      delete conflicts[enrollmentId];
      const entries = { ...d.entries };
      let entry: DraftEntry | null = null;
      if (choice === "mine") {
        if (!c.server) return null;
        entry = { enrollmentId, entryStatus: c.mine.entryStatus, score: c.mine.score, comment: c.mine.comment, baseVersion: c.server.rowVersion, editedAt: this.nowIso() };
        entries[enrollmentId] = entry;
      }
      await this.write({ ...d, entries, conflicts, updatedAt: this.nowIso() });
      return { entry, serverRowVersion: c.server?.rowVersion ?? null };
    });
  }

  /** Efface les brouillons du propriétaire courant, ou tous (`all`). `keepUnsynced` : conserve ce qui reste à envoyer ou à arbitrer. */
  purge(options: { all?: boolean; keepUnsynced?: boolean } = {}): Promise<number> {
    return this.serial(async () => {
      const owner = this.deps.owner();
      let n = 0;
      for (const d of await this.store.getAll()) {
        if (!options.all && d.owner !== owner) continue;
        if (options.keepUnsynced && !isEmpty({ ...d, blocked: null })) continue;
        await this.store.delete(d.key);
        n += 1;
      }
      return n;
    });
  }
}

export interface ReconcileResult {
  /** Saisies à restituer dans la grille. */
  restored: DraftEntry[];
  /** Tous les conflits en cours de l'évaluation (nouveaux et anciens). */
  conflicts: DraftConflict[];
  /** Saisies abandonnées car l'inscription n'est plus dans la feuille. */
  dropped: number;
  /** L'évaluation n'est plus en brouillon : l'envoi est bloqué. */
  locked: boolean;
}
