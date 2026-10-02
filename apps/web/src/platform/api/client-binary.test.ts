import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

function makeClient(fetchMock: typeof fetch) {
  return createApiClient({ baseUrl: "https://api.test", getTenant: () => "ipam", getToken: () => "tok", fetch: fetchMock, sleep: async () => undefined, retries: 0 });
}

describe("createApiClient — corps binaire", () => {
  it("envoie un fichier tel quel (jamais en JSON), avec le jeton, le tenant et le Content-Type de l'appelant", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json" } }));
    const file = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
    await makeClient(fetchMock as unknown as typeof fetch).request("PUT", "/api/v1/people/students/s1/documents", { query: { typeCode: "ID_CARD", fileName: "cni.pdf" }, body: file, headers: { "Content-Type": "application/pdf" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/people/students/s1/documents?typeCode=ID_CARD&fileName=cni.pdf");
    expect(init.body).toBe(file);
    expect(init.headers).toMatchObject({ "Content-Type": "application/pdf", "X-Tenant": "ipam", Authorization: "Bearer tok" });
  });

  it("un tampon d'octets est aussi transmis sans sérialisation", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const bytes = new Uint8Array([1, 2, 3]);
    await makeClient(fetchMock as unknown as typeof fetch).request("PUT", "/x", { body: bytes, headers: { "Content-Type": "image/png" } });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(bytes);
  });
});
