import { describe, it, expect, vi } from "@jest/globals";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireOwner, requireOwnerOrAdmin } from "../middlewares/requireOwner";

function createReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe("requireOwner", () => {
  it("répond 400 si tenantId absent", async () => {
    const request = { tenantId: undefined, user: { id: "u", roles: ["owner"] } } as FastifyRequest;
    const reply = createReply();
    await requireOwner(request, reply);
    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it("répond 403 si rôle owner absent", async () => {
    const request = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      user: { id: "u", roles: ["admin", "teacher"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwner(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("répond 403 pour parent / student / formateur sans owner", async () => {
    for (const roles of [["parent"], ["student"], ["formateur"]]) {
      const request = {
        tenantId: "00000000-0000-0000-0000-000000000001",
        user: { id: "u", roles },
      } as unknown as FastifyRequest;
      const reply = createReply();
      await requireOwner(request, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
    }
  });

  it("ne bloque pas si owner présent (réponse non envoyée)", async () => {
    const request = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      user: { id: "u", roles: ["owner"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwner(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  /*
     LE CAS QUI DONNAIT UN 403 INEXPLICABLE.

     `auth-middleware` remplit `roles: [activeRole]` — le seul rôle sous lequel
     la personne navigue. Un compte owner ET admin qui avait basculé en admin se
     voyait donc refuser TOUT l'espace propriétaire : le fondateur d'une école
     qui l'administre aussi ne pouvait plus voir ses propres statistiques.

     L'autorisation se fonde désormais sur `availableRoles` — ce que la personne
     EST — et non sur le rôle qu'elle a choisi d'afficher.
  */
  it("ne bloque pas un compte owner+admin dont le rôle actif est admin", async () => {
    const request = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      user: { id: "u", roles: ["admin"], availableRoles: ["owner", "admin"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwner(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  /* Le contrôle négatif : `availableRoles` autorise, il n'ouvre pas tout. */
  it("répond 403 quand availableRoles ne contient pas owner", async () => {
    const request = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      user: { id: "u", roles: ["admin"], availableRoles: ["admin", "teacher"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwner(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });
});

describe("requireOwnerOrAdmin", () => {
  it("ne bloque pas si admin est prÃ©sent", async () => {
    const request = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      user: { id: "u", roles: ["admin"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwnerOrAdmin(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("ne bloque pas si super_admin est prÃ©sent", async () => {
    const request = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      user: { id: "u", roles: ["super_admin"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwnerOrAdmin(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("rÃ©pond 403 pour teacher sans owner/admin", async () => {
    const request = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      user: { id: "u", roles: ["teacher"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwnerOrAdmin(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });
});
