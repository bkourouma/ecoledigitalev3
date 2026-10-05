/**
 * CANDIDAT LIBRE (Q-E15) sur base réelle : inscription sans dossier élève, numéro interne sans trou PARTAGÉ avec les élèves, numéro officiel
 * importé, éligibilité par faits saisis (règle inchangée), pièce « vue sur place », minimisation des données personnelles (profil à part,
 * numéro de pièce masqué, aucun nom/contact dans les événements ni l'audit), documents compatibles, anonymisation, isolation A/B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createCandidate, getCandidateDetail, listCandidates, registerCandidate, setIdentifier, withdrawCandidate } from "../../application/candidates";
import { evaluateEligibility } from "../../application/eligibility";
import { anonymizeExternalCandidate, createExternalBatch, createExternalCandidate, getExternalProfile, updateExternalCandidate, type CreateExternalInput } from "../../application/external-candidates";
import { issueDocument } from "../../application/issued-documents";
import { actOnPiece, listPieces } from "../../application/pieces";
import { createCenter, createRoom } from "../../application/reference";
import { assignCandidate, setSessionCenters } from "../../application/assignments";
import { saveResults } from "../../application/results";
import { transitionSession } from "../../application/sessions";
import { describeIntegration } from "../support/db";
import { addPupils, openSession, registerPupil, seedPack, setupEnv, type Env } from "../support/env";

const person = (n: number, over: Partial<CreateExternalInput["profile"]> = {}, inGrade = true): CreateExternalInput => ({
  identity: { lastName: `LIBRE${n}`, firstName: `Prénom${n}`, birthDate: "2015-03-04", birthPlace: "Bouaké", sex: n % 2 === 0 ? "F" : "M" },
  profile: { contactPhone: `+22507000${String(n).padStart(4, "0")}`, idPieceKind: "NATIONAL_ID", idPieceNumber: `CNI-SECRET-${n}`, guardianName: "Tuteur Fictif", guardianRelation: "oncle", declaredInExamGrade: inGrade, declaredPriorAttempts: 0, ...over },
});

async function readyAndRegister(env: Env, ctx: RequestContext, sessionId: string, candidateId: string): Promise<string> {
  const deps = env.deps();
  const pieces = unwrap(await listPieces(deps, ctx, candidateId));
  for (const p of pieces.pieces.filter((x) => x.required)) {
    unwrap(await actOnPiece(deps, ctx, candidateId, p.requirementId, { action: "SIGHT", note: "Original présenté au secrétariat" }));
    unwrap(await actOnPiece(deps, ctx, candidateId, p.requirementId, { action: "ACCEPT" }));
  }
  unwrap(await evaluateEligibility(deps, ctx, candidateId, { mode: "EVALUATE" }));
  return unwrap(await registerCandidate(deps, ctx, candidateId)).candidateNumber as string;
}

describeIntegration("examinations : candidat libre (Q-E15)", () => {
  let env: Env;
  let sessionId: string;
  let mockId: string;

  beforeAll(async () => {
    env = await setupEnv();
    await seedPack(env);
    await seedPack(env, env.ctxB());
    sessionId = (await openSession(env, "CEPE-LIBRE", { startsOn: "2027-06-10" })).id;
    mockId = (await openSession(env, "CEPE-BLANC", { kind: "MOCK" })).id;
  });
  afterAll(async () => {
    await env?.drop();
  });

  it("inscrit un libre SANS dossier élève : identité figée, numéro interne du compteur PARTAGÉ avec les élèves, sans trou", async () => {
    const { pupils } = addPupils(env, 2);
    const first = await registerPupil(env, env.ctxA(), sessionId, pupils[0]!);
    expect(first.number).toBe("CEPE2027-00001");
    const dto = unwrap(await createExternalCandidate(env.deps(), env.ctxA(), sessionId, person(1)));
    expect(dto).toMatchObject({ candidateKind: "EXTERNAL", studentId: null, enrollmentId: null, registrationStatus: "DRAFT", lastName: "LIBRE1", anonymized: false });
    const number = await readyAndRegister(env, env.ctxA(), sessionId, dto.id);
    expect(number).toBe("CEPE2027-00002");
    const second = await registerPupil(env, env.ctxA(), sessionId, pupils[1]!);
    expect(second.number).toBe("CEPE2027-00003");
    const free2 = unwrap(await createExternalCandidate(env.deps(), env.ctxA(), sessionId, person(2)));
    expect(await readyAndRegister(env, env.ctxA(), sessionId, free2.id)).toBe("CEPE2027-00004");
    const rows = await env.db.admin.query("SELECT candidate_number FROM examinations.candidates WHERE session_id = $1 ORDER BY candidate_seq", [sessionId]);
    expect(rows.rows.map((r) => r.candidate_number)).toEqual(["CEPE2027-00001", "CEPE2027-00002", "CEPE2027-00003", "CEPE2027-00004"]);
    const detail = unwrap(await getCandidateDetail(env.deps(), env.ctxA(), dto.id));
    expect(detail.candidate).toMatchObject({ registrationStatus: "REGISTERED", displayName: "LIBRE1 Prénom1" });
    expect(detail.pieces[0]).toMatchObject({ status: "ACCEPTED", presentationKind: "SIGHTED", documentRef: null });
  });

  it("numéro officiel importé : identifiant OFFICIAL_NUMBER unique dans la session, comme pour un élève", async () => {
    const list = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    const libres = list.items.filter((c) => c.candidateKind === "EXTERNAL");
    expect(libres).toHaveLength(2);
    unwrap(await setIdentifier(env.deps(), env.ctxA(), libres[0]!.id, { kind: "OFFICIAL_NUMBER", value: "OFF-0001" }, "IMPORT"));
    const dup = await setIdentifier(env.deps(), env.ctxA(), libres[1]!.id, { kind: "OFFICIAL_NUMBER", value: "OFF-0001" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("examinations.identifier_taken");
    const again = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    expect(again.items.find((c) => c.id === libres[0]!.id)?.officialNumber).toBe("OFF-0001");
  });

  it("refuse les doublons, l'examen blanc, l'absence de moyen de contact et la pièce incomplète", async () => {
    const dup = await createExternalCandidate(env.deps(), env.ctxA(), sessionId, person(1, { idPieceKind: null, idPieceNumber: null }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("examinations.candidate_duplicate");
    const samePiece = await createExternalCandidate(env.deps(), env.ctxA(), sessionId, { ...person(9), profile: { ...person(9).profile, idPieceNumber: "CNI-SECRET-1" } });
    expect(samePiece.ok).toBe(false);
    if (!samePiece.ok) expect(samePiece.error.code).toBe("examinations.candidate_duplicate");
    const mock = await createExternalCandidate(env.deps(), env.ctxA(), mockId, person(3));
    expect(mock.ok).toBe(false);
    if (!mock.ok) expect(mock.error.code).toBe("examinations.external_official_only");
    const noContact = await createExternalCandidate(env.deps(), env.ctxA(), sessionId, person(4, { contactPhone: null, guardianName: null }));
    expect(noContact.ok).toBe(false);
    if (!noContact.ok) expect(noContact.error.code).toBe("examinations.external_profile_incomplete");
    const halfPiece = await createExternalCandidate(env.deps(), env.ctxA(), sessionId, person(5, { idPieceNumber: null }));
    expect(halfPiece.ok).toBe(false);
  });

  it("éligibilité : faits SAISIS (classe d'examen déclarée) passés à la règle inchangée ; hors classe -> INELIGIBLE", async () => {
    const out = unwrap(await createExternalCandidate(env.deps(), env.ctxA(), sessionId, person(6, {}, false)));
    const evaluated = unwrap(await evaluateEligibility(env.deps(), env.ctxA(), out.id, { mode: "EVALUATE" }));
    expect(evaluated.candidate.eligibilityStatus).toBe("INELIGIBLE");
    expect(evaluated.check.reasons).toEqual(["NOT_IN_EXAM_GRADE"]);
    // la règle a reçu les faits déclarés et l'âge CALCULÉ (naissance 2015-03-04, session 2027-06-10 : 12 ans), aucun nom
    const call = env.rules.calls.filter((c) => c.ruleKey === "eligibilite").at(-1)!;
    expect(call.variables).toMatchObject({ en_classe_examen: false, age_annees: "12", nombre_tentatives: "0" });
    expect(JSON.stringify(call.variables)).not.toContain("LIBRE6");
    const refused = await registerCandidate(env.deps(), env.ctxA(), out.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("examinations.not_eligible");
    // correction de la déclaration (profil modifiable avant inscription) puis réévaluation
    unwrap(await updateExternalCandidate(env.deps(), env.ctxA(), out.id, { profile: person(6, {}, true).profile }));
    expect(unwrap(await evaluateEligibility(env.deps(), env.ctxA(), out.id, { mode: "EVALUATE" })).candidate.eligibilityStatus).toBe("NEEDS_REVIEW"); // pièce non encore vue
    expect(await readyAndRegister(env, env.ctxA(), sessionId, out.id)).toBe("CEPE2027-00005");
  });

  it("un élève ne peut pas être traité en libre (pièce SIGHT refusée), ni un libre déposer un document de la GED", async () => {
    const { pupils } = addPupils(env, 1);
    const student = unwrap(await createCandidate(env.deps(), env.ctxA(), sessionId, { studentId: pupils[0]!.studentId, enrollmentId: pupils[0]!.enrollmentId }));
    const req = unwrap(await listPieces(env.deps(), env.ctxA(), student.id)).pieces[0]!;
    const sighted = await actOnPiece(env.deps(), env.ctxA(), student.id, req.requirementId, { action: "SIGHT" });
    expect(sighted.ok).toBe(false);
    if (!sighted.ok) expect(sighted.error.code).toBe("examinations.piece_mode_mismatch");
    const free = unwrap(await createExternalCandidate(env.deps(), env.ctxA(), sessionId, person(7)));
    const sub = await actOnPiece(env.deps(), env.ctxA(), free.id, req.requirementId, { action: "SUBMIT", documentRef: "0192f0a4-7b1e-7c3a-8d2e-000000000009" });
    expect(sub.ok).toBe(false);
    if (!sub.ok) expect(sub.error.code).toBe("examinations.piece_mode_mismatch");
    // un libre ne se rattache pas à un élève au niveau de la base
    const bad = await env.db.admin.query("SELECT count(*)::int AS n FROM examinations.candidates WHERE (candidate_kind = 'EXTERNAL') <> (student_id IS NULL)");
    expect(bad.rows[0].n).toBe(0);
  });

  it("MINIMISATION : le profil est à part et masqué par défaut ; la lecture est auditée ; aucun nom/contact/pièce dans événements et audit", async () => {
    const list = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    const libre = list.items.find((c) => c.lastName === "LIBRE1")!;
    const masked = unwrap(await getExternalProfile(env.deps(), env.ctxA(), libre.id));
    expect(masked).toMatchObject({ contactPhone: "+225070000001", guardianName: "Tuteur Fictif", declaredInExamGrade: true });
    expect(masked.idPieceNumber).toBe("*********T-1");
    expect(masked.idPieceNumber).not.toContain("SECRET");
    const revealed = unwrap(await getExternalProfile(env.deps(), env.ctxA(), libre.id, { reveal: true }));
    expect(revealed.idPieceNumber).toBe("CNI-SECRET-1");
    const reads = env.audit.entries.filter((e) => e.entry.action === "examinations.external_profile.read");
    expect(reads.map((r) => r.entry.sensitive)).toEqual([false, true]);
    // ni la liste ni la fiche ne portent contact, pièce ou tuteur
    expect(JSON.stringify(list)).not.toMatch(/SECRET|Tuteur|\+225070/);
    expect(JSON.stringify(unwrap(await getCandidateDetail(env.deps(), env.ctxA(), libre.id)))).not.toMatch(/SECRET|Tuteur|\+225070/);
    // événements et audit : identifiants seulement
    const ev = await env.db.admin.query("SELECT type, payload::text AS p FROM kernel.domain_events WHERE tenant_id = $1 AND type LIKE 'examinations.%'", [env.tenantA]);
    expect(ev.rows.length).toBeGreaterThan(0);
    for (const row of ev.rows) expect(row.p).not.toMatch(/LIBRE\d|Prénom|SECRET|Tuteur|\+225070|Bouaké/);
    const registered = ev.rows.filter((r) => r.type === "examinations.candidate.registered").map((r) => JSON.parse(r.p));
    expect(registered.some((p) => p.candidateKind === "EXTERNAL" && p.studentId === null)).toBe(true);
    for (const e of env.audit.entries) expect(JSON.stringify(e.entry)).not.toMatch(/LIBRE\d|Prénom|SECRET|Tuteur|\+225070|Bouaké/);
  });

  it("saisie en lot / import : un refus n'annule pas les autres ; source IMPORTED tracée ; une seule entrée d'audit", async () => {
    const before = env.audit.entries.length;
    const report = unwrap(await createExternalBatch(env.deps(), env.ctxA(), sessionId, [person(20), person(21), person(20), person(22, { contactPhone: null, guardianName: null })], "IMPORTED"));
    expect(report.created.map((c) => c.index)).toEqual([0, 1]);
    expect(report.failed.map((f) => [f.index, f.code])).toEqual([[2, "examinations.candidate_duplicate"], [3, "examinations.external_profile_incomplete"]]);
    expect(env.audit.entries.length - before).toBe(1);
    const src = await env.db.admin.query("SELECT data_source FROM examinations.external_candidate_profiles WHERE candidate_id = $1", [report.created[0]!.candidateId]);
    expect(src.rows[0].data_source).toBe("IMPORTED");
  });

  it("convocation, résultat publié, attestation et relevé fonctionnent pour un libre ; pas d'accès famille", async () => {
    const list = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 50 }));
    const libre = list.items.find((c) => c.lastName === "LIBRE1")!;
    const center = unwrap(await createCenter(env.deps(), env.ctxA(), { code: "CL", name: "Centre libre (fictif)", kind: "OWN" }));
    unwrap(await createRoom(env.deps(), env.ctxA(), center.id, { code: "S1", capacity: 20 }));
    unwrap(await setSessionCenters(env.deps(), env.ctxA(), sessionId, [center.id]));
    const room = (await env.db.admin.query("SELECT id FROM examinations.rooms WHERE center_id = $1", [center.id])).rows[0].id as string;
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "REGISTRATION_CLOSED"));
    unwrap(await assignCandidate(env.deps(), env.ctxA(), libre.id, { centerId: center.id, roomId: room, seatNumber: 1 }));
    const conv = unwrap(await issueDocument(env.deps(), env.ctxA(), libre.id, "CONVOCATION"));
    expect(conv.status).toBe("ISSUED");
    const sealed = env.world.officialRequests.find((r) => r.sourceId === conv.id)!;
    expect(sealed.content).toMatchObject({ candidateNumber: "CEPE2027-00002", lastName: "LIBRE1", watermark: expect.stringContaining("démonstration") });
    expect(JSON.stringify(sealed.content)).not.toMatch(/SECRET|Tuteur|\+225070/); // aucun contact ni pièce sur le document scellé
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "IN_PROGRESS"));
    // withdraw d'un autre libre non inscrit n'est pas nécessaire : on saisit les résultats des inscrits seulement, les autres sont retirés
    const live = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 100 })).items;
    for (const c of live.filter((x) => x.registrationStatus !== "REGISTERED")) unwrap(await withdrawCandidate(env.deps(), env.ctxA(), c.id, "Dossier non finalisé"));
    const registered = live.filter((c) => c.registrationStatus === "REGISTERED");
    unwrap(await saveResults(env.deps(), env.ctxA(), sessionId, { items: registered.map((c) => ({ candidateId: c.id, resultCode: "ADMITTED" as const, average: "12.5" })) }));
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "RESULTS_ENTERED"));
    unwrap(await transitionSession(env.deps(), env.ctxA(), sessionId, "PUBLISHED"));
    const att = unwrap(await issueDocument(env.deps(), env.ctxA(), libre.id, "ATTESTATION_REUSSITE"));
    expect(att.status).toBe("ISSUED");
    const rel = unwrap(await issueDocument(env.deps(), env.ctxA(), libre.id, "RELEVE_NOTES"));
    expect(rel.status).toBe("ISSUED");
    const pub = await env.db.admin.query("SELECT payload FROM kernel.domain_events WHERE type = 'examinations.result.published' AND tenant_id = $1 AND payload->>'candidateId' = $2", [env.tenantA, libre.id]);
    expect(pub.rows[0].payload).toMatchObject({ studentId: null, candidateKind: "EXTERNAL", outcome: "ADMITTED" });
    // aucun lien de tutelle : la famille ne voit jamais ce document
    const { familyAccess } = await import("../../application/family");
    const row = (await import("../../infrastructure/candidates-repo"));
    const cand = await env.deps().db.run(env.ctxA(), (tx) => row.getCandidate(tx, libre.id), { readOnly: true });
    expect(await familyAccess(env.deps(), env.ctxA())(cand!)).toBe(false);
  });

  it("ANONYMISATION : profil effacé, identité neutre, numéro et résultat conservés, irréversible ; plus de document nominatif", async () => {
    const list = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 100 }));
    const libre = list.items.find((c) => c.lastName === "LIBRE1")!;
    unwrap(await setIdentifier(env.deps(), env.ctxA(), libre.id, { kind: "NATIONAL_ID", value: "N-123" }));
    const short = await anonymizeExternalCandidate(env.deps(), env.ctxA(), libre.id, "court");
    expect(short.ok).toBe(false);
    const done = unwrap(await anonymizeExternalCandidate(env.deps(), env.ctxA(), libre.id, "Demande écrite de la personne (droit à l'effacement)"));
    expect(done).toMatchObject({ anonymized: true, lastName: "ANONYME", firstName: "ANONYME", birthPlace: null, birthDate: "2015-01-01", candidateNumber: "CEPE2027-00002", registrationStatus: "REGISTERED" });
    const profile = unwrap(await getExternalProfile(env.deps(), env.ctxA(), libre.id, { reveal: true }));
    expect(profile).toMatchObject({ contactPhone: null, idPieceNumber: null, guardianName: null });
    expect(profile.anonymizedAt).not.toBeNull();
    const ids = await env.db.admin.query("SELECT kind, value FROM examinations.candidate_identifiers WHERE candidate_id = $1 ORDER BY kind", [libre.id]);
    expect(ids.rows[0]).toEqual({ kind: "NATIONAL_ID", value: expect.stringMatching(/^ANONYME-/) });
    expect(ids.rows[1]).toEqual({ kind: "OFFICIAL_NUMBER", value: "OFF-0001" });
    const result = await env.db.admin.query("SELECT result_code FROM examinations.candidate_results WHERE candidate_id = $1", [libre.id]);
    expect(result.rows[0].result_code).toBe("ADMITTED");
    const again = await anonymizeExternalCandidate(env.deps(), env.ctxA(), libre.id, "Deuxième demande identique");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("examinations.candidate_anonymized");
    const edit = await updateExternalCandidate(env.deps(), env.ctxA(), libre.id, { profile: person(1).profile });
    expect(edit.ok).toBe(false);
    // la base elle-même refuse de rétablir l'identité
    await expect(env.db.admin.query("UPDATE examinations.candidates SET last_name = 'LIBRE1' WHERE id = $1", [libre.id])).rejects.toThrow(/candidate_anonymized/);
    const doc = await issueDocument(env.deps(), env.ctxA(), libre.id, "CONVOCATION");
    expect(doc.ok).toBe(false);
    const audit = env.audit.entries.find((e) => e.entry.action === "examinations.external_candidate.anonymize")!;
    expect(audit.entry.sensitive).toBe(true);
    // un élève ne s'anonymise pas par cette voie
    const pupil = list.items.find((c) => c.candidateKind === "STUDENT")!;
    const refused = await anonymizeExternalCandidate(env.deps(), env.ctxA(), pupil.id, "Tentative sur un élève inscrit");
    expect(refused.ok).toBe(false);
  });

  it("ISOLATION A/B : le tenant B ne voit ni le libre, ni son profil, ni ses lignes (RLS)", async () => {
    const list = unwrap(await listCandidates(env.deps(), env.ctxA(), sessionId, { page: 1, pageSize: 100 }));
    const libre = list.items.find((c) => c.candidateKind === "EXTERNAL")!;
    const asB = await getExternalProfile(env.deps(), env.ctxB(), libre.id);
    expect(asB.ok).toBe(false);
    if (!asB.ok) expect(asB.error.code).toBe("examinations.candidate_not_found");
    const detailB = await getCandidateDetail(env.deps(), env.ctxB(), libre.id);
    expect(detailB.ok).toBe(false);
    const sessionB = (await openSession(env, "CEPE-B-LIBRE", { ctx: env.ctxB() })).id;
    unwrap(await createExternalCandidate(env.deps(), env.ctxB(), sessionB, person(1))); // même identité chez B : aucun conflit entre tenants
    const visibleToB = await env.deps().db.run(env.ctxB(), (tx) => tx.many("SELECT candidate_id FROM examinations.external_candidate_profiles"), { readOnly: true });
    expect(visibleToB).toHaveLength(1);
    const writeAsB = await env.deps().db.run(env.ctxB(), (tx) => tx.query("UPDATE examinations.external_candidate_profiles SET contact_phone = '0000' WHERE candidate_id = $1", [libre.id]), {}).catch((e) => e);
    expect(writeAsB.rowCount ?? 0).toBe(0);
    const intact = await env.db.admin.query("SELECT contact_phone FROM examinations.external_candidate_profiles WHERE candidate_id = $1", [libre.id]);
    expect(intact.rows[0].contact_phone).toBeNull(); // anonymisé plus haut, jamais '0000'
  });
});
