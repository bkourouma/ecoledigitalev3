/**
 * Kit d'adaptateurs : les dépendances de LECTURE des modules fournisseurs (academic, people, finance, attendance, scheduling,
 * results, reportcards, rules) construites une fois sur un `TenantDb` / `SystemDb`, partagées par tous les adaptateurs.
 *
 * Le même kit sert l'API (`runtime.tenantDb`) et le worker (`tenantDb` du worker) : un adaptateur ne connaît que des
 * dépendances de modules, jamais Fastify ni le contexte HTTP. Les dépendances se référencent entre elles PARESSEUSEMENT
 * (fournisseurs de ports lus à l'appel) : aucun cycle à la construction, ordre indifférent.
 *
 * Ces dépendances n'écrivent rien (audit no-op) : ce sont des LECTURES pour le compte d'un autre module ; l'écriture et
 * l'audit appartiennent au module appelant, qui contrôle les permissions de la requête.
 */
import { noopLogger, systemClock, type Clock, type Logger } from "@ecoledigitale/kernel";
import type { SystemDb, TenantDb } from "@ecoledigitale/database";
import { createAcademicDeps, createTenancyInstitutionDirectory, type AcademicDeps } from "../../modules/academic";
import { createAssessDeps, type AssessDeps } from "../../modules/assess";
import { createAttendanceDeps, type AttendanceDeps } from "../../modules/attendance";
import { createFinanceDeps, type FinanceDeps } from "../../modules/finance";
import { createHigherDeps, type HigherDeps } from "../../modules/higher";
import { createPeopleDeps, type PeopleDeps } from "../../modules/people";
import { createReportcardsDeps, type ReportcardsDeps } from "../../modules/reportcards";
import { assessPortFrom, createResultsDeps, rulesPortFrom, type ResultsDeps } from "../../modules/results";
import { createRulesApi, createRulesDeps, type RulesApi } from "../../modules/rules";
import { createSchedulingDeps, type SchedulingDeps } from "../../modules/scheduling";
import { createAttendanceOccurrencePort, createSchedulingAttendanceQuery } from "./scheduling-attendance";
import { createAttendancePeriodPort, createAttendanceRosterPort } from "./academic-attendance";
import { createPeopleAcademicQuery } from "./academic-people";
import { createResultsCurriculumPort, createResultsRosterPort } from "./academic-results";
import { createSchedulingAcademicQuery } from "./academic-scheduling";
import { createAttendancePeoplePort } from "./people-attendance";
import { createPeopleLookups, type PeopleLookups } from "./people-lookups";
import { createResultsActorNamePort, createResultsGuardianshipPort } from "./people-results";
import { createSchedulingPeopleQuery } from "./people-scheduling";

export interface AdapterKitInput {
  readonly tenantDb: TenantDb;
  readonly systemDb: SystemDb;
  readonly clock?: Clock | undefined;
  readonly logger?: Logger | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

export interface AdapterKit {
  readonly tenantDb: TenantDb;
  readonly systemDb: SystemDb;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly academic: AcademicDeps;
  readonly people: PeopleDeps;
  readonly finance: FinanceDeps;
  readonly attendance: AttendanceDeps;
  readonly scheduling: SchedulingDeps;
  readonly results: ResultsDeps;
  readonly assess: AssessDeps;
  readonly higher: HigherDeps;
  readonly reportcards: ReportcardsDeps;
  readonly rules: RulesApi;
  readonly lookups: PeopleLookups;
}

export function createAdapterKit(input: AdapterKitInput): AdapterKit {
  const clock = input.clock ?? systemClock;
  const logger = input.logger ?? noopLogger;
  const db = input.tenantDb;
  const env = input.env ?? process.env;

  const academic = createAcademicDeps({ db, clock, logger, ports: { institutions: createTenancyInstitutionDirectory({ db, clock }) } });
  // `people` lit `academic` (affectations, garde d'ouverture d'offre) par l'adaptateur académique -> people.
  const people: PeopleDeps = createPeopleDeps({ db, clock, logger, portsProvider: () => ({ academic: createPeopleAcademicQuery(academic) }) });
  const lookups = createPeopleLookups({ people, tenantDb: db });
  const finance = createFinanceDeps({ db, clock, logger });

  // scheduling et attendance se lisent l'un l'autre : getters, jamais de valeur figée.
  let attendance!: AttendanceDeps;
  const scheduling: SchedulingDeps = createSchedulingDeps({
    db,
    clock,
    logger,
    ports: {
      get academic() {
        return createSchedulingAcademicQuery(academic);
      },
      get people() {
        return createSchedulingPeopleQuery(people, lookups);
      },
      get attendance() {
        return createSchedulingAttendanceQuery(attendance);
      },
    },
  });
  attendance = createAttendanceDeps({
    db,
    clock,
    logger,
    portsProvider: () => ({
      roster: createAttendanceRosterPort(academic),
      periods: createAttendancePeriodPort(academic),
      occurrences: createAttendanceOccurrencePort(scheduling),
      people: createAttendancePeoplePort(people, lookups),
    }),
  });

  const rules = createRulesApi(createRulesDeps({ db, systemDb: input.systemDb, clock, logger }));
  const assessDeps = createAssessDeps({ db, clock, logger, portsProvider: () => ({}) });
  const assess = assessPortFrom(assessDeps);
  const results = createResultsDeps({
    db,
    clock,
    logger,
    portsProvider: () => ({
      curriculum: createResultsCurriculumPort(academic),
      roster: createResultsRosterPort(academic),
      guardianship: createResultsGuardianshipPort(lookups),
      names: createResultsActorNamePort(lookups),
      assess,
      rules: rulesPortFrom(rules),
    }),
  });
  const reportcards = createReportcardsDeps({ db, systemDb: input.systemDb, clock, logger });
  const higher = createHigherDeps({ db, clock, logger, portsProvider: () => ({}) });

  return { tenantDb: db, systemDb: input.systemDb, clock, logger, env, academic, people, finance, attendance, scheduling, results, assess: assessDeps, higher, reportcards, rules, lookups };
}
