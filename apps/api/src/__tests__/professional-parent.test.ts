import type { FastifyReply, FastifyRequest } from "fastify";
import {
  requireParent,
  requireAdmin,
  requireStudent,
} from "../middlewares/professional-guards";

/**
 * Tests US5 — Accès parent en lecture seule (feature 028, FR-029/FR-030).
 * Le périmètre par enfant (`student_parents`) est vérifié en base et couvert
 * par le smoke test de quickstart.md (T053).
 */

function makeReply(): FastifyReply {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

function req(tenantId: string | undefined, roles: string[]): FastifyRequest {
  return { tenantId, user: { id: "u", roles } } as unknown as FastifyRequest;
}

describe("requireParent", () => {
  it("répond 400 si le contexte tenant est absent", async () => {
    const reply = makeReply();
    await requireParent(req(undefined, ["parent"]), reply);
    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it("répond 403 pour un rôle non parent", async () => {
    const reply = makeReply();
    await requireParent(req("t1", ["student"]), reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("laisse passer un parent", async () => {
    const reply = makeReply();
    await requireParent(req("t1", ["parent"]), reply);
    expect(reply.status).not.toHaveBeenCalled();
  });
});

describe("Cloisonnement des rôles du module professionnel", () => {
  it("un parent ne franchit pas la garde administrateur", async () => {
    const reply = makeReply();
    await requireAdmin(req("t1", ["parent"]), reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("un parent ne franchit pas la garde étudiant", async () => {
    const reply = makeReply();
    await requireStudent(req("t1", ["parent"]), reply);
    expect(reply.status).toHaveBeenCalledWith(403);
  });
});
