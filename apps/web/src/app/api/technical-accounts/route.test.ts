import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { GET as GET_TOTP } from "./totp/route";

// Secret factice de test (vecteur de la RFC 6238 : « 12345678901234567890 » en base32) : à t = 59 s, le code est 287082.
const FAKE_TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const file = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  accounts: [
    { tenant: "demo-a", pack: "SECONDARY", role: "directeur", email: "dir@demo-a.test", password: "fake-pw-1", totpSecret: FAKE_TOTP_SECRET },
    { tenant: "demo-a", pack: "SECONDARY", role: "enseignant", email: "ens@demo-a.test", password: "fake-pw-2" },
    { tenant: "demo-b", pack: "PRIMARY", role: "role_inconnu", email: "x@demo-b.test", password: "fake-pw-3" },
  ],
};

let dir: string;
let credentialsPath: string;

const listRequest = (query = "") => new NextRequest(`http://localhost:3000/api/technical-accounts${query}`);
const totpRequest = (email: string) => new NextRequest(`http://localhost:3000/api/technical-accounts/totp?email=${encodeURIComponent(email)}`);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ed-creds-"));
  credentialsPath = path.join(dir, "credentials.json");
  writeFileSync(credentialsPath, JSON.stringify(file));
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SHOW_TECHNICAL_ACCOUNTS", "");
  vi.stubEnv("DEV_CREDENTIALS_FILE", credentialsPath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/technical-accounts avec DEV_CREDENTIALS_FILE", () => {
  it("renvoie les comptes du fichier, libellés français et indicateur mfa, sans secret TOTP", async () => {
    const res = await GET(listRequest());
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.accounts).toHaveLength(3);
    expect(body.accounts[0]).toMatchObject({ tenant: "demo-a", role: "directeur", label: "Directeur", email: "dir@demo-a.test", password: "fake-pw-1", mfa: true });
    expect(body.accounts[1]).toMatchObject({ label: "Enseignant", mfa: false });
    expect(body.accounts[2]).toMatchObject({ label: "Role inconnu" });
    expect(JSON.stringify(body)).not.toContain(FAKE_TOTP_SECRET);
    expect(JSON.stringify(body)).not.toContain("totpSecret");
  });

  it("ne renvoie rien en production sans SHOW_TECHNICAL_ACCOUNTS=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const body = await (await GET(listRequest())).json();
    expect(body).toEqual({ enabled: false, accounts: [] });
  });

  it("retombe sur les comptes génériques si le fichier est absent ou invalide", async () => {
    vi.stubEnv("DEV_CREDENTIALS_FILE", path.join(dir, "absent.json"));
    const missing = await (await GET(listRequest("?tenant=demo-a"))).json();
    expect(missing.enabled).toBe(true);
    expect(missing.accounts.map((a: { email: string }) => a.email)).toContain("admin@demo-a.local");

    writeFileSync(credentialsPath, "{pas du json");
    const broken = await (await GET(listRequest("?tenant=demo-a"))).json();
    expect(broken.accounts[0].email).toBe("admin@demo-a.local");
  });

  it("sans fichier ni tenant, la liste est vide", async () => {
    vi.stubEnv("DEV_CREDENTIALS_FILE", "");
    const body = await (await GET(listRequest())).json();
    expect(body).toEqual({ enabled: true, accounts: [] });
  });
});

describe("GET /api/technical-accounts/totp", () => {
  afterEach(() => vi.useRealTimers());

  it("calcule le code RFC 6238 (SHA-1, 6 chiffres, pas de 30 s) à un instant fixé", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(59_000);
    const res = await GET_TOTP(totpRequest("DIR@demo-a.test"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ code: "287082", expiresIn: 1 });

    vi.setSystemTime(60_000);
    const next = await (await GET_TOTP(totpRequest("dir@demo-a.test"))).json();
    expect(next.expiresIn).toBe(30);
    expect(next.code).toMatch(/^\d{6}$/);
    expect(next.code).not.toBe("287082");
  });

  it("répond 404 sans secret (compte sans MFA, inconnu, e-mail absent)", async () => {
    for (const email of ["ens@demo-a.test", "inconnu@demo-a.test", ""]) {
      const res = await GET_TOTP(totpRequest(email));
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("répond 404 en production sans SHOW_TECHNICAL_ACCOUNTS=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET_TOTP(totpRequest("dir@demo-a.test"))).status).toBe(404);
    vi.stubEnv("SHOW_TECHNICAL_ACCOUNTS", "true");
    expect((await GET_TOTP(totpRequest("dir@demo-a.test"))).status).toBe(200);
  });
});
