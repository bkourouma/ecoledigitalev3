import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrastes WCAG 1.4.3 (texte >= 4,5:1) des jetons de couleur de `app/globals.css`. axe ne peut pas le vérifier sous jsdom
 * (pas de CSS réel) : on calcule donc le rapport directement sur les jetons HSL, pour le thème par défaut (`:root`) et `.dark`.
 */
const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Bloc introuvable : ${selector}`);
  return css.slice(start, css.indexOf("\n  }", start));
}

function tokens(selector: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const m of block(selector).matchAll(/--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) out[m[1]!] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}

function toRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return lig - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const x = luminance(toRgb(a));
  const y = luminance(toRgb(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Paires (texte, fond) effectivement utilisées par les composants partagés. */
const PAIRS: ReadonlyArray<[string, string]> = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["destructive-foreground", "destructive"],
  ["destructive", "background"],
  ["accent-foreground", "accent"],
];

describe.each([":root", ".dark"])("contraste des jetons (%s)", (selector) => {
  const t = tokens(selector);
  it.each(PAIRS)("%s sur %s >= 4,5:1", (fg, bg) => {
    const a = t[fg];
    const b = t[bg];
    if (!a || !b) return; // jeton non redéfini dans ce thème
    expect(contrast(a, b), `${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
});
