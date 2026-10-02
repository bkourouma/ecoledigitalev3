"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFamilyLearners, useFamilyStatement } from "@/platform/v2/portal";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { FamilyFinance } from "../../_family/FamilyFinance";

/**
 * « Ma scolarité » / « Scolarité de mes enfants » (`/v2/finance/me`) : lit EXCLUSIVEMENT les routes famille `/api/v1/finance/me/*`
 * (`finance.child.*` pour un parent, `finance.self.*` pour un élève). La propriété — l'apprenant est la fiche liée au compte, ou
 * l'enfant d'un tuteur vivant — est relue côté serveur à chaque requête ; hors périmètre, 404 uniforme. Ce parcours reste disponible
 * pour les liens existants ; les portails `/v2/parent` et `/v2/student` affichent les mêmes écrans dans leur coquille.
 */
export function MyFinanceScreen() {
  const t = useTranslations("v2Finance.me");
  const learners = useFamilyLearners();
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {learners.isPending ? <LoadingBlock /> : null}
      {learners.isError ? <ErrorBlock error={learners.error} onRetry={() => void learners.refetch()} /> : null}
      {learners.data && learners.data.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("listLabel")}>
        {(learners.data ?? []).map((l) => (
          <li key={l.learnerId}>
            <LearnerCard learnerId={l.learnerId} name={l.displayName ?? t("learnerFallback")} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function LearnerCard({ learnerId, name }: { learnerId: string; name: string }) {
  const t = useTranslations("v2Finance.me.card");
  const money = useMoney();
  const statement = useFamilyStatement(learnerId);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">{name}</h2>
      {statement.isPending && statement.fetchStatus !== "idle" ? <LoadingBlock className="py-2" /> : null}
      {statement.isError ? <Notice kind="info">{t("unavailable")}</Notice> : null}
      {statement.data ? (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("billed")}</dt>
            <dd className="tabular-nums">{money.of(statement.data.totals.billed)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("collected")}</dt>
            <dd className="tabular-nums">{money.of(statement.data.totals.collected)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">{t("outstanding")}</dt>
            <dd className="text-lg font-semibold tabular-nums">{money.of(statement.data.totals.outstanding)}</dd>
          </div>
        </dl>
      ) : null}
      <Link href={`/v2/finance/me/${learnerId}`} className={buttonClass.secondary}>
        {t("open")}
        <span className="sr-only"> — {name}</span>
      </Link>
    </div>
  );
}

export function MyChildFinanceScreen({ learnerId }: { learnerId: string }) {
  const t = useTranslations("v2Finance.me.detail");
  const learners = useFamilyLearners();
  if (learners.isPending) return <LoadingBlock />;
  if (learners.isError) return <ErrorBlock error={learners.error} onRetry={() => void learners.refetch()} />;
  // Garde d'écran : la liste de la finance (propriété relue côté serveur) fait foi ; un autre identifiant n'est jamais interrogé.
  const learner = learners.data.find((l) => l.learnerId === learnerId);
  if (!learner) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("forbiddenTitle")} />
        <Notice kind="warning">{t("forbidden")}</Notice>
        <Link href="/v2/finance/me" className={buttonClass.secondary}>
          {t("back")}
        </Link>
      </div>
    );
  }
  return (
    <FamilyFinance
      learnerId={learnerId}
      title={learner.displayName ?? t("learnerFallback")}
      receiptHref={(id) => `/v2/finance/me/${learnerId}/receipts/${id}`}
    />
  );
}
