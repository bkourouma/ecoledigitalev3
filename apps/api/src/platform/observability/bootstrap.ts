/**
 * Amorçage de l'observabilité de l'API : À IMPORTER EN DEUXIÈME dans `src/index.ts` (après `config/bootstrap-env`, qui charge
 * `.env`, et AVANT Fastify, `pg` et les routes) : les instrumentations `pg` et HTTP sortant ne peuvent patcher que les
 * modules chargés après elles. Sans `OTEL_EXPORTER_OTLP_ENDPOINT`, aucun SDK n'est chargé et aucun appel réseau n'est fait.
 *
 * Une configuration invalide arrête le processus (code 78) avec la liste des variables en cause, jamais leurs valeurs.
 */
import { ObservabilityConfigError } from "./core/config";
import { createObservability, type Observability } from "./observability";

function bootstrap(): Observability {
  try {
    return createObservability("api");
  } catch (err) {
    console.error(err instanceof ObservabilityConfigError ? err.message : err);
    process.exit(78); // EX_CONFIG
  }
}

export const observability: Observability = bootstrap();
