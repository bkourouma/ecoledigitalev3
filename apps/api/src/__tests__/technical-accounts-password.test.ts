import bcrypt from "bcryptjs";

type QueryCall = { sql: string; params: unknown[] };

/** Faux PoolClient : un seul rôle global, aucun compte technique existant. */
function fakeClient() {
  const calls: QueryCall[] = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM roles/i.test(sql)) {
        return { rows: [{ id: "role-1", key: "admin", name: "Administrateur", is_active: true }] };
      }
      if (/is_technical_account/i.test(sql) && /SELECT u\.id/i.test(sql)) return { rows: [] };
      if (/INSERT INTO users/i.test(sql)) return { rows: [{ id: "user-1" }] };
      return { rows: [] };
    }),
  };
  return { client: client as any, calls };
}

async function loadService() {
  jest.resetModules();
  return import("../services/tenant-provisioning.service");
}

describe("comptes techniques — mot de passe", () => {
  const original = process.env.TECHNICAL_ACCOUNT_PASSWORD;

  afterEach(() => {
    if (original === undefined) delete process.env.TECHNICAL_ACCOUNT_PASSWORD;
    else process.env.TECHNICAL_ACCOUNT_PASSWORD = original;
    jest.restoreAllMocks();
  });

  it("n'exporte plus de mot de passe par défaut", async () => {
    const service = await loadService();
    expect((service as Record<string, unknown>).DEFAULT_TECHNICAL_PASSWORD).toBeUndefined();
  });

  it("utilise TECHNICAL_ACCOUNT_PASSWORD et ne stocke jamais le clair", async () => {
    process.env.TECHNICAL_ACCOUNT_PASSWORD = "q8Zk-W3mT-p7LxB-2";
    const service = await loadService();
    const { client, calls } = fakeClient();

    await service.ensureTechnicalAccountsForTenant(client, "tenant-1", "demo");

    const insert = calls.find((c) => /INSERT INTO users/i.test(c.sql));
    expect(insert).toBeDefined();
    const [, , , , , passwordHash, initialPassword] = insert!.params;
    expect(await bcrypt.compare("q8Zk-W3mT-p7LxB-2", passwordHash as string)).toBe(true);
    expect(initialPassword).toBeNull();
  });

  it("sans variable : génère un mot de passe aléatoire, l'annonce une seule fois", async () => {
    delete process.env.TECHNICAL_ACCOUNT_PASSWORD;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const service = await loadService();
    const first = fakeClient();
    const second = fakeClient();

    await service.ensureTechnicalAccountsForTenant(first.client, "tenant-1", "demo");
    await service.ensureTechnicalAccountsForTenant(second.client, "tenant-2", "autre");

    const announcements = warn.mock.calls.filter((args) => String(args[0]).includes("[technical-accounts]"));
    expect(announcements).toHaveLength(1);

    const hash1 = first.calls.find((c) => /INSERT INTO users/i.test(c.sql))!.params[5] as string;
    const hash2 = second.calls.find((c) => /INSERT INTO users/i.test(c.sql))!.params[5] as string;
    expect(typeof hash1).toBe("string");
    // Le mot de passe généré n'est pas l'ancienne valeur par défaut.
    expect(await bcrypt.compare("Password@2025", hash1)).toBe(false);
    // Même mot de passe pour tous les comptes créés par ce process.
    const printed = String(announcements[0][0]).split(": ").pop() as string;
    expect(await bcrypt.compare(printed, hash1)).toBe(true);
    expect(await bcrypt.compare(printed, hash2)).toBe(true);
  });
});
