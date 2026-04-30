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
      tenantId: "e9f4c59f-0666-4dc7-a7d4-c63004000791",
      user: { id: "u", roles: ["admin", "teacher"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwner(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("répond 403 pour parent / student / formateur sans owner", async () => {
    for (const roles of [["parent"], ["student"], ["formateur"]]) {
      const request = {
        tenantId: "e9f4c59f-0666-4dc7-a7d4-c63004000791",
        user: { id: "u", roles },
      } as unknown as FastifyRequest;
      const reply = createReply();
      await requireOwner(request, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
    }
  });

  it("ne bloque pas si owner présent (réponse non envoyée)", async () => {
    const request = {
      tenantId: "e9f4c59f-0666-4dc7-a7d4-c63004000791",
      user: { id: "u", roles: ["owner"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwner(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});

describe("requireOwnerOrAdmin", () => {
  it("ne bloque pas si admin est prÃ©sent", async () => {
    const request = {
      tenantId: "e9f4c59f-0666-4dc7-a7d4-c63004000791",
      user: { id: "u", roles: ["admin"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwnerOrAdmin(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("ne bloque pas si super_admin est prÃ©sent", async () => {
    const request = {
      tenantId: "e9f4c59f-0666-4dc7-a7d4-c63004000791",
      user: { id: "u", roles: ["super_admin"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwnerOrAdmin(request, reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("rÃ©pond 403 pour teacher sans owner/admin", async () => {
    const request = {
      tenantId: "e9f4c59f-0666-4dc7-a7d4-c63004000791",
      user: { id: "u", roles: ["teacher"] },
    } as unknown as FastifyRequest;
    const reply = createReply();
    await requireOwnerOrAdmin(request, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });
});
