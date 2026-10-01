"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, NativeSelect, Notice } from "@ecoledigitale/ui";
import type { Campus, EntityStatus, Institution } from "@ecoledigitale/contracts/v2/tenancy";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { useCreateCampus, useCreateInstitution, useUpdateCampus, useUpdateInstitution } from "./hooks";
import {
  campusFormFrom,
  EMPTY_CAMPUS_FORM,
  PACK_KEYS,
  validateCampusCreate,
  validateCampusUpdate,
  validateInstitutionCreate,
  validateInstitutionUpdate,
  type CampusFormState,
  type InstitutionFormState,
} from "./profile";

const STATUSES: readonly EntityStatus[] = ["ACTIVE", "SUSPENDED", "ARCHIVED"];

// --------------------------------------------------------------------------- création d'un établissement

export function CreateInstitutionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("settings.institutions.create");
  const tPack = useTranslations("settings.institutions.pack");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const create = useCreateInstitution();
  const [form, setForm] = useState<InstitutionFormState>({ name: "", pack: "", code: "", educationSystem: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof InstitutionFormState, string>>>({});
  const server = fieldErrorsOf(create.error);

  const close = () => {
    create.reset();
    setForm({ name: "", pack: "", code: "", educationSystem: "" });
    setErrors({});
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateInstitutionCreate(form);
    setErrors(result.errors);
    if (!result.data) return;
    create.mutate(result.data, {
      onSuccess: (created) => {
        notifySuccess(t("done", { name: created.name }));
        close();
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent closeLabel={tu("close")} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={t("name")} required requiredLabel={tu("required")} error={errors.name ?? server.name}>
            {(c) => <Input {...c} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />}
          </Field>
          <Field label={t("pack")} required requiredLabel={tu("required")} error={errors.pack ?? server.pack}>
            {(c) => (
              <NativeSelect {...c} value={form.pack} onChange={(e) => setForm((f) => ({ ...f, pack: e.target.value as InstitutionFormState["pack"] }))}>
                <option value="">{t("packChoose")}</option>
                {PACK_KEYS.map((pack) => (
                  <option key={pack} value={pack}>
                    {tPack(pack)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t("code")} hint={t("codeHint")} error={errors.code ?? server.code}>
            {(c) => <Input {...c} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} autoComplete="off" spellCheck={false} />}
          </Field>
          <Field label={t("educationSystem")} hint={t("educationSystemHint")} error={errors.educationSystem ?? server.educationSystem}>
            {(c) => <Input {...c} value={form.educationSystem} onChange={(e) => setForm((f) => ({ ...f, educationSystem: e.target.value }))} />}
          </Field>
          {create.error ? <Notice tone="danger">{message(create.error)}</Notice> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" onClick={close} disabled={create.isPending}>
              {tu("cancel")}
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-10" disabled={create.isPending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------- modification d'un établissement

export function EditInstitutionDialog({ institution, onClose }: { institution: Institution | null; onClose: () => void }) {
  const t = useTranslations("settings.institutions.update");
  const tStatus = useTranslations("settings.institutions.status");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const update = useUpdateInstitution();
  const [form, setForm] = useState({ name: "", educationSystem: "", status: "ACTIVE" as EntityStatus });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<"name" | "educationSystem", string>>>({});
  const [nothing, setNothing] = useState(false);

  if (institution && loadedFor !== institution.id) {
    setLoadedFor(institution.id);
    setForm({ name: institution.name, educationSystem: institution.educationSystem, status: institution.status });
    setErrors({});
    setNothing(false);
  }

  const close = () => {
    update.reset();
    setLoadedFor(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!institution) return;
    const result = validateInstitutionUpdate(form, institution);
    setErrors(result.errors);
    setNothing(!result.data && Object.keys(result.errors).length === 0);
    if (!result.data) return;
    update.mutate(
      { id: institution.id, ...result.data },
      {
        onSuccess: () => {
          notifySuccess(t("done"));
          close();
        },
      },
    );
  };

  return (
    <Dialog open={institution !== null} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent closeLabel={tu("close")} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{institution?.name ?? ""}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={t("name")} error={errors.name}>
            {(c) => <Input {...c} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}
          </Field>
          <Field label={t("educationSystem")} error={errors.educationSystem}>
            {(c) => <Input {...c} value={form.educationSystem} onChange={(e) => setForm((f) => ({ ...f, educationSystem: e.target.value }))} />}
          </Field>
          <Field label={t("status")}>
            {(c) => (
              <NativeSelect {...c} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as EntityStatus }))}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tStatus(s)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {nothing ? <Notice tone="info">{t("nothing")}</Notice> : null}
          {update.error ? <Notice tone="danger">{message(update.error)}</Notice> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" onClick={close} disabled={update.isPending}>
              {tu("cancel")}
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-10" disabled={update.isPending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------- campus

export type CampusDialogTarget = { mode: "create"; institution: Pick<Institution, "id" | "name"> } | { mode: "edit"; campus: Campus } | null;

export function CampusDialog({ target, onClose }: { target: CampusDialogTarget; onClose: () => void }) {
  const t = useTranslations("settings.campuses.form");
  const tStatus = useTranslations("settings.institutions.status");
  const tu = useTranslations("ui");
  const message = useErrorMessage();
  const createCampus = useCreateCampus();
  const updateCampus = useUpdateCampus();
  const [form, setForm] = useState<CampusFormState & { status: EntityStatus }>({ ...EMPTY_CAMPUS_FORM, status: "ACTIVE" });
  const [errors, setErrors] = useState<Partial<Record<keyof CampusFormState, string>>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = target ? (target.mode === "create" ? `create:${target.institution.id}` : `edit:${target.campus.id}`) : null;
  if (target && loadedFor !== key) {
    setLoadedFor(key);
    setForm(target.mode === "edit" ? { ...campusFormFrom(target.campus), status: target.campus.status } : { ...EMPTY_CAMPUS_FORM, status: "ACTIVE" });
    setErrors({});
  }

  const mutation = target?.mode === "edit" ? updateCampus : createCampus;
  const server = fieldErrorsOf(mutation.error);

  const close = () => {
    createCampus.reset();
    updateCampus.reset();
    setLoadedFor(null);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!target) return;
    if (target.mode === "create") {
      const result = validateCampusCreate(form);
      setErrors(result.errors);
      if (!result.data) return;
      createCampus.mutate(
        { institutionId: target.institution.id, ...result.data },
        {
          onSuccess: (campus) => {
            notifySuccess(t("createDone", { name: campus.name }));
            close();
          },
        },
      );
      return;
    }
    const result = validateCampusUpdate(form, target.campus);
    setErrors(result.errors);
    if (!result.data) {
      if (Object.keys(result.errors).length === 0) close();
      return;
    }
    updateCampus.mutate(
      { id: target.campus.id, ...result.data },
      {
        onSuccess: () => {
          notifySuccess(t("editDone"));
          close();
        },
      },
    );
  };

  const editing = target?.mode === "edit";

  return (
    <Dialog open={target !== null} onOpenChange={(next) => (!next ? close() : undefined)}>
      <DialogContent closeLabel={tu("close")} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle") : t("createTitle")}</DialogTitle>
          <DialogDescription>{target ? (target.mode === "create" ? target.institution.name : target.campus.name) : ""}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={t("name")} required requiredLabel={tu("required")} error={errors.name ?? server.name}>
            {(c) => <Input {...c} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />}
          </Field>
          {!editing ? (
            <Field label={t("code")} hint={t("codeHint")} error={errors.code ?? server.code}>
              {(c) => <Input {...c} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} autoComplete="off" spellCheck={false} />}
            </Field>
          ) : null}
          <Field label={t("address")} error={errors.address ?? server.address}>
            {(c) => <Input {...c} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("city")} error={errors.city ?? server.city}>
              {(c) => <Input {...c} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />}
            </Field>
            <Field label={t("phone")} error={errors.phone ?? server.phone}>
              {(c) => <Input {...c} type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />}
            </Field>
          </div>
          {editing ? (
            <Field label={t("status")}>
              {(c) => (
                <NativeSelect {...c} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as EntityStatus }))}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {tStatus(s)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          ) : null}
          {mutation.error ? <Notice tone="danger">{message(mutation.error)}</Notice> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" onClick={close} disabled={mutation.isPending}>
              {tu("cancel")}
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-10" disabled={mutation.isPending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
