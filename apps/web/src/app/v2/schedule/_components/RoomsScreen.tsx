"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { schedulingEquipmentBodySchema, schedulingRoomBodySchema } from "@ecoledigitale/contracts/v2/scheduling";
import { useCampuses } from "@/platform/admin/tenancy/hooks";
import { useFeature } from "@/platform/access";
import { addDays, mondayOf, todayCivil } from "@/platform/v2/dates";
import { useInstitutions } from "@/platform/v2/lookups";
import { useCreateEquipment, useCreateRoom, useEquipment, useRoomOccupancy, useRoomTypes, useRooms, useSetRoomStatus, useUpdateEquipment } from "@/platform/v2/scheduling";
import { Can, FeatureNotice } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import type { z } from "zod";
import type { schedulingEquipmentDtoSchema, schedulingRoomDtoSchema } from "@ecoledigitale/contracts/v2/scheduling";

type Room = z.infer<typeof schedulingRoomDtoSchema>;
type Equipment = z.infer<typeof schedulingEquipmentDtoSchema>;
const STATUSES = ["AVAILABLE", "OUT_OF_SERVICE", "ARCHIVED"] as const;
const tone = (s: string) => (s === "AVAILABLE" ? "success" : s === "OUT_OF_SERVICE" ? "warning" : "neutral");

