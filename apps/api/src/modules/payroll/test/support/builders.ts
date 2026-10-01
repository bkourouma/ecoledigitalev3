/** Fabriques de données pures pour les tests du domaine (aucune base, aucune horloge). */
import { Money } from "@ecoledigitale/kernel";
import type { HourFact, HourSourceKind, PayConfig, PricedHour, RateOrigin } from "../../domain/types";

let counter = 0;
/** UUID déterministe (version 4 « fabriquée ») : `uuid(1)`, `uuid(2)`… */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const nextUuid = (): string => uuid(++counter);

export const STAFF = uuid(9001);
export const xof = (n: number): Money => Money.of(n, "XOF");

export function config(over: Partial<PayConfig> = {}): PayConfig {
  return {
    id: uuid(9100),
    staffId: STAFF,
    type: "HOURLY",
    monthlySalary: null,
    annualSalary: null,
    defaultHourlyRate: xof(10_000),
    overtimeThresholdMinutes: 2400,
    overtimeMultiplierPermille: 1500,
    effectiveFrom: "2025-09-01",
    effectiveTo: null,
    ...over,
  };
}

export interface HourOpts {
  kind?: HourSourceKind;
  refId?: string;
  staffId?: string;
  date: string;
  startTime?: string | null;
  minutes: number;
  rate?: number;
  rateOrigin?: RateOrigin;
  nodeId?: string | null;
}

export function priced(o: HourOpts): PricedHour {
  return {
    kind: o.kind ?? "SESSION",
    refId: o.refId ?? nextUuid(),
    staffId: o.staffId ?? STAFF,
    date: o.date,
    startTime: o.startTime === undefined ? "08:00" : o.startTime,
    minutes: o.minutes,
    nodeId: o.nodeId ?? null,
    classroomId: null,
    label: null,
    code: null,
    classroomLabel: null,
    rate: xof(o.rate ?? 10_000),
    rateOrigin: o.rateOrigin ?? "CONFIG_DEFAULT",
  };
}

export function fact(over: Partial<HourFact> = {}): HourFact {
  return {
    kind: "SESSION",
    refId: nextUuid(),
    staffId: STAFF,
    date: "2026-01-12",
    startTime: "08:00",
    endTime: "10:00",
    durationMinutes: null,
    paidMinutesOverride: null,
    realized: true,
    validated: true,
    nodeId: null,
    classroomId: null,
    label: null,
    code: null,
    classroomLabel: null,
    ...over,
  };
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) pour les tests de propriété. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rand: () => number, min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
