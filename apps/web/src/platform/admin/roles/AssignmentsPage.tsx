"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Pencil, UserMinus } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  LoadingState,
  NativeSelect,
  Notice,
  PageHeader,
  ResponsiveTable,
  StatusBadge,
  type Column,
  type StatusTone,
} from "@ecoledigitale/ui";
import type { RbacAssignment, RbacRoleSummary } from "@ecoledigitale/contracts/v2/rbac";
import type { MemberSummary } from "@ecoledigitale/contracts/v2/iam";
import { usePermission } from "@/platform/access";
import { StepUpDialog } from "@/platform/ui/StepUpDialog";
import { useStepUp } from "@/platform/ui/useStepUp";
import { ApiErrorState, useDateOnly } from "../common";
import { notifySuccess } from "../notify";
import { toIsoInstant } from "../audit/filters";
import { useInstitutions } from "../tenancy/hooks";
import { useErrorMessage } from "../use-error-message";
import { MfaSessionNotice } from "./access-info";
import { shortId, toLocalInput, validityStatus, type ValidityStatus } from "./assignments";
import { CreateAssignmentForm } from "./CreateAssignmentForm";
import { useAssignments, useMembers, useRevokeAssignment, useRoles, useUpdateAssignment } from "./hooks";

const STATUS_TONE: Record<ValidityStatus, StatusTone> = { active: "success", upcoming: "info", expired: "neutral" };

