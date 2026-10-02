/**
 * Matrice de la politique d'accès (spec 024 §4) : chaque règle R1..R7, chaque refus, sans base de données.
 */
import { describe, expect, it } from "vitest";
import { canUploadSomewhere, ownerLink, readableConfidentialities, resolveAccess, resolveCreate, tierAllows } from "../../domain/policy";
import type { Actor, ActorCaps, ActorLinks, CategoryFacts, DocumentFacts } from "../../domain/types";

const U = {
  me: "00000000-0000-7000-8000-000000000001",
  other: "00000000-0000-7000-8000-000000000002",
  student: "00000000-0000-7000-8000-0000000000a1",
  child: "00000000-0000-7000-8000-0000000000a2",
  stranger: "00000000-0000-7000-8000-0000000000a3",
  staff: "00000000-0000-7000-8000-0000000000b1",
  staff2: "00000000-0000-7000-8000-0000000000b2",
};

const actor = (caps: ActorCaps, links: Partial<ActorLinks> = {}, userId = U.me): Actor => ({
  userId,
  caps,
  links: { studentId: null, childStudentIds: [], staffId: null, ...links },
});

const category = (over: Partial<CategoryFacts> = {}): CategoryFacts => ({
  id: "00000000-0000-7000-8000-0000000000c1",
  kind: "STUDENT",
  confidentiality: "RESTRICTED",
  audienceOwner: true,
  audienceGuardians: true,
  ownerUpload: true,
  status: "ACTIVE",
  ...over,
});

const doc = (over: Partial<DocumentFacts> = {}): DocumentFacts => ({
  id: "00000000-0000-7000-8000-0000000000d1",
  status: "ACTIVE",
  visibility: "INHERIT",
  createdBy: U.other,
  ownerType: "STUDENT",
  ownerId: U.student,
  category: category(),
  shareLevel: null,
  grantLevel: null,
  ...over,
});

describe("niveaux de lecture", () => {
  it("chaque niveau inclut les précédents", () => {
    expect(tierAllows({ read: true }, "INTERNAL")).toBe(true);
    expect(tierAllows({ read: true }, "RESTRICTED")).toBe(false);
    expect(tierAllows({ readRestricted: true }, "INTERNAL")).toBe(true);
    expect(tierAllows({ readRestricted: true }, "RESTRICTED")).toBe(true);
    expect(tierAllows({ readRestricted: true }, "CONFIDENTIAL")).toBe(false);
    expect(tierAllows({ readConfidential: true }, "INTERNAL")).toBe(true);
    expect(tierAllows({ readConfidential: true }, "CONFIDENTIAL")).toBe(true);
    expect(tierAllows({}, "INTERNAL")).toBe(false);
    expect(readableConfidentialities({ readRestricted: true })).toEqual(["INTERNAL", "RESTRICTED"]);
  });
});

describe("R1 gestion", () => {
  it("voit tout, y compris archivé et PRIVATE, et écrit / partage / archive", () => {
    const a = resolveAccess(actor({ manage: true }), doc({ visibility: "PRIVATE", status: "ARCHIVED" }));
    expect(a).toMatchObject({ view: true, write: true, share: true, archive: true, history: true, via: ["MANAGER"] });
  });
});

describe("document archivé", () => {
  it("n'est visible que de la gestion (même du déposant et du titulaire d'un partage)", () => {
    const d = doc({ status: "ARCHIVED", createdBy: U.me, shareLevel: "WRITE" });
    expect(resolveAccess(actor({ upload: true, readRestricted: true }), d).view).toBe(false);
  });
});

describe("R5 niveau de la catégorie (héritage)", () => {
  it("enseignant (documents.read) : lit INTERNAL, jamais RESTRICTED ni CONFIDENTIAL", () => {
    const teacher = actor({ read: true });
    expect(resolveAccess(teacher, doc({ ownerType: "NONE", ownerId: null, category: category({ kind: "INSTITUTION", confidentiality: "INTERNAL" }) })).view).toBe(true);
    expect(resolveAccess(teacher, doc({ category: category({ confidentiality: "RESTRICTED" }) })).view).toBe(false);
    expect(resolveAccess(teacher, doc({ category: category({ confidentiality: "CONFIDENTIAL" }) })).view).toBe(false);
  });

  it("secrétariat (read.restricted) : lit RESTRICTED, pas CONFIDENTIAL", () => {
    const sec = actor({ read: true, readRestricted: true, upload: true });
    expect(resolveAccess(sec, doc()).view).toBe(true);
    expect(resolveAccess(sec, doc({ category: category({ confidentiality: "CONFIDENTIAL" }) })).view).toBe(false);
  });

  it("un document PRIVATE échappe au niveau ; un changement de niveau de la catégorie agit aussitôt", () => {
    const sec = actor({ readRestricted: true });
    expect(resolveAccess(sec, doc({ visibility: "PRIVATE" })).view).toBe(false);
    expect(resolveAccess(sec, doc({ visibility: "STAFF_ONLY" })).view).toBe(true);
    expect(resolveAccess(sec, doc({ category: category({ confidentiality: "CONFIDENTIAL" }) })).view).toBe(false);
    expect(resolveAccess(sec, doc({ category: category({ confidentiality: "INTERNAL" }) })).view).toBe(true);
  });

  it("écrire exige documents.upload en plus du niveau ; partager / archiver exigent leur permission", () => {
    expect(resolveAccess(actor({ readRestricted: true }), doc())).toMatchObject({ view: true, write: false, share: false, archive: false });
    expect(resolveAccess(actor({ readRestricted: true, upload: true }), doc())).toMatchObject({ write: true, share: false, archive: false });
    expect(resolveAccess(actor({ readRestricted: true, upload: true, share: true, archive: true }), doc())).toMatchObject({ write: true, share: true, archive: true });
  });
});

