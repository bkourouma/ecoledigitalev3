/** Parts de financement d'une inscription (cumul, O-04) : SQL via le `Tx` de TenantDb. */
import type { Tx } from "@ecoledigitale/database";
import type { EnrollmentFunding, FundingShare, FundingShareInput } from "../domain/enrollment-funding";

interface Row {
  id: string;
  enrollment_id: string;
  funding_type: string;
  share_kind: "PERCENT" | "AMOUNT";
  share_bps: number | null;
  share_amount: string | null;
  currency: string | null;
  funder_label: string | null;
  assignment_reference: string | null;
  notes: string | null;
  status: "ACTIVE" | "ENDED";
  created_by: string | null;
  created_at: Date;
  ended_at: Date | null;
}

const COLS = "id, enrollment_id, funding_type, share_kind, share_bps, share_amount::text AS share_amount, currency, funder_label, assignment_reference, notes, status, created_by, created_at, ended_at";

const mapRow = (r: Row): EnrollmentFunding => {
  const share: FundingShare = r.share_kind === "PERCENT" ? { kind: "PERCENT", bps: r.share_bps as number } : { kind: "AMOUNT", amount: Number(r.share_amount), currency: r.currency as string };
  return {
    id: r.id,
    enrollmentId: r.enrollment_id,
    fundingType: r.funding_type,
    share,
    funderLabel: r.funder_label,
    assignmentReference: r.assignment_reference,
    notes: r.notes,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    endedAt: r.ended_at,
  };
};

export async function listFundings(tx: Tx, enrollmentId: string, options: { includeEnded?: boolean } = {}): Promise<EnrollmentFunding[]> {
  const rows = await tx.many<Row>(
    `SELECT ${COLS} FROM academic.enrollment_fundings WHERE enrollment_id = $1 ${options.includeEnded ? "" : "AND status = 'ACTIVE'"} ORDER BY created_at, funding_type, id`,
    [enrollmentId],
  );
  return rows.map(mapRow);
}

/** Termine toutes les parts vivantes de l'inscription (le contenu d'une part ne se modifie jamais : on termine puis on recrée). */
export async function endActiveFundings(tx: Tx, enrollmentId: string, ids?: readonly string[]): Promise<number> {
  const r = await tx.query(
    `UPDATE academic.enrollment_fundings SET status = 'ENDED', ended_at = now()
      WHERE enrollment_id = $1 AND status = 'ACTIVE' AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
    [enrollmentId, ids ? [...ids] : null],
  );
  return r.rowCount ?? 0;
}

export async function insertFunding(tx: Tx, v: { id: string; enrollmentId: string; input: FundingShareInput; createdBy: string | null }): Promise<void> {
  const s = v.input.share;
  await tx.query(
    `INSERT INTO academic.enrollment_fundings (id, tenant_id, enrollment_id, funding_type, share_kind, share_bps, share_amount, currency, funder_label, assignment_reference, notes, created_by)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      v.id,
      v.enrollmentId,
      v.input.fundingType,
      s.kind,
      s.kind === "PERCENT" ? s.bps : null,
      s.kind === "AMOUNT" ? s.amount : null,
      s.kind === "AMOUNT" ? s.currency : null,
      v.input.funderLabel?.trim() || null,
      v.input.assignmentReference?.trim() || null,
      v.input.notes ?? null,
      v.createdBy,
    ],
  );
}
