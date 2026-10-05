/**
 * Quotas de stockage par plan (Q-05) : 5 / 50 / 250 Gio, palier le plus haut accordé, environnement optionnel, échec sûr.
 */
import { describe, expect, it } from "vitest";
import { GIB, PLAN_QUOTA_DEFAULT_BYTES, QUOTA_FEATURE_KEYS, planQuotaBytes, quotaTierFor } from "../../domain/quota";
import manifest from "../../manifest";

describe("quotas de stockage par plan (Q-05)", () => {
  it("5 Gio / 50 Gio / 250 Gio par défaut", () => {
    expect(PLAN_QUOTA_DEFAULT_BYTES).toEqual({ base: 5 * GIB, extended: 50 * GIB, large: 250 * GIB });
    expect(planQuotaBytes("base")).toBe(5 * 1024 ** 3);
    expect(planQuotaBytes("extended")).toBe(50 * 1024 ** 3);
    expect(planQuotaBytes("large")).toBe(250 * 1024 ** 3);
  });

  it("le palier le plus haut accordé gagne (large > extended > base)", () => {
    expect(quotaTierFor({ extended: false, large: false })).toBe("base");
    expect(quotaTierFor({ extended: true, large: false })).toBe("extended");
    expect(quotaTierFor({ extended: false, large: true })).toBe("large");
    expect(quotaTierFor({ extended: true, large: true })).toBe("large");
  });

  it("l'environnement ajuste un palier ; une valeur absente, nulle, négative, décimale ou illisible retombe sur le défaut", () => {
    expect(planQuotaBytes("base", { DOCUMENTS_QUOTA_BASE_BYTES: "1073741824" })).toBe(GIB);
    expect(planQuotaBytes("extended", { DOCUMENTS_QUOTA_EXTENDED_BYTES: "2147483648" })).toBe(2 * GIB);
    for (const bad of ["", "0", "-5", "abc", "1.5", "NaN", "Infinity", "1e400"]) expect(planQuotaBytes("large", { DOCUMENTS_QUOTA_LARGE_BYTES: bad })).toBe(250 * GIB);
    expect(planQuotaBytes("large", { DOCUMENTS_QUOTA_BASE_BYTES: "1" })).toBe(250 * GIB); // une autre clé ne s'applique pas
  });

  it("les features de palier existent dans le manifeste (le rattachement aux plans se fait dans la console des entitlements)", () => {
    const keys = manifest.features.map((f) => f.key);
    expect(keys).toContain(QUOTA_FEATURE_KEYS.extended);
    expect(keys).toContain(QUOTA_FEATURE_KEYS.large);
  });
});
