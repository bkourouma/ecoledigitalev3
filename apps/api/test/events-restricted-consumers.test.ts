/**
 * Événements à charge SENSIBLE : restriction des abonnés (sans base de données).
 *
 * `examinations.result.transmitted` (décision métier Q-E18) est le SEUL événement d'examens qui porte une MOYENNE (« admis / non admis »
 * ET moyenne vers l'admission en 6e). Garde-fou de minimisation : aucun autre module que `admissions` ne peut le consommer, ni par son
 * nom, ni par un motif qui le couvrirait (`examinations.*.*`, `examinations.**`, `**`…), ni par un abonné du worker.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { entryCovers, loadEventsCatalog, type EventsCatalog } from "./helpers/events-catalog";

const RESTRICTED: ReadonlyArray<{ event: string; allowedConsumers: readonly string[] }> = [{ event: "examinations.result.transmitted", allowedConsumers: ["admissions"] }];

let catalog: EventsCatalog;
beforeAll(async () => {
  catalog = await loadEventsCatalog();
});

describe("événements à charge sensible : abonnés restreints", () => {
  for (const { event, allowedConsumers } of RESTRICTED) {
    it(`« ${event} » : producteur déclaré, consommé par ${allowedConsumers.join(", ")} seulement (noms, motifs et abonnés du worker)`, () => {
      expect(catalog.producers.get(event)).toEqual([event.split(".")[0]]);
      const declared = [...catalog.consumes.entries()].filter(([, entries]) => entries.some((e) => entryCovers(e, event))).map(([module]) => module);
      expect(declared.sort()).toEqual([...allowedConsumers].sort());
      const subscribers = catalog.subscribers.filter((s) => s.matches(event)).map((s) => `${s.module}:${s.name}`);
      for (const s of subscribers) expect(allowedConsumers, `abonné non autorisé : ${s}`).toContain(s.split(":")[0]);
      expect(subscribers.length).toBeGreaterThan(0);
    });
  }

  it("`examinations.result.published` (issue seule, sans moyenne) reste distinct de l'événement qui porte la moyenne", () => {
    expect(catalog.allPublished).toContain("examinations.result.published");
    expect(catalog.allPublished).toContain("examinations.result.transmitted");
  });
});