/** Salles, équipements et plan d'occupation d'un campus. */
export function RoomsScreen() {
  const t = useTranslations("v2Schedule.rooms");
  const tStatus = useTranslations("v2Schedule.resourceStatus");
  const format = useFormatter();
  const flash = useFlash();
  const institutions = useInstitutions();
  const [institutionId, setInstitutionId] = useState("");
  const institution = institutionId || institutions.data?.[0]?.id || "";
  const campuses = useCampuses(institution || null);
  const [campusPick, setCampusPick] = useState("");
  const campus = campusPick || campuses.data?.[0]?.id || "";
  const rooms = useRooms({ campusId: campus || undefined }, campus !== "");
  const equipmentFeature = useFeature("scheduling.equipment");
  const equipment = useEquipment({ campusId: campus || undefined }, campus !== "" && equipmentFeature.allowed);
  const [roomForm, setRoomForm] = useState(false);
  const [equipmentForm, setEquipmentForm] = useState(false);
  const [statusFor, setStatusFor] = useState<{ room: Room; status: (typeof STATUSES)[number] } | null>(null);
  const [editing, setEditing] = useState<Equipment | null>(null);
  const setStatus = useSetRoomStatus();
  const monday = mondayOf(todayCivil());
  const occupancy = useRoomOccupancy({ campusId: campus || null, from: monday, to: addDays(monday, 6) });

  const roomColumns: DataTableColumn<Room>[] = [
    { id: "name", header: t("columns.name"), rowHeader: true, cell: (r) => r.name },
    { id: "code", header: t("columns.code"), cell: (r) => r.code, className: "hidden sm:table-cell" },
    { id: "type", header: t("columns.type"), cell: (r) => r.roomTypeCode, className: "hidden md:table-cell" },
    { id: "capacity", header: t("columns.capacity"), align: "right", cell: (r) => r.capacity ?? "—" },
    { id: "building", header: t("columns.building"), cell: (r) => [r.building, r.floorLabel].filter(Boolean).join(" · ") || "—", className: "hidden lg:table-cell" },
    { id: "status", header: t("columns.status"), cell: (r) => <StatusBadge label={tStatus(r.status)} tone={tone(r.status)} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (r) => (
        <Can permission="schedule.room.manage">
          <span className="inline-flex flex-wrap justify-end gap-1">
            {STATUSES.filter((s) => s !== r.status).map((s) => (
              <button key={s} type="button" className={buttonClass.ghost} onClick={() => setStatusFor({ room: r, status: s })}>
                {t(`setStatus.${s}`)}
              </button>
            ))}
          </span>
        </Can>
      ),
    },
  ];

  const equipmentColumns: DataTableColumn<Equipment>[] = [
    { id: "label", header: t("columns.name"), rowHeader: true, cell: (e) => e.label },
    { id: "code", header: t("columns.code"), cell: (e) => e.code, className: "hidden sm:table-cell" },
    { id: "quantity", header: t("columns.quantity"), align: "right", cell: (e) => e.quantity },
    { id: "status", header: t("columns.status"), cell: (e) => <StatusBadge label={tStatus(e.status)} tone={tone(e.status)} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      align: "right",
      cell: (e) => (
        <Can permission="schedule.room.manage">
          <button type="button" className={buttonClass.ghost} onClick={() => setEditing(e)}>
            {t("editEquipment")}
          </button>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="schedule.room.manage">
            <button type="button" className={buttonClass.primary} disabled={!campus} onClick={() => setRoomForm(true)}>
              {t("addRoom")}
            </button>
          </Can>
        }
      />
      {flash.node}
      <div role="search" aria-label={t("filters")} className="grid gap-3 sm:grid-cols-2">
        {(institutions.data?.length ?? 0) > 1 ? (
          <FormField label={t("institution")}>
            {(c) => <NativeSelect {...c} value={institution} onChange={(v) => { setInstitutionId(v); setCampusPick(""); }} options={(institutions.data ?? []).map((i) => ({ value: i.id, label: i.name }))} />}
          </FormField>
        ) : null}
        <FormField label={t("campus")}>{(c) => <NativeSelect {...c} value={campus} onChange={setCampusPick} options={(campuses.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />}</FormField>
      </div>

      <section aria-labelledby="rooms-title" className="space-y-2">
        <h2 id="rooms-title" className="text-lg font-semibold">
          {t("rooms")}
        </h2>
        <DataTable caption={t("roomsCaption")} columns={roomColumns} rows={rooms.data ?? []} getRowId={(r) => r.id} isLoading={rooms.isFetching} error={rooms.error} onRetry={() => void rooms.refetch()} emptyTitle={t("emptyRooms")} emptyDescription={t("emptyRoomsHint")} />
        {setStatus.error && !statusFor ? <ErrorBlock error={setStatus.error} /> : null}
      </section>

      <section aria-labelledby="occupancy-title" className="space-y-2">
        <h2 id="occupancy-title" className="text-lg font-semibold">
          {t("occupancy")}
        </h2>
        {occupancy.isPending && campus ? (
          <LoadingBlock />
        ) : occupancy.isError ? (
          <ErrorBlock error={occupancy.error} onRetry={() => void occupancy.refetch()} />
        ) : occupancy.data ? (
          <DataTable
            caption={t("occupancyCaption")}
            columns={[
              { id: "room", header: t("columns.name"), rowHeader: true, cell: (r: NonNullable<typeof occupancy.data>["rooms"][number]) => r.name },
              { id: "occupied", header: t("columns.occupied"), align: "right", cell: (r) => t("hours", { value: format.number(r.occupiedMinutes / 60, { maximumFractionDigits: 1 }) }) },
              { id: "rate", header: t("columns.rate"), align: "right", cell: (r) => (r.rateBp === null ? t("noOpening") : format.number(r.rateBp / 10_000, { style: "percent", maximumFractionDigits: 0 })) },
            ]}
            rows={occupancy.data.rooms}
            getRowId={(r) => r.roomId}
            emptyTitle={t("emptyRooms")}
          />
        ) : null}
      </section>

      <section aria-labelledby="equip-title" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="equip-title" className="text-lg font-semibold">
            {t("equipment")}
          </h2>
          {equipmentFeature.allowed ? (
            <Can permission="schedule.room.manage">
              <button type="button" className={buttonClass.secondary} disabled={!campus} onClick={() => setEquipmentForm(true)}>
                {t("addEquipment")}
              </button>
            </Can>
          ) : null}
        </div>
        {!equipmentFeature.isLoading && !equipmentFeature.allowed ? (
          <FeatureNotice>{t("equipmentOff")}</FeatureNotice>
        ) : (
          <DataTable caption={t("equipmentCaption")} columns={equipmentColumns} rows={equipment.data ?? []} getRowId={(e) => e.id} isLoading={equipment.isFetching} error={equipment.error} onRetry={() => void equipment.refetch()} emptyTitle={t("emptyEquipment")} />
        )}
      </section>

      {roomForm ? <RoomForm institutionId={institution} campusId={campus} onClose={() => setRoomForm(false)} onDone={() => flash.show(t("roomSaved"))} /> : null}
      {equipmentForm ? <EquipmentForm institutionId={institution} campusId={campus} onClose={() => setEquipmentForm(false)} onDone={() => flash.show(t("equipmentSaved"))} /> : null}
      {editing ? <EquipmentEdit item={editing} onClose={() => setEditing(null)} onDone={() => flash.show(t("equipmentSaved"))} /> : null}
      {statusFor ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setStatusFor(null)}
          title={t("statusTitle", { room: statusFor.room.name, status: tStatus(statusFor.status) })}
          description={statusFor.status === "AVAILABLE" ? t("statusDescriptionOn") : t("statusDescriptionOff")}
          reasonLabel={t("reasonOptional")}
          confirmLabel={t("confirmStatus")}
          reasonRequired={false}
          isPending={setStatus.isPending}
          error={setStatus.error}
          onConfirm={(reason) =>
            setStatus.mutate(
              { id: statusFor.room.id, status: statusFor.status, ...(reason ? { reason } : {}) },
              {
                onSuccess: () => {
                  setStatusFor(null);
                  flash.show(t("statusSaved"));
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

function RoomForm({ institutionId, campusId, onClose, onDone }: { institutionId: string; campusId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Schedule.rooms.roomForm");
  const create = useCreateRoom();
  const types = useRoomTypes();
  const [v, setV] = useState({ code: "", name: "", roomTypeCode: "", capacity: "", building: "", features: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const api = apiErrorToFieldErrors(create.error);
  const set = (k: keyof typeof v) => (value: string) => setV((x) => ({ ...x, [k]: value }));

  function submit() {
    const body = {
      institutionId,
      campusId,
      code: v.code.trim(),
      name: v.name.trim(),
      roomTypeCode: v.roomTypeCode,
      ...(v.capacity.trim() ? { capacity: Number(v.capacity) } : {}),
      ...(v.building.trim() ? { building: v.building.trim() } : {}),
      ...(v.features.trim() ? { features: v.features.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
    };
    const r = validateWith(schedulingRoomBodySchema, body);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    create.mutate(r.data as never, {
      onSuccess: () => {
        onClose();
        onDone();
      },
    });
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={Object.keys(api).length ? undefined : create.error}>
      <FormField label={t("code")} required error={errors.code ?? api.code}>{(c) => <TextControl {...c} value={v.code} onChange={set("code")} maxLength={40} />}</FormField>
      <FormField label={t("name")} required error={errors.name ?? api.name}>{(c) => <TextControl {...c} value={v.name} onChange={set("name")} maxLength={200} />}</FormField>
      <FormField label={t("type")} required error={errors.roomTypeCode ?? api.roomTypeCode}>
        {(c) => <NativeSelect {...c} value={v.roomTypeCode} onChange={set("roomTypeCode")} placeholder={t("chooseType")} options={(types.data ?? []).filter((x) => x.active !== false).map((x) => ({ value: x.code, label: x.label }))} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("capacity")} error={errors.capacity ?? api.capacity}>{(c) => <TextControl {...c} type="number" inputMode="numeric" min={1} value={v.capacity} onChange={set("capacity")} />}</FormField>
        <FormField label={t("building")}>{(c) => <TextControl {...c} value={v.building} onChange={set("building")} />}</FormField>
      </div>
      <FormField label={t("features")} hint={t("featuresHint")}>{(c) => <TextControl {...c} value={v.features} onChange={set("features")} />}</FormField>
    </FormDialog>
  );
}

function EquipmentForm({ institutionId, campusId, onClose, onDone }: { institutionId: string; campusId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Schedule.rooms.equipmentForm");
  const create = useCreateEquipment();
  const [v, setV] = useState({ code: "", label: "", quantity: "1" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const api = apiErrorToFieldErrors(create.error);
  function submit() {
    const r = validateWith(schedulingEquipmentBodySchema, { institutionId, campusId, code: v.code.trim(), label: v.label.trim(), quantity: Number(v.quantity) });
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    create.mutate(r.data, {
      onSuccess: () => {
        onClose();
        onDone();
      },
    });
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={Object.keys(api).length ? undefined : create.error}>
      <FormField label={t("code")} required error={errors.code ?? api.code}>{(c) => <TextControl {...c} value={v.code} onChange={(code) => setV((x) => ({ ...x, code }))} maxLength={40} />}</FormField>
      <FormField label={t("label")} required error={errors.label ?? api.label}>{(c) => <TextControl {...c} value={v.label} onChange={(label) => setV((x) => ({ ...x, label }))} maxLength={200} />}</FormField>
      <FormField label={t("quantity")} required error={errors.quantity ?? api.quantity}>{(c) => <TextControl {...c} type="number" inputMode="numeric" min={1} value={v.quantity} onChange={(quantity) => setV((x) => ({ ...x, quantity }))} />}</FormField>
    </FormDialog>
  );
}

function EquipmentEdit({ item, onClose, onDone }: { item: Equipment; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Schedule.rooms.equipmentForm");
  const tStatus = useTranslations("v2Schedule.resourceStatus");
  const update = useUpdateEquipment();
  const [label, setLabel] = useState(item.label);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [status, setStatus] = useState<string>(item.status);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("editTitle", { label: item.label })}
      submitLabel={t("save")}
      isPending={update.isPending}
      error={update.error}
      onSubmit={() =>
        update.mutate(
          { id: item.id, label: label.trim(), quantity: Number(quantity), status: status as Equipment["status"] },
          {
            onSuccess: () => {
              onClose();
              onDone();
            },
          },
        )
      }
    >
      <FormField label={t("label")} required>{(c) => <TextControl {...c} value={label} onChange={setLabel} maxLength={200} />}</FormField>
      <FormField label={t("quantity")} required>{(c) => <TextControl {...c} type="number" inputMode="numeric" min={1} value={quantity} onChange={setQuantity} />}</FormField>
      <FormField label={t("status")}>{(c) => <NativeSelect {...c} value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}</FormField>
    </FormDialog>
  );
}
