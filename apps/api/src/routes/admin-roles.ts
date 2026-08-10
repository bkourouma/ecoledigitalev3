import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import {
  ADMIN_MENU_CATALOG,
  AdminMenuCatalogResponseSchema,
  AdminMyMenusResponseSchema,
  AdminRoleCreateBodySchema,
  AdminRoleMenusPutBodySchema,
  AdminRoleSchema,
  AdminRoleUpdateBodySchema,
  AdminRolesListResponseSchema,
  AdminUserAdminRolePatchBodySchema,
  AdminUserCreateBodySchema,
  AdminUsersListResponseSchema,
  AdminManagedUserSchema,
} from "@ecoledigitale/contracts";
import { requireOwnerOrAdmin } from "../middlewares/requireOwner";
import {
  createAdminRole,
  createManagedUser,
  deleteAdminRole,
  getMyAllowedMenus,
  isAdminRolesFailure,
  listAdminRoles,
  listManagedUsers,
  setUserAdminRole,
  updateAdminRole,
  type AdminRolesFailure,
} from "../services/admin-roles.service";

const uuid = z.string().uuid();

function sendFailure(reply: FastifyReply, failure: AdminRolesFailure) {
  return reply.status(failure.status).send({
    success: false,
    error:
      failure.status === 409 ? "Conflict" : failure.status === 404 ? "Not Found" : "Bad Request",
    message: failure.message,
  });
}

function sendBadRequest(reply: FastifyReply, message: unknown) {
  return reply.status(400).send({ success: false, error: "Bad Request", message });
}

/**
 * Gestion des rôles administratifs personnalisés et des utilisateurs associés.
 * Monté sous `/api/v1/admin/access`.
 */
export async function adminRolesRoutes(fastify: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Catalogue des menus administrables (référentiel côté code).
  // -------------------------------------------------------------------------
  fastify.get("/menus/catalog", { preHandler: requireOwnerOrAdmin }, async (_request, reply) => {
    reply.send(AdminMenuCatalogResponseSchema.parse({ sections: ADMIN_MENU_CATALOG }));
  });

  // -------------------------------------------------------------------------
  // Menus autorisés pour l'utilisateur connecté (utilisé par le sidebar).
  // Accessible à tout utilisateur authentifié : la réponse ne concerne que lui.
  // -------------------------------------------------------------------------
  fastify.get("/me/menus", async (request, reply) => {
    const tenantId = request.tenantId;
    const user = (request as { user?: { id: string; roles?: string[] } }).user;
    if (!tenantId || !user?.id) {
      return reply.send(
        AdminMyMenusResponseSchema.parse({ allowAll: true, menuKeys: [], adminRoleName: null })
      );
    }
    const result = await getMyAllowedMenus(
      fastify.pg as Pool,
      tenantId,
      user.id,
      user.roles ?? [],
      request.log
    );
    reply.send(AdminMyMenusResponseSchema.parse(result));
  });

  // -------------------------------------------------------------------------
  // Rôles
  // -------------------------------------------------------------------------
  fastify.get("/roles", { preHandler: requireOwnerOrAdmin }, async (request, reply) => {
    const roles = await listAdminRoles(fastify.pg as Pool, request.tenantId!, request.log);
    reply.send(AdminRolesListResponseSchema.parse({ roles }));
  });

  fastify.post("/roles", { preHandler: requireOwnerOrAdmin }, async (request, reply) => {
    const parsed = AdminRoleCreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendBadRequest(reply, parsed.error.flatten().fieldErrors);
    }

    const result = await createAdminRole(
      fastify.pg as Pool,
      request.tenantId!,
      {
        name: parsed.data.name,
        menuKeys: parsed.data.menuKeys ?? [],
      },
      request.log
    );
    if (isAdminRolesFailure(result)) return sendFailure(reply, result);
    reply.status(201).send(AdminRoleSchema.parse(result.value));
  });

  fastify.patch<{ Params: { id: string } }>(
    "/roles/:id",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      if (!uuid.safeParse(request.params.id).success) {
        return sendBadRequest(reply, "Identifiant de rôle invalide");
      }
      const parsed = AdminRoleUpdateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendBadRequest(reply, parsed.error.flatten().fieldErrors);
      }

      const result = await updateAdminRole(
        fastify.pg as Pool,
        request.tenantId!,
        request.params.id,
        {
          name: parsed.data.name,
          isActive: parsed.data.isActive,
          menuKeys: parsed.data.menuKeys,
        },
        request.log
      );
      if (isAdminRolesFailure(result)) return sendFailure(reply, result);
      reply.send(AdminRoleSchema.parse(result.value));
    }
  );

  fastify.put<{ Params: { id: string } }>(
    "/roles/:id/menus",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      if (!uuid.safeParse(request.params.id).success) {
        return sendBadRequest(reply, "Identifiant de rôle invalide");
      }
      const parsed = AdminRoleMenusPutBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendBadRequest(reply, parsed.error.flatten().fieldErrors);
      }

      const result = await updateAdminRole(
        fastify.pg as Pool,
        request.tenantId!,
        request.params.id,
        { menuKeys: parsed.data.menuKeys ?? [] },
        request.log
      );
      if (isAdminRolesFailure(result)) return sendFailure(reply, result);
      reply.send(AdminRoleSchema.parse(result.value));
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/roles/:id",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      if (!uuid.safeParse(request.params.id).success) {
        return sendBadRequest(reply, "Identifiant de rôle invalide");
      }
      const result = await deleteAdminRole(
        fastify.pg as Pool,
        request.tenantId!,
        request.params.id,
        request.log
      );
      if (isAdminRolesFailure(result)) return sendFailure(reply, result);
      reply.send({ success: true, id: result.value.id });
    }
  );

  // -------------------------------------------------------------------------
  // Utilisateurs
  // -------------------------------------------------------------------------
  fastify.get("/users", { preHandler: requireOwnerOrAdmin }, async (request, reply) => {
    const users = await listManagedUsers(fastify.pg as Pool, request.tenantId!, request.log);
    reply.send(AdminUsersListResponseSchema.parse({ users }));
  });

  fastify.post("/users", { preHandler: requireOwnerOrAdmin }, async (request, reply) => {
    const parsed = AdminUserCreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendBadRequest(reply, parsed.error.flatten().fieldErrors);
    }

    const result = await createManagedUser(
      fastify.pg as Pool,
      request.tenantId!,
      {
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email,
        password: parsed.data.password,
        adminRoleId: parsed.data.adminRoleId,
      },
      request.log
    );
    if (isAdminRolesFailure(result)) return sendFailure(reply, result);
    reply.status(201).send(AdminManagedUserSchema.parse(result.value));
  });

  fastify.patch<{ Params: { userId: string } }>(
    "/users/:userId/admin-role",
    { preHandler: requireOwnerOrAdmin },
    async (request, reply) => {
      if (!uuid.safeParse(request.params.userId).success) {
        return sendBadRequest(reply, "Identifiant utilisateur invalide");
      }
      const parsed = AdminUserAdminRolePatchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendBadRequest(reply, parsed.error.flatten().fieldErrors);
      }

      const result = await setUserAdminRole(
        fastify.pg as Pool,
        request.tenantId!,
        request.params.userId,
        parsed.data.adminRoleId ?? null,
        request.log
      );
      if (isAdminRolesFailure(result)) return sendFailure(reply, result);
      reply.send({ success: true, ...result.value });
    }
  );
}
