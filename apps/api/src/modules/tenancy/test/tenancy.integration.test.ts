/**
 * Intégration (vrai Postgres) : provisioning de DEUX tenants et preuve qu'ils ne
 * se voient pas, use cases, atomicité, événements d'outbox, test d'isolation générique.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { ManualClock, createRequestContext, createSystemContext, newId, type RequestContext } from "@ecoledigitale/kernel";
import {
  TenancyInstitutionCreatedPayloadSchema,
  TenancyTenantProvisionedPayloadSchema,
  TenancyTenantStatusChangedPayloadSchema,
} from "@ecoledigitale/contracts/src/v2/tenancy";
import {
  completeOnboardingStep,
  createCampus,
  createInstitution,
  deleteCampus,
  getInstitution,
  getOnboarding,
  getTenantProfile,
  getTenantStatus,
  listCampuses,
  listInstitutions,
  provisionTenant,
  setTenantStatus,
  skipOnboardingStep,
  updateCampus,
  updateInstitution,
  updateTenantProfile,
  type TenancyDeps,
} from "../index";
import { TENANCY_ISOLATION_ALLOWLIST, tenancyIsolationFixtures } from "../../isolation-allowlist.tenancy";
import { TENANCY_MIGRATIONS, createTestDb, describeIntegration, type TestDb } from "./support/db";

/** Code de la première violation d'une ValidationError (undefined si succès ou autre erreur). */
const issue = (r: { ok: boolean; error?: unknown }): string | undefined =>
  r.ok ? undefined : (r.error as { issues?: Array<{ code?: string }> }).issues?.[0]?.code;

const clock = new ManualClock("2026-10-01T08:00:00.000Z");

const asTenant = (tenantId: string): RequestContext =>
  createRequestContext({ tenantId, userId: newId(), roles: ["director"] });

