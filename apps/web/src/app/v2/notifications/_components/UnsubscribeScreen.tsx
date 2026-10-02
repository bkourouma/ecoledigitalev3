"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useApplyUnsubscribe, useUnsubscribeInfo } from "@/platform/v2/notifications";
import { useDescribeError } from "@/platform/ui/errors";
import { buttonClass } from "@/platform/ui/PageHeader";
import { LoadingBlock, Notice } from "@/platform/ui/states";

/**
 * Désinscription PUBLIQUE par lien signé (`/v2/notifications/unsubscribe?t=…`). Aucune session. Ouvrir le lien n'écrit
 * RIEN (les aperçus de liens des messageries le font) : la désinscription n'est appliquée que par le bouton de confirmation.
 */
export function UnsubscribeScreen() {
  const t = useTranslations("v2NotificationsUnsubscribe");
  const describe = useDescribeError();
  const params = useSearchParams();
  const token = params.get("t");
  const info = useUnsubscribeInfo(token);
  const apply = useApplyUnsubscribe();

  const done = apply.isSuccess || info.data?.applied === true;
  const channel = info.data?.channel;
  const organization = info.data?.organization;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      {!token ? (
        <Notice kind="error">{t("missingToken")}</Notice>
      ) : info.isPending ? (
        <LoadingBlock />
      ) : info.isError ? (
        <Notice kind="error">{describe(info.error)}</Notice>
      ) : done ? (
        <Notice kind="success">{organization ? t("doneWithOrg", { channel: t(`channels.${channel!}`), organization }) : t("done", { channel: t(`channels.${channel!}`) })}</Notice>
      ) : (
        <>
          <p className="text-sm">{organization ? t("questionWithOrg", { channel: t(`channels.${channel!}`), organization }) : t("question", { channel: t(`channels.${channel!}`) })}</p>
          <p className="text-sm text-muted-foreground">{t("note")}</p>
          {apply.error ? <Notice kind="error">{describe(apply.error)}</Notice> : null}
          <button type="button" className={buttonClass.primary} disabled={apply.isPending} onClick={() => apply.mutate({ token })}>
            {t("confirm")}
          </button>
        </>
      )}
    </div>
  );
}