describe("R6 propriétaire (élève, personnel)", () => {
  it("l'élève lit ses pièces si la catégorie ouvre l'audience propriétaire, avec documents.self.read et sa fiche liée", () => {
    const pupil = actor({ selfRead: true }, { studentId: U.student });
    expect(resolveAccess(pupil, doc())).toMatchObject({ view: true, write: false, via: ["OWNER"] });
    expect(resolveAccess(pupil, doc({ category: category({ audienceOwner: false }) })).view).toBe(false);
    expect(resolveAccess(pupil, doc({ ownerId: U.stranger })).view).toBe(false);
    expect(resolveAccess(actor({ selfRead: true }), doc()).view).toBe(false); // compte sans fiche liée : échec fermé
    expect(resolveAccess(actor({}, { studentId: U.student }), doc()).view).toBe(false); // sans la permission
  });

  it("un membre du personnel lit son propre dossier (documents.own.read)", () => {
    const d = doc({ ownerType: "STAFF", ownerId: U.staff, category: category({ kind: "TEACHER", confidentiality: "CONFIDENTIAL", audienceOwner: true }) });
    expect(resolveAccess(actor({ ownRead: true }, { staffId: U.staff }), d)).toMatchObject({ view: true, via: ["OWNER"] });
    expect(resolveAccess(actor({ ownRead: true }, { staffId: U.staff2 }), d).view).toBe(false);
  });

  it("STAFF_ONLY et PRIVATE coupent l'audience propriétaire", () => {
    const pupil = actor({ selfRead: true }, { studentId: U.student });
    expect(resolveAccess(pupil, doc({ visibility: "STAFF_ONLY" })).view).toBe(false);
    expect(resolveAccess(pupil, doc({ visibility: "PRIVATE" })).view).toBe(false);
  });
});

describe("R7 parent = enfants liés", () => {
  const parent = actor({ childRead: true }, { childStudentIds: [U.child] });
  it("lit les pièces de son enfant lié selon l'audience tuteurs de la catégorie", () => {
    expect(resolveAccess(parent, doc({ ownerId: U.child })).via).toEqual(["GUARDIAN"]);
    expect(resolveAccess(parent, doc({ ownerId: U.child, category: category({ audienceGuardians: false }) })).view).toBe(false);
  });
  it("jamais un élève non lié ; jamais STAFF_ONLY / PRIVATE ; jamais un document d'établissement", () => {
    expect(resolveAccess(parent, doc({ ownerId: U.stranger })).view).toBe(false);
    expect(resolveAccess(parent, doc({ ownerId: U.child, visibility: "STAFF_ONLY" })).view).toBe(false);
    expect(resolveAccess(parent, doc({ ownerId: U.child, visibility: "PRIVATE" })).view).toBe(false);
    expect(resolveAccess(parent, doc({ ownerType: "NONE", ownerId: null })).view).toBe(false);
  });
  it("un parent sans permission documents.child.read ne voit rien, même avec un lien", () => {
    expect(resolveAccess(actor({}, { childStudentIds: [U.child] }), doc({ ownerId: U.child })).view).toBe(false);
  });
  it("le parent ne voit pas les documents du PERSONNEL ni d'un autre type de propriétaire", () => {
    expect(resolveAccess(parent, doc({ ownerType: "STAFF", ownerId: U.child })).view).toBe(false);
  });
});

describe("R2 déposant", () => {
  it("garde son dépôt tant qu'il a documents.upload ou un lien valide", () => {
    const mine = doc({ createdBy: U.me, visibility: "PRIVATE" });
    expect(resolveAccess(actor({ upload: true }), mine)).toMatchObject({ view: true, write: true, history: true });
    expect(resolveAccess(actor({}), mine).view).toBe(false);
  });
  it("le parent qui a déposé garde son dépôt tant que le lien est valide, et le perd avec le lien", () => {
    const d = doc({ createdBy: U.me, ownerId: U.child, visibility: "PRIVATE" });
    const withLink = actor({ childUpload: true }, { childStudentIds: [U.child] });
    expect(resolveAccess(withLink, d)).toMatchObject({ view: true, write: true });
    expect(resolveAccess(actor({ childUpload: true }), d).view).toBe(false);
  });
});

