"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { councilsPaperSignatureSchema, type CouncilsMinutesDto, type CouncilsUnlockDto } from "@ecoledigitale/contracts/v2/councils";
import {
  useCouncil,
  useDecideUnlock,
  useGenerateMinutes,
  useMinutesDetail,
  useMinutesList,
  useMinutesPdfLink,
  useReopenCouncil,
  useRequestUnlock,
  useRevokeMinutes,
  useSignMinutes,
  useSignMinutesOnPaper,
  useUnlockRequests,
} from "@/platform/v2/councils";
import { Can } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, validateWith, type FieldErrors } from "@/platform/ui/validation";
import { CouncilStatusBar } from "./CouncilParts";
import { ActionError, CouncilSubNav, CouncilsBoundary, EnumLabel, Hash, PlaceholderBanner, ScrollTable, Section, TD, TH, councilTitle, useCouncilsError, useDateTime } from "./shared";

/**
 * Procès-verbal : génération (versions successives), état du rendu PDF et téléchargement par URL signée de courte durée,
 * signatures électroniques ou papier, signataires manquants, déverrouillage motivé (demande, approbation ou refus,
 * réouverture). La mention « jeu de règles de démonstration » vient de l'API.
 */
export function MinutesScreen({ councilId }: { councilId: string }) {
  const t = useTranslations("v2Councils.minutes");
  const council = useCouncil(councilId);
  const list = useMinutesList(councilId);
  const generate = useGenerateMinutes();
  const flash = useFlash();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const versions = [...(list.data ?? [])].sort((a, b) => b.version - a.version);
  const current = versions.find((m) => m.id === selectedId) ?? versions.find((m) => m.status !== "SUPERSEDED") ?? versions[0];
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={council.data ? councilTitle(council.data.council) : t("description")}
        actions={
          <Can permission="council.minutes.generate">
            <button type="button" className={buttonClass.primary} disabled={generate.isPending} onClick={() => generate.mutate({ councilId }, { onSuccess: (m) => { setSelectedId(m.id); flash.show(t("generated", { version: m.version })); } })}>
              {t("generate")}
            </button>
          </Can>
        }
      />
      <CouncilSubNav councilId={councilId} current="minutes" />
      {council.data ? (
        <>
          <PlaceholderBanner ruleSourceKind={council.data.council.ruleSourceKind} />
          <CouncilStatusBar detail={council.data} compact />
        </>
      ) : null}
      {flash.node}
      <ActionError error={generate.error} />
      <CouncilsBoundary query={list} isEmpty={versions.length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
        {current ? (
          <div className="space-y-4">
            <VersionsTable versions={versions} currentId={current.id} onSelect={setSelectedId} />
            <CurrentMinutes minutes={current} />
          </div>
        ) : null}
      </CouncilsBoundary>
      <UnlockSection councilId={councilId} status={council.data?.council.status ?? null} />
    </div>
  );
}

