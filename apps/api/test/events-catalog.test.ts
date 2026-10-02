/**
 * Catalogue global des événements inter-modules (sans base de données).
 *
 * Garde-fou d'ALIGNEMENT : un événement consommé doit avoir un producteur, un producteur ne publie
 * que ce qu'il déclare, un abonné du worker n'écoute que ce que son module déclare consommer.
 * Les noms suivent `<module>.<entité>.<verbe-passé>`. Le producteur est la source de vérité : on
 * corrige le consommateur, jamais l'inverse (sauf défaut avéré du producteur).
 *
 * Analyse statique du code source des modules (hors tests/migrations) : tout littéral de chaîne
 * COMPLET « <clé-du-module>.<entité>.<verbe> » (constantes de `domain/events.ts` comprises) et tout
 * littéral passé à un point d'émission (`events.add(`, `.append(`, `createDomainEvent({ type })`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { consumedEdges, entryCovers, EVENT_NAME_RE, isPatternEntry, loadEventsCatalog, type EventsCatalog } from "./helpers/events-catalog";

let catalog: EventsCatalog;
beforeAll(async () => {
  catalog = await loadEventsCatalog();
});

/** Verbes qui ne sont pas des participes passés en « -ed », mais sont des états/faits assumés. */
const IRREGULAR_VERBS = new Set([
  "full", // academic.offering.full — état « complet »
  "paid", // finance.invoice.paid
  "overdue", // finance.invoice.overdue
  "held", // scheduling.occurrence.held
  "unheld", // scheduling.occurrence.unheld
  "mismatch", // rules.replay.mismatch, reportcards.integrity.mismatch — constat d'écart
  "expiring", // people.staff_qualification.expiring — alerte avant échéance (préavis)
  "orphan", // academic.enrollment_course.payment_orphan — constat
  "in", // iam.user.logged_in
  "withdrawn", // academic.enrollment.withdrawn, reportcards.report_card.withdrawn (participe passé irrégulier)
  "overridden", // scheduling.conflict.overridden (participe passé irrégulier)
  "reset", // iam.mfa.reset (participe passé invariable)
  "eligible", // higher.diploma.eligible — constat d'éligibilité (nom conservé : déjà consommé par les pages)
  "overlap", // scheduling.calendar_event.blocking_overlap — constat de chevauchement
  "sent", // messaging.message.sent — participe passé irrégulier (nom demandé par la spec 016)
  "ready", // primary_school.year_archive.ready — constat « archive prête » (nom fixé par la spec 005)
  "frozen", // primary_school.year_archive.frozen — participe passé irrégulier (gel irréversible, spec 005)
  "due", // stateassign.control.due — contrôle arrivé à échéance (nom de la spec 006, comme `overdue`)
  "discrepancy", // stateassign.reconciliation.discrepancy — constat d'écart (nom de la spec 006, comme `mismatch`)
]);

function verbOf(name: string): string {
  return name.split(".")[2]!;
}

function isPastVerb(name: string): boolean {
  const verb = verbOf(name);
  const last = verb.split("_").pop()!;
  return /ed$/.test(last) || IRREGULAR_VERBS.has(last) || IRREGULAR_VERBS.has(verb);
}

const fmt = (lines: string[]): string => (lines.length ? `\n  - ${lines.join("\n  - ")}\n` : "");

