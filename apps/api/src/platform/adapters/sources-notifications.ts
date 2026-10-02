/**
 * finance, results, academic, people, messaging -> notifications : les PORTS SOURCES des relances d'impayés et des alertes.
 *
 *  - `OverdueSource`    échéances en retard (finance) : lecture seule, payeur = apprenant ; relue avant l'envoi ;
 *  - `GradeSource`      deux résultats FINAL consécutifs d'un élève (results) : on TRANSPORTE les moyennes déjà calculées par
 *                       `rules` via `results`, aucune formule ici ; un FINAL reste la version officielle d'une période rouverte ;
 *  - `TeachingLoadSource` heures planifiées des enseignants de l'année en cours (people) ;
 *  - `AnnouncementFeed` annonce publiée : titre, extrait, priorité, destinataires figés (messaging).
 * Règles (platform-assembly §11) : appels SÉQUENTIELS ; échec fermé (une lecture impossible LÈVE : l'alerte est rapportée
 * non évaluée, jamais un zéro qui passerait pour une mesure) ; jamais de SQL.
 */
import { unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { listAcademicPeriods, listAcademicYears, listClassrooms } from "../../modules/academic";
import { isInstallmentOverdue, listOverdueInstallments } from "../../modules/finance";
import { createMessagingDeps, readAnnouncementForDelivery } from "../../modules/messaging";
import type { AnnouncementFeed, GradePair, GradeSource, OverdueSource, TeachingLoadSource } from "../../modules/notifications";
import { getStudentsByIds, getTeachingLoad, listStaff } from "../../modules/people";
import { getClassMatrix, getFinalResult } from "../../modules/results";
import type { AdapterKit } from "./kit";

const PAGE = 200;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export function createNotificationsOverdueSource(kit: AdapterKit): OverdueSource {
  return {
    async listOverdueInstallments(ctx, input) {
      return unwrap(await listOverdueInstallments(kit.finance, ctx, input));
    },
    async isInstallmentStillOverdue(ctx, installmentId) {
      return unwrap(await isInstallmentOverdue(kit.finance, ctx, installmentId, isoDay(kit.clock.now())));
    },
  };
}

export function createNotificationsAnnouncements(kit: Pick<AdapterKit, "tenantDb" | "clock" | "logger">): AnnouncementFeed {
  const deps = createMessagingDeps({ db: kit.tenantDb, clock: kit.clock, logger: kit.logger });
  return {
    async read(ctx, announcementId) {
      return unwrap(await readAnnouncementForDelivery(deps, ctx, announcementId));
    },
  };
}

export function createNotificationsTeachingLoad(kit: AdapterKit): TeachingLoadSource {
  const { academic, people } = kit;
  return {
    async listLoads(ctx) {
      const years = unwrap(await listAcademicYears(academic, ctx)).filter((y) => y.isCurrent);
      const out: Array<{ staffId: string; staffName: string; plannedHours: number }> = [];
      for (const year of years) {
        for (let offset = 0; offset < 5_000; offset += PAGE) {
          const page = unwrap(await listStaff(people, ctx, { canTeach: true, academicYearId: year.id, limit: PAGE, offset }));
          for (const s of page.items) {
            const load = unwrap(await getTeachingLoad(people, ctx, s.id, { yearId: year.id }));
            if (load.plannedHours > 0) out.push({ staffId: s.id, staffName: s.displayName, plannedHours: load.plannedHours });
          }
          if (page.items.length < PAGE) break;
        }
      }
      return out;
    },
  };
}

/**
 * Résultats FINAL consécutifs : pour chaque classe ACTIVE de l'année en cours, les deux périodes les plus récentes qui ont un
 * résultat FINAL, comparées élève par élève par l'appelant (`domain/alerts.ts`). Une classe sans état de résultats est ignorée
 * (rien n'a été clôturé) ; un port `results` indisponible fait échouer fermé.
 */
export function createNotificationsGrades(kit: AdapterKit): GradeSource {
  const { academic, people, results } = kit;

  async function finalsOf(ctx: RequestContext, classroomId: string, periodId: string): Promise<Map<string, { studentId: string; average: string | null }>> {
    const matrix = await getClassMatrix(results, ctx, { classroomId, academicPeriodId: periodId, withLines: false, caps: { read: true } });
    const out = new Map<string, { studentId: string; average: string | null }>();
    if (!matrix.ok) {
      const code = (matrix.error as { code?: string }).code ?? "";
      if (/port_unavailable$/.test(code)) throw matrix.error;
      return out;
    }
    for (const row of matrix.value.rows) {
      const header = row.header.status === "FINAL" ? row.header : unwrap(await getFinalResult(results, ctx, { enrollmentId: row.header.enrollmentId, academicPeriodId: periodId }));
      if (header && header.status === "FINAL") out.set(header.studentId, { studentId: header.studentId, average: header.average === null || header.average === undefined ? null : String(header.average) });
    }
    return out;
  }

  return {
    async listConsecutiveFinals(ctx) {
      const pairs: GradePair[] = [];
      const years = unwrap(await listAcademicYears(academic, ctx)).filter((y) => y.isCurrent);
      for (const year of years) {
        const periods = unwrap(await listAcademicPeriods(academic, ctx, year.id)).slice().sort((a, b) => b.ordinal - a.ordinal);
        for (let page = 1; page <= 200; page += 1) {
          const rooms = unwrap(await listClassrooms(academic, ctx, { academicYearId: year.id, status: "ACTIVE", page, pageSize: PAGE }));
          for (const room of rooms.items) {
            const found: Array<{ periodId: string; map: Map<string, { studentId: string; average: string | null }> }> = [];
            for (const period of periods) {
              const map = await finalsOf(ctx, room.id, period.id);
              if (map.size > 0) found.push({ periodId: period.id, map });
              if (found.length === 2) break;
            }
            if (found.length < 2) continue;
            const [current, previous] = found as [(typeof found)[number], (typeof found)[number]];
            const studentIds = [...current.map.keys()].filter((id) => previous.map.has(id));
            const names = new Map<string, string>();
            for (let i = 0; i < studentIds.length; i += 400) for (const s of unwrap(await getStudentsByIds(people, ctx, studentIds.slice(i, i + 400)))) names.set(s.id, s.displayName);
            for (const id of studentIds) {
              pairs.push({
                studentId: id,
                studentName: names.get(id) ?? "Élève",
                classroomId: room.id,
                className: room.name,
                previousPeriodId: previous.periodId,
                currentPeriodId: current.periodId,
                previous: previous.map.get(id)!.average,
                current: current.map.get(id)!.average,
              });
            }
          }
          if (rooms.items.length < PAGE) break;
        }
      }
      return pairs;
    },
  };
}
