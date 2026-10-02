/**
 * people -> payroll : `StaffDirectoryPort` (personnel payable, compte lié, nom d'affichage d'un utilisateur).
 *
 * Un membre du personnel « parti » reste payé de ses séances validées non payées (AC2.12) : `active` ne signifie donc pas
 * « payable ». Le titulaire d'un compte est résolu par la liaison explicite `persons.identity_id` (jamais par e-mail).
 */
import { getStaffByIds, listStaff, type PeopleDeps } from "../../modules/people";
import type { StaffDirectoryPort, StaffInfo } from "../../modules/payroll";
import type { PeopleLookups } from "./people-lookups";

export function createPayrollStaffDirectory(people: PeopleDeps, lookups: PeopleLookups): StaffDirectoryPort {
  const toInfo = (s: { staffId: string; displayName: string; staffNumber: string; status: string; identityId: string | null }): StaffInfo => ({
    staffId: s.staffId,
    displayName: s.displayName,
    matricule: s.staffNumber || null,
    active: s.status === "ACTIVE" || s.status === "ON_LEAVE",
    userId: s.identityId,
  });
  async function many(ctx: Parameters<StaffDirectoryPort["getStaffMany"]>[0], ids: readonly string[]): Promise<StaffInfo[]> {
    const out: StaffInfo[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const r = await getStaffByIds(people, ctx, ids.slice(i, i + 500));
      if (r.ok) out.push(...r.value.map(toInfo));
    }
    return out;
  }
  return {
    async getStaff(ctx, staffId) {
      return (await many(ctx, [staffId]))[0] ?? null;
    },
    getStaffMany: (ctx, staffIds) => many(ctx, staffIds),
    getStaffIdForUser: (ctx, userId) => lookups.staffIdForUser(ctx, userId),
    getUserDisplayName: (ctx, userId) => lookups.displayNameOfUser(ctx, userId),
    async listPayableStaff(ctx) {
      const ids: string[] = [];
      for (let offset = 0; offset < 10_000; offset += 200) {
        const r = await listStaff(people, ctx, { limit: 200, offset });
        if (!r.ok) break;
        ids.push(...r.value.items.map((s) => s.id));
        if (ids.length >= r.value.total || r.value.items.length === 0) break;
      }
      return many(ctx, ids);
    },
  };
}