function VersionsTable({ versions, currentId, onSelect }: { versions: CouncilsMinutesDto[]; currentId: string; onSelect: (id: string) => void }) {
  const t = useTranslations("v2Councils.minutes.versions");
  const dt = useDateTime();
  return (
    <Section id="pv-versions" title={t("title")}>
      <ScrollTable caption={t("caption")}>
        <thead>
          <tr className="border-b">
            <th scope="col" className={TH}>{t("version")}</th>
            <th scope="col" className={TH}>{t("status")}</th>
            <th scope="col" className={TH}>{t("render")}</th>
            <th scope="col" className={TH}>{t("generatedAt")}</th>
            <th scope="col" className={TH}>{t("hash")}</th>
            <th scope="col" className={TH}><span className="sr-only">{t("actions")}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {versions.map((m) => (
            <tr key={m.id} aria-current={m.id === currentId ? "true" : undefined} className={m.id === currentId ? "bg-muted/40" : undefined}>
              <td className={TD}>{t("versionValue", { version: m.version })}</td>
              <td className={TD}><EnumLabel group="minutesStatus" value={m.status} /></td>
              <td className={TD}><EnumLabel group="renderStatus" value={m.renderStatus} /></td>
              <td className={TD}>{dt.dateTime(m.generatedAt)}</td>
              <td className={TD}><Hash value={m.snapshotHash} /></td>
              <td className={TD}>
                {m.id === currentId ? (
                  <span className="text-xs text-muted-foreground">{t("shown")}</span>
                ) : (
                  <button type="button" className={buttonClass.ghost} onClick={() => onSelect(m.id)} aria-label={t("show", { version: m.version })}>
                    {t("showShort")}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </Section>
  );
}

type Pending = { kind: "paper" } | { kind: "revoke" } | null;

function CurrentMinutes({ minutes }: { minutes: CouncilsMinutesDto }) {
  const t = useTranslations("v2Councils.minutes.current");
  const dt = useDateTime();
  const describe = useCouncilsError();
  const detail = useMinutesDetail(minutes.id);
  const pdf = useMinutesPdfLink();
  const sign = useSignMinutes();
  const revoke = useRevokeMinutes();
  const flash = useFlash();
  const [pending, setPending] = useState<Pending>(null);
  const [paperFor, setPaperFor] = useState<string | undefined>(undefined);
  const rendered = minutes.renderStatus === "RENDERED";
  const signable = minutes.status === "GENERATED";
  const snapshot = detail.data?.snapshot;
  return (
    <Section id="pv-current" title={t("title", { version: minutes.version })}>
      {flash.node}
      {minutes.placeholderNotice ? <Notice kind="warning">{minutes.placeholderNotice}</Notice> : null}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t("status")}</dt>
          <dd><EnumLabel group="minutesStatus" value={minutes.status} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("render")}</dt>
          <dd><EnumLabel group="renderStatus" value={minutes.renderStatus} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("generatedAt")}</dt>
          <dd className="text-sm font-medium">{dt.dateTime(minutes.generatedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("signedAt")}</dt>
          <dd className="text-sm font-medium">{dt.dateTime(minutes.signedAt)}</dd>
        </div>
      </dl>
      {minutes.revokedReason ? (
        <p className="text-sm">
          <span className="font-medium">{t("revokedReason")} : </span>
          {minutes.revokedReason}
        </p>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("pdfTitle")}</h3>
        {minutes.renderStatus === "PENDING" ? <p className="text-sm text-muted-foreground">{t("renderPending")}</p> : null}
        {minutes.renderStatus === "FAILED" ? <Notice kind="error">{t("renderFailed")}</Notice> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Can permission="council.minutes.read">
            <button type="button" className={buttonClass.secondary} disabled={!rendered || pdf.isPending} onClick={() => pdf.mutate({ id: minutes.id })}>
              {t("pdfPrepare")}
            </button>
          </Can>
          {pdf.data ? (
            <a href={pdf.data.url} target="_blank" rel="noopener noreferrer" className={buttonClass.primary}>
              {t("pdfDownload")}
            </a>
          ) : null}
        </div>
        {pdf.data ? (
          <p className="text-xs text-muted-foreground">
            {t("pdfExpires", { date: dt.dateTime(pdf.data.expiresAt) })} <Hash value={pdf.data.renderHash} />
          </p>
        ) : null}
        {pdf.error ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {describe(pdf.error)}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("signaturesTitle")}</h3>
        {minutes.signatures.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSignature")}</p>
        ) : (
          <ScrollTable caption={t("signaturesCaption")}>
            <thead>
              <tr className="border-b">
                <th scope="col" className={TH}>{t("signer")}</th>
                <th scope="col" className={TH}>{t("role")}</th>
                <th scope="col" className={TH}>{t("method")}</th>
                <th scope="col" className={TH}>{t("signedOn")}</th>
                <th scope="col" className={TH}>{t("hash")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {minutes.signatures.map((s) => (
                <tr key={s.id}>
                  <td className={TD}>{s.signerName}</td>
                  <td className={TD}>{s.roleCode}</td>
                  <td className={TD}><EnumLabel group="signatureMethod" value={s.method} /></td>
                  <td className={TD}>{dt.dateTime(s.signedAt)}</td>
                  <td className={TD}><Hash value={s.signedHash} /></td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        )}
        <div>
          <h4 className="text-sm font-medium">{t("missingTitle")}</h4>
          {minutes.missingSigners.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMissing")}</p>
          ) : (
            <ul aria-label={t("missingTitle")} className="mt-1 divide-y rounded-md border">
              {minutes.missingSigners.map((m) => (
                <li key={m.participantId} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <span className="text-sm">
                    {m.displayName} <span className="text-xs text-muted-foreground">{m.roleCode}</span> <StatusBadge label={t("toSign")} tone="warning" />
                  </span>
                  {signable ? (
                    <Can permission="council.minutes.sign">
                      <button type="button" className={buttonClass.secondary} onClick={() => { setPaperFor(m.participantId); setPending({ kind: "paper" }); }} aria-label={t("paperFor", { name: m.displayName })}>
                        {t("paper")}
                      </button>
                    </Can>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <ActionError error={sign.error} />
        <div className="flex flex-wrap gap-2">
          {signable ? (
            <Can permission="council.minutes.sign">
              <button type="button" className={buttonClass.primary} disabled={sign.isPending} onClick={() => sign.mutate({ id: minutes.id }, { onSuccess: () => flash.show(t("signed")) })}>
                {t("signElectronic")}
              </button>
            </Can>
          ) : null}
          {minutes.status === "GENERATED" || minutes.status === "SIGNED" ? (
            <Can permission="council.minutes.revoke">
              <button type="button" className={buttonClass.danger} onClick={() => setPending({ kind: "revoke" })}>
                {t("revoke")}
              </button>
            </Can>
          ) : null}
        </div>
      </div>

      {snapshot ? (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-semibold">{t("contentTitle")}</summary>
          <div className="mt-3 space-y-2">
            {snapshot.placeholderNotice ? <p className="text-xs font-medium">{snapshot.placeholderNotice}</p> : null}
            <ScrollTable caption={t("contentCaption")}>
              <thead>
                <tr className="border-b">
                  <th scope="col" className={TH}>{t("student")}</th>
                  <th scope="col" className={TH}>{t("decisions")}</th>
                  <th scope="col" className={TH}>{t("appreciation")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {snapshot.students.map((s) => (
                  <tr key={s.enrollmentId}>
                    <td className={TD}>{s.name}</td>
                    <td className={TD}>
                      {s.decisions.length === 0
                        ? "—"
                        : s.decisions.map((d, i) => (
                            <div key={i}>
                              {d.decisionTypeCode}
                              {d.differsFromSuggestion ? <span className="ml-1 text-xs text-muted-foreground">({t("differs")})</span> : null}
                            </div>
                          ))}
                    </td>
                    <td className={TD}>{s.appreciation ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          </div>
        </details>
      ) : null}

      {pending?.kind === "paper" ? <PaperDialog minutes={minutes} initial={paperFor} onClose={() => setPending(null)} onDone={() => flash.show(t("paperSigned"))} /> : null}
      {pending?.kind === "revoke" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={t("revokeDialog.title")}
          description={t("revokeDialog.description")}
          reasonLabel={t("revokeDialog.label")}
          confirmLabel={t("revokeDialog.confirm")}
          destructive
          minLength={10}
          maxLength={1000}
          isPending={revoke.isPending}
          error={revoke.error}
          onConfirm={(reason) => revoke.mutate({ id: minutes.id, reason }, { onSuccess: () => { flash.show(t("revoked")); setPending(null); } })}
        />
      ) : null}
    </Section>
  );
}

function PaperDialog({ minutes, initial, onClose, onDone }: { minutes: CouncilsMinutesDto; initial?: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Councils.minutes.paperDialog");
  const paper = useSignMinutesOnPaper();
  const [participantId, setParticipantId] = useState(initial ?? "");
  const [key, setKey] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  function submit() {
    const v = validateWith(councilsPaperSignatureSchema, { participantId, evidenceObjectKey: key.trim() });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    paper.mutate(
      { id: minutes.id, ...v.data },
      {
        onSuccess: () => {
          onDone();
          onClose();
        },
        onError: (e) => setErrors(apiErrorToFieldErrors(e)),
      },
    );
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={paper.isPending} error={paper.error && Object.keys(apiErrorToFieldErrors(paper.error)).length === 0 ? paper.error : undefined}>
      <FormField label={t("signer")} required error={errors.participantId ?? null}>
        {(c) => <NativeSelect {...c} value={participantId} placeholder={t("chooseSigner")} onChange={setParticipantId} options={minutes.missingSigners.map((m) => ({ value: m.participantId, label: m.displayName }))} />}
      </FormField>
      <FormField label={t("evidence")} hint={t("evidenceHint")} required error={errors.evidenceObjectKey ?? null}>
        {(c) => <TextControl {...c} value={key} onChange={setKey} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Déverrouillage motivé : demande -> approbation (ou refus) -> réouverture
// ---------------------------------------------------------------------------

type UnlockPending = { kind: "request" } | { kind: "approve" | "reject"; request: CouncilsUnlockDto } | { kind: "reopen" } | null;

function UnlockSection({ councilId, status }: { councilId: string; status: string | null }) {
  const t = useTranslations("v2Councils.unlock");
  const dt = useDateTime();
  const requests = useUnlockRequests(councilId);
  const request = useRequestUnlock();
  const approve = useDecideUnlock("approve");
  const reject = useDecideUnlock("reject");
  const reopen = useReopenCouncil();
  const flash = useFlash();
  const [pending, setPending] = useState<UnlockPending>(null);
  const list = requests.data ?? [];
  const hasApproved = list.some((r) => r.status === "APPROVED");
  const locked = status === "CLOSED" || status === "SIGNED";
  const decide = pending?.kind === "reject" ? reject : approve;
  return (
    <Section
      id="pv-unlock"
      title={t("title")}
      actions={
        locked ? (
          <Can permission="council.unlock.request">
            <button type="button" className={buttonClass.secondary} onClick={() => setPending({ kind: "request" })}>
              {t("request")}
            </button>
          </Can>
        ) : undefined
      }
    >
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {flash.node}
      <ActionError error={reopen.error} />
      <CouncilsBoundary query={requests} isEmpty={list.length === 0} empty={<p className="text-sm text-muted-foreground">{t("none")}</p>}>
        <ScrollTable caption={t("caption")}>
          <thead>
            <tr className="border-b">
              <th scope="col" className={TH}>{t("requestedBy")}</th>
              <th scope="col" className={TH}>{t("reason")}</th>
              <th scope="col" className={TH}>{t("status")}</th>
              <th scope="col" className={TH}>{t("decidedBy")}</th>
              <th scope="col" className={TH}><span className="sr-only">{t("actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((r) => (
              <tr key={r.id}>
                <td className={TD}>
                  {r.requestedByName}
                  <div className="text-xs text-muted-foreground">{dt.dateTime(r.requestedAt)}</div>
                </td>
                <td className={TD}>{r.reason}</td>
                <td className={TD}>
                  <EnumLabel group="unlockStatus" value={r.status} />
                  {r.fourEyesWaived ? <div className="text-xs text-muted-foreground">{t("fourEyesWaived")}</div> : null}
                </td>
                <td className={TD}>
                  {r.decidedByName ?? "—"}
                  {r.decisionNote ? <div className="text-xs text-muted-foreground">{r.decisionNote}</div> : null}
                </td>
                <td className={TD}>
                  {r.status === "REQUESTED" ? (
                    <Can permission="council.unlock.approve">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={buttonClass.primary} onClick={() => setPending({ kind: "approve", request: r })}>
                          {t("approve")}
                        </button>
                        <button type="button" className={buttonClass.secondary} onClick={() => setPending({ kind: "reject", request: r })}>
                          {t("reject")}
                        </button>
                      </div>
                    </Can>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </CouncilsBoundary>
      {hasApproved && locked ? (
        <div className="space-y-1">
          <p className="text-sm">{t("approvedHint")}</p>
          <button type="button" className={buttonClass.primary} onClick={() => setPending({ kind: "reopen" })}>
            {t("reopen")}
          </button>
        </div>
      ) : null}

      {pending?.kind === "request" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={t("requestDialog.title")}
          description={t("requestDialog.description")}
          reasonLabel={t("requestDialog.label")}
          confirmLabel={t("requestDialog.confirm")}
          minLength={20}
          maxLength={2000}
          isPending={request.isPending}
          error={request.error}
          onConfirm={(reason) => request.mutate({ councilId, reason }, { onSuccess: () => { flash.show(t("requested")); setPending(null); } })}
        />
      ) : null}
      {pending?.kind === "approve" || pending?.kind === "reject" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={t(`${pending.kind}Dialog.title`)}
          description={t(`${pending.kind}Dialog.description`)}
          reasonLabel={t(`${pending.kind}Dialog.label`)}
          confirmLabel={t(`${pending.kind}Dialog.confirm`)}
          reasonRequired={pending.kind === "reject"}
          minLength={pending.kind === "reject" ? 5 : 1}
          maxLength={1000}
          isPending={decide.isPending}
          error={decide.error}
          onConfirm={(note) => decide.mutate({ id: pending.request.id, ...(note ? { note } : {}) }, { onSuccess: () => { flash.show(t(pending.kind === "approve" ? "approved" : "rejected")); setPending(null); } })}
        />
      ) : null}
      {pending?.kind === "reopen" ? (
        <FormDialog open onOpenChange={(o) => !o && setPending(null)} title={t("reopenDialog.title")} description={t("reopenDialog.description")} submitLabel={t("reopenDialog.confirm")} onSubmit={() => reopen.mutate({ id: councilId }, { onSuccess: () => { flash.show(t("reopened")); setPending(null); } })} isPending={reopen.isPending} error={reopen.error}>
          <p className="text-sm">{t("reopenDialog.body")}</p>
        </FormDialog>
      ) : null}
    </Section>
  );
}
