/**
 * Adaptateur du port `InstitutionDirectory` vers l'API publique du module `tenancy` (`getInstitution`,
 * `listCountries`) : valide qu'un établissement existe (les références sont des UUID sans clé étrangère), donne son
 * pack, son système éducatif et le fuseau de son pays (« aujourd'hui » = date civile de l'établissement, D-24).
 *
 * Un instantané court (60 s) évite de relire l'établissement à chaque `todayFor`.
 */
import type { TenantDb } from "@ecoledigitale/database";
import type { Clock, RequestContext } from "@ecoledigitale/kernel";
import { systemClock } from "@ecoledigitale/kernel";
import { getInstitution, listCountries } from "../../tenancy";
import type { InstitutionDirectory, InstitutionInfo } from "../application/ports";

const TTL_MS = 60_000;

export function createTenancyInstitutionDirectory(deps: { db: TenantDb; clock?: Clock }): InstitutionDirectory {
  const clock = deps.clock ?? systemClock;
  const cache = new Map<string, { at: number; info: InstitutionInfo | null }>();
  let timezones: { at: number; byCountry: Map<string, string> } | null = null;

  async function timezoneOf(ctx: RequestContext, countryCode: string): Promise<string | null> {
    const now = clock.now().getTime();
    if (!timezones || now - timezones.at > TTL_MS * 10) {
      const countries = await listCountries({ db: deps.db, clock }, ctx);
      timezones = { at: now, byCountry: new Map(countries.ok ? countries.value.map((c) => [c.code, c.timezone]) : []) };
    }
    return timezones.byCountry.get(countryCode) ?? null;
  }

  return {
    async getInstitution(ctx, institutionId) {
      const key = `${ctx.tenantId}:${institutionId}`;
      const now = clock.now().getTime();
      const hit = cache.get(key);
      if (hit && now - hit.at < TTL_MS) return hit.info;
      const r = await getInstitution({ db: deps.db, clock }, ctx, institutionId);
      const info: InstitutionInfo | null = r.ok
        ? {
            id: r.value.id,
            pack: r.value.pack,
            educationSystem: r.value.educationSystem,
            countryCode: r.value.countryCode,
            timezone: await timezoneOf(ctx, r.value.countryCode),
          }
        : null;
      // On ne met en cache que les établissements trouvés (un établissement créé juste après doit être visible).
      if (info) cache.set(key, { at: now, info });
      return info;
    },
  };
}