/** `/v2/access/assignments` : attributions utilisateur/rôle avec périmètre et validité. */
export function AssignmentsPage() {
  const t = useTranslations("access.assignments");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const date = useDateOnly();
  const manage = usePermission("rbac.assignment.manage");
  const readMembers = usePermission("iam.user.read");

  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [editing, setEditing] = useState<RbacAssignment | null>(null);
  const [revoking, setRevoking] = useState<RbacAssignment | null>(null);

  const roles = useRoles();
  const members = useMembers(readMembers.allowed);
  const institutions = useInstitutions();
  const assignments = useAssignments({ userId: userId || undefined, roleId: roleId || undefined });
  const revoke = useRevokeAssignment();
  const stepUp = useStepUp();

  const roleById = useMemo(() => new Map<string, RbacRoleSummary>((roles.data ?? []).map((r) => [r.id, r])), [roles.data]);
  const memberByIdentity = useMemo(() => new Map<string, MemberSummary>((members.data ?? []).map((m) => [m.identityId, m])), [members.data]);
  const institutionName = useMemo(() => new Map((institutions.data ?? []).map((i) => [i.id, i.name])), [institutions.data]);
  const now = new Date();

  const roleLabel = (a: RbacAssignment) => roleById.get(a.roleId)?.label ?? a.roleKey;
  const scopeLabel = (a: RbacAssignment) =>
    a.scope.type === "tenant"
      ? t("scopeTenant")
      : a.scope.type === "institution"
        ? t("scopeInstitution", { name: institutionName.get(a.scope.id) ?? shortId(a.scope.id) })
        : t("scopeCampus", { id: shortId(a.scope.id) });
  const validityLabel = (a: RbacAssignment) => {
    if (!a.validFrom && !a.validUntil) return t("unlimited");
    if (a.validFrom && a.validUntil) return t("range", { from: date(a.validFrom), until: date(a.validUntil) });
    return a.validFrom ? t("from", { date: date(a.validFrom) }) : t("until", { date: date(a.validUntil) });
  };

  const columns: Column<RbacAssignment>[] = [
    {
      key: "user",
      header: t("user"),
      cell: (a) => {
        const member = memberByIdentity.get(a.userId);
        return member ? member.email : <code className="break-all text-xs">{a.userId}</code>;
      },
    },
    { key: "role", header: t("role"), cell: roleLabel },
    { key: "scope", header: t("scope"), cell: scopeLabel },
    { key: "validity", header: t("validity"), cell: validityLabel },
    {
      key: "status",
      header: t("status"),
      cell: (a) => {
        const s = validityStatus(a, now);
        return <StatusBadge tone={STATUS_TONE[s]}>{t(s)}</StatusBadge>;
      },
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("actions")}</span>,
      label: "",
      cell: (a) =>
        manage.allowed ? (
          <span className="flex flex-wrap justify-end gap-2 md:justify-start">
            <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={t("edit.open", { role: roleLabel(a) })} onClick={() => setEditing(a)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={t("revoke.open", { role: roleLabel(a) })} onClick={() => setRevoking(a)}>
              <UserMinus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </span>
        ) : null,
    },
  ];

  const loading = assignments.isPending || roles.isPending;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <MfaSessionNotice />

      {manage.allowed && roles.data ? <CreateAssignmentForm roles={roles.data} members={readMembers.allowed && members.data ? members.data : null} /> : null}

      <section aria-label={t("caption")} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("filterUser")}>
            {(c) =>
              members.data ? (
                <NativeSelect {...c} value={userId} onChange={(e) => setUserId(e.target.value)}>
                  <option value="">{t("all")}</option>
                  {members.data.map((m) => (
                    <option key={m.membershipId} value={m.identityId}>
                      {m.email}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input {...c} value={userId} onChange={(e) => setUserId(e.target.value.trim())} autoComplete="off" spellCheck={false} />
              )
            }
          </Field>
          <Field label={t("filterRole")}>
            {(c) => (
              <NativeSelect {...c} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">{t("all")}</option>
                {(roles.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>

        {loading ? <LoadingState label={tu("loading")} rows={4} /> : null}
        {assignments.isError ? <ApiErrorState error={assignments.error} onRetry={() => void assignments.refetch()} /> : null}
        {assignments.data && assignments.data.length === 0 ? <EmptyState title={t("empty")} /> : null}
        {assignments.data && assignments.data.length > 0 ? (
          <ResponsiveTable columns={columns} rows={assignments.data} rowKey={(a) => a.id} caption={t("caption")} />
        ) : null}
      </section>

      <EditValidityDialog assignment={editing} roleLabel={editing ? roleLabel(editing) : ""} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
            revoke.reset();
          }
        }}
        title={t("revoke.title")}
        description={revoking ? t("revoke.body", { role: roleLabel(revoking) }) : ""}
        confirmLabel={t("revoke.confirm")}
        cancelLabel={tu("cancel")}
        closeLabel={tu("close")}
        destructive
        pending={revoke.isPending}
        onConfirm={() =>
          revoking &&
          void stepUp.run(() => revoke.mutateAsync({ id: revoking.id })).then(
            () => {
              notifySuccess(t("revoke.done"));
              setRevoking(null);
            },
            () => undefined,
          )
        }
      >
        {revoke.error ? <Notice tone="danger">{message(revoke.error)}</Notice> : null}
      </ConfirmDialog>
      <StepUpDialog {...stepUp.dialogProps} />
    </div>
  );
}

function EditValidityDialog({ assignment, roleLabel, onClose }: { assignment: RbacAssignment | null; roleLabel: string; onClose: () => void }) {
  const t = useTranslations("access.assignments");
  const tCreate = useTranslations("access.assignments.create");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const update = useUpdateAssignment();
  const stepUp = useStepUp();
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [periodError, setPeriodError] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Préremplit à l'ouverture (une seule fois par attribution).
  if (assignment && loadedFor !== assignment.id) {
    setLoadedFor(assignment.id);
    setFrom(toLocalInput(assignment.validFrom));
    setUntil(toLocalInput(assignment.validUntil));
    setPeriodError(false);
  }

  const close = () => {
    update.reset();
    setLoadedFor(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!assignment) return;
    const f = toIsoInstant(from);
    const u = toIsoInstant(until);
    if (f && u && Date.parse(u) <= Date.parse(f)) {
      setPeriodError(true);
      return;
    }
    setPeriodError(false);
    void stepUp.run(() => update.mutateAsync({ id: assignment.id, validFrom: f, validUntil: u })).then(
      () => {
        notifySuccess(t("edit.done"));
        close();
      },
      () => undefined,
    );
  };

  return (
    <Dialog open={assignment !== null} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent closeLabel={tu("close")} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("edit.title")}</DialogTitle>
          <DialogDescription>{t("edit.description", { role: roleLabel })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={tCreate("validFrom")}>
            {(c) => <Input {...c} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field label={tCreate("validUntil")} error={periodError ? tCreate("errors.period") : undefined}>
            {(c) => <Input {...c} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />}
          </Field>
          {update.error ? <Notice tone="danger">{message(update.error)}</Notice> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" onClick={close} disabled={update.isPending}>
              {tu("cancel")}
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-10" disabled={update.isPending}>
              {t("edit.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <StepUpDialog {...stepUp.dialogProps} />
    </Dialog>
  );
}
