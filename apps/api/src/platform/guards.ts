/**
 * Adaptateurs de garde entre `ModuleRuntime` et les options historiques des plugins de module
 * (`requirePermission?: (permission, options?) => (request, reply) => Promise<void> | void`).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ModuleRuntime } from "./runtime";

export type PermissionGuardFactory = (
  permission: string,
  options?: { scope?: unknown },
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** `runtime.requirePermission` (préHandler Fastify) sous la forme `(permission, options?) => (request, reply) => Promise<void>`. */
export function permissionGuardFactory(runtime: Pick<ModuleRuntime, "requirePermission">): PermissionGuardFactory {
  return (permission, options) => {
    const guard = runtime.requirePermission(permission, options);
    return async (request, reply) => {
      await guard.call(request.server, request, reply);
    };
  };
}

/** Garde `requireFeature` du runtime sous la même forme. */
export function featureGuardFactory(runtime: Pick<ModuleRuntime, "entitlements">) {
  return (featureKey: string) => {
    const guard = runtime.entitlements.requireFeature(featureKey);
    return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => guard.call(request.server, request, reply);
  };
}
