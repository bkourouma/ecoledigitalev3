/**
 * Ports du module payroll. Les séances (017), les présences enseignants (010), le personnel (009) et les
 * libellés de curriculum (004) sont des UUID résolus par ces PORTS que fournissent les modules voisins à
 * l'assemblage (`registerPayrollPorts(app, ports)`), jamais par jointure SQL. Aucun port ne prend de `Tx` :
 * un port appartient à un AUTRE module, qui ouvre sa propre lecture ; seul le fait métier traverse la frontière.
 *
 * ÉCHEC FERMÉ : tant qu'un port nécessaire n'est pas branché, ou quand il lève, le calcul est REFUSÉ
 * (`payroll.port_unavailable`) — jamais un résultat partiel silencieux (spec 032 §11 « Ports »).
 *
 * Contrat de `HoursSourcePort.collect` : renvoyer les faits d'heures dont la DATE est dans `[from, to]`
 * (tous statuts : la paie applique elle-même le prédicat de payabilité, `domain/payability.ts`, ce qui permet
 * d'expliquer pourquoi une heure n'est pas payée). Un fournisseur qui ne peut renvoyer que le payable
 * (p. ex. `scheduling.listPayableHours`) marque ses faits `realized: true, validated: true`.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { HourFact, HourSourceKind, IsoDate, Uuid } from "../domain/types";

export interface HoursQuery {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Restreint aux enseignants demandés ; absent = tout le personnel. */
  readonly staffIds?: readonly Uuid[] | undefined;
}

export interface HourLockLine {
  readonly refId: Uuid;
  readonly staffId: Uuid;
}

export interface HoursSourcePort {
  readonly kind: HourSourceKind;
  collect(ctx: RequestContext, query: HoursQuery): Promise<readonly HourFact[]>;
  /**
   * Facultatif — gèle les heures côté source quand le bulletin est ARRÊTÉ (`scheduling.lockHours`) : une séance
   * rattachée à un bulletin approuvé ou payé ne se dévalide plus et ne change plus de durée (AC1.4).
   * Idempotent pour un même `lockRef` (= identifiant du bulletin). Doit LEVER si le verrouillage est impossible.
   */
  lock?(ctx: RequestContext, input: { lockRef: Uuid; lines: readonly HourLockLine[] }): Promise<void>;
  /** Facultatif — libère les heures verrouillées sous `lockRef` (annulation du bulletin). Idempotent. */
  release?(ctx: RequestContext, input: { lockRef: Uuid }): Promise<void>;
}

export interface StaffInfo {
  readonly staffId: Uuid;
  readonly displayName: string;
  readonly matricule: string | null;
  /** Un enseignant désactivé reste payé de ses séances validées non payées (AC2.12). */
  readonly active: boolean;
  /** Compte utilisateur lié (destinataire des notifications). */
  readonly userId: Uuid | null;
}

export interface StaffDirectoryPort {
  getStaff(ctx: RequestContext, staffId: Uuid): Promise<StaffInfo | null>;
  getStaffMany(ctx: RequestContext, staffIds: readonly Uuid[]): Promise<readonly StaffInfo[]>;
  /** Le membre du personnel lié à un compte utilisateur (identité du titulaire, jamais un paramètre de requête). */
  getStaffIdForUser(ctx: RequestContext, userId: Uuid): Promise<Uuid | null>;
  /** Nom affiché d'un utilisateur (figé dans le journal à l'instant de l'acte). */
  getUserDisplayName?(ctx: RequestContext, userId: Uuid): Promise<string | null>;
  /** Tous les membres du personnel payables (vue d'ensemble) ; facultatif. */
  listPayableStaff?(ctx: RequestContext): Promise<readonly StaffInfo[]>;
}

export interface CurriculumLabel {
  readonly label: string | null;
  readonly code: string | null;
}

export interface CurriculumLabelPort {
  getLabels(ctx: RequestContext, nodeIds: readonly Uuid[]): Promise<ReadonlyMap<Uuid, CurriculumLabel>>;
}

export interface PayrollPorts {
  readonly sessionHours: HoursSourcePort | null;
  readonly attendanceHours: HoursSourcePort | null;
  readonly staff: StaffDirectoryPort | null;
  readonly curriculum: CurriculumLabelPort | null;
}

export type PayrollPortsInput = Partial<{ [K in keyof PayrollPorts]: PayrollPorts[K] | undefined }>;

/** Registre de ports « vivant » : lu À L'APPEL, l'ordre de chargement des modules n'est pas porteur de sens. */
export interface PayrollPortRegistry {
  register(ports: PayrollPortsInput): void;
  readonly current: PayrollPorts;
}

export function createPortRegistry(initial: PayrollPortsInput = {}): PayrollPortRegistry {
  const state: { -readonly [K in keyof PayrollPorts]: PayrollPorts[K] } = { sessionHours: null, attendanceHours: null, staff: null, curriculum: null };
  const apply = (ports: PayrollPortsInput): void => {
    if (ports.sessionHours) state.sessionHours = ports.sessionHours;
    if (ports.attendanceHours) state.attendanceHours = ports.attendanceHours;
    if (ports.staff) state.staff = ports.staff;
    if (ports.curriculum) state.curriculum = ports.curriculum;
  };
  apply(initial);
  const view: PayrollPorts = {
    get sessionHours() {
      return state.sessionHours;
    },
    get attendanceHours() {
      return state.attendanceHours;
    },
    get staff() {
      return state.staff;
    },
    get curriculum() {
      return state.curriculum;
    },
  };
  return { register: apply, current: view };
}
