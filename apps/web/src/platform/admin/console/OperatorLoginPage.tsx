"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Notice } from "@ecoledigitale/ui";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { getOperatorToken, OPERATOR_HOME_PATH, saveOperatorSession } from "../operator";
import { loginOperator } from "./hooks";

/** `/v2/platform/login` : connexion de l'opérateur (jeton super-admin, séparé des sessions de tenant). */
export function OperatorLoginPage() {
  const t = useTranslations("platform.login");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Déjà connecté : on va directement à la console.
  useEffect(() => {
    if (getOperatorToken()) router.replace(OPERATOR_HOME_PATH);
  }, [router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = { ...(email.trim() ? {} : { email: t("required") }), ...(password ? {} : { password: t("required") }) };
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      const session = await loginOperator(email, password);
      saveOperatorSession(session.token, session.email);
      router.replace(OPERATOR_HOME_PATH);
    } catch (error) {
      const unreachable = error instanceof ApiError && (error.code === ClientErrorCode.NETWORK || error.code === ClientErrorCode.TIMEOUT || error.status >= 500);
      setFailure(unreachable ? t("unreachable") : t("invalid"));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <form onSubmit={submit} noValidate aria-labelledby="operator-login-title" className="w-full max-w-md space-y-5 rounded-lg border p-6 shadow-sm">
        <div>
          <h1 id="operator-login-title" className="text-xl font-semibold">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Field label={t("email")} required error={errors.email}>
          {(c) => <Input {...c} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
        </Field>
        <Field label={t("password")} required error={errors.password}>
          {(c) => <Input {...c} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {failure ? <Notice tone="danger">{failure}</Notice> : null}
        <Button type="submit" className="min-h-11 w-full" disabled={pending}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </form>
    </main>
  );
}
