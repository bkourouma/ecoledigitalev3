import type { Tx } from "@ecoledigitale/database";
import type { CountryProfileRecord } from "../domain/entities";

interface CountryRow {
  code: string;
  name: string;
  currency_code: string;
  currency_exponent: number;
  locale: string;
  timezone: string;
  phone_prefix: string;
  education_system: string;
}

const COLUMNS = "code, name, currency_code, currency_exponent, locale, timezone, phone_prefix, education_system";

const toRecord = (r: CountryRow): CountryProfileRecord => ({
  code: r.code,
  name: r.name,
  currencyCode: r.currency_code,
  currencyExponent: Number(r.currency_exponent),
  locale: r.locale,
  timezone: r.timezone,
  phonePrefix: r.phone_prefix,
  educationSystem: r.education_system,
});

export async function listCountries(tx: Tx): Promise<CountryProfileRecord[]> {
  return (await tx.many<CountryRow>(`SELECT ${COLUMNS} FROM tenancy.country_profiles ORDER BY name`)).map(toRecord);
}

export async function findCountry(tx: Tx, code: string): Promise<CountryProfileRecord | null> {
  const row = await tx.queryOne<CountryRow>(`SELECT ${COLUMNS} FROM tenancy.country_profiles WHERE code = $1`, [code]);
  return row ? toRecord(row) : null;
}
