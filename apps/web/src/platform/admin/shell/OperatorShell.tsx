"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, LoadingState } from "@ecoledigitale/ui";
import { buildOperatorMenu } from "../menu";
import { clearOperatorSession, getOperatorEmail, getOperatorToken, OPERATOR_LOGIN_PATH } from "../operator";
import { Shell } from "./Shell";

/**
 * Coquille de la console plateforme. Garde CLIENT : sans jeton d'opérateur valide, redirection vers la connexion
 * super-admin (le contenu n'est jamais rendu). La vraie barrière reste l'API (`SuperAdminAuthorizer` sur chaque route).
 */
export function OperatorShell({ children, activePath }: { children: ReactNode; activePath?: string | null }) {
  const t = useTranslations("admin.shell");
  const tu = useTranslations("ui");
  const router = useRouter();
  const [state, setState] = useState<{ ready: boolean; email: string | null }>({ ready: false, email: null });

  useEffect(() => {
    if (!getOperatorToken()) {
      router.replace(OPERATOR_LOGIN_PATH);
      return;
    }
    setState({ ready: true, email: getOperatorEmail() });
  }, [router]);

  const items = useMemo(() => buildOperatorMenu((key) => t(`operator.${key}` as never)), [t]);

  if (!state.ready) {
    return (
      <div className="p-6">
        <LoadingState label={tu("loading")} />
      </div>
    );
  }

  return (
    <Shell
      items={items}
      navLabel={t("operator.navLabel")}
      activePath={activePath}
      title={t("operator.title")}
      headerRight={
        <>
          {state.email ? <span className="hidden max-w-[16rem] truncate text-xs text-muted-foreground sm:inline">{t("operator.signedInAs", { email: state.email })}</span> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-9"
            onClick={() => {
              clearOperatorSession();
              router.replace(OPERATOR_LOGIN_PATH);
            }}
          >
            {t("logout")}
          </Button>
        </>
      }
    >
      {children}
    </Shell>
  );
}
