"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { academicEnrollStudentBodySchema, type AcademicEnrollmentDto } from "@ecoledigitale/contracts/v2/academic";
import { peopleCreateStudentBodySchema, type PeopleDuplicateCandidateDto } from "@ecoledigitale/contracts/v2/people";
import { useAcademicYears, useClassroom, useEnrollStudent, useEnrollments, useReference } from "@/platform/v2/academic";
import { useClassroomOptions, useStudentOptions } from "@/platform/v2/lookups";
import { duplicateCandidatesOf, useCreateStudent } from "@/platform/v2/people";
import { useFeature } from "@/platform/access";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, Notice } from "@/platform/ui/states";
import { Wizard } from "@/platform/ui/Wizard";
import { apiErrorToFieldErrors, compact, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { DuplicateWarning, emptyIdentity, IdentityFields, identityToInput } from "../../students/_components/identity";

type StudentMode = "existing" | "new";

export function EnrollmentWizard({ initialStudentId, initialClassroomId }: { initialStudentId?: string; initialClassroomId?: string }) {
  const t = useTranslations("v2Enrollments.wizard");
  const tFunding = useTranslations("v2Enrollments.funding");
  const years = useAcademicYears();
  const fundingTypes = useReference("funding-types");
  const stateAssigned = useFeature("academic.state-assigned");
  const aLaCarte = useFeature("academic.a-la-carte");
  const createStudent = useCreateStudent();
  const enroll = useEnrollStudent();

  const [studentMode, setStudentMode] = useState<StudentMode>("existing");
  const [student, setStudent] = useState<SelectOption | null>(initialStudentId ? { value: initialStudentId, label: initialStudentId } : null);
  const [identity, setIdentity] = useState(emptyIdentity());
  const [duplicates, setDuplicates] = useState<PeopleDuplicateCandidateDto[]>([]);
  const [ack, setAck] = useState(false);
  const [ackReason, setAckReason] = useState("");
  const [createdStudentId, setCreatedStudentId] = useState<string | null>(null);

  const [yearId, setYearId] = useState("");
  const [classroom, setClassroom] = useState<SelectOption | null>(initialClassroomId ? { value: initialClassroomId, label: initialClassroomId } : null);
  const [mode, setMode] = useState<"CLASS" | "A_LA_CARTE">("CLASS");
  const [placement, setPlacement] = useState({ enrolledOn: "", isRepeating: false, isTransferIn: false, originSchool: "" });
  const [funding, setFunding] = useState({ fundingType: "PRIVATE", assignmentReference: "", assignmentIssuedOn: "", funderLabel: "", fundingNotes: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [done, setDone] = useState<AcademicEnrollmentDto | null>(null);

  // Année proposée d'office : l'année courante (affichage seulement).
  useEffect(() => {
    if (yearId || !years.data) return;
    const current = years.data.find((y) => y.isCurrent) ?? years.data.find((y) => y.status === "OPEN");
    if (current) setYearId(current.id);
  }, [years.data, yearId]);

  const studentId = studentMode === "existing" ? (student?.value ?? null) : createdStudentId;
  const classroomDetail = useClassroom(classroom?.value ?? null);
  // Un élève existant peut déjà être inscrit cette année : simple avertissement (l'API refuse un vrai doublon).
  const existing = useEnrollments({ studentId: studentMode === "existing" ? (student?.value ?? undefined) : undefined, academicYearId: yearId || undefined, pageSize: 20 });
  const liveExisting = (existing.data?.items ?? []).filter((e) => ["PENDING", "ACTIVE", "SUSPENDED"].includes(e.status));

  const fundingDef = (fundingTypes.data ?? []).find((f) => f.code === funding.fundingType);
  const fundingOptions = (fundingTypes.data ?? [])
    .filter((f) => f.active && (f.code !== "STATE_ASSIGNED" || stateAssigned.allowed))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const useClassOpts = (search: string, enabled: boolean) => useClassroomOptions(search, enabled, { academicYearId: yearId || undefined });

  const newStudentBody = (validateOnly: boolean, acknowledge: boolean) => ({
    person: identityToInput(identity),
    validateOnly,
    ...(acknowledge ? { acknowledgeDuplicate: true, duplicateReason: ackReason.trim() } : {}),
  });

  async function validateStudentStep(): Promise<boolean> {
    if (studentMode === "existing") {
      if (!student) {
        setErrors({ student: t("student.required") });
        return false;
      }
      setErrors({});
      return true;
    }
    if (createdStudentId) return true;
    // Contrat d'abord (sexe obligatoire, formats), puis contrôle de doublon côté serveur sans rien écrire (`validateOnly`).
    const local = validateWith(peopleCreateStudentBodySchema, newStudentBody(true, ack));
    if (!local.ok) {
      setErrors(local.errors);
      return false;
    }
    // Doublons déjà signalés pour cette saisie et confirmés (avec motif, validé ci-dessus) : pas de second contrôle.
    if (duplicates.length > 0 && ack) {
      setErrors({});
      return true;
    }
    try {
      const result = await createStudent.mutateAsync(local.data);
      const found = "duplicates" in result ? result.duplicates : [];
      setDuplicates(found);
      if (found.length > 0 && !ack) {
        setErrors({ duplicate: t("student.duplicateBlocking") });
        return false;
      }
      setErrors({});
      return true;
    } catch (e) {
      setErrors(apiErrorToFieldErrors(e));
      return false;
    }
  }

  function validateClassStep(): boolean {
    const e: FieldErrors = {};
    if (!classroom) e.classroom = t("classroom.required");
    if (placement.isTransferIn && !placement.originSchool.trim()) e.originSchool = t("classroom.originRequired");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateFundingStep(): boolean {
    const e: FieldErrors = {};
    if (!funding.fundingType) e.fundingType = t("funding.required");
    // Les exigences (référence, financeur) sont des données du type de financement renvoyées par l'API.
    if (fundingDef?.requiresReference && !funding.assignmentReference.trim()) e.assignmentReference = t("funding.referenceRequired");
    if (fundingDef?.requiresFunder && !funding.funderLabel.trim()) e.funderLabel = t("funding.funderRequired");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function finish() {
    setErrors({});
    try {
      let sid = studentId;
      if (studentMode === "new" && !createdStudentId) {
        const body = validateWith(peopleCreateStudentBodySchema, newStudentBody(false, ack));
        if (!body.ok) return setErrors(body.errors);
        const created = await createStudent.mutateAsync(body.data);
        if (!("student" in created)) return;
        sid = created.student.id;
        setCreatedStudentId(sid);
      }
      const body = {
        studentId: sid,
        classroomId: classroom?.value,
        mode,
        ...compact({
          enrolledOn: placement.enrolledOn,
          originSchool: placement.isTransferIn ? placement.originSchool.trim() : "",
          fundingType: funding.fundingType,
          assignmentReference: funding.assignmentReference.trim(),
          assignmentIssuedOn: funding.assignmentIssuedOn,
          funderLabel: funding.funderLabel.trim(),
          fundingNotes: funding.fundingNotes.trim(),
        }),
        ...(placement.isRepeating ? { isRepeating: true } : {}),
        ...(placement.isTransferIn ? { isTransferIn: true } : {}),
      };
      const v = validateWith(academicEnrollStudentBodySchema, body);
      if (!v.ok) return setErrors(v.errors);
      setDone(await enroll.mutateAsync(v.data));
    } catch (e) {
      const mapped = apiErrorToFieldErrors(e);
      setErrors(mapped);
      const candidates = duplicateCandidatesOf(e);
      if (candidates.length > 0) setDuplicates(candidates);
    }
  }

  function reset() {
    setDone(null);
    setStudentMode("existing");
    setStudent(null);
    setIdentity(emptyIdentity());
    setDuplicates([]);
    setAck(false);
    setAckReason("");
    setCreatedStudentId(null);
    setClassroom(null);
    setMode("CLASS");
    setPlacement({ enrolledOn: "", isRepeating: false, isTransferIn: false, originSchool: "" });
    setFunding({ fundingType: "PRIVATE", assignmentReference: "", assignmentIssuedOn: "", funderLabel: "", fundingNotes: "" });
    setErrors({});
    createStudent.reset();
    enroll.reset();
  }

  if (done) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("doneTitle")} />
        <Notice kind="success">{t("doneBody", { registration: done.registrationNumber ?? "—", status: t(`doneStatus.${done.status}`) })}</Notice>
        <div className="flex flex-wrap gap-2">
          <Link href={`/v2/enrollments/${done.id}`} className={buttonClass.primary}>
            {t("openEnrollment")}
          </Link>
          <button type="button" className={buttonClass.secondary} onClick={reset}>
            {t("another")}
          </button>
          <Link href="/v2/enrollments" className={buttonClass.ghost}>
            {t("backToList")}
          </Link>
        </div>
      </div>
    );
  }

  const apiError = enroll.error ?? createStudent.error;
  const apiDup = duplicateCandidatesOf(apiError);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <Wizard
        label={t("title")}
        finishLabel={t("finish")}
        isSubmitting={enroll.isPending || createStudent.isPending}
        onFinish={finish}
        footerNotice={apiError && apiDup.length === 0 ? <ErrorBlock error={apiError} /> : errors.duplicate ? <Notice kind="warning">{errors.duplicate}</Notice> : null}
        steps={[
          {
            id: "student",
            title: t("student.title"),
            description: t("student.description"),
            validate: validateStudentStep,
            content: (
              <div className="space-y-4">
                <fieldset className="flex flex-col gap-2 sm:flex-row sm:gap-6" disabled={!!createdStudentId}>
                  <legend className="sr-only">{t("student.modeLabel")}</legend>
                  {(["existing", "new"] as const).map((m) => (
                    <label key={m} className="flex min-h-[2.75rem] items-center gap-2 text-sm">
                      <input type="radio" name="student-mode" checked={studentMode === m} onChange={() => { setStudentMode(m); setErrors({}); }} className="h-4 w-4 accent-primary" />
                      {t(`student.mode.${m}`)}
                    </label>
                  ))}
                </fieldset>
                {studentMode === "existing" ? (
                  <FormField label={t("student.search")} required error={errors.student}>
                    {(c) => <SelectAsync {...c} value={student} onChange={setStudent} useOptions={useStudentOptions} placeholder={t("student.searchPlaceholder")} ariaLabel={t("student.search")} />}
                  </FormField>
                ) : createdStudentId ? (
                  <Notice kind="success">{t("student.alreadyCreated")}</Notice>
                ) : (
                  <>
                    <IdentityFields value={identity} onChange={(v) => { setIdentity(v); setDuplicates([]); setAck(false); }} errors={errors} compact />
                    <DuplicateWarning candidates={duplicates.length > 0 ? duplicates : apiDup} acknowledged={ack} onAcknowledge={setAck} reason={ackReason} onReason={setAckReason} reasonError={errors.duplicateReason} />
                  </>
                )}
              </div>
            ),
          },
          {
            id: "classroom",
            title: t("classroom.title"),
            description: t("classroom.description"),
            validate: validateClassStep,
            content: (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={t("classroom.year")}>
                    {(c) => <NativeSelect {...c} value={yearId} onChange={(v) => { setYearId(v); setClassroom(null); }} placeholder={t("classroom.choose")} options={(years.data ?? []).filter((y) => y.status !== "ARCHIVED").map((y) => ({ value: y.id, label: y.label }))} />}
                  </FormField>
                  <FormField label={t("classroom.classroom")} required error={errors.classroom ?? errors.classroomId}>
                    {(c) => <SelectAsync {...c} value={classroom} onChange={setClassroom} useOptions={useClassOpts} placeholder={t("classroom.searchPlaceholder")} ariaLabel={t("classroom.classroom")} />}
                  </FormField>
                </div>
                {classroomDetail.data ? (
                  <Notice kind={classroomDetail.data.capacity && classroomDetail.data.enrolledCount >= classroomDetail.data.capacity ? "warning" : "info"}>
                    {classroomDetail.data.capacity
                      ? t(classroomDetail.data.capacityIsHard ? "classroom.capacityHard" : "classroom.capacitySoft", { count: classroomDetail.data.enrolledCount, capacity: classroomDetail.data.capacity })
                      : t("classroom.noCapacity", { count: classroomDetail.data.enrolledCount })}
                  </Notice>
                ) : null}
                {liveExisting.length > 0 ? <Notice kind="warning">{t("classroom.alreadyEnrolled", { count: liveExisting.length })}</Notice> : null}
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">{t("classroom.modeLabel")}</legend>
                  <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
                    {(["CLASS", "A_LA_CARTE"] as const).map((m) => (
                      <label key={m} className="flex min-h-[2.75rem] items-center gap-2 text-sm">
                        <input type="radio" name="enrollment-mode" checked={mode === m} disabled={m === "A_LA_CARTE" && !aLaCarte.allowed} onChange={() => setMode(m)} className="h-4 w-4 accent-primary" />
                        {t(`classroom.mode.${m}`)}
                      </label>
                    ))}
                  </div>
                  {mode === "A_LA_CARTE" ? <p className="text-xs text-muted-foreground">{t("classroom.aLaCarteHint")}</p> : null}
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={t("classroom.enrolledOn")} hint={t("classroom.enrolledOnHint")} error={errors.enrolledOn}>
                    {(c) => <TextControl {...c} type="date" value={placement.enrolledOn} onChange={(v) => setPlacement((p) => ({ ...p, enrolledOn: v }))} />}
                  </FormField>
                </div>
                <CheckControl checked={placement.isRepeating} onChange={(v) => setPlacement((p) => ({ ...p, isRepeating: v }))} label={t("classroom.repeating")} />
                <CheckControl checked={placement.isTransferIn} onChange={(v) => setPlacement((p) => ({ ...p, isTransferIn: v }))} label={t("classroom.transferIn")} />
                {placement.isTransferIn ? (
                  <FormField label={t("classroom.originSchool")} required error={errors.originSchool}>
                    {(c) => <TextControl {...c} value={placement.originSchool} onChange={(v) => setPlacement((p) => ({ ...p, originSchool: v }))} maxLength={200} />}
                  </FormField>
                ) : null}
              </div>
            ),
          },
          {
            id: "funding",
            title: t("funding.title"),
            description: t("funding.description"),
            validate: validateFundingStep,
            content: (
              <div className="space-y-4">
                <FormField label={t("funding.type")} required error={errors.fundingType}>
                  {(c) => <NativeSelect {...c} value={funding.fundingType} onChange={(v) => setFunding((f) => ({ ...f, fundingType: v }))} options={fundingOptions.map((f) => ({ value: f.code, label: f.label || tFunding(f.code) }))} />}
                </FormField>
                {fundingDef?.requiresReference || fundingDef?.requiresFunder || funding.fundingType !== "PRIVATE" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label={t("funding.reference")} required={fundingDef?.requiresReference} hint={fundingDef?.requiresReference ? t("funding.referenceHint") : undefined} error={errors.assignmentReference}>
                      {(c) => <TextControl {...c} value={funding.assignmentReference} onChange={(v) => setFunding((f) => ({ ...f, assignmentReference: v }))} maxLength={100} />}
                    </FormField>
                    <FormField label={t("funding.issuedOn")} error={errors.assignmentIssuedOn}>
                      {(c) => <TextControl {...c} type="date" value={funding.assignmentIssuedOn} onChange={(v) => setFunding((f) => ({ ...f, assignmentIssuedOn: v }))} />}
                    </FormField>
                    <FormField label={t("funding.funder")} required={fundingDef?.requiresFunder} error={errors.funderLabel}>
                      {(c) => <TextControl {...c} value={funding.funderLabel} onChange={(v) => setFunding((f) => ({ ...f, funderLabel: v }))} maxLength={200} />}
                    </FormField>
                  </div>
                ) : null}
                <FormField label={t("funding.notes")} error={errors.fundingNotes}>
                  {(c) => <TextAreaControl {...c} value={funding.fundingNotes} onChange={(v) => setFunding((f) => ({ ...f, fundingNotes: v }))} maxLength={1000} />}
                </FormField>
              </div>
            ),
          },
          {
            id: "review",
            title: t("review.title"),
            content: (
              <div className="space-y-3">
                <dl className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{t("review.student")}</dt>
                    <dd>{studentMode === "existing" ? (student?.label ?? "—") : `${identity.firstName} ${identity.lastName}`.trim() || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("review.classroom")}</dt>
                    <dd>{classroomDetail.data?.name ?? classroom?.label ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("review.mode")}</dt>
                    <dd>{t(`classroom.mode.${mode}`)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("review.funding")}</dt>
                    <dd>{fundingDef?.label ?? funding.fundingType}</dd>
                  </div>
                  {funding.assignmentReference ? (
                    <div>
                      <dt className="text-muted-foreground">{t("funding.reference")}</dt>
                      <dd>{funding.assignmentReference}</dd>
                    </div>
                  ) : null}
                </dl>
                {studentMode === "new" && !createdStudentId ? <Notice kind="info">{t("review.newStudentNote")}</Notice> : null}
                <Notice kind="info">{t("review.statusNote")}</Notice>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