describe("R3 partage et R4 droit de catégorie", () => {
  it("un partage donne la lecture (READ) ou le dépôt de versions (WRITE) ; sans droit de niveau", () => {
    const stranger = actor({});
    expect(resolveAccess(stranger, doc({ shareLevel: "READ" }))).toMatchObject({ view: true, write: false, via: ["SHARE"] });
    expect(resolveAccess(stranger, doc({ shareLevel: "WRITE" }))).toMatchObject({ view: true, write: true });
    expect(resolveAccess(stranger, doc({ visibility: "PRIVATE", shareLevel: "READ" })).view).toBe(true);
  });
  it("un partage ne rend pas partageable sans documents.share", () => {
    expect(resolveAccess(actor({ share: true }), doc({ shareLevel: "WRITE" })).share).toBe(true);
    expect(resolveAccess(actor({}), doc({ shareLevel: "WRITE" })).share).toBe(false);
  });
  it("le droit de catégorie donne lecture / écriture sur tous les documents de la catégorie", () => {
    expect(resolveAccess(actor({}), doc({ grantLevel: "READ" }))).toMatchObject({ view: true, write: false, via: ["CATEGORY_GRANT"] });
    expect(resolveAccess(actor({}), doc({ grantLevel: "WRITE", visibility: "PRIVATE" }))).toMatchObject({ view: true, write: true });
  });
});

describe("création (resolveCreate)", () => {
  const cat = category({ confidentiality: "RESTRICTED" });
  const owner = { type: "STUDENT" as const, id: U.student };

  it("personnel : documents.upload + niveau de la catégorie", () => {
    expect(resolveCreate(actor({ upload: true, readRestricted: true }), cat, owner, null)).toEqual({ allowed: true, via: "LEVEL" });
    expect(resolveCreate(actor({ upload: true, read: true }), cat, owner, null).allowed).toBe(false); // enseignant : pas de dépôt en RESTRICTED
    expect(resolveCreate(actor({ readRestricted: true }), cat, owner, null).allowed).toBe(false); // lecture seule
  });

  it("propriétaire / parent : seulement si la catégorie autorise le dépôt, pour soi / ses enfants liés", () => {
    expect(resolveCreate(actor({ selfUpload: true }, { studentId: U.student }), cat, owner, null)).toEqual({ allowed: true, via: "OWNER" });
    expect(resolveCreate(actor({ selfUpload: true }, { studentId: U.student }), category({ ownerUpload: false }), owner, null).allowed).toBe(false);
    expect(resolveCreate(actor({ childUpload: true }, { childStudentIds: [U.child] }), cat, { type: "STUDENT", id: U.child }, null).allowed).toBe(true);
    expect(resolveCreate(actor({ childUpload: true }, { childStudentIds: [U.child] }), cat, { type: "STUDENT", id: U.stranger }, null).allowed).toBe(false);
    expect(resolveCreate(actor({ ownUpload: true }, { staffId: U.staff }), category({ kind: "TEACHER" }), { type: "STAFF", id: U.staff }, null).allowed).toBe(true);
    expect(resolveCreate(actor({ ownUpload: true }, { staffId: U.staff2 }), category({ kind: "TEACHER" }), { type: "STAFF", id: U.staff }, null).allowed).toBe(false);
  });

  it("droit de catégorie WRITE et gestion ouvrent le dépôt", () => {
    expect(resolveCreate(actor({}), cat, owner, "WRITE")).toEqual({ allowed: true, via: "CATEGORY_GRANT" });
    expect(resolveCreate(actor({}), cat, owner, "READ").allowed).toBe(false);
    expect(resolveCreate(actor({ manage: true }), cat, owner, null).via).toBe("MANAGER");
  });

  it("canUploadSomewhere : drapeau d'affichage cohérent avec les règles de dépôt", () => {
    expect(canUploadSomewhere(actor({ upload: true, readRestricted: true }), cat, null)).toBe(true);
    expect(canUploadSomewhere(actor({ upload: true }), cat, null)).toBe(false);
    expect(canUploadSomewhere(actor({ childUpload: true }, { childStudentIds: [U.child] }), cat, null)).toBe(true);
    expect(canUploadSomewhere(actor({ childUpload: true }), cat, null)).toBe(false);
    expect(canUploadSomewhere(actor({ manage: true }), category({ status: "ARCHIVED" }), null)).toBe(false);
  });
});

describe("ownerLink", () => {
  it("SELF / CHILD / OWN / null", () => {
    const a = actor({}, { studentId: U.student, childStudentIds: [U.child], staffId: U.staff });
    expect(ownerLink(a, "STUDENT", U.student)).toBe("SELF");
    expect(ownerLink(a, "STUDENT", U.child)).toBe("CHILD");
    expect(ownerLink(a, "STAFF", U.staff)).toBe("OWN");
    expect(ownerLink(a, "STAFF", U.student)).toBeNull();
    expect(ownerLink(a, "NONE", null)).toBeNull();
  });
});
