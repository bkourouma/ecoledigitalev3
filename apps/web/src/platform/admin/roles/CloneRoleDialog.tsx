"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Notice } from "@ecoledigitale/ui";
import type { RbacRoleSummary } from "@ecoledigitale/contracts/v2/rbac";
import { StepUpDialog } from "@/platform/ui/StepUpDialog";
import { useStepUp } from "@/platform/ui/useStepUp";
import { fieldErrorsOf } from "../errors";
import { notifySuccess } from "../notify";
import { useErrorMessage } from "../use-error-message";
import { useCloneRole } from "./hooks";

export interface CloneRoleDialogProps {
  role: Pick<RbacRoleSummary, "id" | "label"> | null;
  onClose: () => void;
}

export function CloneRoleDialog({ role, onClose }: CloneRoleDialogProps) {
  const t = useTranslations("access.clone");
  const tu = useTranslations("ui");
  const router = useRouter();
  const message = useErrorMessage();
  const clone = useCloneRole();
  const stepUp = useStepUp();
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [labelError, setLabelError] = useState<string | undefined>();

  const close = () => {
    clone.reset();
    setLabel("");
    setKey("");
    setDescription("");
    setLabelError(undefined);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!role) return;
    if (!label.trim()) {
      setLabelError(tu("required"));
      return;
    }
    setLabelError(undefined);
    const body = {
      id: role.id,
      label: label.trim(),
      ...(key.trim() ? { key: key.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    void stepUp.run(() => clone.mutateAsync(body)).then(
      (created) => {
        notifySuccess(t("done", { label: created.label }));
        close();
        router.push(`/v2/access/roles/${created.id}`);
      },
      () => undefined,
    );
  };

  const fields = fieldErrorsOf(clone.error);

  return (
    <Dialog open={role !== null} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent closeLabel={tu("close")} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { label: role?.label ?? "" })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={t("label")} required requiredLabel={tu("required")} error={labelError ?? fields.label}>
            {(c) => <Input {...c} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />}
          </Field>
          <Field label={t("key")} hint={t("keyHint")} error={fields.key}>
            {(c) => <Input {...c} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>
          <Field label={t("descriptionField")} error={fields.description}>
            {(c) => <Input {...c} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          {clone.error ? <Notice tone="danger">{message(clone.error)}</Notice> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-10" onClick={close} disabled={clone.isPending}>
              {tu("cancel")}
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-10" disabled={clone.isPending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <StepUpDialog {...stepUp.dialogProps} />
    </Dialog>
  );
}
