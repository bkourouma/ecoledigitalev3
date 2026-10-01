import frCI from "../../../messages/fr-CI.json";
import type { Locale } from "./config";

export type Messages = typeof frCI;

/** Catalogues par locale. Une langue ajoutée doit être déclarée ici ET dans `config.ts`. */
const CATALOGS: Record<Locale, Messages> = {
  "fr-CI": frCI,
};

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale];
}
