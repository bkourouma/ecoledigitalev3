"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { peopleCreateGuardianBodySchema, peopleUpdateGuardianBodySchema, type PeopleGuardianDto } from "@ecoledigitale/contracts/v2/people";
import { duplicateCandidatesOf, useCreateGuardian, useGuardian, useGuardians, useInvitePortalAccess, useStudents, useUpdateGuardian } from "@/platform/v2/people";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { useDebounced } from "@/platform/ui/useDebounced";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { DuplicateWarning, emptyIdentity, IdentityFields, identityOf, identityPatch, identityToInput, type IdentityValue } from "../../students/_components/identity";

const PAGE_SIZES = [20, 50, 100] as const;

export function GuardiansScreen() {
  const t = useTranslations("v2Guardians.list");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [creating, setCreating] = useState(false);
  const flash = useFlash();
  const list = useGuardians({ q: q || undefined, limit: pageSize, offset: (page - 1) * pageSize });

  const columns: DataTableColumn<PeopleGuardianDto>[] = [
    { id: "name", header: t("columns.name"), rowHeader: true, cell: (g) => (<Link href={`/v2/guardians/${g.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{g.displayName}</Link>) },
    { id: "phone", header: t("columns.phone"), cell: (g) => g.phone ?? "—" },
    { id: "email", header: t("columns.email"), cell: (g) => g.email ?? "—", className: "hidden md:table-cell" },
    { id: "children", header: t("columns.children"), align: "right", cell: (g) => g.childrenCount, className: "hidden sm:table-cell" },
    { id: "portal", header: t("columns.portal"), cell: (g) => <StatusBadge label={g.portalAccount === "NONE" ? t("noPortal") : t("portalActive")} tone={g.portalAccount === "NONE" ? "neutral" : "success"} />, className: "hidden lg:table-cell" },
  ];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="guardian.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>
              {t("new")}
            </button>
          </Can>
        }
      />
      {flash.node}
      <div role="search" aria-label={t("search")} className="mb-4 max-w-xl">
        <FormField label={t("search")}>
          {(c) => <TextControl {...c} type="search" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder={t("searchPlaceholder")} maxLength={120} />}
        </FormField>
      </div>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(g) => g.id}
        isLoading={list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={q ? t("noResults") : t("empty")}
        pagination={list.data ? { page, pageSize, total: list.data.total, onPageChange: setPage, pageSizeOptions: PAGE_SIZES, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } } : undefined}
      />
      {creating ? <CreateGuardianDialog onClose={() => setCreating(false)} onDone={(name) => flash.show(t("created", { name }))} /> : null}
    </div>
  );
}

function CreateGuardianDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const t = useTranslations("v2Guardians.list");
  const create = useCreateGuardian();
  const [identity, setIdentity] = useState(emptyIdentity());
  const [occupation, setOccupation] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState("");
  const candidates = duplicateCandidatesOf(create.error);

  async function submit() {
    const body = { person: identityToInput(identity), ...(occupation.trim() ? { occupation: occupation.trim() } : {}), ...(ack ? { acknowledgeDuplicate: true, duplicateReason: reason.trim() } : {}) };
    const v = validateWith(peopleCreateGuardianBodySchema, body);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    try {
      const result = await create.mutateAsync(v.data);
      onDone(result.guardian.displayName);
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("createTitle")} submitLabel={t("create")} onSubmit={() => void submit()} isPending={create.isPending} error={candidates.length > 0 ? null : create.error} wide>
      <IdentityFields value={identity} onChange={(v) => { setIdentity(v); setAck(false); create.reset(); }} errors={errors} sexRequired={false} />
      <FormField label={t("occupation")}>{(c) => <TextControl {...c} value={occupation} onChange={setOccupation} maxLength={160} />}</FormField>
      <DuplicateWarning candidates={candidates} acknowledged={ack} onAcknowledge={setAck} reason={reason} onReason={setReason} reasonError={errors.duplicateReason} linkTarget="none" />
    </FormDialog>
  );
}

export function GuardianDetail({ id }: { id: string }) {
  const t = useTranslations("v2Guardians.detail");
  const guardian = useGuardian(id);
  const children = useStudents({ guardianId: id, limit: 50 });
  const invite = useInvitePortalAccess();
  const flash = useFlash();
  const [editing, setEditing] = useState(false);
  const [inviteError, setInviteError] = useState<unknown>(null);

  if (guardian.isPending && guardian.fetchStatus !== "idle") return <LoadingBlock />;
  if (guardian.isError) return <ErrorBlock error={guardian.error} onRetry={() => void guardian.refetch()} />;
  if (!guardian.data) return null;
  const g = guardian.data;

  const columns: DataTableColumn<NonNullable<typeof children.data>["items"][number]>[] = [
    { id: "name", header: t("children.name"), rowHeader: true, cell: (s) => (<Link href={`/v2/students/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{s.displayName}</Link>) },
    { id: "number", header: t("children.number"), cell: (s) => s.studentNumber, className: "hidden sm:table-cell" },
    { id: "classroom", header: t("children.classroom"), cell: (s) => s.currentEnrollment?.classroomName ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={g.displayName}
        description={g.occupation ?? undefined}
        actions={
          <>
            <Link href="/v2/guardians" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            <Can permission="guardian.manage">
              <button type="button" className={buttonClass.secondary} onClick={() => setEditing(true)}>
                {t("edit")}
              </button>
              {g.portalAccount === "NONE" ? (
                <button
                  type="button"
                  className={buttonClass.secondary}
                  disabled={invite.isPending}
                  onClick={() => {
                    setInviteError(null);
                    void invite.mutateAsync({ personId: g.personId, quality: "GUARDIAN" }).then(() => flash.show(t("invited"))).catch(setInviteError);
                  }}
                >
                  {t("invite")}
                </button>
              ) : null}
            </Can>
          </>
        }
      />
      {flash.node}
      {inviteError ? <ErrorBlock error={inviteError} /> : null}
      <section aria-labelledby="g-contact" className="rounded-2xl border border-white/10 bg-card/40 p-4">
        <h2 id="g-contact" className="mb-3 text-lg font-semibold">
          {t("contact")}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {([["email", g.email], ["phone", g.phone], ["phoneAlt", g.phoneAlt], ["city", g.city], ["addressLine", g.addressLine], ["employer", g.employer]] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground">{t(`fields.${k}`)}</dt>
              <dd className="break-words">{v || "—"}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground">{t("fields.portal")}</dt>
            <dd>{g.portalAccount === "NONE" ? t("noPortal") : g.portalAccount}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="g-children" className="space-y-2">
        <h2 id="g-children" className="text-lg font-semibold">
          {t("children.title")}
        </h2>
        <DataTable caption={t("children.caption")} columns={columns} rows={children.data?.items ?? []} getRowId={(s) => s.id} isLoading={children.isFetching} error={children.error} onRetry={() => void children.refetch()} emptyTitle={t("children.empty")} />
      </section>
      {editing ? <EditGuardianDialog guardian={g} onClose={() => setEditing(false)} onDone={() => flash.show(t("updated"))} /> : null}
    </div>
  );
}

function EditGuardianDialog({ guardian, onClose, onDone }: { guardian: PeopleGuardianDto; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Guardians.detail");
  const initial = identityOf(guardian as unknown as Partial<Record<keyof IdentityValue, string | null>>);
  const [value, setValue] = useState<IdentityValue>(initial);
  const [occupation, setOccupation] = useState(guardian.occupation ?? "");
  const [employer, setEmployer] = useState(guardian.employer ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = useUpdateGuardian();

  async function submit() {
    const patch: Record<string, unknown> = {};
    const person = identityPatch(value, initial);
    if (Object.keys(person).length > 0) patch.person = person;
    if (occupation.trim() !== (guardian.occupation ?? "")) patch.occupation = occupation.trim() || null;
    if (employer.trim() !== (guardian.employer ?? "")) patch.employer = employer.trim() || null;
    if (Object.keys(patch).length === 0) return onClose();
    const v = validateWith(peopleUpdateGuardianBodySchema, patch);
    if (!v.ok) return setErrors(v.errors);
    try {
      await update.mutateAsync({ id: guardian.id, patch: v.data as Record<string, unknown> });
      onDone();
      onClose();
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("editTitle", { name: guardian.displayName })} submitLabel={t("save")} onSubmit={() => void submit()} isPending={update.isPending} error={update.error} wide>
      <IdentityFields value={value} onChange={setValue} errors={errors} sexRequired={false} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fields.occupation")}>{(c) => <TextControl {...c} value={occupation} onChange={setOccupation} maxLength={160} />}</FormField>
        <FormField label={t("fields.employer")}>{(c) => <TextControl {...c} value={employer} onChange={setEmployer} maxLength={160} />}</FormField>
      </div>
    </FormDialog>
  );
}
