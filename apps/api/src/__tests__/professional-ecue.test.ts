import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CreateProfessionalEcueSchema,
  UpdateProfessionalEcueSchema,
} from "@ecoledigitale/contracts";
import { requireAdmin } from "../middlewares/professional-guards";

/**
 * Tests — ECUE (feature 030). Tests unitaires (sans base) : validation des
 * contrats + garde de rôle. L'ECUE est pédagogique : pas de prix/UV/filière.
 */

const VALID_ECUE = {
  code: "ECUE-A",
  libelle: "Comptabilité analytique",
};

describe("CreateProfessionalEcueSchema", () => {
  it("accepte une ECUE valide (code + libellé)", () => {
    expect(CreateProfessionalEcueSchema.safeParse(VALID_ECUE).success).toBe(true);
  });

  it("accepte un bilan_type_id et une description", () => {
    expect(
      CreateProfessionalEcueSchema.safeParse({
        ...VALID_ECUE,
        bilan_type_id: "11111111-1111-1111-1111-111111111111",
        description: "Module pédagogique",
      }).success
    ).toBe(true);
  });

  it("rejette un code vide", () => {
    expect(CreateProfessionalEcueSchema.safeParse({ ...VALID_ECUE, code: "" }).success).toBe(false);
  });

  it("rejette un libellé absent", () => {
    expect(CreateProfessionalEcueSchema.safeParse({ code: "ECUE-X" }).success).toBe(false);
  });

  it("n'accepte ni prix ni UV (champs pédagogiques uniquement)", () => {
    const r = CreateProfessionalEcueSchema.safeParse(VALID_ECUE);
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).prix).toBeUndefined();
      expect((r.data as Record<string, unknown>).nb_uv).toBeUndefined();
    }
  });
});

describe("UpdateProfessionalEcueSchema", () => {
  it("autorise une mise à jour partielle", () => {
    expect(UpdateProfessionalEcueSchema.safeParse({ libelle: "Nouveau libellé" }).success).toBe(true);
  });

  it("accepte la modification du statut", () => {
    expect(UpdateProfessionalEcueSchema.safeParse({ statut: "inactif" }).success).toBe(true);
  });
});

describe("requireAdmin (garde de rôle)", () => {
  function makeReply(): FastifyReply {
    return {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as FastifyReply;
  }

  it("répond 400 si le contexte tenant est absent", async () => {
    const reply = makeReply();
    await requireAdmin(
      { tenantId: undefined, user: { id: "u", roles: ["admin"] } } as unknown as FastifyRequest,
      reply
    );
    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it("répond 403 pour un rôle non administrateur", async () => {
    const reply = makeReply();
    await requireAdmin(
      { tenantId: "t1", user: { id: "u", roles: ["student"] } } as unknown as FastifyRequest,
      reply
    );
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it("laisse passer un administrateur", async () => {
    const reply = makeReply();
    await requireAdmin(
      { tenantId: "t1", user: { id: "u", roles: ["admin"] } } as unknown as FastifyRequest,
      reply
    );
    expect(reply.status).not.toHaveBeenCalled();
  });
});
