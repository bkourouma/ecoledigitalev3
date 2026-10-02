"use client";

import { useTranslations } from "next-intl";
import type { HigherDocumentDto } from "@ecoledigitale/contracts/v2/higher";
import { usePermission } from "@/platform/access";
import { useChildHigherDocuments, useMyHigherDocuments } from "@/platform/v2/higher-documents";
import { useMyChildren } from "@/platform/v2/people";
import { useDateFormat } from "@/platform/ui/format";
import { PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { DocumentPdfActions, PdfStateBadge, SealBadge, VerifyLink } from "./DocumentPdf";
import { toneOfStatus } from "../../assessments/_components/shared";

/**
 * Mes documents officiels (diplômes, attestations) : ceux de l'étudiant connecté (`higher.self.read`) et ceux de ses enfants pour un
 * tuteur (`higher.child.read`). Le serveur ne renvoie que les documents PUBLIÉS ; un document révoqué n'est plus téléchargeable.
 */
export function MyDocumentsScreen() {
  const t = useTranslations("v2HigherPdf.mine");
  const tErrors = useTranslations("errors");
  const self = usePermission("higher.self.read");
  const child = usePermission("higher.child.read");
  const loading = self.isLoading || child.isLoading;
  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      {loading ? <LoadingBlock /> : null}
      {!loading && !self.allowed && !child.allowed ? <Notice kind="warning">{tErrors("forbidden")}</Notice> : null}
      {self.allowed ? <OwnDocuments /> : null}
      {child.allowed ? <ChildrenDocuments /> : null}
    </div>
  );
}

function OwnDocuments() {
  const t = useTranslations("v2HigherPdf.mine");
  const docs = useMyHigherDocuments();
  return (
    <section aria-labelledby="own-documents" className="space-y-3">
      <h2 id="own-documents" className="text-lg font-semibold">
        {t("own")}
      </h2>
      <DocumentList query={docs} label={t("own")} />
    </section>
  );
}

function ChildrenDocuments() {
  const t = useTranslations("v2HigherPdf.mine");
  const children = useMyChildren();
  return (
    <div className="space-y-6">
      {children.isError ? <ErrorBlock error={children.error} onRetry={() => void children.refetch()} /> : null}
      {children.data && children.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("noChild")}</p> : null}
      {(children.data ?? []).map((c) => (
        <ChildSection key={c.id} studentId={c.id} name={c.displayName} />
      ))}
    </div>
  );
}

function ChildSection({ studentId, name }: { studentId: string; name: string }) {
  const t = useTranslations("v2HigherPdf.mine");
  const docs = useChildHigherDocuments(studentId);
  return (
    <section aria-labelledby={`child-docs-${studentId}`} className="space-y-3">
      <h2 id={`child-docs-${studentId}`} className="text-lg font-semibold">
        {t("child", { name })}
      </h2>
      <DocumentList query={docs} label={t("child", { name })} />
    </section>
  );
}

interface QueryLike {
  isPending: boolean;
  fetchStatus: string;
  isError: boolean;
  error: unknown;
  data: HigherDocumentDto[] | undefined;
  refetch: () => unknown;
}

function DocumentList({ query, label }: { query: QueryLike; label: string }) {
  const t = useTranslations("v2HigherPdf.mine");
  const tKind = useTranslations("v2Higher.documentKind");
  const tStatus = useTranslations("v2Higher.documentStatus");
  const date = useDateFormat();
  if (query.isPending && query.fetchStatus !== "idle") return <LoadingBlock />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return null;
  if (query.data.length === 0) return <EmptyBlock title={t("empty")} description={t("emptyHint")} />;
  return (
    <ul className="grid gap-3 md:grid-cols-2" aria-label={label}>
      {query.data.map((d) => (
        <li key={d.id} className="flex flex-col gap-2 rounded-lg border p-3">
          <div>
            <p className="font-medium">{tKind(d.documentKind)}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {d.reference} · {t("version", { n: d.version })}
            </p>
            <p className="text-xs text-muted-foreground">{t("issuedOn", { date: date.instant(d.issuedAt) })}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            <StatusBadge label={tStatus(d.status)} tone={toneOfStatus(d.status)} />
            <SealBadge sealed={d.sealed} />
            <PdfStateBadge doc={d} />
          </div>
          {d.status === "REVOKED" && d.revokeReason ? <p className="text-xs text-destructive">{t("revoked", { reason: d.revokeReason })}</p> : null}
          <VerifyLink code={d.verificationCode} />
          <p className="text-xs text-muted-foreground">{t("verifyHint")}</p>
          <div className="mt-auto">
            <DocumentPdfActions doc={d} />
          </div>
        </li>
      ))}
    </ul>
  );
}
