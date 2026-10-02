/**
 * Purge des données hors ligne à la DÉCONNEXION VOLONTAIRE.
 *
 *  - copie d'emploi du temps : effacée (cache jetable, tous propriétaires) ;
 *  - brouillons de notes DÉJÀ envoyés : il n'en reste pas (un brouillon est supprimé dès qu'il est envoyé) ;
 *  - brouillons de notes NON envoyés (en attente, en conflit, en échec) : CONSERVÉS par défaut — ce sont des notes saisies que la
 *    personne n'a pas pu transmettre, les supprimer en silence serait une perte de travail. Ils restent rattachés à leur
 *    propriétaire `tenant:utilisateur` : personne d'autre ne les voit ni ne les envoie ; ils reprennent à la prochaine
 *    connexion de la même identité. `discardUnsynced: true` les efface aussi (appareil partagé, bouton « tout effacer »).
 *
 * Une session qui EXPIRE (ou une session révoquée) ne purge rien : voir `IamSessionKeeper` — les brouillons doivent survivre.
 * La file d'appel (`attendance_calls`) a sa propre gestion et n'est pas touchée ici.
 */

import { openOfflineDb, type OfflineDb } from "./idb";

export interface PurgeReport {
  scheduleCleared: boolean;
  draftsRemoved: number;
  draftsKept: number;
}

export async function purgeOfflineData(options: { db?: OfflineDb; discardUnsynced?: boolean } = {}): Promise<PurgeReport> {
  const db = options.db ?? (await openOfflineDb());
  await db.store("schedule_cache").clear();
  const drafts = db.store<{ key: string; entries: object; inflight: unknown; conflicts: object }>("grade_drafts");
  let removed = 0;
  let kept = 0;
  for (const d of await drafts.getAll()) {
    const unsynced = Object.keys(d.entries).length > 0 || d.inflight !== null || Object.keys(d.conflicts).length > 0;
    if (unsynced && !options.discardUnsynced) {
      kept += 1;
    } else {
      await drafts.delete(d.key);
      removed += 1;
    }
  }
  return { scheduleCleared: true, draftsRemoved: removed, draftsKept: kept };
}

/** Purge sans jamais bloquer ni faire échouer la déconnexion (délai maximal, erreurs avalées). */
export async function purgeOfflineDataBestEffort(timeoutMs = 1500): Promise<void> {
  try {
    await Promise.race([purgeOfflineData(), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  } catch {
    /* la déconnexion continue */
  }
}
