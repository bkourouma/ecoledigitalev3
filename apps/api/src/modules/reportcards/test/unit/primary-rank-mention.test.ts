/**
 * Bulletin du primaire, gabarits v2 — décisions métier Q-P04 (rang affiché par défaut, classement « compétition ») et
 * Q-P05 (mention automatique réglée par le jeu de règles, désactivable). Aucun calcul : le rendu montre ou cache ce que
 * `results` a produit.
 */
import { describe, expect, it } from "vitest";
import { renderDocumentHtml } from "../../domain/document-html";
import { resolveOptions } from "../../domain/options-schema";
import { validatePlatformTemplate } from "../../application/platform";
import { BUILTIN_TEMPLATES, builtinTemplate } from "../../templates/builtin";
import { snapshotFor } from "../support/fixtures";

const KEYS = ["primary-bulletin", "report-primary"] as const;

type Snap = ReturnType<typeof snapshotFor>["snapshot"];

function html(key: string, edit: (s: Snap) => void = () => {}, options: Record<string, unknown> = {}): string {
  const s = snapshotFor(key, { pack: "PRIMARY", options });
  const snapshot = structuredClone(s.snapshot) as Snap;
  edit(snapshot);
  return renderDocumentHtml({ snapshot, template: { body: s.template.body, css: s.template.css }, verification: null });
}

/** Élèves ex æquo : 1, 1, 3 (classement « compétition », calculé par `results`). */
function withTies(s: Snap): void {
  const ranks = [1, 1, 3];
  s.results.lines.forEach((l, i) => {
    l.rank = ranks[i] ?? null;
    l.rankOf = 30;
  });
}

function nursery(s: Snap): void {
  for (const l of s.results.lines) {
    l.rank = null;
    l.rankOf = null;
  }
  s.results.summary.rank = null;
  s.results.summary.classSize = null;
  s.results.summary.mention = null;
}

describe.each(KEYS)("gabarit %s v2 (Q-P04, Q-P05)", (key) => {
  it("la version 2 est la plus récente ; la version 1 reste livrée à l'identique", () => {
    expect(builtinTemplate(key)?.version).toBe(2);
    expect(BUILTIN_TEMPLATES.filter((t) => t.key === key).map((t) => t.version)).toEqual([1, 2]);
    const v1 = BUILTIN_TEMPLATES.find((t) => t.key === key && t.version === 1)!;
    expect(v1.body).toContain("{{#if options.showRank}}");
    expect(v1.body).not.toContain("show.rank");
  });

  it("le gabarit v2 est valide à la publication", () => {
    const v2 = builtinTemplate(key)!;
    expect(validatePlatformTemplate(v2)).toEqual([]);
  });

  it("rang AFFICHÉ par défaut : l'option showRank vaut true, sans configuration", () => {
    const options = resolveOptions(builtinTemplate(key)!.optionsSchema, {});
    expect(options.ok && options.value).toMatchObject({ showRank: true, showMention: true });
    const out = html(key);
    expect(out).toContain("<th>Rang</th>");
    expect(out).toContain("7e / 30");
  });

  it("classement « compétition » en cas d'égalité : 1er, 1er, 3e (jamais 2e)", () => {
    const out = html(key, withTies);
    const cells = [...out.matchAll(/<td>(1er|2e|3e) \/ 30<\/td>/g)].map((m) => m[1]);
    expect(cells).toEqual(["1er", "1er", "3e"]);
  });

  it("l'établissement désactive l'affichage du rang (option du gabarit)", () => {
    const out = html(key, withTies, { showRank: false });
    expect(out).not.toContain("<th>Rang</th>");
    expect(out).not.toContain("7e / 30");
    expect(out).not.toContain("1er / 30");
    expect(out).toContain("Moyenne");
  });

  it("maternelle : sans note, donc sans rang — ni colonne ni ligne, même si l'option est active", () => {
    const out = html(key, nursery, { showRank: true });
    expect(out).not.toContain("<th>Rang</th>");
    expect(out).not.toContain('<span class="lbl">Rang</span>');
    expect(out).not.toContain('<span class="lbl">Classement</span>');
  });

  it("mention affichée quand la règle en produit une ; désactivable ; absente si la règle est désactivée", () => {
    expect(html(key)).toContain('<span class="lbl">Mention</span><span class="val">Assez bien</span>');
    expect(html(key, () => {}, { showMention: false })).not.toContain('<span class="lbl">Mention</span>');
    expect(html(key, (s) => { s.results.summary.mention = null; })).not.toContain('<span class="lbl">Mention</span>');
  });

  it("le rendu reste déterministe", () => {
    expect(html(key, withTies)).toBe(html(key, withTies));
  });
});
