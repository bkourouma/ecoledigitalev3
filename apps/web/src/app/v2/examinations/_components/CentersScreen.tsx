"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { examCreateCenterBodySchema, examCreateRoomBodySchema, type ExamCenterDto, type ExamRoomDto } from "@ecoledigitale/contracts/v2/examinations";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { useCreateCenter, useCreateRoom, useExamCenters, useUpdateCenter, useUpdateRoom } from "@/platform/v2/examinations";
import { StatusPill } from "./shared";

function CenterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Examinations.centers.create");
  const create = useCreateCenter();
  const [form, setForm] = useState({ code: "", name: "", kind: "OWN", authorityCode: "", locality: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  async function submit() {
    const parsed = validateWith(examCreateCenterBodySchema, {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      kind: form.kind,
      authorityCode: form.authorityCode.trim() ? form.authorityCode.trim() : null,
      locality: form.locality.trim() ? form.locality.trim() : null,
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    try {
      await create.mutateAsync(parsed.data as never);
      setForm({ code: "", name: "", kind: "OWN", authorityCode: "", locality: "" });
      onOpenChange(false);
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={Object.keys(errors).length === 0 ? create.error : undefined}>
      <div className="space-y-3">
        <FormField label={t("code")} required error={errors.code ?? null}>{(c) => <TextControl {...c} value={form.code} onChange={set("code")} maxLength={30} />}</FormField>
        <FormField label={t("name")} required error={errors.name ?? null}>{(c) => <TextControl {...c} value={form.name} onChange={set("name")} maxLength={200} />}</FormField>
        <FormField label={t("kind")} required hint={t("kindHint")}>{(c) => <NativeSelect {...c} value={form.kind} options={[{ value: "OWN", label: t("own") }, { value: "HOST", label: t("host") }]} onChange={set("kind")} />}</FormField>
        <FormField label={t("authorityCode")} error={errors.authorityCode ?? null}>{(c) => <TextControl {...c} value={form.authorityCode} onChange={set("authorityCode")} maxLength={60} />}</FormField>
        <FormField label={t("locality")} error={errors.locality ?? null}>{(c) => <TextControl {...c} value={form.locality} onChange={set("locality")} maxLength={120} />}</FormField>
      </div>
    </FormDialog>
  );
}

function RoomDialog({ center, open, onOpenChange }: { center: ExamCenterDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations("v2Examinations.centers.room");
  const create = useCreateRoom(center.id);
  const [form, setForm] = useState({ code: "", label: "", capacity: "30" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  async function submit() {
    const parsed = validateWith(examCreateRoomBodySchema, { code: form.code.trim().toUpperCase(), label: form.label.trim() ? form.label.trim() : null, capacity: Number(form.capacity) });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    try {
      await create.mutateAsync(parsed.data as never);
      setForm({ code: "", label: "", capacity: "30" });
      onOpenChange(false);
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
    }
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("title", { center: center.name })} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={create.isPending} error={Object.keys(errors).length === 0 ? create.error : undefined}>
      <div className="space-y-3">
        <FormField label={t("code")} required error={errors.code ?? null}>{(c) => <TextControl {...c} value={form.code} onChange={set("code")} maxLength={20} />}</FormField>
        <FormField label={t("label")} error={errors.label ?? null}>{(c) => <TextControl {...c} value={form.label} onChange={set("label")} maxLength={120} />}</FormField>
        <FormField label={t("capacity")} required error={errors.capacity ?? null}>{(c) => <TextControl {...c} type="number" min={1} value={form.capacity} onChange={set("capacity")} />}</FormField>
      </div>
    </FormDialog>
  );
}

function RoomRow({ centerId, room }: { centerId: string; room: ExamRoomDto }) {
  const t = useTranslations("v2Examinations.centers.room");
  const update = useUpdateRoom(centerId, room.id);
  return (
    <tr className="border-t">
      <th scope="row" className="px-3 py-2 text-left font-medium">{room.code}</th>
      <td className="hidden px-3 py-2 sm:table-cell">{room.label ?? "—"}</td>
      <td className="px-3 py-2 text-right">{room.capacity}</td>
      <td className="px-3 py-2"><StatusPill label={room.active ? t("active") : t("inactive")} tone={room.active ? "success" : "neutral"} /></td>
      <td className="px-3 py-2 text-right">
        <button type="button" className={buttonClass.ghost} disabled={update.isPending} onClick={() => update.mutate({ active: !room.active })}>
          {room.active ? t("deactivate") : t("activate")}
        </button>
        {update.isError ? <ErrorBlock error={update.error} /> : null}
      </td>
    </tr>
  );
}

function CenterCard({ center }: { center: ExamCenterDto }) {
  const t = useTranslations("v2Examinations.centers");
  const update = useUpdateCenter(center.id);
  const [room, setRoom] = useState(false);
  const rooms = center.rooms ?? [];
  const active = center.status === "ACTIVE";
  return (
    <li className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{center.code} — {center.name}</h2>
        <div className="flex items-center gap-2">
          <StatusPill label={center.kind === "OWN" ? t("create.own") : t("create.host")} tone="info" />
          <StatusPill label={active ? t("active") : t("inactive")} tone={active ? "success" : "neutral"} />
        </div>
      </div>
      {center.locality ? <p className="text-sm text-muted-foreground">{center.locality}</p> : null}
      {rooms.length === 0 ? <p className="text-sm text-muted-foreground">{t("noRooms")}</p> : (
        <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label={t("rooms", { center: center.name })}>
          <table className="w-full text-sm">
            <caption className="sr-only">{t("rooms", { center: center.name })}</caption>
            <thead className="bg-muted/50 text-left"><tr>
              <th scope="col" className="px-3 py-2">{t("room.code")}</th>
              <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("room.label")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("room.capacity")}</th>
              <th scope="col" className="px-3 py-2">{t("room.status")}</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">{t("room.actions")}</span></th>
            </tr></thead>
            <tbody>{rooms.map((r) => <RoomRow key={r.id} centerId={center.id} room={r} />)}</tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass.secondary} onClick={() => setRoom(true)}>{t("addRoom")}</button>
        <button type="button" className={buttonClass.secondary} disabled={update.isPending} onClick={() => update.mutate({ status: active ? "INACTIVE" : "ACTIVE" })}>
          {active ? t("deactivate") : t("activate")}
        </button>
      </div>
      {update.isError ? <ErrorBlock error={update.error} /> : null}
      <RoomDialog center={center} open={room} onOpenChange={setRoom} />
    </li>
  );
}

/** Centres d'examen (propres ou d'accueil) et leurs salles : capacités utilisées par la répartition. */
export function CentersScreen() {
  const t = useTranslations("v2Examinations.centers");
  const centers = useExamCenters();
  const [creating, setCreating] = useState(false);
  const items = centers.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} actions={<button type="button" className={buttonClass.primary} onClick={() => setCreating(true)}>{t("create.open")}</button>} />
      {centers.isPending ? <LoadingBlock /> : centers.isError ? <ErrorBlock error={centers.error} onRetry={() => void centers.refetch()} /> : items.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : <ul className="space-y-3">{items.map((c) => <CenterCard key={c.id} center={c} />)}</ul>}
      <CenterDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
