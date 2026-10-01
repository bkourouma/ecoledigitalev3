/**
 * Couverture des contrats : tout événement consommé (manifeste) a un contrat dans `events-contracts/<consommateur>.contracts.ts`,
 * et aucun contrat ne vise un événement que le module ne consomme plus. Ajouter un `events.consumes` sans contrat fait échouer.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { consumedEdges, loadEventsCatalog } from "../helpers/events-catalog";
import type { EventContract } from "./support";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = await loadEventsCatalog();

interface ContractsModule {
  contracts: EventContract[];
  exemptions?: Array<{ event: string; reason: string }>;
}

const files = readdirSync(here).filter((f) => f.endsWith(".contracts.ts"));
const byConsumer = new Map<string, ContractsModule>();
for (const f of files) {
  byConsumer.set(f.replace(/\.contracts\.ts$/, ""), (await import(pathToFileURL(join(here, f)).href)) as ContractsModule);
}

describe("couverture des contrats d'événements", () => {
  it("chaque événement consommé a un contrat (ou une exemption motivée)", () => {
    const missing: string[] = [];
    for (const edge of consumedEdges(catalog)) {
      const mod = byConsumer.get(edge.consumer);
      for (const event of edge.events) {
        const covered = mod?.contracts.some((c) => c.event === event) || mod?.exemptions?.some((e) => e.event === event);
        if (!covered) missing.push(`${edge.consumer} consomme « ${event} » sans contrat dans test/events-contracts/${edge.consumer}.contracts.ts`);
      }
    }
    expect(missing, `\n  - ${missing.join("\n  - ")}\n`).toEqual([]);
  });

  it("aucun contrat ne vise un événement non consommé", () => {
    const stale: string[] = [];
    for (const [consumer, mod] of byConsumer) {
      const consumed = new Set(consumedEdges(catalog).filter((e) => e.consumer === consumer).flatMap((e) => e.events));
      for (const c of mod.contracts) if (!consumed.has(c.event)) stale.push(`${consumer} : contrat « ${c.event} » alors que le manifeste ne le consomme pas`);
      for (const e of mod.exemptions ?? []) if (!consumed.has(e.event)) stale.push(`${consumer} : exemption « ${e.event} » alors que le manifeste ne le consomme pas`);
    }
    expect(stale, `\n  - ${stale.join("\n  - ")}\n`).toEqual([]);
  });

  it("chaque contrat cite son propre consommateur et un fichier par module consommateur", () => {
    const errors: string[] = [];
    for (const [consumer, mod] of byConsumer) {
      if (!catalog.keys.includes(consumer)) errors.push(`${consumer}.contracts.ts : module inconnu`);
      for (const c of mod.contracts) if (c.consumer !== consumer) errors.push(`${consumer}.contracts.ts : contrat « ${c.event} » déclare le consommateur « ${c.consumer} »`);
    }
    expect(errors).toEqual([]);
  });
});
