/**
 * Observabilité de la plateforme (ADR-009) : API publique.
 * Le cœur sans Fastify (`./core`) est aussi consommé par `apps/worker`.
 */
export * from "./core";
export * from "./observability";
export * from "./plugin";
export * from "./probes";
