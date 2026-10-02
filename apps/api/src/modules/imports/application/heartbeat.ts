/**
 * Battement de coeur d'un exécutant (validation ou import) : renouvelle le bail, publie la progression et lit la demande
 * d'annulation, HORS de la transaction de travail (connexion distincte, jamais imbriquée : le timer est créé avant toute
 * transaction, donc hors de son contexte asynchrone).
 *
 * Si le bail est perdu (un autre exécutant a repris l'import, ou l'import a été annulé / terminé), `lost` passe à `true` :
 * l'exécutant doit s'arrêter sans rien écrire de plus.
 */
import { createSystemContext } from "@ecoledigitale/kernel";
import type { ImportsDeps } from "./deps";
import { heartbeatJob } from "../infrastructure/jobs-repository";

export class LeaseLostError extends Error {
  constructor() {
    super("imports : bail perdu");
    this.name = "LeaseLostError";
  }
}

export interface HeartbeatState {
  /** Lignes traitées (exécution) ou validées (validation) : publié à chaque battement. */
  progress: number;
  cancelRequested: boolean;
  lost: boolean;
}

export interface Heartbeat {
  readonly state: HeartbeatState;
  /** Lève `LeaseLostError` si le bail est perdu (à appeler entre deux lignes). */
  assertHeld(): void;
  stop(): Promise<void>;
}

export function startHeartbeat(deps: ImportsDeps, tenantId: string, jobId: string, owner: string, kind: "validation" | "run"): Heartbeat {
  const state: HeartbeatState = { progress: 0, cancelRequested: false, lost: false };
  const sys = createSystemContext(tenantId, `imports:heartbeat:${jobId}`);
  let inFlight: Promise<void> = Promise.resolve();
  const beat = (): void => {
    inFlight = inFlight.then(async () => {
      if (state.lost) return;
      try {
        const r = await deps.db.run(sys, (tx) => heartbeatJob(tx, jobId, owner, deps.config.leaseSeconds, kind === "run" ? { processed: state.progress } : { validation: state.progress }));
        if (!r.held) state.lost = true;
        else if (r.cancelRequested) state.cancelRequested = true;
      } catch (e) {
        // Une panne passagère de la base ne doit pas tuer l'exécutant : le bail expirera seul si elle dure.
        deps.logger.warn({ jobId, err: e instanceof Error ? e.message : String(e) }, "imports : battement de coeur en échec");
      }
    });
  };
  const timer = setInterval(beat, deps.config.heartbeatMs);
  timer.unref?.();
  return {
    state,
    assertHeld() {
      if (state.lost) throw new LeaseLostError();
    },
    async stop() {
      clearInterval(timer);
      await inFlight;
    },
  };
}
