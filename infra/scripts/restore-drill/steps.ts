#!/usr/bin/env tsx
/**
 * Étapes « applicatives » de l'exercice de restauration (appelées par `infra/scripts/restore-drill.mjs`).
 * NE SE LANCE PAS SEUL : le script parent fournit une base JETABLE (conteneur Docker éphémère) via l'environnement.
 *
 *   ED_DRILL_ADMIN_URL   connexion superuser de la base éphémère visée (nom finissant par _test)
 *   ED_DRILL_WORKDIR     dossier temporaire (secrets de test générés à l'exécution, manifeste) ; supprimé par le parent
 *
 *   steps.ts migrate               applique la baseline, le worker et toutes les migrations de modules
 *   steps.ts seed [--tenants N] [--invoices N]
 *                                  jeu de données multi-tenant par les VRAIS cas d'usage (finance), audit chaîné HMAC,
 *                                  documents officiels signés Ed25519, secrets de fournisseurs chiffrés (SecretStorePort)
 *   steps.ts verify                vérifications de la base RESTAURÉE (grand livre, chaîne d'audit, signatures, coffre,
 *                                  isolation RLS, compteurs) ; imprime une ligne `DRILL_JSON:{...}`
 *
 * Aucun secret réel : clés HMAC, Ed25519 et AES générées à l'exécution, écrites uniquement dans ED_DRILL_WORKDIR.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client, Pool } from "pg";
import { SystemDb, TenantDb, checkTenantIsolation } from "../../../packages/database/src";
import { ManualClock, createRequestContext, newId, noopLogger, type RequestContext } from "../../../packages/kernel/src";
import { discoverModules } from "../../../apps/api/src/modules/registry-discovery";
import { loadIsolationAllowlist } from "../../../apps/api/src/platform/isolation-allowlist-loader";
import { createLoginRole } from "../../../apps/api/src/platform/v2-login-role";
import { runV2Migrations } from "../../../apps/api/src/platform/v2-migrations";
import { AuditService } from "../../../apps/api/src/modules/audit/application/audit-service";
import { createFinanceDeps } from "../../../apps/api/src/modules/finance/application/deps";
import { RecordingAudit } from "../../../apps/api/src/modules/finance/application/ports/audit";
import { InMemoryEnrollmentDirectory } from "../../../apps/api/src/modules/finance/application/ports/directories";
import { createProviderRegistry } from "../../../apps/api/src/modules/finance/infrastructure/providers/registry";
import { AesGcmSecretStore, parseKeyring } from "../../../apps/api/src/modules/finance/infrastructure/secrets/aes-gcm-secret-store";
import { SecretStoreError } from "../../../apps/api/src/modules/finance/application/ports/secret-store";
import { pay, openCashier, seedCatalog, simpleInvoice, tuitionInvoice, learnerId } from "../../../apps/api/src/modules/finance/test/support/scenario";
import { ledgerViolations } from "../../../apps/api/src/modules/finance/test/support/invariants";
import { generateSigningKeyPair, StaticKeyProvider } from "../../../apps/api/src/modules/reportcards/infrastructure/key-provider";
import { generateVerificationCode, publicKeyFingerprint, verifyDocumentSignature } from "../../../apps/api/src/modules/reportcards/domain/signing";

const adminUrl = process.env.ED_DRILL_ADMIN_URL ?? "";
const workdir = process.env.ED_DRILL_WORKDIR ?? "";
if (!adminUrl || !workdir) {
  console.error("[restore-drill/steps] ED_DRILL_ADMIN_URL et ED_DRILL_WORKDIR sont requis (lancez pnpm restore:drill).");
  process.exit(2);
}
// Garde-fou : uniquement une base éphémère dont le nom finit par _test.
{
  const db = new URL(adminUrl).pathname.replace(/^\//, "");
  if (!/_test$/.test(db) || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(adminUrl).hostname)) {
    console.error(`[restore-drill/steps] REFUS : base "${db}" non éphémère (nom *_test sur 127.0.0.1 exigé).`);
    process.exit(2);
  }
}
const secretsFile = join(workdir, "secrets.json");
const manifestFile = join(workdir, "manifest.json");

interface Secrets {
  auditHmacKeyId: string;
  auditHmacKey: string;
  signingPrivateKeyPem: string;
  signingKeyId: string;
  financeSecretsKeys: string; // « k1:<base64 32 octets> »
}
interface TenantManifest {
  id: string;
  slug: string;
  invoices: number;
  payments: number;
  receipts: number;
  auditEntries: number;
  officialDocuments: number;
  providerConfigs: number;
}
interface Manifest {
  tenants: TenantManifest[];
  platformAuditEntries: number;
  signingPublicKeyFingerprint: string;
}

const ctxOf = (tenantId: string): RequestContext => createRequestContext({ tenantId, userId: newId(), roles: ["finance"] });
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

function financeWorld(tdb: TenantDb) {
  const clock = new ManualClock("2025-09-01T08:00:00.000Z");
  const enrollments = new InMemoryEnrollmentDirectory();
  return createFinanceDeps({
    db: tdb,
    clock,
    audit: new RecordingAudit(),
    providers: createProviderRegistry({ environment: "test" }),
    enrollments,
    config: { environment: "test" },
  });
}

// ----------------------------------------------------------------------------------------------------------------- migrate
async function cmdMigrate(): Promise<void> {
  const report = await runV2Migrations({ url: adminUrl, yes: true, logger: noopLogger });
  const steps = report.steps.map((s) => ({ id: s.step.id, table: s.step.table, applied: s.result.applied.length }));
  console.log(`DRILL_JSON:${JSON.stringify({ database: report.database, steps })}`);
}

// ----------------------------------------------------------------------------------------------------------------- seed
async function cmdSeed(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { tenants: { type: "string" }, invoices: { type: "string" } } });
  const nTenants = Number(values.tenants ?? 3);
  const nInvoices = Number(values.invoices ?? 24);

  const signing = generateSigningKeyPair();
  const secrets: Secrets = {
    auditHmacKeyId: "drill1",
    auditHmacKey: randomBytes(32).toString("hex"),
    signingPrivateKeyPem: signing.privateKeyPem,
    signingKeyId: "ed-drill-0001",
    financeSecretsKeys: `k1:${randomBytes(32).toString("base64")}`,
  };
  writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });

  const login = await createLoginRole({ adminUrl, role: "ed_drill_seed" });
  const pool = new Pool({ connectionString: login.applicationUrl, max: 6 });
  const tdb = new TenantDb(pool);
  const sys = new SystemDb(tdb, { logger: noopLogger });
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const audit = new AuditService({ hmac: { activeKeyId: secrets.auditHmacKeyId, keys: { [secrets.auditHmacKeyId]: secrets.auditHmacKey } } });
  const deps = financeWorld(tdb);
  const store = new AesGcmSecretStore(parseKeyring(secrets.financeSecretsKeys)!);
  const keyProvider = new StaticKeyProvider(signing.privateKey, secrets.signingKeyId);

  const manifest: Manifest = { tenants: [], platformAuditEntries: 0, signingPublicKeyFingerprint: publicKeyFingerprint(keyProvider.publicKey) };
  try {
    await admin.query(`INSERT INTO reportcards.signing_keys (key_id, public_key) VALUES ($1, $2)`, [secrets.signingKeyId, keyProvider.publicKey]);

    for (let t = 0; t < nTenants; t += 1) {
      const id = newId();
      const slug = `drill-${t}-${id.slice(-6)}`;
      await admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [id, slug, `Établissement ${slug}`]);
      const ctx = ctxOf(id);
      await seedCatalog(deps, ctx);
      await openCashier(deps, ctx, 10_000, `C${t}`);
      let payments = 0;
      for (let i = 0; i < nInvoices; i += 1) {
        const learner = learnerId();
        const total = i % 3 === 0 ? 500_000 : 100_000 + i * 1_000;
        const detail = i % 3 === 0 ? await tuitionInvoice(deps, ctx, learner) : await simpleInvoice(deps, ctx, learner, total);
        const inv = detail.invoice;
        // 2 factures sur 3 reçoivent un paiement (une moitié partiel, une moitié intégral)
        if (i % 3 !== 2) {
          const amount = i % 2 === 0 ? Math.max(1, Math.floor(total / 2)) : total;
          const r = await pay(deps, ctx, learner, amount);
          if (!r.ok) throw new Error(`paiement refusé pendant le seed : ${JSON.stringify(r.error)}`);
          payments += 1;
        }
        await tdb.run(ctx, (tx) =>
          audit.record(tx, { action: "invoice.issued", entity: "invoice", entityId: inv.id, after: { number: inv.number ?? null, learner }, severity: "info" }),
        );
      }
      // Secrets de fournisseurs de paiement, scellés par le coffre (jamais en clair en base)
      const providers = ["wave", "orange_money"];
      for (const provider of providers) {
        const sealed = await store.seal({ tenantId: id, provider, field: "api_key" }, `cle-de-test-${randomBytes(6).toString("hex")}`);
        await admin.query(
          `INSERT INTO finance.provider_configs (id, tenant_id, provider, enabled, mode, settings, secrets) VALUES ($1,$2,$3,true,'sandbox','{}'::jsonb,$4::jsonb)`,
          [newId(), id, provider, JSON.stringify({ api_key: sealed })],
        );
      }
      // Documents officiels (reçus) signés Ed25519, avec index de vérification
      const receipts = (await admin.query(`SELECT id, number FROM finance.receipts WHERE tenant_id = $1 ORDER BY number_seq`, [id])).rows as Array<{ id: string; number: string }>;
      for (const rc of receipts.slice(0, 10)) {
        const snapshot = { receiptId: rc.id, number: rc.number, tenant: slug };
        const explain = {};
        const hash = (await admin.query(`SELECT reportcards.canonical_hash($1::jsonb, $2::jsonb) AS h`, [JSON.stringify(snapshot), JSON.stringify(explain)])).rows[0].h as string;
        const code = generateVerificationCode();
        const issuedAt = new Date();
        const signature = keyProvider.sign({ snapshotHash: hash, verificationCode: code, issuedAt });
        const docId = newId();
        await admin.query(
          `INSERT INTO reportcards.official_documents
             (id, tenant_id, document_kind, source_id, title, template_key, template_version, snapshot, explain, snapshot_hash,
              verification_code, signing_key_id, signature, issued_at)
           VALUES ($1,$2,'RECEIPT',$3,$4,'receipt',1,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)`,
          [docId, id, rc.id, `Reçu ${rc.number}`, JSON.stringify(snapshot), JSON.stringify(explain), hash, code, secrets.signingKeyId, signature, issuedAt.toISOString()],
        );
        await admin.query(`INSERT INTO reportcards.verification_index (code, tenant_id, document_kind, document_id) VALUES ($1,$2,'RECEIPT',$3)`, [code, id, docId]);
      }
      manifest.tenants.push({ id, slug, invoices: 0, payments, receipts: 0, auditEntries: 0, officialDocuments: 0, providerConfigs: providers.length });
    }

    // Journal de plateforme (hors tenant)
    for (let i = 0; i < 5; i += 1) {
      await sys.run("restore-drill-seed", (tx) =>
        audit.recordPlatform(tx, { action: "platform.drill.checked", entity: "tenant", entityId: `t${i}`, actor: { type: "superAdmin", id: newId() }, reason: "exercice de restauration" }),
      );
    }
    manifest.platformAuditEntries = 5;

    // Comptages de référence (vérités SQL, superuser) — la comparaison fine par table est faite par le script parent.
    for (const tm of manifest.tenants) {
      const one = async (sql: string) => Number((await admin.query(sql, [tm.id])).rows[0].n);
      tm.invoices = await one(`SELECT count(*) AS n FROM finance.invoices WHERE tenant_id = $1`);
      tm.receipts = await one(`SELECT count(*) AS n FROM finance.receipts WHERE tenant_id = $1`);
      tm.payments = await one(`SELECT count(*) AS n FROM finance.payments WHERE tenant_id = $1`);
      tm.auditEntries = await one(`SELECT count(*) AS n FROM audit.audit_log WHERE tenant_id = $1`);
      tm.officialDocuments = await one(`SELECT count(*) AS n FROM reportcards.official_documents WHERE tenant_id = $1`);
    }
    writeFileSync(manifestFile, JSON.stringify(manifest));
    console.log(`DRILL_JSON:${JSON.stringify({ tenants: manifest.tenants.map(({ id: _id, ...t }) => t), platformAuditEntries: manifest.platformAuditEntries })}`);
  } finally {
    await pool.end().catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

// ----------------------------------------------------------------------------------------------------------------- verify
interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function cmdVerify(): Promise<void> {
  const secrets = readJson<Secrets>(secretsFile);
  const manifest = readJson<Manifest>(manifestFile);
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string): void => void checks.push({ name, ok, detail });

  // Rôle applicatif de la base RESTAURÉE : créé comme en production (LOGIN, membre de app_user, NOBYPASSRLS).
  const login = await createLoginRole({ adminUrl, role: "ed_drill_restored" });
  const pool = new Pool({ connectionString: login.applicationUrl, max: 6 });
  pool.on("error", () => undefined);
  const tdb = new TenantDb(pool);
  const sys = new SystemDb(tdb, { logger: noopLogger });
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    const roleFlags = (await admin.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'ed_drill_restored'`)).rows[0];
    add("rôle applicatif NOSUPERUSER NOBYPASSRLS", roleFlags.rolsuper === false && roleFlags.rolbypassrls === false, JSON.stringify(roleFlags));

    // 1. Grand livre : invariants indépendants + numérotation sans trou
    let ledgerProblems = 0;
    const ledgerDetails: string[] = [];
    for (const t of manifest.tenants) {
      const v = await ledgerViolations({ admin }, t.id);
      ledgerProblems += v.length;
      ledgerDetails.push(`${t.slug}:${v.length}`);
    }
    add("finance : invariants du grand livre (dont numérotation sans trou, compteur = dernier numéro)", ledgerProblems === 0, ledgerDetails.join(" "));

    // 2. Chaîne d'audit (HMAC) : bonne clé ok ; mauvaise clé détectée (témoin négatif)
    const goodAudit = new AuditService({ hmac: { activeKeyId: secrets.auditHmacKeyId, keys: { [secrets.auditHmacKeyId]: secrets.auditHmacKey } } });
    const badAudit = new AuditService({ hmac: { activeKeyId: secrets.auditHmacKeyId, keys: { [secrets.auditHmacKeyId]: randomBytes(32).toString("hex") } } });
    let chainOk = true;
    const chainDetails: string[] = [];
    for (const t of manifest.tenants) {
      const r = await tdb.run(ctxOf(t.id), (tx) => goodAudit.verifyChain(tx, t.id));
      chainOk &&= r.ok && r.checked === t.auditEntries && r.headSeq === t.auditEntries;
      chainDetails.push(`${t.slug}:${r.checked}/${t.auditEntries} ok=${r.ok}`);
    }
    add("audit : chaîne HMAC intacte par tenant (tête = dernière ligne)", chainOk, chainDetails.join(" "));
    const platform = await sys.run("restore-drill-verify", (tx) => goodAudit.verifyPlatformChain(tx));
    add("audit : chaîne de plateforme intacte", platform.ok && platform.checked === manifest.platformAuditEntries, `checked=${platform.checked} ok=${platform.ok}`);
    const wrong = await tdb.run(ctxOf(manifest.tenants[0]!.id), (tx) => badAudit.verifyChain(tx, manifest.tenants[0]!.id));
    add("témoin négatif : une MAUVAISE clé HMAC est détectée (clé d'audit à sauvegarder séparément)", wrong.ok === false, `issues=${wrong.issues.length}`);

    // 3. Documents officiels : signatures Ed25519 vérifiables avec la clé publique restaurée
    const docs = (
      await admin.query(
        `SELECT d.id, d.tenant_id, d.snapshot_hash, d.verification_code, d.signature, d.issued_at, k.public_key,
                (d.snapshot_hash = reportcards.canonical_hash(d.snapshot, d.explain)) AS hash_ok,
                EXISTS (SELECT 1 FROM reportcards.verification_index v WHERE v.code = d.verification_code AND v.document_id = d.id) AS indexed
           FROM reportcards.official_documents d JOIN reportcards.signing_keys k ON k.key_id = d.signing_key_id`,
      )
    ).rows as Array<{ snapshot_hash: string; verification_code: string; signature: string; issued_at: Date; public_key: string; hash_ok: boolean; indexed: boolean }>;
    const expectedDocs = manifest.tenants.reduce((s, t) => s + t.officialDocuments, 0);
    const sigOk = docs.filter((d) => verifyDocumentSignature(d.public_key, { snapshotHash: d.snapshot_hash, verificationCode: d.verification_code, issuedAt: d.issued_at }, d.signature)).length;
    add("documents : signatures Ed25519 vérifiables (clé publique restaurée)", docs.length === expectedDocs && sigOk === docs.length, `${sigOk}/${docs.length} (attendu ${expectedDocs})`);
    add("documents : empreinte du contenu = canonical_hash recalculé, index de vérification présent", docs.every((d) => d.hash_ok && d.indexed), `${docs.filter((d) => d.hash_ok && d.indexed).length}/${docs.length}`);
    const fp = publicKeyFingerprint(docs[0]!.public_key);
    add("documents : empreinte de la clé publique identique à la source", fp === manifest.signingPublicKeyFingerprint, fp.slice(0, 16));
    const d0 = docs[0]!;
    add(
      "témoin négatif : une signature altérée est rejetée",
      !verifyDocumentSignature(d0.public_key, { snapshotHash: "0".repeat(64), verificationCode: d0.verification_code, issuedAt: d0.issued_at }, d0.signature),
      "snapshotHash falsifié",
    );

    // 4. Coffre des secrets (SecretStorePort) : lisible avec le trousseau sauvegardé à part, illisible sans
    const store = new AesGcmSecretStore(parseKeyring(secrets.financeSecretsKeys)!);
    const strangerStore = new AesGcmSecretStore(parseKeyring(`k1:${randomBytes(32).toString("base64")}`)!);
    const cfgs = (await admin.query(`SELECT tenant_id, provider, secrets FROM finance.provider_configs`)).rows as Array<{ tenant_id: string; provider: string; secrets: Record<string, string> }>;
    let opened = 0;
    let refused = 0;
    for (const c of cfgs) {
      const scope = { tenantId: c.tenant_id, provider: c.provider, field: "api_key" };
      if ((await store.open(scope, c.secrets.api_key!)).startsWith("cle-de-test-")) opened += 1;
      try {
        await strangerStore.open(scope, c.secrets.api_key!);
      } catch (e) {
        if (e instanceof SecretStoreError && (e.reason === "tampered" || e.reason === "unknown_key")) refused += 1;
      }
    }
    const expectedCfgs = manifest.tenants.reduce((s, t) => s + t.providerConfigs, 0);
    add("coffre : secrets de fournisseurs déchiffrables avec le trousseau sauvegardé séparément", cfgs.length === expectedCfgs && opened === cfgs.length, `${opened}/${cfgs.length}`);
    add("témoin négatif : un autre trousseau ne déchiffre rien", refused === cfgs.length, `${refused}/${cfgs.length}`);

    // 5. Partitions d'audit et extensions
    const parts = (await admin.query(`SELECT count(*)::int AS n FROM pg_inherits WHERE inhparent = 'audit.audit_log'::regclass`)).rows[0].n as number;
    const now = new Date();
    const current = `audit_log_y${now.getUTCFullYear()}m${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const hasCurrent = (await admin.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`audit.${current}`])).rows[0].ok as boolean;
    add("audit : partitions présentes (>= 14) dont le mois courant", parts >= 14 && hasCurrent, `${parts} partitions, ${current}=${hasCurrent}`);
    const exts = (await admin.query(`SELECT extname FROM pg_extension ORDER BY 1`)).rows.map((r) => r.extname as string);
    const needed = ["btree_gist", "pg_trgm", "unaccent"];
    add("extensions requises présentes", needed.every((e) => exts.includes(e)), exts.join(","));

    // 6. Isolation RLS sur la base restaurée
    const noTenant = (await pool.query(`SELECT count(*)::int AS n FROM finance.invoices`)).rows[0].n as number;
    add("RLS : sans contexte de tenant, le rôle applicatif ne voit AUCUNE facture", noTenant === 0, `n=${noTenant}`);
    let isoOk = true;
    const isoDetails: string[] = [];
    for (const t of manifest.tenants) {
      const r = await tdb.run(ctxOf(t.id), async (tx) => ({
        own: Number((await tx.query(`SELECT count(*) AS n FROM finance.invoices`)).rows[0]!.n),
        foreign: Number((await tx.query(`SELECT count(*) AS n FROM finance.invoices WHERE tenant_id <> $1`, [t.id])).rows[0]!.n),
        ownAudit: Number((await tx.query(`SELECT count(*) AS n FROM audit.audit_log`)).rows[0]!.n),
        foreignAudit: Number((await tx.query(`SELECT count(*) AS n FROM audit.audit_log WHERE tenant_id <> $1`, [t.id])).rows[0]!.n),
        docs: Number((await tx.query(`SELECT count(*) AS n FROM reportcards.official_documents`)).rows[0]!.n),
      }));
      isoOk &&= r.own === t.invoices && r.foreign === 0 && r.ownAudit === t.auditEntries && r.foreignAudit === 0 && r.docs === t.officialDocuments;
      isoDetails.push(`${t.slug}:inv=${r.own} audit=${r.ownAudit} docs=${r.docs} fuite=${r.foreign + r.foreignAudit}`);
    }
    add("RLS : chaque tenant ne voit que ses lignes (factures, audit, documents), 0 fuite", isoOk, isoDetails.join(" "));

    const discover = await discoverModules({});
    const keys = discover.map((m) => m.key);
    const allow = await loadIsolationAllowlist({ knownModules: keys });
    const iso = await checkTenantIsolation({ pool, schemas: ["kernel", ...keys], allowlist: allow.tables, fixtures: allow.fixtures });
    const staleOrViol = iso.violations.length + iso.staleAllowlist.length;
    add(
      "RLS : test d'isolation GLOBAL (structure + comportement) sur la base restaurée",
      staleOrViol === 0,
      `testées=${iso.behavioural.length} structure seule=${iso.structuralOnly.length} allowlist=${iso.allowlisted.length} violations=${iso.violations.length}`,
    );

    // 7. Compteurs : prochain numéro = dernier + 1, la chaîne d'audit continue
    const deps = financeWorld(tdb);
    const t0 = manifest.tenants[0]!;
    const ctx0 = ctxOf(t0.id);
    const maxInvoice = Number((await admin.query(`SELECT max(number_seq) AS m FROM finance.invoices WHERE tenant_id = $1`, [t0.id])).rows[0].m);
    const learner = learnerId();
    const inv = (await simpleInvoice(deps, ctx0, learner, 50_000)).invoice;
    const seqAfter = Number((await admin.query(`SELECT number_seq AS s FROM finance.invoices WHERE id = $1`, [inv.id])).rows[0].s);
    add("compteurs : la prochaine facture reçoit max + 1 (sans trou)", seqAfter === maxInvoice + 1, `max=${maxInvoice} nouveau=${seqAfter}`);
    const maxReceipt = Number((await admin.query(`SELECT max(number_seq) AS m FROM finance.receipts WHERE tenant_id = $1`, [t0.id])).rows[0].m);
    const paid = await pay(deps, ctx0, learner, 50_000);
    const rcpt = Number((await admin.query(`SELECT max(number_seq) AS m FROM finance.receipts WHERE tenant_id = $1`, [t0.id])).rows[0].m);
    add("compteurs : le prochain reçu reçoit max + 1", paid.ok && rcpt === maxReceipt + 1, `max=${maxReceipt} nouveau=${rcpt}`);
    await tdb.run(ctx0, (tx) => goodAudit.record(tx, { action: "drill.post_restore_write", entity: "invoice", entityId: inv.id }));
    const after = await tdb.run(ctx0, (tx) => goodAudit.verifyChain(tx, t0.id));
    add("audit : une écriture après restauration prolonge la chaîne sans la rompre", after.ok && after.checked === t0.auditEntries + 1, `checked=${after.checked} ok=${after.ok}`);
    const ledgerAfter = await ledgerViolations({ admin }, t0.id);
    add("finance : grand livre toujours cohérent après de nouvelles écritures", ledgerAfter.length === 0, `violations=${ledgerAfter.length}`);

    console.log(`DRILL_JSON:${JSON.stringify({ checks })}`);
  } finally {
    await pool.end().catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

const [command, ...rest] = process.argv.slice(2);
const run = command === "migrate" ? cmdMigrate() : command === "seed" ? cmdSeed(rest) : command === "verify" ? cmdVerify() : Promise.reject(new Error("commande inconnue (migrate|seed|verify)"));
run.then(
  () => process.exit(0),
  (e) => {
    console.error(`[restore-drill/steps] ÉCHEC ${command} : ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  },
);