describe("catalogue des événements", () => {
  it("découvre les manifestes et leurs événements", () => {
    expect(catalog.keys.length).toBeGreaterThanOrEqual(10);
    expect(catalog.allPublished.length).toBeGreaterThan(100);
  });

  it("(d) les noms publiés et consommés sont bien formés <module>.<entité>.<verbe-passé>", () => {
    const errors: string[] = [];
    for (const [key, names] of catalog.publishes) {
      for (const name of names) {
        const m = EVENT_NAME_RE.exec(name);
        if (!m) errors.push(`${key} publie « ${name} » : forme attendue <module>.<entité>.<verbe-passé>`);
        else if (m[1] !== key) errors.push(`${key} publie « ${name} » : le préfixe doit être la clé du module (« ${key}. »)`);
        else if (!isPastVerb(name)) errors.push(`${key} publie « ${name} » : le verbe « ${verbOf(name)} » n'est pas un participe passé (ajouter à IRREGULAR_VERBS si c'est voulu)`);
      }
    }
    for (const [key, entries] of catalog.consumes) {
      for (const entry of entries) {
        if (isPatternEntry(entry)) {
          if (!/^[a-z][a-z0-9]*(\.(\*|\*\*|[a-z][a-z0-9_]*))+$/.test(entry)) errors.push(`${key} consomme le motif mal formé « ${entry} »`);
        } else if (!EVENT_NAME_RE.test(entry)) {
          errors.push(`${key} consomme « ${entry} » : forme attendue <module>.<entité>.<verbe-passé>`);
        }
      }
    }
    expect(errors, fmt(errors)).toEqual([]);
  });

  it("(d) aucun événement n'est publié par deux modules, ni deux fois par le même manifeste", () => {
    const errors: string[] = [];
    for (const [name, mods] of catalog.producers) {
      if (mods.length > 1) errors.push(`« ${name} » est publié par ${mods.join(" et ")}`);
    }
    expect(errors, fmt(errors)).toEqual([]);
  });

  it("(a) tout événement consommé a un producteur déclaré (les motifs couvrent au moins un événement publié)", () => {
    const errors: string[] = [];
    for (const edge of consumedEdges(catalog)) {
      if (edge.events.length === 0) {
        errors.push(
          isPatternEntry(edge.entry)
            ? `${edge.consumer} consomme le motif « ${edge.entry} » : aucun événement publié ne correspond`
            : `${edge.consumer} consomme « ${edge.entry} » : aucun manifeste ne le publie (events.publishes)`,
        );
      }
    }
    expect(errors, fmt(errors)).toEqual([]);
  });

  it("(b) tout nom publié dans le code d'un module figure dans son events.publishes", () => {
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const site of [...catalog.literals, ...catalog.emissions]) {
      const prefix = site.name.split(".")[0]!;
      const declared = catalog.publishes.get(site.module) ?? [];
      const consumed = (catalog.consumes.get(site.module) ?? []).some((e) => entryCovers(e, site.name));
      if (site.kind === "emission" && prefix !== site.module && catalog.keys.includes(prefix)) {
        const k = `${site.module}:${site.file}:${site.name}`;
        if (!seen.has(k)) errors.push(`${site.module}/${site.file}:${site.line} émet « ${site.name} » qui appartient au module « ${prefix} »`);
        seen.add(k);
        continue;
      }
      if (prefix !== site.module) continue;
      if (declared.includes(site.name)) continue;
      // Un module peut référencer un nom qu'il consomme lui-même (ex. rbac : invalidation de cache).
      if (consumed) continue;
      const k = `${site.module}:${site.file}:${site.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      errors.push(`${site.module}/${site.file}:${site.line} utilise « ${site.name} » absent de son events.publishes`);
    }
    expect(errors, fmt(errors)).toEqual([]);
  });

  it("(b) l'analyse statique voit les noms d'événements de chaque module qui en publie (garde-fou du test lui-même)", () => {
    // `people` tire ses noms de packages/contracts (PEOPLE_EVENTS) : aucun littéral local, c'est attendu.
    const FROM_CONTRACTS = new Set(["people"]);
    const blind = [...catalog.publishes]
      .filter(([key, names]) => names.length > 0 && !FROM_CONTRACTS.has(key))
      .filter(([key]) => ![...catalog.literals, ...catalog.emissions].some((l) => l.module === key))
      .map(([key]) => key);
    expect(blind, `modules sans aucun nom d'événement repéré dans le code : ${blind.join(", ")}`).toEqual([]);
  });

  it("(b) tout événement déclaré publié est défini dans les constantes du module ou passé à un point d'émission", () => {
    const errors: string[] = [];
    for (const [key, names] of catalog.publishes) {
      const used = new Set([...catalog.literals, ...catalog.emissions].filter((l) => l.module === key).map((l) => l.name));
      // Les modules qui tirent leurs noms de `packages/contracts` (people) n'ont pas de littéral local.
      if (used.size === 0) continue;
      for (const name of names) {
        if (!used.has(name)) errors.push(`${key} déclare publier « ${name} » mais ce nom n'est défini nulle part dans son code source`);
      }
    }
    expect(errors, fmt(errors)).toEqual([]);
  });

  it("(a) tout événement d'un autre module cité dans les constantes d'événements d'un module figure dans son events.consumes", () => {
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const site of catalog.foreign) {
      const consumed = (catalog.consumes.get(site.module) ?? []).some((e) => entryCovers(e, site.name));
      const k = `${site.module}:${site.name}`;
      if (!consumed && !seen.has(k)) {
        seen.add(k);
        errors.push(`${site.module}/${site.file}:${site.line} déclare consommer « ${site.name} » sans le lister dans events.consumes`);
      }
    }
    expect(errors, fmt(errors)).toEqual([]);
  });

  it("(c) tout abonné du worker écoute uniquement des événements déclarés dans events.consumes de son module", () => {
    const errors: string[] = [];
    for (const sub of catalog.subscribers) {
      const consumes = catalog.consumes.get(sub.module) ?? [];
      const matched = catalog.allPublished.filter((n) => sub.matches(n));
      if (matched.length === 0) {
        errors.push(`${sub.module} : l'abonné « ${sub.name} » (${String(sub.pattern)}) ne correspond à aucun événement publié`);
        continue;
      }
      const undeclared = matched.filter((n) => !consumes.some((e) => entryCovers(e, n)));
      if (undeclared.length) {
        errors.push(`${sub.module} : l'abonné « ${sub.name} » (${String(sub.pattern)}) reçoit des événements absents de events.consumes : ${undeclared.join(", ")}`);
      }
    }
    expect(errors, fmt(errors)).toEqual([]);
  });

  it("(c) tout événement déclaré consommé a au moins un abonné dans le module", () => {
    const errors: string[] = [];
    for (const edge of consumedEdges(catalog)) {
      const subs = catalog.subscribers.filter((s) => s.module === edge.consumer);
      const targets = edge.events.length ? edge.events : [edge.entry];
      const listened = targets.some((n) => subs.some((s) => s.matches(n)));
      if (!listened) errors.push(`${edge.consumer} déclare consommer « ${edge.entry} » mais aucun abonné (subscribers.ts) ne l'écoute`);
    }
    expect(errors, fmt(errors)).toEqual([]);
  });

  it("(e) information : consommateurs sans dependsOn vers le producteur, et événements sans consommateur", () => {
    const decoupled: string[] = [];
    for (const edge of consumedEdges(catalog)) {
      const producers = new Set(edge.events.flatMap((n) => catalog.producers.get(n) ?? []));
      const deps = catalog.modules.find((m) => m.key === edge.consumer)?.manifest.dependsOn ?? [];
      for (const p of producers) {
        if (p !== edge.consumer && !deps.includes(p)) decoupled.push(`${edge.consumer} <- ${p} (${edge.entry})`);
      }
    }
    const consumedNames = new Set(consumedEdges(catalog).flatMap((e) => e.events));
    const orphans = catalog.allPublished.filter((n) => !consumedNames.has(n));
    // Informatif uniquement : les événements découplent les modules (pas d'erreur).
    console.info(`[events-catalog] consommateurs sans dependsOn vers le producteur (${decoupled.length}) :\n  ${[...new Set(decoupled)].join("\n  ")}`);
    console.info(`[events-catalog] événements publiés sans consommateur dans un manifeste (${orphans.length}) :\n  ${orphans.join("\n  ")}`);
    expect(Array.isArray(decoupled)).toBe(true);
  });
});
