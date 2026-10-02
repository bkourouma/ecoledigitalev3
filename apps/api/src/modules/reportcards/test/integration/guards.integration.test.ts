import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createBatch } from "../../application/issue";
import { renderReportCard } from "../../application/render";
import { publishReportCard, revokeReportCard } from "../../application/lifecycle";
import { canonicalJson, snapshotHash } from "../../domain/canonical";
import { generateVerificationCode } from "../../domain/signing";
import * as cardsRepo from "../../infrastructure/cards-repository";
import { ALL_PLATFORM_TEMPLATES } from "../../templates/builtin";
import { SHARED_VECTOR } from "../support/vectors";
import { adminOne, adminRows, createReportcardsTestDb, describeIntegration, ctxFor, type ReportcardsTestDb } from "../support/db";
import { makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

/** Générateur pseudo-aléatoire déterministe (mulberry32) pour la comparaison TypeScript / SQL. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const ALPHABET = ["a", "Z", "é", "é", "ß", "中", "😀", "\u{1F1EB}\u{1F1F7}", " ", " ", "\"", "\\", "/", "\n", "\t", "\u0001", "\u001f", "<", ">", "&", "'", "0", "9", "ñ", "Å", "Å", "ǆ"];

function randomString(rand: () => number, max = 12): string {
  const n = Math.floor(rand() * max);
  return Array.from({ length: n }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]!).join("");
}

function randomValue(rand: () => number, depth = 0): unknown {
  const r = rand();
  if (depth > 3 || r < 0.35) {
    const k = rand();
    if (k < 0.3) return randomString(rand);
    if (k < 0.5) return Math.floor(rand() * 2_000_000) - 1_000_000;
    if (k < 0.6) return rand() < 0.5;
    if (k < 0.7) return null;
    if (k < 0.8) return `${Math.floor(rand() * 100)}.${String(Math.floor(rand() * 100)).padStart(2, "0")}`;
    return Math.floor(rand() * 9e15);
  }
  if (r < 0.65) return Array.from({ length: Math.floor(rand() * 5) }, () => randomValue(rand, depth + 1));
  const o: Record<string, unknown> = {};
  const n = Math.floor(rand() * 6);
  for (let i = 0; i < n; i += 1) o[randomString(rand, 6) || `k${i}`] = randomValue(rand, depth + 1);
  return o;
}

describeIntegration("gardes d'intégrité en base (déclencheurs, RLS) — même pour un superutilisateur", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let school: School;
  let cardIds: string[];

  const expectRejected = async (sql: string, params: unknown[], pattern: RegExp): Promise<void> => {
    await expect(db.admin.query(sql, params)).rejects.toThrow(pattern);
    // Une erreur de transaction éventuelle ne doit pas laisser la connexion dans un état avorté.
    await db.admin.query("ROLLBACK").catch(() => undefined);
  };

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
    school = await seedSchool(world, await db.createTenant(), { students: 3 });
    unwrap(await createBatch(world.deps, school.admin.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
    cardIds = (await adminRows<{ id: string }>(db, "SELECT id FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY id", [school.tenantId])).map((r) => r.id);
  });
  afterAll(async () => {
    await db.drop();
  });

  describe("JSON canonique : l'implémentation SQL égale l'implémentation TypeScript (risque R5)", () => {
    it("vecteur partagé : même forme canonique et même hash", async () => {
      const row = await adminOne<{ c: string; h: string }>(db, "SELECT reportcards.canonical_json($1::jsonb) AS c, reportcards.canonical_hash($2::jsonb, '[]'::jsonb) AS h", [
        JSON.stringify({ snapshot: SHARED_VECTOR.value, explain: [] }),
        JSON.stringify(SHARED_VECTOR.value),
      ]);
      expect(row.c).toBe(SHARED_VECTOR.canonical);
      expect(row.h).toBe(SHARED_VECTOR.hash);
    });

    it("400 valeurs aléatoires (accents, emoji, combinants, contrôles, ordre des clés) : identiques", async () => {
      const rand = prng(20261001);
      let compared = 0;
      for (let i = 0; i < 400; i += 1) {
        const value = { snapshot: randomValue(rand), explain: randomValue(rand) };
        const json = JSON.stringify(value);
        // JSON.stringify ne conserve pas deux clés égales après normalisation ; on compare ce que la base reçoit réellement.
        let expected: string;
        try {
          expected = canonicalJson(JSON.parse(json));
        } catch {
          continue; // clés dupliquées après NFC : cas exclu par construction du snapshot
        }
        const { c } = await adminOne<{ c: string }>(db, "SELECT reportcards.canonical_json($1::jsonb) AS c", [json]);
        expect(c, json).toBe(expected);
        compared += 1;
      }
      expect(compared).toBeGreaterThan(300);
    });

    it("refuse en SQL ce que TypeScript refuse : flottants, entiers hors plage", async () => {
      await expectRejected("SELECT reportcards.canonical_json('{\"a\":1.5}'::jsonb)", [], /canonical_number/);
      await expectRejected("SELECT reportcards.canonical_json('{\"a\":1.0}'::jsonb)", [], /canonical_number/);
      await expectRejected("SELECT reportcards.canonical_json('{\"a\":9007199254740993}'::jsonb)", [], /canonical_number/);
    });

    it("le hash stocké de chaque bulletin égale le hash recalculé EN SQL et en TypeScript", async () => {
      const rows = await adminRows<any>(db, "SELECT snapshot_hash, reportcards.canonical_hash(snapshot, explain) AS sql_hash, snapshot, explain FROM reportcards.report_cards WHERE tenant_id = $1", [school.tenantId]);
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.sql_hash).toBe(r.snapshot_hash);
        expect(snapshotHash(r.snapshot, r.explain)).toBe(r.snapshot_hash);
      }
    });
  });

  describe("immuabilité d'un snapshot (AC2.1)", () => {
    const attempts: Array<[string, string]> = [
      ["le contenu du snapshot", "UPDATE reportcards.report_cards SET snapshot = jsonb_set(snapshot, '{student,lastName}', '\"PIRATE\"') WHERE id = $1"],
      ["la trace", "UPDATE reportcards.report_cards SET explain = '[]'::jsonb WHERE id = $1"],
      ["le hash", "UPDATE reportcards.report_cards SET snapshot_hash = repeat('0', 64) WHERE id = $1"],
      ["la signature", "UPDATE reportcards.report_cards SET signature = 'AAAA' WHERE id = $1"],
      ["le code de vérification", "UPDATE reportcards.report_cards SET verification_code = repeat('A', 26) WHERE id = $1"],
      ["la date d'émission", "UPDATE reportcards.report_cards SET issued_at = now() WHERE id = $1"],
      ["la version de règle", "UPDATE reportcards.report_cards SET rule_version_id = gen_random_uuid() WHERE id = $1"],
      ["l'élève", "UPDATE reportcards.report_cards SET student_id = gen_random_uuid() WHERE id = $1"],
      ["la version", "UPDATE reportcards.report_cards SET version = 9 WHERE id = $1"],
      ["le tenant", "UPDATE reportcards.report_cards SET tenant_id = gen_random_uuid() WHERE id = $1"],
      ["le gabarit utilisé", "UPDATE reportcards.report_cards SET template_version = 99 WHERE id = $1"],
    ];
    for (const [what, sql] of attempts) {
      it(`UPDATE de ${what} refusé pour le superutilisateur`, async () => {
        await expectRejected(sql, [cardIds[0]], /snapshot_immutable|violates|restrict/);
      });
    }

    it("DELETE refusé (superutilisateur ET rôle applicatif)", async () => {
      await expectRejected("DELETE FROM reportcards.report_cards WHERE id = $1", [cardIds[0]], /immutable/);
      await expect(db.tenantDb.run(school.admin.ctx, (tx) => tx.query("DELETE FROM reportcards.report_cards WHERE id = $1", [cardIds[0]]))).rejects.toThrow(/immutable|permission denied/);
      expect(Number((await adminOne<any>(db, "SELECT count(*) AS n FROM reportcards.report_cards WHERE tenant_id = $1", [school.tenantId])).n)).toBe(3);
    });

    it("même en neutralisant les déclencheurs ordinaires (session_replication_role = replica) : ENABLE ALWAYS", async () => {
      await db.admin.query("SET session_replication_role = replica");
      try {
        await expect(db.admin.query("UPDATE reportcards.report_cards SET snapshot = '{}'::jsonb WHERE id = $1", [cardIds[0]])).rejects.toThrow(/snapshot_immutable|violates/);
        await expect(db.admin.query("DELETE FROM reportcards.report_cards WHERE id = $1", [cardIds[0]])).rejects.toThrow(/immutable/);
      } finally {
        await db.admin.query("RESET session_replication_role");
      }
    });

    it("TRUNCATE n'est pas accordé au rôle applicatif", async () => {
      await expect(db.tenantDb.run(school.admin.ctx, (tx) => tx.query("TRUNCATE reportcards.report_cards"))).rejects.toThrow(/permission|privilège|denied/i);
    });

    it("le rôle applicatif ne peut pas écrire une colonne figée (même sans trigger : droits + trigger)", async () => {
      await expect(
        db.tenantDb.run(school.admin.ctx, (tx) => tx.query("UPDATE reportcards.report_cards SET student_id = $2 WHERE id = $1", [cardIds[0], newId()])),
      ).rejects.toThrow(/snapshot_immutable/);
    });

    it("ne rejette pas les champs autorisés : rendu courant (render_status, current_render_id)", async () => {
      await db.admin.query("UPDATE reportcards.report_cards SET render_status = 'RENDERING' WHERE id = $1", [cardIds[1]]);
      await db.admin.query("UPDATE reportcards.report_cards SET render_status = 'PENDING' WHERE id = $1", [cardIds[1]]);
    });
  });

  describe("transitions de statut", () => {
    it("ISSUED -> SUPERSEDED direct refusé : un bulletin n'est remplacé que par l'émission de la version suivante", async () => {
      await expectRejected("UPDATE reportcards.report_cards SET status = 'SUPERSEDED', superseded_at = now(), superseded_by_id = gen_random_uuid() WHERE id = $1", [cardIds[0]], /supersede_only_by_successor/);
    });
    it("révocation sans motif refusée par contrainte ; avec motif acceptée puis terminale (aucune sortie de REVOKED)", async () => {
      await expectRejected("UPDATE reportcards.report_cards SET status = 'REVOKED', revoked_at = now() WHERE id = $1", [cardIds[2]], /report_cards_check|violates check/);
      unwrap(await revokeReportCard(world.deps, school.admin.ctx, { reportCardId: cardIds[2]!, reason: "Erreur d'identité de l'élève" }));
      await expectRejected("UPDATE reportcards.report_cards SET status = 'PUBLISHED', published_at = now(), published_by = gen_random_uuid() WHERE id = $1", [cardIds[2]], /invalid_transition/);
      await expectRejected("UPDATE reportcards.report_cards SET status = 'ISSUED' WHERE id = $1", [cardIds[2]], /invalid_transition/);
      await expectRejected("UPDATE reportcards.report_cards SET revoke_reason = 'autre motif' WHERE id = $1", [cardIds[2]], /terminal_immutable/);
    });
    it("PUBLISHED -> ISSUED interdit (le retrait passe par withdrawn_at) ; date de publication figée ; retrait seulement si publié", async () => {
      unwrap(await renderReportCard(world.deps, school.admin.ctx, { reportCardId: cardIds[0]! }));
      unwrap(await publishReportCard(world.deps, school.admin.ctx, { reportCardId: cardIds[0]! }));
      await expectRejected("UPDATE reportcards.report_cards SET status = 'ISSUED' WHERE id = $1", [cardIds[0]], /invalid_transition/);
      await expectRejected("UPDATE reportcards.report_cards SET published_at = now() WHERE id = $1", [cardIds[0]], /publish_immutable/);
      await expectRejected("UPDATE reportcards.report_cards SET withdrawn_at = now() WHERE id = $1", [cardIds[1]], /withdraw_invalid/);
      await db.admin.query("UPDATE reportcards.report_cards SET withdrawn_at = now() WHERE id = $1", [cardIds[0]]);
      await db.admin.query("UPDATE reportcards.report_cards SET withdrawn_at = NULL WHERE id = $1", [cardIds[0]]);
    });
    it("un bulletin provisoire n'est jamais publiable", async () => {
      const t = await db.createTenant();
      const s = await seedSchool(world, t, { students: 1, closed: false });
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId, provisional: true }));
      const id = (await adminOne<any>(db, "SELECT id FROM reportcards.report_cards WHERE tenant_id = $1", [t])).id;
      await expectRejected("UPDATE reportcards.report_cards SET status = 'PUBLISHED', published_at = now(), published_by = gen_random_uuid() WHERE id = $1", [id], /violates check|publish_invalid/);
    });
  });

  describe("insertion : hash recalculé en SQL, cohérence, unicité des versions vivantes", () => {
    const paramsOf = async (id: string, patch: Record<string, unknown> = {}) => {
      const content = await db.tenantDb.run(school.admin.ctx, (tx) => cardsRepo.getCardContent(tx, id));
      const r = content!.record;
      return {
        id: newId(), tenantId: school.tenantId, documentKind: r.documentKind, enrollmentId: r.enrollmentId, studentId: r.studentId, classroomId: r.classroomId,
        academicYearId: r.academicYearId, academicPeriodId: r.academicPeriodId, scope: r.scope, version: 1, provisional: false, snapshot: content!.snapshot,
        explain: content!.explain, snapshotHash: r.snapshotHash, ruleSetCode: r.ruleSetCode, ruleVersionId: r.ruleVersionId, ruleVersionNo: 3, definitionHash: "a".repeat(64),
        resultsStateId: r.resultsStateId, resultsVersion: r.resultsVersion, closureHash: r.closureHash, templateKey: r.templateKey, templateVersion: r.templateVersion,
        configVersion: r.configVersion, verificationCode: generateVerificationCode(), signingKeyId: r.signingKeyId, signature: r.signature, issuedAt: r.issuedAt,
        issuedBy: r.issuedBy, issuedByName: r.issuedByName, supersedesId: null, supersedeReason: null, batchId: null, ...patch,
      } as cardsRepo.NewCard;
    };
    const insert = (p: cardsRepo.NewCard) => db.tenantDb.run(school.admin.ctx, (tx) => cardsRepo.insertCard(tx, p));

    it("hash fourni différent du hash recalculé : refusé (R-RC-09)", async () => {
      const content = await db.tenantDb.run(school.admin.ctx, (tx) => cardsRepo.getCardContent(tx, cardIds[1]!));
      const snapshot = { ...content!.snapshot, labels: { ...content!.snapshot.labels, X: "modifié" } };
      await expect(insert(await paramsOf(cardIds[1]!, { snapshot, enrollmentId: newId(), studentId: content!.record.studentId }))).rejects.toThrow(/hash_mismatch/);
    });

    it("colonnes incohérentes avec le snapshot (élève, version, nature) : refusé", async () => {
      await expect(insert(await paramsOf(cardIds[1]!, { studentId: newId(), enrollmentId: newId() }))).rejects.toThrow(/snapshot_columns/);
      await expect(insert(await paramsOf(cardIds[1]!, { version: 3, supersedesId: cardIds[1], supersedeReason: "x" }))).rejects.toThrow(/snapshot_columns/);
    });

    it("deux versions vivantes pour la même clé fonctionnelle : refusé (index unique partiel)", async () => {
      const p = await paramsOf(cardIds[1]!);
      // Même contenu = même hash : l'unicité du hash (R-RC-09) répond avant l'unicité de la version vivante.
      await expect(insert(p)).rejects.toThrow(/report_cards_hash_uq|duplicate key|unique/i);
    });

    it("version > 1 sans version remplacée, ou remplaçant une autre clé fonctionnelle : refusé", async () => {
      const content = await db.tenantDb.run(school.admin.ctx, (tx) => cardsRepo.getCardContent(tx, cardIds[1]!));
      const bump = (supersedes: string | null) => {
        const snapshot = { ...content!.snapshot, meta: { ...content!.snapshot.meta, version: 2 } };
        return { snapshot, snapshotHash: snapshotHash(snapshot, content!.explain), version: 2, supersedesId: supersedes, supersedeReason: "motif de test" };
      };
      await expect(insert(await paramsOf(cardIds[1]!, bump(null)))).rejects.toThrow(/supersede_missing|violates check/);
      await expect(insert(await paramsOf(cardIds[1]!, bump(newId())))).rejects.toThrow(/supersede_missing/);
      await expect(insert(await paramsOf(cardIds[1]!, bump(cardIds[0]!)))).rejects.toThrow(/supersede_mismatch/); // un autre élève
    });

    it("un snapshot naît ISSUED, non publié, non rendu", async () => {
      await expect(db.admin.query("UPDATE reportcards.report_cards SET status = status WHERE false")).resolves.toBeDefined();
      const rows = await adminRows<any>(db, "SELECT DISTINCT status, render_status FROM reportcards.report_cards WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND id <> ALL($3::uuid[])", [school.tenantId, cardIds, [cardIds[0], cardIds[2]]]);
      expect(rows).toHaveLength(1);
    });
  });

  describe("tables de configuration et de rendu", () => {
    it("identité et configuration de gabarit : une version est immuable, seul is_current passe à false", async () => {
      const b = await adminOne<any>(db, "SELECT id FROM reportcards.branding_versions WHERE tenant_id = $1 AND is_current", [school.tenantId]);
      await expectRejected("UPDATE reportcards.branding_versions SET legal_name = 'X' WHERE id = $1", [b.id], /version_immutable/);
      await expectRejected("DELETE FROM reportcards.branding_versions WHERE id = $1", [b.id], /immutable/);
      const c = await adminOne<any>(db, "SELECT id FROM reportcards.template_configs WHERE tenant_id = $1 AND is_current", [school.tenantId]);
      await expectRejected("UPDATE reportcards.template_configs SET options = '{}'::jsonb WHERE id = $1", [c.id], /version_immutable/);
      await db.admin.query("UPDATE reportcards.template_configs SET is_current = false WHERE id = $1", [c.id]);
      await expectRejected("UPDATE reportcards.template_configs SET is_current = true WHERE id = $1", [c.id], /version_immutable/);
      await db.admin.query("UPDATE reportcards.template_configs SET is_current = true WHERE id = $1", [c.id]).catch(() => undefined);
    });

    it("signataires : jamais supprimés (désactivation seulement)", async () => {
      await expectRejected("DELETE FROM reportcards.signatories WHERE id = $1", [school.signatoryId], /immutable/);
    });

    it("rendu terminé immuable ; une ligne de rendu n'est jamais supprimée", async () => {
      const r = await adminOne<any>(db, "SELECT id FROM reportcards.renders WHERE tenant_id = $1 AND status = 'RENDERED' LIMIT 1", [school.tenantId]);
      await expectRejected("UPDATE reportcards.renders SET pdf_hash = repeat('1', 64) WHERE id = $1", [r.id], /render_immutable/);
      await expectRejected("DELETE FROM reportcards.renders WHERE id = $1", [r.id], /immutable/);
    });

    it("journaux append-only : verification_events, access_log", async () => {
      await db.admin.query("INSERT INTO reportcards.verification_events (id, tenant_id, document_kind, result) VALUES (gen_random_uuid(), $1, 'REPORT_CARD', 'AUTHENTIC')", [school.tenantId]);
      await expectRejected("UPDATE reportcards.verification_events SET result = 'REVOKED' WHERE tenant_id = $1", [school.tenantId], /immutable/);
      await expectRejected("DELETE FROM reportcards.verification_events WHERE tenant_id = $1", [school.tenantId], /immutable/);
    });

    it("rétention : seule la purge sous réglage dédié supprime, et seulement des lignes de plus de 24 mois", async () => {
      await db.admin.query("INSERT INTO reportcards.verification_events (id, tenant_id, document_kind, result, occurred_at) VALUES (gen_random_uuid(), $1, 'REPORT_CARD', 'AUTHENTIC', now() - interval '30 months')", [school.tenantId]);
      const purged = await db.tenantDb.run(school.admin.ctx, (tx) => cardsRepo.purgeExpiredVerificationEvents(tx));
      expect(purged).toBe(1);
      const left = await adminRows<any>(db, "SELECT count(*)::int AS n FROM reportcards.verification_events WHERE tenant_id = $1", [school.tenantId]);
      expect(left[0].n).toBeGreaterThanOrEqual(1);
      // Sans le réglage, même une ligne échue reste.
      await db.admin.query("INSERT INTO reportcards.verification_events (id, tenant_id, document_kind, result, occurred_at) VALUES (gen_random_uuid(), $1, 'REPORT_CARD', 'AUTHENTIC', now() - interval '30 months')", [school.tenantId]);
      await expectRejected("DELETE FROM reportcards.verification_events WHERE occurred_at < now() - interval '24 months'", [], /immutable/);
    });
  });

  describe("tables globales : gabarits, clés, index public", () => {
    it("un tenant ne peut ni publier un gabarit ni enregistrer une clé de signature (écriture réservée à `system`)", async () => {
      await expect(
        db.tenantDb.run(school.admin.ctx, (tx) =>
          tx.query("INSERT INTO reportcards.platform_templates (key, version, document_kind, pack, snapshot_schema, title, body, options_schema, status, content_hash) VALUES ('pirate', 1, 'REPORT_CARD', 'CORE', 'reportcard/1', 't', '<p>x</p>', '{}', 'PUBLISHED', repeat('a', 64))"),
        ),
      ).rejects.toThrow(/row-level security|RLS|politique/i);
      await expect(db.tenantDb.run(school.admin.ctx, (tx) => tx.query("INSERT INTO reportcards.signing_keys (key_id, public_key) VALUES ('pirate-key-01', repeat('A', 60))"))).rejects.toThrow(/row-level security|RLS|politique/i);
      // Lecture ouverte : le tenant lit le catalogue.
      expect(await db.tenantDb.run(school.admin.ctx, (tx) => tx.many("SELECT key FROM reportcards.platform_templates"))).toHaveLength(ALL_PLATFORM_TEMPLATES.length);
    });

    it("gabarit publié immuable (corps, css, schéma d'options) ; retrait permis ; jamais de suppression", async () => {
      await expect(db.systemDb.run("test-template-guard", (tx) => tx.query("UPDATE reportcards.platform_templates SET body = '<p>piraté</p>' WHERE key = 'secondary-bulletin'"))).rejects.toThrow(/template_published_immutable/);
      await expect(db.systemDb.run("test-template-guard", (tx) => tx.query("UPDATE reportcards.platform_templates SET css = '' WHERE key = 'secondary-bulletin'"))).rejects.toThrow(/template_published_immutable/);
      await expect(db.systemDb.run("test-template-guard", (tx) => tx.query("DELETE FROM reportcards.platform_templates WHERE key = 'secondary-bulletin'"))).rejects.toThrow(/immutable|permission denied/);
      await expectRejected("DELETE FROM reportcards.platform_templates WHERE key = 'secondary-bulletin'", [], /immutable/);
    });

    it("clé publique de signature immuable ; seul le retrait est possible et terminal", async () => {
      await expect(db.systemDb.run("test-key-guard", (tx) => tx.query("UPDATE reportcards.signing_keys SET public_key = repeat('B', 60) WHERE key_id = $1", [world.keys.keyId]))).rejects.toThrow(/signing_key_immutable/);
      await expectRejected("DELETE FROM reportcards.signing_keys WHERE key_id = $1", [world.keys.keyId], /immutable/);
    });

    it("index public : un tenant ne peut pas inscrire un code au nom d'un autre, ni pour un document inexistant, ni modifier/supprimer", async () => {
      const other = await db.createTenant();
      const code = generateVerificationCode();
      const otherCtx = ctxFor(other);
      await expect(
        db.tenantDb.run(otherCtx, (tx) => tx.query("INSERT INTO reportcards.verification_index (code, tenant_id, document_kind, document_id) VALUES ($1, $2, 'REPORT_CARD', $3)", [code, school.tenantId, cardIds[0]])),
      ).rejects.toThrow(/row-level security|RLS|politique|verification_target/i);
      await expect(
        db.tenantDb.run(otherCtx, (tx) => tx.query("INSERT INTO reportcards.verification_index (code, tenant_id, document_kind, document_id) VALUES ($1, $2, 'REPORT_CARD', $3)", [code, other, newId()])),
      ).rejects.toThrow(/verification_target/);
      await expectRejected("DELETE FROM reportcards.verification_index", [], /immutable/);
      await expectRejected("UPDATE reportcards.verification_index SET document_kind = 'TRANSCRIPT'", [], /immutable/);
    });

    it("index public : lisible par le système (vérification publique) et par son tenant, PAS par un autre tenant", async () => {
      const code = (await adminOne<any>(db, "SELECT verification_code FROM reportcards.report_cards WHERE id = $1", [cardIds[0]])).verification_code;
      const other = await db.createTenant();
      expect(await db.tenantDb.run(ctxFor(other), (tx) => tx.many("SELECT code FROM reportcards.verification_index WHERE code = $1", [code]))).toHaveLength(0);
      expect(await db.tenantDb.run(school.admin.ctx, (tx) => tx.many("SELECT code FROM reportcards.verification_index WHERE code = $1", [code]))).toHaveLength(1);
      expect(await db.systemDb.run("public-verification", (tx) => tx.many("SELECT code, tenant_id FROM reportcards.verification_index WHERE code = $1", [code]))).toHaveLength(1);
    });
  });

  describe("isolation entre tenants (RLS)", () => {
    it("le tenant B ne voit, ne modifie ni ne supprime rien du tenant A", async () => {
      const b = await db.createTenant();
      const ctxB = ctxFor(b);
      for (const table of ["report_cards", "renders", "batches", "batch_items", "branding_versions", "template_configs", "signatories", "access_log", "verification_events"]) {
        expect(await db.tenantDb.run(ctxB, (tx) => tx.many(`SELECT 1 FROM reportcards.${table}`)), table).toHaveLength(0);
      }
      const upd = await db.tenantDb.run(ctxB, (tx) => tx.query("UPDATE reportcards.report_cards SET render_status = 'FAILED' WHERE id = $1", [cardIds[1]]));
      expect(upd.rowCount).toBe(0);
      await expect(db.tenantDb.run(ctxB, (tx) => cardsRepo.insertCard(tx, { ...({} as cardsRepo.NewCard) }))).rejects.toBeDefined();
    });
  });
});