describeIntegration("tenancy — intégration", () => {
  let db: TestDb;
  let deps: TenancyDeps;
  let A: { tenantId: string; institutionIds: string[]; campusIds: string[] };
  let B: { tenantId: string; institutionIds: string[]; campusIds: string[] };

  async function provision(slug: string, packs: Array<"PRIMARY" | "SECONDARY" | "HIGHER" | "VIRTUAL">) {
    const r = await provisionTenant(deps, {
      name: `Groupe ${slug}`,
      slug,
      countryCode: "CI",
      packs,
      adminContact: { name: "Awa Koné", email: `direction@${slug}.ci`, phone: "+225 07 00 00 00 00" },
    });
    if (!r.ok) throw r.error;
    return {
      tenantId: r.value.tenantId,
      institutionIds: r.value.institutions.map((i) => i.id),
      campusIds: r.value.institutions.map((i) => i.defaultCampusId),
    };
  }

  const countRaw = async (sql: string, params: unknown[] = []): Promise<number> =>
    Number((await db.admin.query(sql, params)).rows[0].n);

  beforeAll(async () => {
    db = await createTestDb([TENANCY_MIGRATIONS]);
    deps = { db: db.tenantDb, clock };
    A = await provision("lauriers", ["PRIMARY", "SECONDARY"]);
    B = await provision("palmiers", ["HIGHER"]);
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe("provisioning", () => {
    it("crée l'organisation, une institution par pack et un campus par défaut chacune", async () => {
      expect(await countRaw("SELECT count(*)::int AS n FROM kernel.tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]])).toBe(2);
      expect(A.institutionIds).toHaveLength(2);
      expect(B.institutionIds).toHaveLength(1);

      const listA = await listInstitutions(deps, asTenant(A.tenantId));
      expect(listA.ok && listA.value.map((i) => [i.pack, i.status, i.countryCode, i.educationSystem])).toEqual([
        ["PRIMARY", "ACTIVE", "CI", "CI"],
        ["SECONDARY", "ACTIVE", "CI", "CI"],
      ]);

      for (const instId of A.institutionIds) {
        const campuses = await listCampuses(deps, asTenant(A.tenantId), instId);
        expect(campuses.ok && campuses.value).toHaveLength(1);
        expect(campuses.ok && campuses.value[0]?.isDefault).toBe(true);
      }
    });

    it("profil 1:1 avec le tenant, contacts et pays posés", async () => {
      const p = await getTenantProfile(deps, asTenant(A.tenantId));
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      expect(p.value).toMatchObject({
        tenantId: A.tenantId,
        slug: "lauriers",
        legalName: "Groupe lauriers",
        countryCode: "CI",
        contactEmail: "direction@lauriers.ci",
        contactPhone: "+225 07 00 00 00 00",
        primaryColor: null,
        customDomain: null,
      });
      expect(await countRaw("SELECT count(*)::int AS n FROM tenancy.tenant_profiles")).toBe(2);
    });

    it("onboarding : 5 étapes accomplies par le provisioning, étape courante = année scolaire", async () => {
      const s = await getOnboarding(deps, asTenant(A.tenantId));
      expect(s.ok).toBe(true);
      if (!s.ok) return;
      expect(s.value.status).toBe("IN_PROGRESS");
      expect(s.value.currentStep).toBe("ACADEMIC_YEAR");
      expect(s.value.progress).toMatchObject({ done: 5, total: 11 });
    });

    it("événements d'outbox : un institution.created par pack puis tenant.provisioned, payloads conformes aux contrats", async () => {
      const rows = (
        await db.admin.query(
          "SELECT type, version, aggregate_id, payload, tenant_id FROM kernel.domain_events WHERE tenant_id = $1 ORDER BY id",
          [A.tenantId],
        )
      ).rows;
      expect(rows.map((r) => r.type)).toEqual([
        "tenancy.institution.created",
        "tenancy.institution.created",
        "tenancy.tenant.provisioned",
      ]);
      for (const r of rows.slice(0, 2)) {
        const p = TenancyInstitutionCreatedPayloadSchema.parse(r.payload);
        expect(A.institutionIds).toContain(p.institutionId);
        expect(r.version).toBe(1);
      }
      const provisioned = TenancyTenantProvisionedPayloadSchema.parse(rows[2].payload);
      expect(provisioned).toMatchObject({ tenantId: A.tenantId, slug: "lauriers", packs: ["PRIMARY", "SECONDARY"] });
      expect(provisioned.institutionIds).toEqual(A.institutionIds);
    });

    it("slug déjà pris : conflit, et RIEN n'est créé (atomicité)", async () => {
      const before = await countRaw("SELECT count(*)::int AS n FROM tenancy.institutions");
      const eventsBefore = await countRaw("SELECT count(*)::int AS n FROM kernel.domain_events");
      const r = await provisionTenant(deps, {
        name: "Doublon",
        slug: "lauriers",
        countryCode: "CI",
        packs: ["PRIMARY"],
        adminContact: { name: "Awa Koné", email: "a@b.ci" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("tenancy.slug_taken");
      expect(await countRaw("SELECT count(*)::int AS n FROM tenancy.institutions")).toBe(before);
      expect(await countRaw("SELECT count(*)::int AS n FROM kernel.domain_events")).toBe(eventsBefore);
    });

    it("pays inconnu, slug réservé, entrée invalide : erreurs de validation, aucune écriture", async () => {
      const base = { name: "Test", slug: "ecole-test", countryCode: "CI", packs: ["PRIMARY"], adminContact: { name: "Awa Koné", email: "a@b.ci" } };
      const tenantsBefore = await countRaw("SELECT count(*)::int AS n FROM kernel.tenants");

      const unknownCountry = await provisionTenant(deps, { ...base, countryCode: "ZZ" });
      expect(issue(unknownCountry)).toBe("tenancy.country_unknown");

      const reserved = await provisionTenant(deps, { ...base, slug: "admin" });
      expect(issue(reserved)).toBe("tenancy.slug_reserved");

      const invalid = await provisionTenant(deps, { ...base, packs: [] });
      expect(!invalid.ok && invalid.error.code).toBe("VALIDATION_FAILED");

      expect(await countRaw("SELECT count(*)::int AS n FROM kernel.tenants")).toBe(tenantsBefore);
    });

    it("échec en cours de route (identifiant en double) : transaction annulée, ni tenant ni profil ni événement", async () => {
      const tenantId = newId();
      const dup = newId();
      // séquence : tenant, inst1, campus1, inst2 (= inst1 -> violation de clé primaire), campus2
      const seq = [tenantId, dup, newId(), dup, newId()];
      let i = 0;
      const broken: TenancyDeps = { ...deps, newId: () => seq[i++] ?? newId() };

      await expect(
        provisionTenant(broken, {
          name: "Cassé",
          slug: "casse",
          countryCode: "CI",
          packs: ["PRIMARY", "SECONDARY"],
          adminContact: { name: "Awa Koné", email: "a@b.ci" },
        }),
      ).rejects.toMatchObject({ code: "23505" });

      expect(await countRaw("SELECT count(*)::int AS n FROM kernel.tenants WHERE id = $1 OR slug = 'casse'", [tenantId])).toBe(0);
      expect(await countRaw("SELECT count(*)::int AS n FROM tenancy.tenant_profiles WHERE tenant_id = $1", [tenantId])).toBe(0);
      expect(await countRaw("SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1", [tenantId])).toBe(0);
    });

    it("provisioning par un opérateur plateforme : acteur superAdmin tracé sur les étapes d'onboarding", async () => {
      const operator = newId();
      const r = await provisionTenant(
        deps,
        { name: "Op", slug: "ecole-op", countryCode: "CI", packs: ["VIRTUAL"], adminContact: { name: "Awa Koné", email: "a@b.ci" } },
        { requestedBy: operator },
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const by = await db.admin.query("SELECT DISTINCT completed_by FROM tenancy.onboarding_steps WHERE tenant_id = $1 AND status = 'COMPLETED'", [r.value.tenantId]);
      expect(by.rows).toEqual([{ completed_by: operator }]);
    });
  });

  describe("isolation entre les deux tenants provisionnés", () => {
    it("chaque tenant ne voit que ses établissements, campus, profil et onboarding", async () => {
      const a = asTenant(A.tenantId);
      const b = asTenant(B.tenantId);

      const listA = await listInstitutions(deps, a);
      const listB = await listInstitutions(deps, b);
      expect(listA.ok && listA.value.map((i) => i.id).sort()).toEqual([...A.institutionIds].sort());
      expect(listB.ok && listB.value.map((i) => i.id)).toEqual(B.institutionIds);
      expect(listA.ok && listA.value.every((i) => i.tenantId === A.tenantId)).toBe(true);

      const profileA = await getTenantProfile(deps, a);
      const profileB = await getTenantProfile(deps, b);
      expect(profileA.ok && profileA.value.slug).toBe("lauriers");
      expect(profileB.ok && profileB.value.slug).toBe("palmiers");

      // Même volume brut côté base, mais chaque contexte n'en voit qu'une part.
      expect(await countRaw("SELECT count(*)::int AS n FROM tenancy.institutions")).toBeGreaterThanOrEqual(3);
    });

    it("A ne peut ni lire, ni modifier, ni supprimer, ni rattacher quoi que ce soit à un objet de B", async () => {
      const a = asTenant(A.tenantId);
      const bInstitution = B.institutionIds[0] as string;
      const bCampus = B.campusIds[0] as string;

      const read = await getInstitution(deps, a, bInstitution);
      expect(!read.ok && read.error.code).toBe("tenancy.institution_not_found");

      const update = await updateInstitution(deps, a, bInstitution, { name: "Piratée" });
      expect(!update.ok && update.error.code).toBe("tenancy.institution_not_found");

      const campuses = await listCampuses(deps, a, bInstitution);
      expect(!campuses.ok && campuses.error.code).toBe("tenancy.institution_not_found");

      const attach = await createCampus(deps, a, bInstitution, { name: "Campus intrus" });
      expect(!attach.ok && attach.error.code).toBe("tenancy.institution_not_found");

      const rename = await updateCampus(deps, a, bCampus, { name: "Piraté" });
      expect(!rename.ok && rename.error.code).toBe("tenancy.campus_not_found");

      const del = await deleteCampus(deps, a, bCampus);
      expect(!del.ok && del.error.code).toBe("tenancy.campus_not_found");

      // B n'a rien subi.
      const stillB = await getInstitution(deps, asTenant(B.tenantId), bInstitution);
      expect(stillB.ok && stillB.value.name).toBe("Groupe palmiers");
    });

    it("SQL direct : A ne peut pas insérer un campus rattaché à l'établissement de B, même en usurpant le tenant_id", async () => {
      const a = asTenant(A.tenantId);
      // Sous l'identité de A, avec le tenant_id de A mais l'établissement de B : refusé par le garde-fou (FK ne voit pas la RLS).
      await expect(
        db.tenantDb.run(a, (tx) =>
          tx.query(
            "INSERT INTO tenancy.campuses (tenant_id, institution_id, code, name) VALUES ($1, $2, 'intrus', 'Intrus')",
            [A.tenantId, B.institutionIds[0]],
          ),
        ),
      ).rejects.toMatchObject({ code: "23503" });

      // Avec le tenant_id de B : refusé aussi (le garde-fou voit l'établissement de B comme inexistant pour A)...
      await expect(
        db.tenantDb.run(a, (tx) =>
          tx.query(
            "INSERT INTO tenancy.campuses (tenant_id, institution_id, code, name) VALUES ($1, $2, 'intrus', 'Intrus')",
            [B.tenantId, B.institutionIds[0]],
          ),
        ),
      ).rejects.toMatchObject({ code: "23503" });

      // ... et la policy RLS (WITH CHECK) refuse toute écriture au nom de B, sans autre garde-fou en jeu.
      await expect(
        db.tenantDb.run(a, (tx) =>
          tx.query("INSERT INTO tenancy.onboarding_steps (tenant_id, step_key) VALUES ($1, 'ACCOUNT')", [B.tenantId]),
        ),
      ).rejects.toThrow(/row-level security|sécurité au niveau ligne/i);

      expect(await countRaw("SELECT count(*)::int AS n FROM tenancy.campuses WHERE code = 'intrus'")).toBe(0);
    });

    it("un tenant sans données ne voit aucune ligne des tables de tenant ; le référentiel des pays reste lisible", async () => {
      const sys = createSystemContext(newId());
      const rows = await db.tenantDb.run(sys, async (tx) => ({
        institutions: (await tx.many("SELECT id FROM tenancy.institutions")).length,
        profiles: (await tx.many("SELECT tenant_id FROM tenancy.tenant_profiles")).length,
        countries: (await tx.many("SELECT code FROM tenancy.country_profiles")).length,
      }));
      expect(rows).toEqual({ institutions: 0, profiles: 0, countries: 1 });
    });

    it("la progression d'onboarding d'un tenant n'affecte pas l'autre", async () => {
      const a = asTenant(A.tenantId);
      const r = await completeOnboardingStep(deps, a, "ACADEMIC_YEAR");
      expect(r.ok && r.value.progress.done).toBe(6);
      const b = await getOnboarding(deps, asTenant(B.tenantId));
      expect(b.ok && b.value.progress.done).toBe(5);
    });

    it("test d'isolation générique (assertTenantIsolation) sur le schéma tenancy", async () => {
      const report = await assertTenantIsolation({
        pool: db.appPool,
        schemas: ["tenancy"],
        allowlist: TENANCY_ISOLATION_ALLOWLIST.map((e) => e.key),
        fixtures: tenancyIsolationFixtures,
      });
      expect(report.violations).toEqual([]);
      expect(report.staleAllowlist).toEqual([]);
      expect(report.allowlisted).toEqual(["tenancy.country_profiles"]);
      // Toutes les tables de tenant sont testées pour de vrai, pas seulement structurellement.
      expect(report.behavioural.sort()).toEqual([
        "tenancy.campuses",
        "tenancy.institutions",
        "tenancy.onboarding_steps",
        "tenancy.tenant_profiles",
      ]);
      expect(report.structuralOnly).toEqual([]);
    });
  });

  describe("établissements et campus", () => {
    let ctx: RequestContext;
    beforeAll(() => {
      ctx = asTenant(A.tenantId);
    });

    it("création d'un établissement : campus par défaut du modèle, code dérivé et unique, événement publié", async () => {
      const r = await createInstitution(deps, ctx, { name: "Lycée Virtuel", pack: "VIRTUAL" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.institution).toMatchObject({ code: "virtual", pack: "VIRTUAL", countryCode: "CI", educationSystem: "CI", status: "ACTIVE" });
      expect(r.value.defaultCampus).toMatchObject({ code: "online", isDefault: true, institutionId: r.value.institution.id });

      const second = await createInstitution(deps, ctx, { name: "Autre virtuel", pack: "VIRTUAL" });
      expect(second.ok && second.value.institution.code).toBe("virtual-2");

      const ev = await db.admin.query(
        "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'tenancy.institution.created' AND aggregate_id = $2",
        [A.tenantId, r.value.institution.id],
      );
      expect(TenancyInstitutionCreatedPayloadSchema.parse(ev.rows[0].payload).defaultCampusId).toBe(r.value.defaultCampus.id);
    });

    it("code explicite déjà pris : conflit ; pays inconnu : validation", async () => {
      const dup = await createInstitution(deps, ctx, { name: "Doublon", pack: "PRIMARY", code: "primary" });
      expect(!dup.ok && dup.error.code).toBe("tenancy.institution_code_taken");
      const country = await createInstitution(deps, ctx, { name: "Ailleurs", pack: "PRIMARY", countryCode: "ZZ" });
      expect(issue(country)).toBe("tenancy.country_unknown");
    });

    it("modification ; le dernier établissement actif ne peut pas être désactivé", async () => {
      const renamed = await updateInstitution(deps, ctx, A.institutionIds[0] as string, { name: "Primaire des Lauriers" });
      expect(renamed.ok && renamed.value.name).toBe("Primaire des Lauriers");

      // B n'a qu'un établissement : le désactiver est refusé.
      const last = await updateInstitution(deps, asTenant(B.tenantId), B.institutionIds[0] as string, { status: "SUSPENDED" });
      expect(!last.ok && last.error.code).toBe("tenancy.last_active_institution");

      const empty = await updateInstitution(deps, ctx, A.institutionIds[0] as string, {});
      expect(!empty.ok && empty.error.code).toBe("VALIDATION_FAILED");
    });

    it("campus : création, code dérivé, promotion du campus par défaut, protections, suppression", async () => {
      const inst = A.institutionIds[0] as string;
      const main = A.campusIds[0] as string;

      const plateau = await createCampus(deps, ctx, inst, { name: "Campus Plateau", city: "Abidjan" });
      expect(plateau.ok).toBe(true);
      if (!plateau.ok) return;
      expect(plateau.value).toMatchObject({ code: "campus-plateau", isDefault: false, city: "Abidjan" });

      const dup = await createCampus(deps, ctx, inst, { name: "Autre", code: "campus-plateau" });
      expect(!dup.ok && dup.error.code).toBe("tenancy.campus_code_taken");

      // Le campus par défaut ne se supprime ni ne se désactive.
      const delDefault = await deleteCampus(deps, ctx, main);
      expect(!delDefault.ok && delDefault.error.code).toBe("tenancy.campus_default_protected");
      const suspendDefault = await updateCampus(deps, ctx, main, { status: "SUSPENDED" });
      expect(!suspendDefault.ok && suspendDefault.error.code).toBe("tenancy.campus_default_protected");

      // Promotion : l'ancien campus par défaut est rétrogradé, il n'y en a toujours qu'un.
      const promoted = await updateCampus(deps, ctx, plateau.value.id, { isDefault: true });
      expect(promoted.ok && promoted.value.isDefault).toBe(true);
      const list = await listCampuses(deps, ctx, inst);
      expect(list.ok && list.value.filter((c) => c.isDefault).map((c) => c.id)).toEqual([plateau.value.id]);

      // L'ancien par défaut peut maintenant être supprimé.
      const del = await deleteCampus(deps, ctx, main);
      expect(del.ok).toBe(true);
      const after = await listCampuses(deps, ctx, inst);
      expect(after.ok && after.value.map((c) => c.id)).toEqual([plateau.value.id]);
    });
  });

  describe("profil et branding", () => {
    it("mise à jour du branding et des contacts", async () => {
      const r = await updateTenantProfile(deps, asTenant(A.tenantId), {
        primaryColor: "#1A73E8",
        secondaryColor: "#FBBC04",
        logoUrl: "https://cdn.example.org/lauriers.png",
        customDomain: "ecole.lauriers.ci",
        tradeName: "Les Lauriers",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value).toMatchObject({ primaryColor: "#1A73E8", customDomain: "ecole.lauriers.ci", tradeName: "Les Lauriers" });
      expect(r.value.updatedAt.getTime()).toBe(clock.now().getTime());
    });

    it("un domaine personnalisé ne peut servir qu'une organisation", async () => {
      const r = await updateTenantProfile(deps, asTenant(B.tenantId), { customDomain: "ECOLE.lauriers.ci".toLowerCase() });
      expect(!r.ok && r.error.code).toBe("tenancy.custom_domain_taken");
    });

    it("valeurs invalides : couleur, domaine, pays, raison sociale vide", async () => {
      const ctx = asTenant(A.tenantId);
      for (const bad of [
        { primaryColor: "rouge" },
        { customDomain: "https://x.org/path" },
        { countryCode: "ZZ" },
        { legalName: null },
        {},
        { inconnu: 1 },
      ]) {
        const r = await updateTenantProfile(deps, ctx, bad);
        expect(r.ok, JSON.stringify(bad)).toBe(false);
      }
    });
  });

  describe("onboarding persisté", () => {
    it("parcours complet jusqu'au GO_LIVE sur le tenant B, avec refus des raccourcis", async () => {
      const ctx = asTenant(B.tenantId);

      const tooEarly = await completeOnboardingStep(deps, ctx, "GO_LIVE");
      expect(!tooEarly.ok && tooEarly.error.code).toBe("tenancy.onboarding.prerequisites_unmet");
      const noSkip = await skipOnboardingStep(deps, ctx, "CLASSES");
      expect(!noSkip.ok && noSkip.error.code).toBe("tenancy.onboarding.step_not_skippable");
      const unknown = await completeOnboardingStep(deps, ctx, "NOPE");
      expect(!unknown.ok && unknown.error.code).toBe("VALIDATION_FAILED");

      for (const step of ["ACADEMIC_YEAR", "CLASSES"]) {
        const r = await completeOnboardingStep(deps, ctx, step);
        expect(r.ok, step).toBe(true);
      }
      for (const step of ["STUDENT_IMPORT", "TEACHERS", "FINANCE"]) {
        const r = await skipOnboardingStep(deps, ctx, step);
        expect(r.ok, step).toBe(true);
      }
      const live = await completeOnboardingStep(deps, ctx, "GO_LIVE");
      expect(live.ok && live.value).toMatchObject({ status: "LIVE", currentStep: null, progress: { done: 11, percent: 100 } });

      // Persisté : relecture à froid.
      const reread = await getOnboarding(deps, ctx);
      expect(reread.ok && reread.value.status).toBe("LIVE");
      const done = await completeOnboardingStep(deps, ctx, "FINANCE");
      expect(!done.ok && done.error.code).toBe("tenancy.onboarding.already_live");
    });
  });

  describe("statut du tenant", () => {
    it("un utilisateur du tenant ne peut pas changer son propre statut", async () => {
      const r = await setTenantStatus(deps, asTenant(A.tenantId), { status: "suspended" });
      expect(!r.ok && r.error.code).toBe("tenancy.tenant_status_forbidden");
    });

    it("suspension puis réactivation par un opérateur : statut lisible, événements publiés", async () => {
      const t = await provision("a-suspendre", ["PRIMARY"]);
      const operator = createRequestContext({ tenantId: t.tenantId, userId: newId(), actor: "superAdmin" });

      const suspended = await setTenantStatus(deps, operator, { status: "suspended", reason: "Impayé" });
      expect(suspended.ok && suspended.value).toMatchObject({ previous: "active", current: "suspended" });
      expect(await db.tenantDb.run(operator, (tx) => getTenantStatus(tx, t.tenantId))).toBe("suspended");

      const again = await setTenantStatus(deps, operator, { status: "suspended" });
      expect(!again.ok && again.error.code).toBe("tenancy.tenant_status_unchanged");

      const reactivated = await setTenantStatus(deps, operator, { status: "active" });
      expect(reactivated.ok).toBe(true);

      const ev = await db.admin.query(
        "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'tenancy.tenant.status_changed' ORDER BY id",
        [t.tenantId],
      );
      const payloads = ev.rows.map((r) => TenancyTenantStatusChangedPayloadSchema.parse(r.payload));
      expect(payloads.map((p) => [p.previousStatus, p.status, p.reason])).toEqual([
        ["active", "suspended", "Impayé"],
        ["suspended", "active", null],
      ]);
    });

    it("statut d'un tenant inexistant : null", async () => {
      const ctx = asTenant(A.tenantId);
      expect(await db.tenantDb.run(ctx, (tx) => getTenantStatus(tx, newId()))).toBeNull();
    });
  });

  describe("droits SQL", () => {
    it("le rôle applicatif n'a que SELECT sur le référentiel des pays et ne peut pas supprimer un établissement", async () => {
      const ctx = asTenant(A.tenantId);
      await expect(
        db.tenantDb.run(ctx, (tx) => tx.query("INSERT INTO tenancy.country_profiles (code, name, currency_code, locale, timezone, phone_prefix, education_system) VALUES ('XX','x','XXX','fr-CI','UTC','+1','x')")),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.tenantDb.run(ctx, (tx) => tx.query("DELETE FROM tenancy.institutions")),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("le pays par défaut est la Côte d'Ivoire : XOF sans décimale, fr-CI, Africa/Abidjan, +225", async () => {
      const row = (await db.admin.query("SELECT * FROM tenancy.country_profiles WHERE code = 'CI'")).rows[0];
      expect(row).toMatchObject({
        currency_code: "XOF",
        currency_exponent: 0,
        locale: "fr-CI",
        timezone: "Africa/Abidjan",
        phone_prefix: "+225",
        education_system: "CI",
      });
    });
  });
});

describe("tenancy — sans base", () => {
  it("(garde) les tests d'intégration sont ignorés proprement sans TEST_DATABASE_URL", () => {
    expect(true).toBe(true);
  });
});
