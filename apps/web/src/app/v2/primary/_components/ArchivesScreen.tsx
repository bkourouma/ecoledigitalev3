"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PrimaryYearArchiveDto } from "@ecoledigitale/contracts/v2/primary_school";
import { usePermission } from "@/platform/access";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, Notice, QueryBoundary, useFlash } from "@/platform/ui/states";
import { useFreezePrimaryArchive, useMyPrimaryClassrooms, usePreparePrimaryArchive, usePrimaryYearArchives } from "@/platform/v2/primary";
import { ConfirmActionDialog, FeatureGate, PrimaryError, RuleBanner, shortHash, toneOfArchive, useCodeLabels, useYearOptions } from "./shared";

/**
 * Archive d'année (direction) : préparer (manifeste, empreinte, manques éventuels), puis GELER. Le gel est IRRÉVERSIBLE : plus aucun
 * bilan de l'année ne pourra être écrit ; il exige une confirmation explicite. Rien n'est déplacé ni purgé (gel logique).
 */
export function ArchivesScreen() {
  return (
    <FeatureGate feature="primary.year-archive">
      <ArchivesBody />
    </FeatureGate>
  );
}

function ArchivesBody() {
  const t = useTranslations("v2PrimaryArchives");
  const label = useCodeLabels();
  const dateFmt = useDateFormat();
  const classes = useMyPrimaryClassrooms();
  const years = useYearOptions(classes.data ?? []);
  const canPrepare = usePermission("primary.archive.prepare").allowed;
  const canFreeze = usePermission("primary.archive.freeze").allowed;
  const [yearId, setYearId] = useState("");
  const archives = usePrimaryYearArchives(yearId || null, Boolean(yearId));
  const prepare = usePreparePrimaryArchive();
  const freeze = useFreezePrimaryArchive();
  const [freezing, setFreezing] = useState<PrimaryYearArchiveDto | null>(null);
  const flash = useFlash();

  useEffect(() => {
    if (!yearId && years.length === 1) setYearId(years[0]!.value);
  }, [years, yearId]);

  async function doPrepare() {
    flash.show(null);
    try {
      await prepare.mutateAsync({ academicYearId: yearId });
      flash.show(t("prepared"));
    } catch {
      /* affichée sous le bouton */
    }
  }

  async function doFreeze() {
    if (!freezing) return;
    try {
      await freeze.mutateAsync({ id: freezing.id });
      flash.show(t("frozen"));
      setFreezing(null);
    } catch {
      /* le refus reste affiché dans la fenêtre */
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <RuleBanner />
      {flash.node}
      <fieldset className="space-y-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{t("pickers")}</legend>
        <div className="max-w-sm">
          <FormField label={t("year")}>{(c) => <NativeSelect {...c} value={yearId} onChange={setYearId} placeholder={t("chooseYear")} options={years} />}</FormField>
        </div>
        {canPrepare ? (
          <div className="space-y-2">
            <button type="button" className={buttonClass.primary} disabled={!yearId || prepare.isPending} onClick={() => void doPrepare()}>
              {prepare.isPending ? t("preparing") : t("prepare")}
            </button>
            <PrimaryError error={prepare.error} />
          </div>
        ) : null}
      </fieldset>

      {!yearId ? (
        <Notice kind="info">{t("chooseYearFirst")}</Notice>
      ) : (
        <QueryBoundary query={archives} isEmpty={(archives.data ?? []).length === 0} empty={<EmptyBlock title={t("empty")} description={t("emptyHint")} />}>
          <ul className="space-y-4" aria-label={t("list")}>
            {(archives.data ?? []).map((a) => (
              <li key={a.id}>
                <section aria-label={t("archiveLabel", { status: label("archiveStatus", a.status) })} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge label={label("archiveStatus", a.status)} tone={toneOfArchive(a.status)} />
                    <p className="text-sm" data-testid="archive-counts">
                      {t("sealedCount", { sealed: a.reviewsSealed, total: a.reviewsTotal })}
                    </p>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">{t("manifest")}</dt>
                      <dd className="font-mono text-xs" title={a.manifestHash ?? undefined}>
                        {shortHash(a.manifestHash)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">{t("preparedAt")}</dt>
                      <dd>{dateFmt.instant(a.preparedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">{t("frozenAt")}</dt>
                      <dd>{a.frozenAt ? dateFmt.instant(a.frozenAt) : "—"}</dd>
                    </div>
                  </dl>
                  {a.blockers.length > 0 ? (
                    <div role="alert" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
                      <p className="font-medium">{t("blockers")}</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {a.blockers.map((b, i) => (
                          <li key={`${b.code}-${i}`}>{b.message}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {a.status === "FROZEN" ? <p className="text-sm text-muted-foreground">{t("frozenNote")}</p> : null}
                  {canFreeze && a.status === "READY" ? (
                    <button type="button" className={buttonClass.danger} onClick={() => setFreezing(a)}>
                      {t("freeze")}
                    </button>
                  ) : null}
                </section>
              </li>
            ))}
          </ul>
        </QueryBoundary>
      )}

      <ConfirmActionDialog
        open={freezing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setFreezing(null);
            freeze.reset();
          }
        }}
        title={t("freezeDialog.title")}
        description={t("freezeDialog.description")}
        confirmLabel={t("freezeDialog.confirm")}
        ackLabel={t("freezeDialog.ack")}
        destructive
        isPending={freeze.isPending}
        error={freeze.error}
        onConfirm={() => void doFreeze()}
      >
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">{t("freezeDialog.irreversible")}</p>
      </ConfirmActionDialog>
    </div>
  );
}
