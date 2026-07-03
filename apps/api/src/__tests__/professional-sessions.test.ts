import { CreateProfessionalUeSessionSchema } from "@ecoledigitale/contracts";
import {
  isValidUeSessionTransition,
  UE_SESSION_STATUS_TRANSITIONS,
} from "../services/professional-ue.service";

/**
 * Tests US1 — Sessions professionnelles (feature 028).
 * Tests unitaires (sans base) : validation dates/fenêtre + machine à états.
 * La création en base et l'isolation multi-tenant (RLS) sont couvertes par le
 * smoke test de quickstart.md (T053).
 */

const VALID_SESSION = {
  libelle: "Session Janvier 2026",
  date_debut: "2026-01-10",
  date_fin: "2026-03-10",
  inscription_ouverte_le: "2026-01-01T08:00:00.000Z",
  inscription_fermee_le: "2026-01-09T23:59:00.000Z",
  capacite_max: 30,
};

describe("CreateProfessionalUeSessionSchema", () => {
  it("accepte une session valide", () => {
    expect(CreateProfessionalUeSessionSchema.safeParse(VALID_SESSION).success).toBe(true);
  });

  it("rejette date_fin antérieure à date_debut", () => {
    expect(
      CreateProfessionalUeSessionSchema.safeParse({ ...VALID_SESSION, date_fin: "2026-01-01" }).success
    ).toBe(false);
  });

  it("rejette une fenêtre d'inscription incohérente", () => {
    expect(
      CreateProfessionalUeSessionSchema.safeParse({
        ...VALID_SESSION,
        inscription_ouverte_le: "2026-02-01T00:00:00.000Z",
        inscription_fermee_le: "2026-01-01T00:00:00.000Z",
      }).success
    ).toBe(false);
  });

  it("rejette une capacité <= 0", () => {
    expect(CreateProfessionalUeSessionSchema.safeParse({ ...VALID_SESSION, capacite_max: 0 }).success).toBe(false);
  });

  it("accepte une capacité nulle (illimitée)", () => {
    expect(CreateProfessionalUeSessionSchema.safeParse({ ...VALID_SESSION, capacite_max: null }).success).toBe(true);
  });
});

describe("isValidUeSessionTransition (machine à états)", () => {
  it("autorise brouillon → ouvert", () => {
    expect(isValidUeSessionTransition("brouillon", "ouvert")).toBe(true);
  });

  it("autorise ouvert → en_cours", () => {
    expect(isValidUeSessionTransition("ouvert", "en_cours")).toBe(true);
  });

  it("autorise en_cours → termine", () => {
    expect(isValidUeSessionTransition("en_cours", "termine")).toBe(true);
  });

  it("autorise l'annulation depuis ouvert", () => {
    expect(isValidUeSessionTransition("ouvert", "annule")).toBe(true);
  });

  it("refuse brouillon → termine (saut d'étape)", () => {
    expect(isValidUeSessionTransition("brouillon", "termine")).toBe(false);
  });

  it("refuse 'complet' comme cible manuelle (automatique via capacité)", () => {
    expect(isValidUeSessionTransition("ouvert", "complet")).toBe(false);
  });

  it("traite 'termine' et 'annule' comme des états terminaux", () => {
    expect(UE_SESSION_STATUS_TRANSITIONS.termine).toHaveLength(0);
    expect(UE_SESSION_STATUS_TRANSITIONS.annule).toHaveLength(0);
  });
});
