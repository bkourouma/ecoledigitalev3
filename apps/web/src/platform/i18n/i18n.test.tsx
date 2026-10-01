// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, isLocale, resolveLocale } from "./config";
import { IntlProvider } from "./IntlProvider";
import { getMessages } from "./messages";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object" ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("config", () => {
  it("locale fixe fr-CI, sans préfixe d'URL", () => {
    expect(DEFAULT_LOCALE).toBe("fr-CI");
    expect(resolveLocale()).toBe("fr-CI");
    expect(resolveLocale("en")).toBe("fr-CI");
    expect(isLocale("fr-CI")).toBe(true);
    expect(isLocale("en")).toBe(false);
  });
});

describe("catalogues", () => {
  it("chaque locale déclarée a un catalogue avec les mêmes clés que la locale par défaut", () => {
    const reference = flatten(getMessages(DEFAULT_LOCALE) as unknown as Record<string, unknown>).sort();
    for (const locale of LOCALES) {
      expect(flatten(getMessages(locale) as unknown as Record<string, unknown>).sort()).toEqual(reference);
    }
  });

  it("contient les clés communes attendues et aucune valeur vide", () => {
    const m = getMessages(DEFAULT_LOCALE) as unknown as Record<string, Record<string, string>>;
    for (const ns of ["common", "actions", "errors", "emptyStates", "navigation", "pwa"]) expect(m[ns]).toBeTruthy();
    for (const key of flatten(m)) {
      const value = key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], m);
      expect(String(value).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("IntlProvider", () => {
  it("fournit les traductions aux composants clients", () => {
    function Demo() {
      const t = useTranslations("actions");
      const e = useTranslations("errors");
      return (
        <p>
          {t("save")}|{e("network")}
        </p>
      );
    }
    render(
      <IntlProvider>
        <Demo />
      </IntlProvider>,
    );
    expect(screen.getByText(/^Enregistrer\|Connexion au serveur impossible/)).toBeTruthy();
  });
});
