import DecimalBase from 'decimal.js';

/**
 * Constructeur Decimal PRIVÉ au moteur (clone) : sa configuration ne touche
 * jamais le `Decimal` global que d'autres paquets pourraient utiliser.
 *
 * - précision : 40 chiffres significatifs (les divisions sont arrondies à 40
 *   chiffres, jamais à la précision binaire d'un flottant) ;
 * - arrondi par défaut : demi supérieur (loin de zéro) ;
 * - notation : jamais exponentielle pour les magnitudes usuelles.
 */
export const Decimal = DecimalBase.clone({
  precision: 40,
  rounding: DecimalBase.ROUND_HALF_UP,
  toExpNeg: -60,
  toExpPos: 60,
});
export type Decimal = InstanceType<typeof Decimal>;

/** Nombre maximal de chiffres significatifs d'un littéral ou d'une donnée. */
export const MAX_DIGITS = 40;

export type RoundingMode = DecimalBase.Rounding;
export const ROUND_HALF_UP = DecimalBase.ROUND_HALF_UP;
export const ROUND_HALF_EVEN = DecimalBase.ROUND_HALF_EVEN;
export const ROUND_FLOOR = DecimalBase.ROUND_FLOOR;
export const ROUND_CEIL = DecimalBase.ROUND_CEIL;

const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Convertit une donnée de contexte en Decimal, ou `undefined` si elle n'est pas
 * un nombre exploitable. Accepte : nombre JS fini, chaîne décimale (« 12.5 »),
 * bigint, Decimal. Les flottants sont lus via leur représentation décimale la
 * plus courte (0.1 devient exactement 0,1).
 */
export function toDecimal(raw: unknown): Decimal | undefined {
  if (raw instanceof Decimal) return raw;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? new Decimal(String(raw)) : undefined;
  }
  if (typeof raw === 'bigint') return new Decimal(raw.toString());
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!DECIMAL_TEXT.test(t) || t.replace(/[^0-9]/g, '').length > 3 * MAX_DIGITS) return undefined;
    return new Decimal(t);
  }
  // Volontairement PAS de reconnaissance « structurelle » d'objets décimaux : cela
  // exécuterait des méthodes (toString…) fournies par les données. Les appelants
  // passent un nombre, une chaîne décimale, un bigint ou le Decimal du moteur.
  return undefined;
}

